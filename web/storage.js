const DB_NAME = "hw_review_platform";
const DB_VERSION = 1;

const STORE_USERS = "users";
const STORE_SUBMISSIONS = "submissions";
const STORE_FILES = "files";

export const AssignmentStatus = {
  SUBMITTED: { code: "SUBMITTED", label: "已提交" },
  REVIEWED: { code: "REVIEWED", label: "已批改" },
  REVISED: { code: "REVISED", label: "已订正" },
};

const RICH_MAGIC = "RICH1\n";

export function statusLabel(statusCode) {
  return AssignmentStatus[statusCode]?.label ?? statusCode ?? "";
}

export function isTextFileName(fileName) {
  const name = String(fileName || "").toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".java") || name.endsWith(".md") || name.endsWith(".csv");
}

function encodeUtf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64ToUtf8(b64) {
  const binary = atob(String(b64 ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function isRichContent(content) {
  return typeof content === "string" && content.startsWith(RICH_MAGIC);
}

export function exportPlainTextFromRich(content) {
  if (!isRichContent(content)) return String(content ?? "");
  const lines = String(content).split("\n");
  let out = "";
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const payload = line.slice(idx + 1);
    if (!payload) continue;
    out += decodeBase64ToUtf8(payload);
  }
  return out;
}

function splitLinesPreserveNewline(text) {
  const s = String(text ?? "");
  if (!s) return [];
  const lines = [];
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === 10) {
      lines.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

function lcsMatches(base, target) {
  const n = base.length;
  const m = target.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = base[i] === target[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const match = new Array(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      match[j] = i;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return match;
}

function buildRichFromRuns(sources, texts) {
  let rich = RICH_MAGIC;
  for (let i = 0; i < texts.length; i += 1) {
    const b64 = encodeUtf8ToBase64(texts[i] ?? "");
    rich += `${sources[i]}:${b64}\n`;
  }
  return rich;
}

function buildRunsByLineSingleStage(baseVersion, targetVersion, unmatchedSource) {
  const baseLines = splitLinesPreserveNewline(baseVersion);
  const targetLines = splitLinesPreserveNewline(targetVersion);
  const matchTargetToBase = lcsMatches(baseLines, targetLines);

  const runSources = [];
  const runTexts = [];

  let currentSource = "";
  let currentText = "";
  for (let i = 0; i < targetLines.length; i += 1) {
    const src = matchTargetToBase[i] >= 0 ? "O" : unmatchedSource;
    if (!currentSource) currentSource = src;
    if (src !== currentSource) {
      runSources.push(currentSource);
      runTexts.push(currentText);
      currentSource = src;
      currentText = "";
    }
    currentText += targetLines[i];
  }
  if (currentSource) {
    runSources.push(currentSource);
    runTexts.push(currentText);
  }
  return [runSources, runTexts];
}

function buildRunsByLineTwoStage(original, teacherVersion, studentVersion) {
  const originalLines = splitLinesPreserveNewline(original);
  const teacherLines = splitLinesPreserveNewline(teacherVersion);
  const matchTeacherToOriginal = lcsMatches(originalLines, teacherLines);
  const teacherSources = teacherLines.map((_, idx) => (matchTeacherToOriginal[idx] >= 0 ? "O" : "T"));

  const studentLines = splitLinesPreserveNewline(studentVersion);
  const matchStudentToTeacher = lcsMatches(teacherLines, studentLines);

  const runSources = [];
  const runTexts = [];
  let currentSource = "";
  let currentText = "";
  for (let i = 0; i < studentLines.length; i += 1) {
    const teacherIdx = matchStudentToTeacher[i];
    const src = teacherIdx >= 0 ? teacherSources[teacherIdx] : "S";
    if (!currentSource) currentSource = src;
    if (src !== currentSource) {
      runSources.push(currentSource);
      runTexts.push(currentText);
      currentSource = src;
      currentText = "";
    }
    currentText += studentLines[i];
  }
  if (currentSource) {
    runSources.push(currentSource);
    runTexts.push(currentText);
  }
  return [runSources, runTexts];
}

function migrateLegacyToRich(originalText, teacherPlain, studentPlain) {
  const original = String(originalText ?? "");
  const teacher = String(teacherPlain ?? "");
  const student = String(studentPlain ?? "");

  if (!teacher.trim() && !student.trim()) {
    return buildRichFromRuns(["O"], [original]);
  }
  if (student.trim()) {
    const [sources, texts] = buildRunsByLineTwoStage(original, teacher.trim() ? teacher : original, student);
    return buildRichFromRuns(sources, texts);
  }
  const [sources, texts] = buildRunsByLineSingleStage(original, teacher, "T");
  return buildRichFromRuns(sources, texts);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_USERS)) {
        db.createObjectStore(STORE_USERS, { keyPath: "username" });
      }

      if (!db.objectStoreNames.contains(STORE_SUBMISSIONS)) {
        const store = db.createObjectStore(STORE_SUBMISSIONS, { keyPath: "id" });
        store.createIndex("byStudent", "studentUsername", { unique: false });
        store.createIndex("byTime", "submitTime", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开数据库失败"));
  });
}

async function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("事务已中止"));
    tx.onerror = () => reject(tx.error || new Error("事务失败"));
  });
}

function nowIso() {
  return new Date().toISOString();
}

function toSafeString(value) {
  return String(value ?? "").trim();
}

export async function ensureDefaults() {
  const db = await openDb();
  const tx = db.transaction([STORE_USERS], "readwrite");
  const users = tx.objectStore(STORE_USERS);

  const existing = await new Promise((resolve) => {
    const req = users.get("teacher");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

  if (!existing) {
    users.put({
      username: "teacher",
      password: "123456",
      displayName: "默认教师",
      role: "教师",
      createdAt: nowIso(),
    });
  }

  await txDone(tx);
  db.close();
}

export async function registerUser({ username, password, displayName, role }) {
  const u = toSafeString(username);
  const p = toSafeString(password);
  const d = toSafeString(displayName);
  const r = toSafeString(role);

  if (!u || !p || !d) {
    throw new Error("请完整填写：用户名/密码/姓名");
  }
  if (r !== "学生" && r !== "教师") {
    throw new Error("角色不合法");
  }

  const db = await openDb();
  const tx = db.transaction([STORE_USERS], "readwrite");
  const store = tx.objectStore(STORE_USERS);

  const exists = await new Promise((resolve) => {
    const req = store.get(u);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => resolve(false);
  });
  if (exists) {
    tx.abort();
    db.close();
    throw new Error("用户名已存在");
  }

  const user = {
    username: u,
    password: p,
    displayName: d,
    role: r,
    createdAt: nowIso(),
  };

  store.put(user);
  await txDone(tx);
  db.close();
  return { ...user, password: undefined };
}

export async function loginUser({ username, password }) {
  const u = toSafeString(username);
  const p = toSafeString(password);
  if (!u || !p) {
    throw new Error("请输入用户名和密码");
  }

  const db = await openDb();
  const tx = db.transaction([STORE_USERS], "readonly");
  const store = tx.objectStore(STORE_USERS);

  const user = await new Promise((resolve, reject) => {
    const req = store.get(u);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取用户失败"));
  });
  await txDone(tx);
  db.close();

  if (!user || user.password !== p) {
    throw new Error("账号或密码错误");
  }
  return { ...user, password: undefined };
}

export async function getUser(username) {
  const u = toSafeString(username);
  if (!u) return null;

  const db = await openDb();
  const tx = db.transaction([STORE_USERS], "readonly");
  const store = tx.objectStore(STORE_USERS);

  const user = await new Promise((resolve) => {
    const req = store.get(u);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  await txDone(tx);
  db.close();

  if (!user) return null;
  return { ...user, password: undefined };
}

async function putFile(db, file) {
  const key = crypto.randomUUID();
  const record = {
    key,
    name: file?.name || "file",
    type: file?.type || "application/octet-stream",
    blob: file instanceof Blob ? file : new Blob([]),
    createdAt: nowIso(),
  };

  const tx = db.transaction([STORE_FILES], "readwrite");
  tx.objectStore(STORE_FILES).put(record);
  await txDone(tx);

  return record;
}

export async function getFileRecord(fileKey) {
  if (!fileKey) return null;
  const db = await openDb();
  const tx = db.transaction([STORE_FILES], "readonly");
  const store = tx.objectStore(STORE_FILES);
  const record = await new Promise((resolve) => {
    const req = store.get(fileKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  await txDone(tx);
  db.close();
  return record;
}

export async function submitAssignment({ studentUser, file }) {
  if (!studentUser?.username) {
    throw new Error("未登录");
  }
  if (!(file instanceof File)) {
    throw new Error("请选择文件");
  }

  const db = await openDb();
  const fileRecord = await putFile(db, file);

  const submission = {
    id: crypto.randomUUID(),
    studentUsername: studentUser.username,
    studentName: studentUser.displayName,
    fileName: file.name,
    submitTime: nowIso(),
    status: AssignmentStatus.SUBMITTED.code,
    teacherNote: null,
    reviewFileName: null,
    originalFileKey: fileRecord.key,
    reviewFileKey: null,
    revisedFileName: null,
    revisedFileKey: null,
    onlineReviewContent: null,
    onlineStudentFixContent: null,
    lineNotes: {},
  };

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  tx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(tx);
  db.close();

  return submission;
}

export async function updateSubmissionDraft({ submissionId, patch }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const p = patch && typeof patch === "object" ? patch : {};

  const allowedKeys = new Set(["onlineReviewContent", "onlineStudentFixContent", "teacherNote", "lineNotes"]);
  for (const key of Object.keys(p)) {
    if (!allowedKeys.has(key)) {
      throw new Error("不允许更新的字段: " + key);
    }
  }

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  const store = tx.objectStore(STORE_SUBMISSIONS);

  const submission = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });

  if (!submission) {
    tx.abort();
    db.close();
    throw new Error("作业不存在");
  }

  if (Object.prototype.hasOwnProperty.call(p, "onlineReviewContent")) {
    submission.onlineReviewContent = String(p.onlineReviewContent ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(p, "onlineStudentFixContent")) {
    submission.onlineStudentFixContent = String(p.onlineStudentFixContent ?? "");
  }
  if (Object.prototype.hasOwnProperty.call(p, "teacherNote")) {
    submission.teacherNote = toSafeString(p.teacherNote) || null;
  }
  if (Object.prototype.hasOwnProperty.call(p, "lineNotes")) {
    submission.lineNotes = p.lineNotes && typeof p.lineNotes === "object" ? p.lineNotes : {};
  }

  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function ensureOnlineEditableContent({ submissionId }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const submission = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });
  await txDone(tx);
  db.close();

  if (!submission) throw new Error("作业不存在");
  if (!isTextFileName(submission.fileName)) throw new Error("当前文件类型不支持在线编辑");

  const originalText = await loadSubmissionOriginalText(submission);
  const current = submission.onlineReviewContent;
  if (isRichContent(current)) {
    return { submission, originalText, richContent: current };
  }

  const rich = migrateLegacyToRich(originalText, submission.onlineReviewContent, submission.onlineStudentFixContent);
  const updated = await updateSubmissionDraft({
    submissionId: submission.id,
    patch: { onlineReviewContent: rich, onlineStudentFixContent: "", lineNotes: {} },
  });
  return { submission: updated, originalText, richContent: rich };
}

export async function listAllSubmissions() {
  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const store = tx.objectStore(STORE_SUBMISSIONS);

  const submissions = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("读取作业列表失败"));
  });
  await txDone(tx);
  db.close();

  submissions.sort((a, b) => String(b.submitTime).localeCompare(String(a.submitTime)));
  return submissions;
}

export async function listSubmissionsForStudent(studentUsername) {
  const u = toSafeString(studentUsername);
  if (!u) return [];

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const index = tx.objectStore(STORE_SUBMISSIONS).index("byStudent");

  const submissions = await new Promise((resolve, reject) => {
    const req = index.getAll(u);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("读取作业列表失败"));
  });
  await txDone(tx);
  db.close();

  submissions.sort((a, b) => String(b.submitTime).localeCompare(String(a.submitTime)));
  return submissions;
}

function deriveFileName(originalName, suffix) {
  const name = String(originalName || "file.txt");
  const match = name.match(/^(.*?)(\.[^.]*)?$/);
  const base = match?.[1] || name;
  const ext = match?.[2] || "";
  return `${base}${suffix}${ext || ".txt"}`;
}

async function putTextFile(db, { name, text }) {
  const blob = new Blob([String(text ?? "")], { type: "text/plain;charset=utf-8" });
  const fileLike = new File([blob], name || "file.txt", { type: blob.type });
  return await putFile(db, fileLike);
}

export async function saveOriginalTextFile({ submissionId, text }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

  const db = await openDb();
  const loadTx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const loadStore = loadTx.objectStore(STORE_SUBMISSIONS);

  const submission = await new Promise((resolve, reject) => {
    const req = loadStore.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });
  await txDone(loadTx);

  if (!submission) {
    db.close();
    throw new Error("作业不存在");
  }

  if (!isTextFileName(submission.fileName)) {
    db.close();
    throw new Error("当前文件类型不支持在线编辑");
  }

  const fileRecord = await putTextFile(db, { name: submission.fileName, text });
  submission.originalFileKey = fileRecord.key;

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function saveOnlineReview({ submissionId, reviewContent, teacherNote }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

  const db = await openDb();
  const loadTx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const loadStore = loadTx.objectStore(STORE_SUBMISSIONS);

  const submission = await new Promise((resolve, reject) => {
    const req = loadStore.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });
  await txDone(loadTx);

  if (!submission) {
    db.close();
    throw new Error("作业不存在");
  }

  submission.onlineReviewContent = String(reviewContent ?? "");
  submission.teacherNote = toSafeString(teacherNote) || null;
  submission.status = AssignmentStatus.REVIEWED.code;

  if (isTextFileName(submission.fileName)) {
    const editedName = deriveFileName(submission.fileName, "_edited");
    const plain = exportPlainTextFromRich(submission.onlineReviewContent);
    const fileRecord = await putTextFile(db, { name: editedName, text: plain });
    submission.reviewFileKey = fileRecord.key;
    submission.reviewFileName = editedName;
    submission.revisedFileKey = fileRecord.key;
    submission.revisedFileName = editedName;
  }

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function saveStudentCorrection({ submissionId, correctionContent }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

  const db = await openDb();
  const loadTx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const loadStore = loadTx.objectStore(STORE_SUBMISSIONS);

  const submission = await new Promise((resolve, reject) => {
    const req = loadStore.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });
  await txDone(loadTx);

  if (!submission) {
    db.close();
    throw new Error("作业不存在");
  }

  submission.onlineReviewContent = String(correctionContent ?? "");
  submission.onlineStudentFixContent = "";
  submission.status = AssignmentStatus.REVISED.code;

  if (isTextFileName(submission.fileName)) {
    const editedName = deriveFileName(submission.fileName, "_edited");
    const plain = exportPlainTextFromRich(submission.onlineReviewContent);
    const fileRecord = await putTextFile(db, { name: editedName, text: plain });
    submission.revisedFileKey = fileRecord.key;
    submission.revisedFileName = editedName;
    submission.reviewFileKey = fileRecord.key;
    submission.reviewFileName = editedName;
  }

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function uploadReviewFile({ submissionId, reviewFile, teacherNote }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  if (!(reviewFile instanceof File)) throw new Error("请选择批改文件");

  const db = await openDb();
  const fileRecord = await putFile(db, reviewFile);

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  const store = tx.objectStore(STORE_SUBMISSIONS);

  const submission = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("读取作业失败"));
  });

  if (!submission) {
    tx.abort();
    db.close();
    throw new Error("作业不存在");
  }

  submission.reviewFileKey = fileRecord.key;
  submission.reviewFileName = reviewFile.name;
  submission.teacherNote = toSafeString(teacherNote) || null;
  submission.status = AssignmentStatus.REVIEWED.code;

  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function loadSubmissionOriginalText(submission) {
  const fileKey = submission?.originalFileKey;
  const fileRecord = await getFileRecord(fileKey);
  if (!fileRecord?.blob) {
    throw new Error("原始作业文件不存在");
  }
  return await fileRecord.blob.text();
}
