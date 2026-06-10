import {
  createClass,
  ensureDefaults,
  ensureOnlineEditableContent,
  exportPlainTextFromRich,
  getFileRecord,
  getUser,
  grantClassTeacherAccess,
  isTextFileName,
  joinClass,
  listClassesForStudent,
  listClassesForTeacher,
  listSubmissionsForTeacher,
  listSubmissionsForStudent,
  listTeachers,
  loadSubmissionOriginalText,
  loginUser,
  registerUser,
  revokeClassTeacherAccess,
  saveOnlineReview,
  saveStudentCorrection,
  statusLabel,
  submitAssignment,
  uploadReviewFile,
} from "./storage.js";

const SESSION_KEY = "hw_platform_current_user";

const appRoot = document.getElementById("app");
const topbarActions = document.getElementById("topbarActions");
const modal = document.getElementById("modal");

let currentUser = null;

const CLIENT_ID = (() => {
  const key = "hw_platform_client_id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
})();

const collab = (() => {
  const channel = new BroadcastChannel("hw_platform_collab");
  const knownLocks = new Map();
  const heldLocks = new Set();
  const listeners = new Set();
  const ttlMs = 15000;
  const heartbeatMs = 5000;

  function lockKey({ submissionId, doc, line }) {
    return `${submissionId}|${doc}|${line}`;
  }

  function now() {
    return Date.now();
  }

  function cleanupExpired() {
    const t = now();
    for (const [k, info] of knownLocks.entries()) {
      if (!info?.expiresAt || info.expiresAt <= t) knownLocks.delete(k);
    }
  }

  function notify() {
    for (const fn of listeners) fn();
  }

  function upsertLock({ key, ownerId, ownerLabel, expiresAt }) {
    knownLocks.set(key, { ownerId, ownerLabel, expiresAt });
  }

  channel.addEventListener("message", (event) => {
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    cleanupExpired();

    if (data.type === "lockAcquire") {
      upsertLock({ key: data.key, ownerId: data.ownerId, ownerLabel: data.ownerLabel, expiresAt: data.expiresAt });
      notify();
      return;
    }
    if (data.type === "lockRelease") {
      const current = knownLocks.get(data.key);
      if (current?.ownerId === data.ownerId) {
        knownLocks.delete(data.key);
        notify();
      }
      return;
    }
    if (data.type === "lockHeartbeat") {
      const current = knownLocks.get(data.key);
      if (current?.ownerId === data.ownerId) {
        upsertLock({ key: data.key, ownerId: data.ownerId, ownerLabel: data.ownerLabel, expiresAt: data.expiresAt });
        notify();
      }
    }
  });

  let heartbeatTimer = null;
  function ensureHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      cleanupExpired();
      const expiresAt = now() + ttlMs;
      for (const key of heldLocks) {
        const current = knownLocks.get(key);
        if (current?.ownerId !== CLIENT_ID) continue;
        upsertLock({ key, ownerId: CLIENT_ID, ownerLabel: current.ownerLabel, expiresAt });
        channel.postMessage({ type: "lockHeartbeat", key, ownerId: CLIENT_ID, ownerLabel: current.ownerLabel, expiresAt });
      }
      notify();
    }, heartbeatMs);
  }

  function getLockInfo(key) {
    cleanupExpired();
    return knownLocks.get(key) || null;
  }

  function isLockedByOther(key) {
    const info = getLockInfo(key);
    return !!info && info.ownerId !== CLIENT_ID;
  }

  function acquire({ submissionId, doc, line, ownerLabel }) {
    cleanupExpired();
    const key = lockKey({ submissionId, doc, line });
    const existing = knownLocks.get(key);
    if (existing && existing.ownerId !== CLIENT_ID && existing.expiresAt > now()) {
      return { ok: false, key, ownerLabel: existing.ownerLabel || "其他用户" };
    }

    const expiresAt = now() + ttlMs;
    upsertLock({ key, ownerId: CLIENT_ID, ownerLabel: ownerLabel || "当前用户", expiresAt });
    heldLocks.add(key);
    ensureHeartbeat();
    channel.postMessage({ type: "lockAcquire", key, ownerId: CLIENT_ID, ownerLabel: ownerLabel || "当前用户", expiresAt });
    notify();
    return { ok: true, key };
  }

  function releaseKey(key) {
    const current = knownLocks.get(key);
    if (current?.ownerId === CLIENT_ID) {
      knownLocks.delete(key);
      heldLocks.delete(key);
      channel.postMessage({ type: "lockRelease", key, ownerId: CLIENT_ID });
      notify();
    }
  }

  function releaseAllForSubmission(submissionId) {
    for (const key of Array.from(heldLocks)) {
      if (String(key).startsWith(`${submissionId}|`)) releaseKey(key);
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.addEventListener("beforeunload", () => {
    for (const key of Array.from(heldLocks)) releaseKey(key);
  });

  return {
    lockKey,
    acquire,
    releaseKey,
    releaseAllForSubmission,
    getLockInfo,
    isLockedByOther,
    subscribe,
  };
})();

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === false || value === null || value === undefined) {
      } else node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "";
  return date.toLocaleString();
}

function setSessionUser(username) {
  if (!username) sessionStorage.removeItem(SESSION_KEY);
  else sessionStorage.setItem(SESSION_KEY, username);
}

function downloadBlob({ blob, fileName, contentType }) {
  const url = URL.createObjectURL(contentType ? new Blob([blob], { type: contentType }) : blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function showNotice({ type, text }) {
  return el("div", { class: `notice ${type || ""}`, text });
}

function closeModal() {
  if (modal.open) modal.close();
  clear(modal);
}

function openModal({ title, body, footerButtons }) {
  clear(modal);
  const header = el(
    "div",
    { class: "modal-header" },
    el("div", { class: "modal-title", text: title || "" }),
    //el("button", { class: "btn small", onClick: closeModal, type: "button" }, "关闭")
  );
  const bodyWrap = el("div", { class: "modal-body" }, body);
  const footer = el("div", { class: "modal-footer" }, footerButtons || []);
  modal.append(header, bodyWrap, footer);
  modal.showModal();
}

async function bootstrap() {
  await ensureDefaults();
  const lastUser = sessionStorage.getItem(SESSION_KEY);
  if (lastUser) {
    const user = await getUser(lastUser);
    if (user) currentUser = user;
  }
  render();
}

function renderTopbar() {
  clear(topbarActions);
  if (!currentUser) return;

  topbarActions.append(
    el("div", { class: "pill" }, `${currentUser.role}：${currentUser.displayName}（${currentUser.username}）`),
    el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: () => {
          currentUser = null;
          setSessionUser(null);
          render();
        },
      },
      "退出登录"
    )
  );
}

function render() {
  renderTopbar();
  clear(appRoot);
  if (!currentUser) renderLogin();
  else renderDashboard();
}

function renderLogin() {
  let mode = "login";

  const tabs = el(
    "div",
    { class: "tabs" },
    el(
      "button",
      {
        class: `tab ${mode === "login" ? "active" : ""}`,
        type: "button",
        onClick: () => {
          mode = "login";
          redraw();
        },
      },
      "登录"
    ),
    el(
      "button",
      {
        class: `tab ${mode === "register" ? "active" : ""}`,
        type: "button",
        onClick: () => {
          mode = "register";
          redraw();
        },
      },
      "注册"
    )
  );

  const content = el("div");

  function redraw() {
    [...tabs.querySelectorAll(".tab")].forEach((btn) => btn.classList.remove("active"));
    tabs.querySelector(mode === "login" ? ".tab:nth-child(1)" : ".tab:nth-child(2)")?.classList.add("active");
    clear(content);
    content.append(mode === "login" ? buildLoginForm() : buildRegisterForm());
  }

  function buildLoginForm() {
    const username = el("input", { autocomplete: "username", placeholder: "例如：teacher" });
    const password = el("input", { autocomplete: "current-password", type: "password", placeholder: "例如：123456" });
    const role = el(
      "select",
      null,
      el("option", { value: "学生", text: "学生" }),
      el("option", { value: "教师", text: "教师" })
    );
    const msg = el("div");

    const form = el(
      "form",
      {
        onSubmit: async (event) => {
          event.preventDefault();
          clear(msg);
          try {
            const user = await loginUser({ username: username.value, password: password.value, role: role.value });
            currentUser = user;
            setSessionUser(user.username);
            render();
          } catch (err) {
            msg.append(showNotice({ type: "bad", text: err?.message || "登录失败" }));
          }
        },
      },
      el("div", { class: "form-row" }, el("label", { text: "用户名" }), username),
      el("div", { class: "form-row" }, el("label", { text: "密码" }), password),
      el("div", { class: "form-row" }, el("label", { text: "角色" }), role),
      el("div", { class: "form-row row" }, el("button", { class: "btn primary", type: "submit" }, "登录")),
      msg,
      el("div", { class: "hint" }, "提示：本版本所有数据都存储在浏览器本地，同一台设备/同一浏览器内可体验完整流程。")
    );

    return form;
  }

  function buildRegisterForm() {
    const username = el("input", { autocomplete: "username", placeholder: "建议英文/数字" });
    const password = el("input", { autocomplete: "new-password", type: "password" });
    const displayName = el("input", { placeholder: "例如：张三" });
    const role = el(
      "select",
      null,
      el("option", { value: "学生", text: "学生" }),
      el("option", { value: "教师", text: "教师" })
    );
    const msg = el("div");

    const form = el(
      "form",
      {
        onSubmit: async (event) => {
          event.preventDefault();
          clear(msg);
          try {
            await registerUser({
              username: username.value,
              password: password.value,
              displayName: displayName.value,
              role: role.value,
            });
            msg.append(showNotice({ type: "ok", text: "注册成功，请切换到登录" }));
            username.value = "";
            password.value = "";
            displayName.value = "";
            role.value = "学生";
          } catch (err) {
            msg.append(showNotice({ type: "bad", text: err?.message || "注册失败" }));
          }
        },
      },
      el("div", { class: "form-row" }, el("label", { text: "用户名" }), username),
      el("div", { class: "form-row" }, el("label", { text: "密码" }), password),
      el("div", { class: "form-row" }, el("label", { text: "姓名/显示名" }), displayName),
      el("div", { class: "form-row" }, el("label", { text: "角色" }), role),
      el("div", { class: "form-row row" }, el("button", { class: "btn primary", type: "submit" }, "注册")),
      msg,
      el("div", { class: "hint" }, "提示：无后端版本不适合保存敏感账号密码，请仅用于作业演示。")
    );

    return form;
  }

  redraw();

  appRoot.append(
    el(
      "div",
      { class: "card" },
      el("div", { class: "row-between" }, el("div", { class: "pill" }, "欢迎使用 Web 本地存储版"), tabs),
      el("div", { class: "grid-2", style: "margin-top:12px" }, el("div", { class: "card" }, content))
    )
  );
}

function renderDashboard() {
  const headerCard = el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "row-between" },
      el("div", null, el("div", { style: "font-weight:700" }, "工作台"), el("div", { class: "muted" }, "数据存储在浏览器 IndexedDB")),
      el(
        "div",
        { class: "row" },
        el("div", { class: "pill" }, `当前角色：${currentUser.role}`),
        el("div", { class: "pill" }, `在线批改/订正支持：txt/java/md/csv`)
      )
    )
  );

  appRoot.append(headerCard);
  if (currentUser.role === "教师") {
    appRoot.append(renderTeacherPanel());
  } else {
    appRoot.append(renderStudentPanel());
  }
}

function renderStudentPanel() {
  const msg = el("div");
  const fileInput = el("input", { type: "file", accept: ".pdf,.doc,.docx,.zip,.java,.txt,.md,.csv" });
  const classSelect = el("select");
  const classHint = el("div", { class: "hint" });
  const submitBtn = el(
    "button",
    {
      class: "btn primary",
      type: "button",
      onClick: async () => {
        clear(msg);
        try {
          const file = fileInput.files?.[0];
          await submitAssignment({ studentUser: currentUser, file, classId: classSelect.value });
          fileInput.value = "";
          msg.append(showNotice({ type: "ok", text: "上传成功" }));
          await refresh();
        } catch (err) {
          msg.append(showNotice({ type: "bad", text: err?.message || "上传失败" }));
        }
      },
    },
    "上传作业"
  );

  const tableWrap = el("div");

  async function refreshClasses() {
    const classes = await listClassesForStudent(currentUser.username);
    const joined = classes.filter((klass) => klass.joined);
    clear(classSelect);
    if (!joined.length) {
      classSelect.append(el("option", { value: "", text: "请先加入班级" }));
      classSelect.disabled = true;
      classHint.textContent = "学生提交作业前必须先加入一个班级。";
    } else {
      classSelect.disabled = false;
      for (const klass of joined) {
        classSelect.append(el("option", { value: klass.id, text: klass.name }));
      }
      classHint.textContent = `已加入 ${joined.length} 个班级，提交结果仅该班有权限教师可见。`;
    }
  }

  async function refresh() {
    clear(tableWrap);
    const submissions = await listSubmissionsForStudent(currentUser.username);
    tableWrap.append(buildSubmissionTable(submissions, { role: "学生" }));
  }

  refreshClasses();
  refresh();

  return el(
    "div",
    { class: "card" },
    el("div", { style: "font-weight:700; margin-bottom:10px" }, "学生端"),
    el(
      "div",
      { class: "row" },
      el("div", { style: "min-width:220px; flex:1" }, el("label", { text: "提交班级" }), classSelect, classHint),
      el("button", { class: "btn", type: "button", onClick: () => openJoinClassModal({ afterJoin: refreshClasses }) }, "加入班级")
    ),
    el(
      "div",
      { class: "row", style: "margin-top:12px" },
      el("div", { style: "min-width:320px; flex:1" }, fileInput),
      submitBtn,
      el("button", { class: "btn", type: "button", onClick: refresh }, "刷新")
    ),
    msg,
    el("div", { style: "margin-top:12px" }, tableWrap)
  );
}

async function openJoinClassModal({ afterJoin }) {
  const body = el("div");
  const msg = el("div");

  async function redraw() {
    clear(body);
    const classes = await listClassesForStudent(currentUser.username);
    if (!classes.length) {
      body.append(showNotice({ type: "warn", text: "暂无可加入班级，请联系教师创建班级。" }));
      return;
    }
    for (const klass of classes) {
      const joined = !!klass.joined;
      body.append(
        el(
          "div",
          { class: "class-item" },
          el(
            "div",
            null,
            el("div", { style: "font-weight:700" }, klass.name),
            el("div", { class: "muted" }, `创建教师：${klass.ownerName || klass.ownerUsername}`),
            klass.description ? el("div", { class: "hint", text: klass.description }) : null
          ),
          el(
            "button",
            {
              class: `btn small ${joined ? "" : "primary"}`,
              type: "button",
              disabled: joined,
              onClick: async () => {
                clear(msg);
                try {
                  await joinClass({ studentUser: currentUser, classId: klass.id });
                  msg.append(showNotice({ type: "ok", text: "加入成功" }));
                  if (afterJoin) await afterJoin();
                  await redraw();
                } catch (err) {
                  msg.append(showNotice({ type: "bad", text: err?.message || "加入失败" }));
                }
              },
            },
            joined ? "已加入" : "加入"
          )
        )
      );
    }
  }

  await redraw();
  openModal({
    title: "加入班级",
    body: el("div", null, body, msg),
    footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
  });
}

function renderTeacherPanel() {
  const msg = el("div");
  const classWrap = el("div");
  const tableWrap = el("div");

  async function refreshSubmissions() {
    clear(tableWrap);
    const submissions = await listSubmissionsForTeacher(currentUser.username);
    tableWrap.append(buildSubmissionTable(submissions, { role: "教师" }));
  }

  async function refreshClasses() {
    clear(classWrap);
    const [classes, teachers] = await Promise.all([listClassesForTeacher(currentUser.username), listTeachers()]);
    classWrap.append(buildTeacherClassManager({ classes, teachers, onChanged: refreshAll }));
  }

  async function refreshAll() {
    await Promise.all([refreshClasses(), refreshSubmissions()]);
  }

  refreshAll();

  return el(
    "div",
    { class: "card" },
    el("div", { class: "row-between" }, el("div", { style: "font-weight:700" }, "教师端"), el("button", { class: "btn", type: "button", onClick: refreshAll }, "刷新")),
    msg,
    el("div", { style: "margin-top:12px" }, classWrap),
    el("div", { style: "margin-top:12px" }, tableWrap)
  );
}

function buildTeacherClassManager({ classes, teachers, onChanged }) {
  const nameInput = el("input", { placeholder: "例如：软件工程 1 班" });
  const descInput = el("input", { placeholder: "班级说明（可选）" });
  const msg = el("div");
  const list = el("div", { class: "class-list" });
  const teacherNames = new Map(teachers.map((t) => [t.username, t.displayName || t.username]));

  function redrawList() {
    clear(list);
    if (!classes.length) {
      list.append(showNotice({ type: "warn", text: "暂无可管理班级，请先创建班级。" }));
      return;
    }
    for (const klass of classes) {
      const isOwner = klass.ownerUsername === currentUser.username;
      const authorized = klass.controllerUsernames || [];
      const teacherSelect = el("select", null, el("option", { value: "", text: "选择教师授权" }));
      for (const teacher of teachers) {
        if (teacher.username === klass.ownerUsername || authorized.includes(teacher.username)) continue;
        teacherSelect.append(el("option", { value: teacher.username, text: `${teacher.displayName}（${teacher.username}）` }));
      }

      const authList = authorized.length
        ? authorized.map((username) =>
            el(
              "span",
              { class: "pill" },
              `${teacherNames.get(username) || username}（${username}）`,
              isOwner
                ? el(
                    "button",
                    {
                      class: "inline-x",
                      type: "button",
                      title: "取消授权",
                      onClick: async () => {
                        clear(msg);
                        try {
                          await revokeClassTeacherAccess({ classId: klass.id, ownerUser: currentUser, teacherUsername: username });
                          msg.append(showNotice({ type: "ok", text: "已取消授权" }));
                          if (onChanged) await onChanged();
                        } catch (err) {
                          msg.append(showNotice({ type: "bad", text: err?.message || "取消授权失败" }));
                        }
                      },
                    },
                    "×"
                  )
                : null
            )
          )
        : [el("span", { class: "muted", text: "暂无协作教师" })];

      list.append(
        el(
          "div",
          { class: "class-item" },
          el(
            "div",
            null,
            el("div", { style: "font-weight:700" }, klass.name),
            el("div", { class: "muted" }, `创建教师：${klass.ownerName || klass.ownerUsername}；学生数：${(klass.memberUsernames || []).length}`),
            klass.description ? el("div", { class: "hint", text: klass.description }) : null,
            el("div", { class: "row", style: "margin-top:8px" }, el("span", { class: "muted", text: "控制权限：" }), authList)
          ),
          isOwner
            ? el(
                "div",
                { class: "class-actions" },
                teacherSelect,
                el(
                  "button",
                  {
                    class: "btn small primary",
                    type: "button",
                    onClick: async () => {
                      clear(msg);
                      try {
                        await grantClassTeacherAccess({ classId: klass.id, ownerUser: currentUser, teacherUsername: teacherSelect.value });
                        msg.append(showNotice({ type: "ok", text: "授权成功" }));
                        if (onChanged) await onChanged();
                      } catch (err) {
                        msg.append(showNotice({ type: "bad", text: err?.message || "授权失败" }));
                      }
                    },
                  },
                  "授权"
                )
              )
            : el("div", { class: "pill", text: "被授权管理" })
        )
      );
    }
  }

  redrawList();

  return el(
    "div",
    { class: "panel-section" },
    el("div", { style: "font-weight:700; margin-bottom:10px" }, "班级与权限"),
    el(
      "div",
      { class: "row" },
      el("div", { style: "min-width:220px; flex:1" }, el("label", { text: "班级名称" }), nameInput),
      el("div", { style: "min-width:260px; flex:1" }, el("label", { text: "说明" }), descInput),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            clear(msg);
            try {
              await createClass({ teacherUser: currentUser, name: nameInput.value, description: descInput.value });
              nameInput.value = "";
              descInput.value = "";
              msg.append(showNotice({ type: "ok", text: "班级创建成功" }));
              if (onChanged) await onChanged();
            } catch (err) {
              msg.append(showNotice({ type: "bad", text: err?.message || "创建失败" }));
            }
          },
        },
        "创建班级"
      )
    ),
    msg,
    list
  );
}

function buildSubmissionTable(submissions, { role }) {
  if (!submissions.length) {
    return showNotice({ type: "warn", text: "暂无记录" });
  }

  const table = el("table");
  table.append(
    el(
      "thead",
      null,
      el(
        "tr",
        null,
        el("th", { text: "编号" }),
        el("th", { text: "学生" }),
        el("th", { text: "班级" }),
        el("th", { text: "文件" }),
        el("th", { text: "状态" }),
        el("th", { text: "提交时间" }),
        el("th", { text: "教师批注" }),
        el("th", { text: "操作" })
      )
    )
  );

  const tbody = el("tbody");
  for (const s of submissions) {
    const actions = el("div", { class: "cell-actions" });

    if (role === "教师") {
      actions.append(
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onDownloadOriginal(s),
          },
          "下载作业"
        ),
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onDownloadRevisedFile(s),
          },
          "下载订正文件"
        ),
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onUploadReviewFile(s),
          },
          "上传批改文件"
        ),
        el(
          "button",
          {
            class: "btn small primary",
            type: "button",
            onClick: () => onTeacherOnlineReview(s),
          },
          "在线查看/批改"
        )
      );
    } else {
      actions.append(
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onDownloadReviewFile(s),
          },
          "下载批改文件"
        ),
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onStudentViewOnlineReview(s),
          },
          "在线查看批改"
        ),
        el(
          "button",
          {
            class: "btn small primary",
            type: "button",
            onClick: () => onStudentOnlineCorrection(s),
          },
          "在线订正"
        ),
        el(
          "button",
          {
            class: "btn small",
            type: "button",
            onClick: () => onStudentDetail(s),
          },
          "查看详情"
        )
      );
    }

    tbody.append(
      el(
        "tr",
        null,
        el("td", { text: s.id.slice(0, 8) }),
        el("td", { text: `${s.studentName}（${s.studentUsername}）` }),
        el("td", { text: s.className || "未分班" }),
        el("td", { text: s.fileName }),
        el("td", null, el("span", { class: "status", text: statusLabel(s.status) })),
        el("td", { text: formatTime(s.submitTime) }),
        el("td", { text: s.teacherNote || "—" }),
        el("td", null, actions)
      )
    );
  }
  table.append(tbody);
  return el("div", { class: "card" }, table);
}

async function onDownloadOriginal(submission) {
  if (isTextFileName(submission.fileName) && submission.onlineReviewContent) {
    const plain = exportPlainTextFromRich(submission.onlineReviewContent);
    downloadBlob({ blob: new Blob([plain], { type: "text/plain;charset=utf-8" }), fileName: submission.fileName });
    return;
  }
  const fileRecord = await getFileRecord(submission.originalFileKey);
  if (!fileRecord?.blob) {
    openModal({
      title: "下载作业",
      body: showNotice({ type: "bad", text: "作业文件不存在" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  downloadBlob({ blob: fileRecord.blob, fileName: fileRecord.name, contentType: fileRecord.type });
}

async function onDownloadReviewFile(submission) {
  if (isTextFileName(submission.fileName) && submission.onlineReviewContent) {
    const plain = exportPlainTextFromRich(submission.onlineReviewContent);
    downloadBlob({ blob: new Blob([plain], { type: "text/plain;charset=utf-8" }), fileName: submission.fileName });
    return;
  }
  if (!submission.reviewFileKey) {
    openModal({
      title: "下载批改文件",
      body: showNotice({ type: "warn", text: "暂无批改文件" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  const fileRecord = await getFileRecord(submission.reviewFileKey);
  if (!fileRecord?.blob) {
    openModal({
      title: "下载批改文件",
      body: showNotice({ type: "bad", text: "批改文件不存在" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  downloadBlob({ blob: fileRecord.blob, fileName: fileRecord.name, contentType: fileRecord.type });
}

async function onDownloadRevisedFile(submission) {
  if (isTextFileName(submission.fileName) && submission.onlineReviewContent) {
    const plain = exportPlainTextFromRich(submission.onlineReviewContent);
    downloadBlob({ blob: new Blob([plain], { type: "text/plain;charset=utf-8" }), fileName: submission.fileName });
    return;
  }
  if (!submission.revisedFileKey) {
    openModal({
      title: "下载订正文件",
      body: showNotice({ type: "warn", text: "暂无订正文件" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  const fileRecord = await getFileRecord(submission.revisedFileKey);
  if (!fileRecord?.blob) {
    openModal({
      title: "下载订正文件",
      body: showNotice({ type: "bad", text: "订正文件不存在" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  downloadBlob({ blob: fileRecord.blob, fileName: fileRecord.name, contentType: fileRecord.type });
}

function onStudentDetail(submission) {
  openModal({
    title: "作业详情",
    body: el(
      "div",
      null,
      showNotice({
        type: "ok",
        text: `状态：${statusLabel(submission.status)}\n教师批注：${submission.teacherNote || "暂无"}`,
      })
    ),
    footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
  });
}

function normalizeTextLines(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  return lines.length ? lines : [""];
}

function buildPane({ title, tagText, paneClass, contentNode }) {
  return el(
    "div",
    { class: `pane ${paneClass}` },
    el("div", { class: "pane-header" }, el("div", { text: title }), el("div", { class: "pane-tag", text: tagText })),
    el("div", { class: "pane-body" }, contentNode)
  );
}

function createLineEditor({ submissionId, doc, initialText, readOnly, onSelectLine, onChange, onStatus }) {
  const editor = el("div", { class: "line-editor" });
  let lines = normalizeTextLines(initialText);
  let selectedLine = 1;
  let currentLockKey = null;

  const lineNodes = [];

  function getOwnerLabel() {
    if (!currentUser) return "未知用户";
    return `${currentUser.role}:${currentUser.username}`;
  }

  function lockKeyFor(lineNo) {
    return collab.lockKey({ submissionId, doc, line: lineNo });
  }

  function setSelected(lineNo) {
    selectedLine = Math.max(1, Math.min(lineNo, lines.length));
    for (const row of lineNodes) row.classList.remove("selected");
    const row = lineNodes[selectedLine - 1];
    if (row) row.classList.add("selected");
    if (onSelectLine) onSelectLine(selectedLine);
  }

  function refreshLocks() {
    for (let i = 0; i < lineNodes.length; i += 1) {
      const lineNo = i + 1;
      const key = lockKeyFor(lineNo);
      const lockInfo = collab.getLockInfo(key);
      const lockedByOther = !!lockInfo && lockInfo.ownerId !== CLIENT_ID;
      const row = lineNodes[i];
      const textNode = row.querySelector(".line-text");
      row.classList.toggle("locked", lockedByOther);

      if (readOnly) {
        textNode.setAttribute("contenteditable", "false");
        continue;
      }
      if (lockedByOther) textNode.setAttribute("contenteditable", "false");
      else textNode.setAttribute("contenteditable", "true");
    }
  }

  const unsubscribe = collab.subscribe(refreshLocks);

  function releaseCurrentLock() {
    if (currentLockKey) {
      collab.releaseKey(currentLockKey);
      currentLockKey = null;
    }
  }

  function render() {
    editor.innerHTML = "";
    lineNodes.length = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lineNo = i + 1;
      const lineRow = el("div", { class: "line-row", "data-line": String(lineNo) });
      const no = el("div", { class: "line-no", text: String(lineNo).padStart(3, " ") });
      const text = el("div", {
        class: "line-text",
        contenteditable: readOnly ? "false" : "true",
        spellcheck: "false",
        tabindex: "0",
      });
      text.textContent = lines[i] ?? "";

      lineRow.addEventListener("click", () => setSelected(lineNo));

      text.addEventListener("focus", () => {
        setSelected(lineNo);
        if (readOnly) return;

        releaseCurrentLock();
        const result = collab.acquire({ submissionId, doc, line: lineNo, ownerLabel: getOwnerLabel() });
        if (!result.ok) {
          text.blur();
          if (onStatus) onStatus(`第 ${lineNo} 行正在被 ${result.ownerLabel} 编辑`);
          refreshLocks();
          return;
        }
        currentLockKey = result.key;
        if (onStatus) onStatus(`已锁定第 ${lineNo} 行`);
        refreshLocks();
      });

      text.addEventListener("blur", () => {
        if (readOnly) return;
        releaseCurrentLock();
        refreshLocks();
      });

      text.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });

      text.addEventListener("paste", (event) => {
        if (!event.clipboardData) return;
        const raw = event.clipboardData.getData("text/plain");
        const sanitized = String(raw || "").replace(/\r?\n/g, " ");
        event.preventDefault();
        document.execCommand("insertText", false, sanitized);
      });

      text.addEventListener("beforeinput", (event) => {
        if (readOnly) {
          event.preventDefault();
          return;
        }
        const key = lockKeyFor(lineNo);
        const lockedByOther = collab.isLockedByOther(key);
        const lockedByMe = currentLockKey === key;
        if (lockedByOther || !lockedByMe) {
          event.preventDefault();
          const info = collab.getLockInfo(key);
          if (onStatus) onStatus(`第 ${lineNo} 行不可编辑（${info?.ownerLabel ? "锁定者：" + info.ownerLabel : "未锁定"}）`);
        }
      });

      text.addEventListener("input", () => {
        const value = String(text.textContent ?? "").replace(/\r?\n/g, " ");
        if (value !== text.textContent) text.textContent = value;
        lines[i] = value;
        if (onChange) onChange(getText());
      });

      lineRow.append(no, text);
      editor.append(lineRow);
      lineNodes.push(lineRow);
    }
    setSelected(1);
    refreshLocks();
  }

  function getText() {
    return lines.join("\n");
  }

  function setText(nextText) {
    lines = normalizeTextLines(nextText);
    releaseCurrentLock();
    render();
  }

  function isEditing() {
    return !!currentLockKey;
  }

  function destroy() {
    releaseCurrentLock();
    unsubscribe();
  }

  render();

  return {
    node: editor,
    getText,
    setText,
    setSelected,
    isEditing,
    destroy,
  };
}

async function openTextWorkspace({ submission, originalText, defaultTab }) {
  const role = currentUser?.role || "";
  const canEditFile = role === "教师" || role === "学生";
  const canEditNote = role === "教师";
  const roleSrc = role === "教师" ? "T" : "S";

  const statusBar = el("div", { class: "hint" });
  const lockResult = canEditFile
    ? collab.acquire({ submissionId: submission.id, doc: "file", line: 0, ownerLabel: `${currentUser.role}:${currentUser.username}` })
    : { ok: false, ownerLabel: "未登录" };
  const editable = !!lockResult.ok;

  const { submission: latestSubmission, richContent } = await ensureOnlineEditableContent({ submissionId: submission.id });

  function encodeUtf8ToBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function parseRichToSegments(content) {
    const raw = String(content ?? "");
    if (!raw.startsWith("RICH1\n")) return [{ src: "O", text: raw }];
    const lines = raw.split("\n");
    const segments = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const src = line.slice(0, idx) || "O";
      const payload = line.slice(idx + 1);
      if (!payload) continue;
      segments.push({ src: src[0] || "O", text: exportPlainTextFromRich(`RICH1\n${src[0]}:${payload}\n`) });
    }
    if (!segments.length) segments.push({ src: "O", text: "" });
    return segments;
  }

  function sourceMetaFor(src) {
    if (src === "T") return { src: "T", className: "seg-teacher", color: "#d00000" };
    if (src === "S") return { src: "S", className: "seg-student", color: "#0058dc" };
    return { src: "O", className: "seg-original", color: "#000000" };
  }

  function spanForSegment(seg) {
    const meta = sourceMetaFor(seg.src);
    const span = document.createElement("span");
    span.dataset.src = meta.src;
    span.className = meta.className;
    span.style.color = meta.color;
    span.textContent = seg.text || "";
    return span;
  }

  function collectSegmentsFromNode(node, inheritedSrc = "O") {
    if (!node) return [];
    if (node.nodeType === 3) {
      return node.nodeValue ? [{ src: inheritedSrc, text: node.nodeValue }] : [];
    }
    if (node.nodeType !== 1) return [];
    if (node.tagName === "BR") return [{ src: inheritedSrc, text: "\n" }];

    const currentSrc = node.tagName === "SPAN" ? node.dataset?.src || inheritedSrc || "O" : inheritedSrc;
    const segments = [];
    for (const child of Array.from(node.childNodes)) {
      segments.push(...collectSegmentsFromNode(child, currentSrc));
    }
    if (!segments.length && node.tagName === "SPAN") {
      segments.push({ src: currentSrc, text: "" });
    }
    return segments;
  }

  function collectSegmentsFromEditor(editor) {
    const segments = [];
    for (const child of Array.from(editor.childNodes)) {
      segments.push(...collectSegmentsFromNode(child, "O"));
    }
    return segments;
  }

  function getCaretOffset(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString().length;
  }

  function restoreCaretOffset(editor, offset) {
    if (offset === null || offset === undefined) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    setCaretAtEnd(editor);
  }

  function normalizeEditor(editor) {
    const caretOffset = getCaretOffset(editor);
    const segments = collectSegmentsFromEditor(editor);
    const merged = [];
    for (const segment of segments) {
      if (!segment.text) continue;
      const prev = merged[merged.length - 1];
      if (prev && prev.src === segment.src) prev.text += segment.text;
      else merged.push({ src: segment.src, text: segment.text });
    }

    editor.replaceChildren(...(merged.length ? merged.map(spanForSegment) : [spanForSegment({ src: "O", text: "" })]));
    restoreCaretOffset(editor, caretOffset);
  }

  function findSpanInEditor(editor, node) {
    if (!node) return null;
    if (node.nodeType === 1 && node.tagName === "SPAN") return editor.contains(node) ? node : null;
    if (node.nodeType === 3) {
      const p = node.parentElement;
      if (p && p.tagName === "SPAN" && editor.contains(p)) return p;
    }
    const elNode = node.nodeType === 1 ? node : node.parentElement;
    const span = elNode?.closest?.("span");
    return span && editor.contains(span) ? span : null;
  }

  function setCaretAtStart(node) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function setCaretAtEnd(node) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureRoleSpanAtCaret(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;

    const span = findSpanInEditor(editor, range.startContainer);
    if (!span) {
      const roleSpan = spanForSegment({ src: roleSrc, text: "" });
      const offset = range.startOffset || 0;
      const ref = editor.childNodes[offset] || null;
      editor.insertBefore(roleSpan, ref);
      setCaretAtStart(roleSpan);
      return;
    }
    if (span.dataset.src === roleSrc) return;

    const spanRange = range.cloneRange();
    spanRange.selectNodeContents(span);
    spanRange.setEnd(range.startContainer, range.startOffset);
    const pos = spanRange.toString().length;
    const full = span.textContent || "";
    const leftText = full.slice(0, pos);
    const rightText = full.slice(pos);

    const parts = [];
    if (leftText) parts.push(spanForSegment({ src: span.dataset.src, text: leftText }));
    const roleSpan = spanForSegment({ src: roleSrc, text: "" });
    parts.push(roleSpan);
    if (rightText) parts.push(spanForSegment({ src: span.dataset.src, text: rightText }));

    span.replaceWith(...parts);
    setCaretAtStart(roleSpan);
  }

  function insertTextAtCaret(editor, text) {
    ensureRoleSpanAtCaret(editor);
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;

    if (!range.collapsed) {
      range.deleteContents();
      sel.removeAllRanges();
      sel.addRange(range);
      ensureRoleSpanAtCaret(editor);
      range = sel.getRangeAt(0);
    }

    const textNode = document.createTextNode(String(text ?? ""));
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function editorToRich(editor) {
    const runs = [];
    for (const segment of collectSegmentsFromEditor(editor)) {
      const src = segment.src || "O";
      const text = segment.text || "";
      if (!text) continue;
      const prev = runs[runs.length - 1];
      if (prev && prev.src === src) prev.text += text;
      else runs.push({ src, text });
    }
    let rich = "RICH1\n";
    for (const run of runs.length ? runs : [{ src: "O", text: "" }]) {
      rich += `${run.src}:${encodeUtf8ToBase64(run.text)}\n`;
    }
    return rich;
  }

  const editor = el("div", { class: "rich-editor" });
  editor.contentEditable = editable ? "true" : "false";
  editor.spellcheck = false;
  editor.append(...parseRichToSegments(richContent).map(spanForSegment));
  normalizeEditor(editor);

  if (editable) {
    let isComposingText = false;
    let normalizeTimer = 0;

    function scheduleNormalizeEditor() {
      if (normalizeTimer) window.clearTimeout(normalizeTimer);
      normalizeTimer = window.setTimeout(() => {
        normalizeTimer = 0;
        if (!isComposingText) normalizeEditor(editor);
      }, 0);
    }

    editor.addEventListener("compositionstart", () => {
      isComposingText = true;
      ensureRoleSpanAtCaret(editor);
    });
    editor.addEventListener("compositionend", () => {
      isComposingText = false;
      scheduleNormalizeEditor();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || isComposingText || event.isComposing) return;
      event.preventDefault();
      insertTextAtCaret(editor, "\n");
      normalizeEditor(editor);
    });
    editor.addEventListener("beforeinput", (event) => {
      if (!editable) {
        event.preventDefault();
        return;
      }
      const inputType = String(event.inputType || "");
      if (inputType === "insertText" || inputType === "insertFromComposition") {
        if (isComposingText || event.isComposing) return;
        event.preventDefault();
        insertTextAtCaret(editor, event.data || "");
        normalizeEditor(editor);
        return;
      }
      if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
        if (isComposingText || event.isComposing) return;
        event.preventDefault();
        insertTextAtCaret(editor, "\n");
        normalizeEditor(editor);
        return;
      }
      if (isComposingText || event.isComposing || inputType === "insertCompositionText") {
        return;
      }
      if (inputType.startsWith("insert")) {
        ensureRoleSpanAtCaret(editor);
      }
      scheduleNormalizeEditor();
    });
    editor.addEventListener("input", (event) => {
      const inputType = String(event.inputType || "");
      if (isComposingText || event.isComposing || inputType === "insertCompositionText") {
        return;
      }
      scheduleNormalizeEditor();
    });
    editor.addEventListener("paste", (event) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      insertTextAtCaret(editor, text);
      normalizeEditor(editor);
    });
  }

  const noteArea = el("textarea");
  noteArea.value = latestSubmission.teacherNote || "";
  noteArea.readOnly = !canEditNote;
  noteArea.style.minHeight = "140px";

  const leftTitle = editable
    ? "文件内容（可编辑）"
    : `文件内容（只读：对方正在编辑 ${lockResult.ownerLabel || "其他用户"}）`;
  const leftPane = buildPane({
    title: leftTitle,
    tagText: "黑/红/蓝",
    paneClass: "original",
    contentNode: el("div", null, editor, statusBar),
  });

  const rightPane = buildPane({
    title: canEditNote ? "评语（教师可编辑）" : "评语（仅查看）",
    tagText: "评语",
    paneClass: "student",
    contentNode: el("div", null, el("div", { class: "form-row" }, el("label", { text: "教师评语" }), noteArea)),
  });

  const body = el("div", { class: "split" }, leftPane, rightPane);

  modal.addEventListener(
    "close",
    () => {
      if (lockResult?.ok) collab.releaseKey(lockResult.key);
    },
    { once: true }
  );

  const footerButtons = [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")];
  if (editable) {
    footerButtons.push(
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            try {
              const rich = editorToRich(editor);
              if (role === "教师") {
                await saveOnlineReview({ submissionId: submission.id, reviewContent: rich, teacherNote: noteArea.value, teacherUser: currentUser });
              } else {
                await saveStudentCorrection({ submissionId: submission.id, correctionContent: rich, studentUser: currentUser });
              }
              closeModal();
              render();
            } catch (err) {
              statusBar.textContent = err?.message || "保存失败";
            }
          },
        },
        "保存"
      )
    );
  }

  openModal({
    title: "在线查看/编辑",
    body,
    footerButtons,
  });
}

async function onTeacherOnlineReview(submission) {
  if (!isTextFileName(submission.fileName)) {
    openModal({
      title: "在线批改",
      body: showNotice({ type: "warn", text: "当前文件类型不支持在线批改（仅支持 txt/java/md/csv）" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }

  await openTextWorkspace({ submission });
}

async function onStudentViewOnlineReview(submission) {
  if (!isTextFileName(submission.fileName)) {
    openModal({
      title: "在线查看批改",
      body: showNotice({ type: "warn", text: "当前文件类型不支持在线查看（仅支持 txt/java/md/csv）" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }

  await openTextWorkspace({ submission });
}

async function onStudentOnlineCorrection(submission) {
  if (!isTextFileName(submission.fileName)) {
    openModal({
      title: "在线订正",
      body: showNotice({ type: "warn", text: "当前文件类型不支持在线订正（仅支持 txt/java/md/csv）" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }

  await openTextWorkspace({ submission });
}

function onUploadReviewFile(submission) {
  const reviewInput = el("input", { type: "file", accept: ".pdf,.doc,.docx,.zip,.txt,.md,.csv,.java" });
  const noteArea = el("textarea");
  noteArea.value = submission.teacherNote || "";
  noteArea.style.minHeight = "90px";

  openModal({
    title: "上传批改文件",
    body: el(
      "div",
      null,
      el("div", { class: "form-row" }, el("label", { text: "选择批改文件" }), reviewInput),
      el("div", { class: "form-row" }, el("label", { text: "教师批注（可选）" }), noteArea)
    ),
    footerButtons: [
      el("button", { class: "btn", type: "button", onClick: closeModal }, "取消"),
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            try {
              const file = reviewInput.files?.[0];
              await uploadReviewFile({ submissionId: submission.id, reviewFile: file, teacherNote: noteArea.value, teacherUser: currentUser });
              closeModal();
              render();
            } catch (err) {
              openModal({
                title: "回传失败",
                body: showNotice({ type: "bad", text: err?.message || "回传失败" }),
                footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
              });
            }
          },
        },
        "确认回传"
      ),
    ],
  });
}

bootstrap();
