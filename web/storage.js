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

export function statusLabel(statusCode) {
  return AssignmentStatus[statusCode]?.label ?? statusCode ?? "";
}

export function isTextFileName(fileName) {
  const name = String(fileName || "").toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".java") || name.endsWith(".md") || name.endsWith(".csv");
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

  if (!isTextFileName(submission.fileName)) {
    tx.abort();
    db.close();
    throw new Error("当前文件类型不支持在线编辑");
  }

  const fileRecord = await putTextFile(db, { name: submission.fileName, text });
  submission.originalFileKey = fileRecord.key;
  store.put(submission);

  await txDone(tx);
  db.close();
  return submission;
}

export async function saveOnlineReview({ submissionId, reviewContent, teacherNote }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

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

  submission.onlineReviewContent = String(reviewContent ?? "");
  submission.teacherNote = toSafeString(teacherNote) || null;
  submission.status = AssignmentStatus.REVIEWED.code;

  if (isTextFileName(submission.fileName)) {
    const reviewName = deriveFileName(submission.fileName, "_reviewed");
    const fileRecord = await putTextFile(db, { name: reviewName, text: submission.onlineReviewContent });
    submission.reviewFileKey = fileRecord.key;
    submission.reviewFileName = reviewName;
  }

  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function saveStudentCorrection({ submissionId, correctionContent }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

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

  submission.onlineStudentFixContent = String(correctionContent ?? "");
  submission.status = AssignmentStatus.REVISED.code;

  if (isTextFileName(submission.fileName)) {
    const revisedName = deriveFileName(submission.fileName, "_revised");
    const fileRecord = await putTextFile(db, { name: revisedName, text: submission.onlineStudentFixContent });
    submission.revisedFileKey = fileRecord.key;
    submission.revisedFileName = revisedName;
  }

  store.put(submission);
  await txDone(tx);
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
