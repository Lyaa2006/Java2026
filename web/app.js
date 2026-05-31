import {
  ensureDefaults,
  getFileRecord,
  getUser,
  isTextFileName,
  listAllSubmissions,
  listSubmissionsForStudent,
  loadSubmissionOriginalText,
  loginUser,
  registerUser,
  saveOriginalTextFile,
  saveOnlineReview,
  saveStudentCorrection,
  statusLabel,
  submitAssignment,
  updateSubmissionDraft,
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
    el("button", { class: "btn small", onClick: closeModal, type: "button" }, "关闭")
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
    const msg = el("div");

    const form = el(
      "form",
      {
        onSubmit: async (event) => {
          event.preventDefault();
          clear(msg);
          try {
            const user = await loginUser({ username: username.value, password: password.value });
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
      el(
        "div",
        { class: "form-row row" },
        el("button", { class: "btn primary", type: "submit" }, "登录"),
        el(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => {
              username.value = "teacher";
              password.value = "123456";
            },
          },
          "填入默认教师"
        )
      ),
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
  const submitBtn = el(
    "button",
    {
      class: "btn primary",
      type: "button",
      onClick: async () => {
        clear(msg);
        try {
          const file = fileInput.files?.[0];
          await submitAssignment({ studentUser: currentUser, file });
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

  async function refresh() {
    clear(tableWrap);
    const submissions = await listSubmissionsForStudent(currentUser.username);
    tableWrap.append(buildSubmissionTable(submissions, { role: "学生" }));
  }

  refresh();

  return el(
    "div",
    { class: "card" },
    el("div", { style: "font-weight:700; margin-bottom:10px" }, "学生端"),
    el("div", { class: "row" }, el("div", { style: "min-width:320px; flex:1" }, fileInput), submitBtn, el("button", { class: "btn", type: "button", onClick: refresh }, "刷新")),
    msg,
    el("div", { style: "margin-top:12px" }, tableWrap)
  );
}

function renderTeacherPanel() {
  const msg = el("div");
  const tableWrap = el("div");

  async function refresh() {
    clear(tableWrap);
    const submissions = await listAllSubmissions();
    tableWrap.append(buildSubmissionTable(submissions, { role: "教师" }));
  }

  refresh();

  return el(
    "div",
    { class: "card" },
    el("div", { class: "row-between" }, el("div", { style: "font-weight:700" }, "教师端"), el("button", { class: "btn", type: "button", onClick: refresh }, "刷新")),
    msg,
    el("div", { style: "margin-top:12px" }, tableWrap)
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
            onClick: () => onDownloadRevisedFile(s),
          },
          "下载订正文件"
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
  const canEditOriginal = role === "教师" || role === "学生";
  const canEditReview = role === "教师";
  const canEditCorrection = role === "学生";

  let active = defaultTab || (canEditReview ? "review" : canEditCorrection ? "correction" : "original");
  let teacherNote = submission.teacherNote || "";
  let lineNotes = submission.lineNotes && typeof submission.lineNotes === "object" ? submission.lineNotes : {};

  let originalTextWorking = String(originalText ?? "");

  async function loadTextFromFileKey(fileKey) {
    const record = await getFileRecord(fileKey);
    if (!record?.blob) return null;
    try {
      return await record.blob.text();
    } catch {
      return null;
    }
  }

  let reviewText = submission.onlineReviewContent;
  if (reviewText == null && submission.reviewFileKey) {
    reviewText = await loadTextFromFileKey(submission.reviewFileKey);
  }
  if (reviewText == null) {
    reviewText = originalTextWorking;
  }

  let correctionText = submission.onlineStudentFixContent;
  if (correctionText == null && submission.revisedFileKey) {
    correctionText = await loadTextFromFileKey(submission.revisedFileKey);
  }
  if (correctionText == null) {
    correctionText = originalTextWorking;
  }

  const statusBar = el("div", { class: "hint" });

  const saveDraft = debounce(async (patch) => {
    try {
      await updateSubmissionDraft({ submissionId: submission.id, patch });
    } catch (err) {
      statusBar.textContent = err?.message || "保存失败";
    }
  }, 350);

  function lineNoAt(text, index) {
    const s = String(text ?? "");
    const idx = Math.max(0, Math.min(Number(index) || 0, s.length));
    let line = 1;
    for (let i = 0; i < idx; i += 1) {
      if (s.charCodeAt(i) === 10) line += 1;
    }
    return line;
  }

  function selectionLineRange(text, start, end) {
    const a = lineNoAt(text, start);
    const b = lineNoAt(text, end);
    return [Math.min(a, b), Math.max(a, b)];
  }

  function getLineNote(lineNo) {
    const key = String(lineNo);
    const entry = lineNotes[key] && typeof lineNotes[key] === "object" ? lineNotes[key] : {};
    return {
      teacher: String(entry.teacher ?? ""),
      student: String(entry.student ?? ""),
    };
  }

  function setLineNote(lineNo, patch) {
    const key = String(lineNo);
    const current = getLineNote(lineNo);
    lineNotes = {
      ...lineNotes,
      [key]: { ...current, ...patch },
    };
    saveDraft({ lineNotes });
  }

  function getOwnerLabel() {
    if (!currentUser) return "未知用户";
    return `${currentUser.role}:${currentUser.username}`;
  }

  let heldLockKeys = new Set();
  let lockDoc = active === "original" ? "original" : active === "review" ? "review" : active === "correction" ? "correction" : null;

  function releaseLocks() {
    for (const key of heldLockKeys) collab.releaseKey(key);
    heldLockKeys = new Set();
  }

  function ensureLocksForRange({ doc, startLine, endLine }) {
    const span = endLine - startLine + 1;
    if (span > 200) {
      return { ok: false, reason: "选区过大，请缩小选区后再编辑" };
    }

    const needed = new Set();
    for (let line = startLine; line <= endLine; line += 1) {
      needed.add(collab.lockKey({ submissionId: submission.id, doc, line }));
    }

    for (const key of heldLockKeys) {
      if (!needed.has(key)) collab.releaseKey(key);
    }

    const nextHeld = new Set();
    for (const key of needed) {
      if (heldLockKeys.has(key)) {
        nextHeld.add(key);
        continue;
      }

      const parts = String(key).split("|");
      const line = Number(parts[2] || 1);
      const result = collab.acquire({ submissionId: submission.id, doc, line, ownerLabel: getOwnerLabel() });
      if (!result.ok) {
        for (const acquired of nextHeld) {
          if (!heldLockKeys.has(acquired)) collab.releaseKey(acquired);
        }
        return { ok: false, reason: `第 ${line} 行正在被 ${result.ownerLabel} 编辑` };
      }
      nextHeld.add(result.key);
    }

    heldLockKeys = nextHeld;
    return { ok: true };
  }

  function isEditableActive() {
    if (active === "original") return canEditOriginal;
    if (active === "review") return canEditReview;
    if (active === "correction") return canEditCorrection;
    return false;
  }

  function activeDocClass() {
    if (active === "original") return "original";
    if (active === "review") return "teacher";
    return "student";
  }

  function getActiveText() {
    if (active === "original") return originalTextWorking;
    if (active === "review") return reviewText;
    return correctionText;
  }

  function setActiveText(next) {
    if (active === "original") {
      originalTextWorking = String(next ?? "");
    } else if (active === "review") {
      reviewText = String(next ?? "");
      saveDraft({ onlineReviewContent: reviewText });
    } else if (active === "correction") {
      correctionText = String(next ?? "");
      saveDraft({ onlineStudentFixContent: correctionText });
    }
  }

  let selectedLine = 1;

  const notesHint = el("div", { class: "hint" });
  const teacherLineNoteArea = el("textarea");
  const studentLineNoteArea = el("textarea");
  teacherLineNoteArea.style.minHeight = "100px";
  studentLineNoteArea.style.minHeight = "100px";
  teacherLineNoteArea.readOnly = !canEditReview;
  studentLineNoteArea.readOnly = !canEditCorrection;

  teacherLineNoteArea.addEventListener("input", () => setLineNote(selectedLine, { teacher: teacherLineNoteArea.value }));
  studentLineNoteArea.addEventListener("input", () => setLineNote(selectedLine, { student: studentLineNoteArea.value }));

  const teacherNoteArea = el("textarea");
  teacherNoteArea.value = teacherNote;
  teacherNoteArea.style.minHeight = "110px";
  teacherNoteArea.readOnly = !canEditReview;
  teacherNoteArea.addEventListener("input", () => {
    teacherNote = teacherNoteArea.value;
    saveDraft({ teacherNote });
  });

  function syncNotesUI() {
    notesHint.textContent = `旁注：当前第 ${selectedLine} 行`;
    const note = getLineNote(selectedLine);
    teacherLineNoteArea.value = note.teacher;
    studentLineNoteArea.value = note.student;
  }

  const tabs = el("div", { class: "tabs" });
  const tabItems = [
    { key: "original", label: "原始作业", tagText: "蓝色" },
    { key: "review", label: "老师批改", tagText: "绿色" },
    { key: "correction", label: "学生订正", tagText: "橙色" },
  ];

  const editorArea = el("textarea", { class: `code-area ${activeDocClass()}`, spellcheck: "false" });

  function syncSelectedLineFromCursor() {
    const text = editorArea.value;
    const start = editorArea.selectionStart ?? 0;
    selectedLine = lineNoAt(text, start);
    syncNotesUI();
  }

  function setActiveTab(nextActive) {
    if (active === nextActive) return;
    active = nextActive;
    lockDoc = active === "original" ? "original" : active === "review" ? "review" : active === "correction" ? "correction" : null;
    releaseLocks();
    redrawTabs();
    redrawEditor();
    syncSelectedLineFromCursor();
    statusBar.textContent = "";
    updateLeftPaneChrome();
  }

  function redrawTabs() {
    [...tabs.querySelectorAll(".tab")].forEach((btn) => btn.classList.remove("active"));
    tabs.querySelector(`[data-tab="${active}"]`)?.classList.add("active");
  }

  for (const item of tabItems) {
    tabs.append(
      el(
        "button",
        {
          class: `tab ${active === item.key ? "active" : ""}`,
          type: "button",
          "data-tab": item.key,
          onClick: () => setActiveTab(item.key),
        },
        item.label
      )
    );
  }

  function redrawEditor() {
    editorArea.className = `code-area ${activeDocClass()}`;
    editorArea.readOnly = !isEditableActive();
    editorArea.value = getActiveText();
  }

  editorArea.addEventListener("beforeinput", (event) => {
    if (!isEditableActive()) {
      event.preventDefault();
      return;
    }
    if (!lockDoc) return;
    const [startLine, endLine] = selectionLineRange(editorArea.value, editorArea.selectionStart, editorArea.selectionEnd);
    const result = ensureLocksForRange({ doc: lockDoc, startLine, endLine });
    if (!result.ok) {
      event.preventDefault();
      statusBar.textContent = result.reason || "该行不可编辑";
      return;
    }
    statusBar.textContent = `已锁定第 ${startLine}${startLine === endLine ? "" : `~${endLine}`} 行`;
  });

  editorArea.addEventListener("input", () => {
    setActiveText(editorArea.value);
    syncSelectedLineFromCursor();
  });

  editorArea.addEventListener("keyup", syncSelectedLineFromCursor);
  editorArea.addEventListener("mouseup", syncSelectedLineFromCursor);
  editorArea.addEventListener("select", syncSelectedLineFromCursor);

  editorArea.addEventListener("blur", () => {
    releaseLocks();
    statusBar.textContent = "";
  });

  redrawEditor();
  syncNotesUI();

  const leftPane = buildPane({
    title: "文件内容",
    tagText: active === "original" ? "蓝色" : active === "review" ? "绿色" : "橙色",
    paneClass: active === "original" ? "original" : active === "review" ? "teacher" : "student",
    contentNode: el("div", null, el("div", { class: "row-between" }, tabs, el("div", { class: "pill" }, "锁：同站点多标签页可体验")), el("div", { style: "margin-top:10px" }, editorArea)),
  });

  const leftPaneTag = leftPane.querySelector(".pane-tag");
  function updateLeftPaneChrome() {
    if (leftPaneTag) {
      leftPaneTag.textContent = active === "original" ? "蓝色" : active === "review" ? "绿色" : "橙色";
    }
    leftPane.classList.remove("original", "teacher", "student");
    leftPane.classList.add(active === "original" ? "original" : active === "review" ? "teacher" : "student");
  }

  updateLeftPaneChrome();

  const rightPane = buildPane({
    title: "旁注",
    tagText: "按行",
    paneClass: "student",
    contentNode: el(
      "div",
      null,
      notesHint,
      el("div", { class: "form-row" }, el("label", { text: "旁注（教师）" }), teacherLineNoteArea),
      el("div", { class: "form-row" }, el("label", { text: "旁注（学生）" }), studentLineNoteArea),
      el("div", { class: "form-row" }, el("label", { text: "教师总批注" }), teacherNoteArea),
      statusBar
    ),
  });

  const body = el("div", { class: "split" }, leftPane, rightPane);

  function cleanup() {
    releaseLocks();
    collab.releaseAllForSubmission(submission.id);
  }

  modal.addEventListener(
    "close",
    () => {
      cleanup();
    },
    { once: true }
  );

  const footerButtons = [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")];
  if (canEditOriginal) {
    footerButtons.push(
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            try {
              await saveOriginalTextFile({ submissionId: submission.id, text: originalTextWorking });
              statusBar.textContent = "已写入原始文件";
            } catch (err) {
              statusBar.textContent = err?.message || "写入失败";
            }
          },
        },
        "保存原文件"
      )
    );
  }
  if (canEditReview) {
    footerButtons.push(
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            try {
              await saveOnlineReview({ submissionId: submission.id, reviewContent: reviewText, teacherNote });
              closeModal();
              render();
            } catch (err) {
              statusBar.textContent = err?.message || "保存失败";
            }
          },
        },
        "保存批改"
      )
    );
  }
  if (canEditCorrection) {
    footerButtons.push(
      el(
        "button",
        {
          class: "btn primary",
          type: "button",
          onClick: async () => {
            try {
              await saveStudentCorrection({ submissionId: submission.id, correctionContent: correctionText });
              closeModal();
              render();
            } catch (err) {
              statusBar.textContent = err?.message || "提交失败";
            }
          },
        },
        "提交订正"
      )
    );
  }

  openModal({
    title: "在线编辑（左侧编辑 / 右侧旁注）",
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

  let originalText = "";
  try {
    originalText = await loadSubmissionOriginalText(submission);
  } catch (err) {
    openModal({
      title: "在线批改",
      body: showNotice({ type: "bad", text: err?.message || "加载失败" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  await openTextWorkspace({ submission, originalText, defaultTab: "review" });
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

  let originalText = "";
  try {
    originalText = await loadSubmissionOriginalText(submission);
  } catch (err) {
    openModal({
      title: "在线查看批改",
      body: showNotice({ type: "bad", text: err?.message || "加载失败" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  await openTextWorkspace({ submission, originalText, defaultTab: "review" });
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

  let originalText = "";
  try {
    originalText = await loadSubmissionOriginalText(submission);
  } catch (err) {
    openModal({
      title: "在线订正",
      body: showNotice({ type: "bad", text: err?.message || "加载失败" }),
      footerButtons: [el("button", { class: "btn", type: "button", onClick: closeModal }, "关闭")],
    });
    return;
  }
  await openTextWorkspace({ submission, originalText, defaultTab: "correction" });
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
              await uploadReviewFile({ submissionId: submission.id, reviewFile: file, teacherNote: noteArea.value });
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
