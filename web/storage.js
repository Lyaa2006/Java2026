const DB_NAME = "hw_review_platform";
const DB_VERSION = 4;

const STORE_USERS = "users";
const STORE_SUBMISSIONS = "submissions";
const STORE_FILES = "files";
const STORE_CLASSES = "classes";
const STORE_ASSIGNMENTS = "assignments";

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

function parseRichRuns(content) {
  if (!isRichContent(content)) return [{ src: "O", text: String(content ?? "") }];
  const runs = [];
  for (const line of String(content).split("\n").slice(1)) {
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const src = line.slice(0, separator, 1) || "O";
    const payload = line.slice(separator + 1);
    runs.push({ src, text: payload ? decodeBase64ToUtf8(payload) : "" });
  }
  return runs;
}

function textForSource(content, source) {
  return parseRichRuns(content)
    .filter((run) => run.src === source)
    .map((run) => run.text)
    .join("");
}

function assertProtectedSourceUnchanged(previousContent, nextContent, protectedSource, message) {
  if (textForSource(previousContent, protectedSource) !== textForSource(nextContent, protectedSource)) {
    throw new Error(message);
  }
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
        store.createIndex("byClass", "classId", { unique: false });
        store.createIndex("byAssignment", "assignmentId", { unique: false });
      } else {
        const store = request.transaction.objectStore(STORE_SUBMISSIONS);
        if (!store.indexNames.contains("byClass")) {
          store.createIndex("byClass", "classId", { unique: false });
        }
        if (!store.indexNames.contains("byAssignment")) {
          store.createIndex("byAssignment", "assignmentId", { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_CLASSES)) {
        const store = db.createObjectStore(STORE_CLASSES, { keyPath: "id" });
        store.createIndex("byOwner", "ownerUsername", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ASSIGNMENTS)) {
        const store = db.createObjectStore(STORE_ASSIGNMENTS, { keyPath: "id" });
        store.createIndex("byClass", "classId", { unique: false });
        store.createIndex("byPublisher", "publisherUsername", { unique: false });
        store.createIndex("byTime", "createdAt", { unique: false });
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

function uniqueStrings(values) {
  return [...new Set((values || []).map(toSafeString).filter(Boolean))];
}

function publicUser(user) {
  if (!user) return null;
  return { ...user, password: undefined };
}

function hasTeacherClassAccess(classRecord, teacherUsername) {
  const u = toSafeString(teacherUsername);
  if (!classRecord || !u) return false;
  return classRecord.ownerUsername === u || (classRecord.controllerUsernames || []).includes(u);
}

async function getRecord(store, key, errorMessage) {
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error(errorMessage || "读取记录失败"));
  });
}

async function getAllRecords(store, errorMessage) {
  return await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error(errorMessage || "读取列表失败"));
  });
}

async function assertTeacherCanAccessSubmission(db, submission, teacherUser) {
  if (teacherUser?.role !== "教师") {
    throw new Error("仅教师可执行该操作");
  }
  if (!submission?.classId) return;

  const tx = db.transaction([STORE_CLASSES], "readonly");
  const klass = await getRecord(tx.objectStore(STORE_CLASSES), submission.classId, "读取班级失败");
  await txDone(tx);
  if (!hasTeacherClassAccess(klass, teacherUser.username)) {
    throw new Error("无该班级权限，不能查看或批改该作业");
  }
}

async function getClassOrThrow(db, classId, requiredMessage = "请选择班级") {
  const id = toSafeString(classId);
  if (!id) {
    throw new Error(requiredMessage);
  }

  const tx = db.transaction([STORE_CLASSES], "readonly");
  const klass = await getRecord(tx.objectStore(STORE_CLASSES), id, "读取班级失败");
  await txDone(tx);
  if (!klass) {
    throw new Error("班级不存在");
  }
  return klass;
}

async function getAssignmentOrThrow(db, assignmentId) {
  const id = toSafeString(assignmentId);
  if (!id) {
    throw new Error("请选择作业");
  }

  const tx = db.transaction([STORE_ASSIGNMENTS], "readonly");
  const assignment = await getRecord(tx.objectStore(STORE_ASSIGNMENTS), id, "读取作业失败");
  await txDone(tx);
  if (!assignment) {
    throw new Error("作业不存在");
  }
  return assignment;
}

function isStudentInClass(classRecord, studentUsername) {
  const u = toSafeString(studentUsername);
  if (!classRecord || !u) return false;
  return (classRecord.memberUsernames || []).includes(u);
}

async function assertTeacherCanAccessClass(db, classId, teacherUser) {
  if (teacherUser?.role !== "教师") {
    throw new Error("仅教师可执行该操作");
  }
  const klass = await getClassOrThrow(db, classId);
  if (!hasTeacherClassAccess(klass, teacherUser.username)) {
    throw new Error("无该班级权限");
  }
  return klass;
}

async function assertStudentCanAccessAssignment(db, assignment, studentUser) {
  if (studentUser?.role !== "学生") {
    throw new Error("仅学生可执行该操作");
  }
  const klass = await getClassOrThrow(db, assignment?.classId);
  if (!isStudentInClass(klass, studentUser.username)) {
    throw new Error("你不在该班级中，无法查看该作业");
  }
  return klass;
}

export async function ensureDefaults() {
  const db = await openDb();
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
  return publicUser(user);
}

export async function loginUser({ username, password, role }) {
  const u = toSafeString(username);
  const p = toSafeString(password);
  const r = toSafeString(role);
  if (!u || !p || !r) {
    throw new Error("请输入用户名、密码和角色");
  }
  if (r !== "学生" && r !== "教师") {
    throw new Error("角色不合法");
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
  if (user.role !== r) {
    throw new Error(r === "教师" ? "该账号不是教师账号" : "该账号不是学生账号");
  }
  return publicUser(user);
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
  return publicUser(user);
}

export async function listTeachers() {
  const db = await openDb();
  const tx = db.transaction([STORE_USERS], "readonly");
  const users = await getAllRecords(tx.objectStore(STORE_USERS), "读取教师列表失败");
  await txDone(tx);
  db.close();
  return users.filter((u) => u.role === "教师").map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
}

export async function listClasses() {
  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES], "readonly");
  const classes = await getAllRecords(tx.objectStore(STORE_CLASSES), "读取班级列表失败");
  await txDone(tx);
  db.close();
  classes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return classes;
}

export async function listClassesForStudent(studentUsername) {
  const u = toSafeString(studentUsername);
  const classes = await listClasses();
  return classes.map((klass) => ({
    ...klass,
    joined: (klass.memberUsernames || []).includes(u),
    pending: (klass.pendingUsernames || []).includes(u),
  }));
}

export async function listClassesForTeacher(teacherUsername) {
  const u = toSafeString(teacherUsername);
  const classes = await listClasses();
  return classes.filter((klass) => hasTeacherClassAccess(klass, u));
}

export async function createAssignment({ teacherUser, classId, title, description }) {
  const db = await openDb();
  const klass = await assertTeacherCanAccessClass(db, classId, teacherUser);

  const assignmentTitle = toSafeString(title);
  if (!assignmentTitle) {
    db.close();
    throw new Error("请填写作业标题");
  }

  const assignment = {
    id: crypto.randomUUID(),
    classId: klass.id,
    className: klass.name,
    title: assignmentTitle,
    description: toSafeString(description),
    publisherUsername: teacherUser.username,
    publisherName: teacherUser.displayName,
    createdAt: nowIso(),
  };

  const tx = db.transaction([STORE_ASSIGNMENTS], "readwrite");
  tx.objectStore(STORE_ASSIGNMENTS).put(assignment);
  await txDone(tx);
  db.close();
  return assignment;
}

export async function listAssignmentsForTeacher(teacherUsername) {
  const u = toSafeString(teacherUsername);
  if (!u) return [];

  const db = await openDb();
  const tx = db.transaction([STORE_ASSIGNMENTS, STORE_CLASSES], "readonly");
  const assignments = await getAllRecords(tx.objectStore(STORE_ASSIGNMENTS), "读取作业列表失败");
  const classes = await getAllRecords(tx.objectStore(STORE_CLASSES), "读取班级列表失败");
  await txDone(tx);
  db.close();

  const accessibleClassIds = new Set(classes.filter((klass) => hasTeacherClassAccess(klass, u)).map((klass) => klass.id));
  return assignments
    .filter((assignment) => accessibleClassIds.has(assignment.classId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listAssignmentsForStudent(studentUsername) {
  const u = toSafeString(studentUsername);
  if (!u) return [];

  const db = await openDb();
  const tx = db.transaction([STORE_ASSIGNMENTS, STORE_CLASSES], "readonly");
  const assignments = await getAllRecords(tx.objectStore(STORE_ASSIGNMENTS), "读取作业列表失败");
  const classes = await getAllRecords(tx.objectStore(STORE_CLASSES), "读取班级列表失败");
  await txDone(tx);
  db.close();

  const joinedClassIds = new Set(classes.filter((klass) => isStudentInClass(klass, u)).map((klass) => klass.id));
  return assignments
    .filter((assignment) => joinedClassIds.has(assignment.classId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getAssignment(assignmentId) {
  const db = await openDb();
  const assignment = await getAssignmentOrThrow(db, assignmentId);
  db.close();
  return assignment;
}

function normalizeFileList(files, fallbackFile) {
  const list = Array.from(files || []);
  if (!list.length && fallbackFile) list.push(fallbackFile);
  return list.filter((item) => item instanceof File);
}

async function buildSubmissionFiles(db, files) {
  const selectedFiles = normalizeFileList(files);
  if (!selectedFiles.length) {
    throw new Error("请选择至少一个文件");
  }

  const entries = [];
  for (const file of selectedFiles) {
    const fileRecord = await putFile(db, file);
    entries.push({
      id: crypto.randomUUID(),
      fileName: file.name,
      originalFileKey: fileRecord.key,
      reviewFileName: null,
      reviewFileKey: null,
      revisedFileName: null,
      revisedFileKey: null,
      onlineReviewContent: null,
      onlineStudentFixContent: null,
      lineNotes: {},
      uploadedAt: nowIso(),
    });
  }
  return entries;
}

function mergeSubmissionFiles(existingFiles, incomingFiles) {
  const merged = Array.isArray(existingFiles) ? [...existingFiles] : [];

  for (const incoming of incomingFiles) {
    const index = merged.findIndex((item) => item?.fileName === incoming.fileName);
    if (index >= 0) {
      merged[index] = incoming;
    } else {
      merged.push(incoming);
    }
  }

  return merged;
}

export function getSubmissionFiles(submission) {
  return Array.isArray(submission?.files) ? submission.files : [];
}

function getSubmissionFileEntry(submission, fileId) {
  const id = toSafeString(fileId);
  return getSubmissionFiles(submission).find((item) => item.id === id) || null;
}

function getSubmissionFileEntryOrThrow(submission, fileId) {
  const file = getSubmissionFileEntry(submission, fileId);
  if (!file) {
    throw new Error("请选择提交中的文件");
  }
  return file;
}

async function findStudentAssignmentSubmission(store, assignmentId, studentUsername) {
  const submissions = await getAllRecords(store, "读取作业提交列表失败");
  return submissions.find((item) => item.assignmentId === assignmentId && item.studentUsername === studentUsername) || null;
}

export async function submitAssignmentToAssignment({ studentUser, file, files, assignmentId }) {
  if (!studentUser?.username) {
    throw new Error("未登录");
  }
  if (studentUser.role !== "学生") {
    throw new Error("仅学生可以提交作业");
  }
  const selectedFiles = normalizeFileList(files, file);
  if (!selectedFiles.length) {
    throw new Error("请选择至少一个文件");
  }

  const db = await openDb();
  const assignment = await getAssignmentOrThrow(db, assignmentId);
  const klass = await assertStudentCanAccessAssignment(db, assignment, studentUser);
  const submissionFiles = await buildSubmissionFiles(db, selectedFiles);

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const existing = await findStudentAssignmentSubmission(store, assignment.id, studentUser.username);

  const submission = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    studentUsername: studentUser.username,
    studentName: studentUser.displayName,
    classId: klass.id,
    className: klass.name,
    files: mergeSubmissionFiles(existing?.files, submissionFiles),
    submitTime: nowIso(),
    status: AssignmentStatus.SUBMITTED.code,
    teacherNote: null,
  };

  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function createClass({ teacherUser, name, description }) {
  if (teacherUser?.role !== "教师") throw new Error("仅教师可以创建班级");
  const className = toSafeString(name);
  if (!className) throw new Error("请填写班级名称");

  const klass = {
    id: crypto.randomUUID(),
    name: className,
    description: toSafeString(description),
    ownerUsername: teacherUser.username,
    ownerName: teacherUser.displayName,
    controllerUsernames: [],
    memberUsernames: [],
    pendingUsernames: [],
    createdAt: nowIso(),
  };

  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES], "readwrite");
  tx.objectStore(STORE_CLASSES).put(klass);
  await txDone(tx);
  db.close();
  return klass;
}

export async function requestClassJoin({ studentUser, classId }) {
  if (studentUser?.role !== "学生") throw new Error("仅学生可以加入班级");
  const id = toSafeString(classId);
  if (!id) throw new Error("请选择班级");

  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES], "readwrite");
  const store = tx.objectStore(STORE_CLASSES);
  const klass = await getRecord(store, id, "读取班级失败");
  if (!klass) {
    tx.abort();
    db.close();
    throw new Error("班级不存在");
  }
  if ((klass.memberUsernames || []).includes(studentUser.username)) {
    tx.abort();
    db.close();
    throw new Error("你已经是该班级成员");
  }
  if ((klass.pendingUsernames || []).includes(studentUser.username)) {
    tx.abort();
    db.close();
    throw new Error("入班申请正在等待教师审批");
  }
  klass.pendingUsernames = uniqueStrings([...(klass.pendingUsernames || []), studentUser.username]);
  store.put(klass);
  await txDone(tx);
  db.close();
  return klass;
}

export async function reviewClassJoinRequest({ classId, teacherUser, studentUsername, approved }) {
  if (teacherUser?.role !== "教师") throw new Error("仅教师可以审批入班申请");
  const id = toSafeString(classId);
  const student = toSafeString(studentUsername);
  if (!id || !student) throw new Error("审批参数不完整");

  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES, STORE_USERS], "readwrite");
  const classes = tx.objectStore(STORE_CLASSES);
  const users = tx.objectStore(STORE_USERS);
  const klass = await getRecord(classes, id, "读取班级失败");
  const studentUser = await getRecord(users, student, "读取学生失败");

  if (!klass) {
    tx.abort();
    db.close();
    throw new Error("班级不存在");
  }
  if (!hasTeacherClassAccess(klass, teacherUser.username)) {
    tx.abort();
    db.close();
    throw new Error("无该班级审批权限");
  }
  if (!studentUser || studentUser.role !== "学生") {
    tx.abort();
    db.close();
    throw new Error("申请账号不是学生");
  }
  if (!(klass.pendingUsernames || []).includes(student)) {
    tx.abort();
    db.close();
    throw new Error("该申请不存在或已处理");
  }

  klass.pendingUsernames = (klass.pendingUsernames || []).filter((username) => username !== student);
  if (approved) {
    klass.memberUsernames = uniqueStrings([...(klass.memberUsernames || []), student]);
  }
  classes.put(klass);
  await txDone(tx);
  db.close();
  return klass;
}

export async function grantClassTeacherAccess({ classId, ownerUser, teacherUsername }) {
  if (ownerUser?.role !== "教师") throw new Error("仅教师可以授权");
  const id = toSafeString(classId);
  const target = toSafeString(teacherUsername);
  if (!id || !target) throw new Error("请选择班级并填写教师账号");

  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES, STORE_USERS], "readwrite");
  const classes = tx.objectStore(STORE_CLASSES);
  const users = tx.objectStore(STORE_USERS);
  const klass = await getRecord(classes, id, "读取班级失败");
  const teacher = await getRecord(users, target, "读取教师失败");

  if (!klass) {
    tx.abort();
    db.close();
    throw new Error("班级不存在");
  }
  if (klass.ownerUsername !== ownerUser.username) {
    tx.abort();
    db.close();
    throw new Error("只有班级创建者可以开放控制权限");
  }
  if (!teacher || teacher.role !== "教师") {
    tx.abort();
    db.close();
    throw new Error("指定账号不是教师");
  }
  if (target === klass.ownerUsername) {
    tx.abort();
    db.close();
    throw new Error("创建者已拥有控制权限");
  }

  klass.controllerUsernames = uniqueStrings([...(klass.controllerUsernames || []), target]);
  classes.put(klass);
  await txDone(tx);
  db.close();
  return klass;
}

export async function revokeClassTeacherAccess({ classId, ownerUser, teacherUsername }) {
  if (ownerUser?.role !== "教师") throw new Error("仅教师可以取消授权");
  const id = toSafeString(classId);
  const target = toSafeString(teacherUsername);
  if (!id || !target) throw new Error("请选择班级和教师");

  const db = await openDb();
  const tx = db.transaction([STORE_CLASSES], "readwrite");
  const store = tx.objectStore(STORE_CLASSES);
  const klass = await getRecord(store, id, "读取班级失败");
  if (!klass) {
    tx.abort();
    db.close();
    throw new Error("班级不存在");
  }
  if (klass.ownerUsername !== ownerUser.username) {
    tx.abort();
    db.close();
    throw new Error("只有班级创建者可以取消控制权限");
  }
  klass.controllerUsernames = (klass.controllerUsernames || []).filter((u) => u !== target);
  store.put(klass);
  await txDone(tx);
  db.close();
  return klass;
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

export async function submitAssignment({ studentUser, file, files, classId }) {
  if (!studentUser?.username) {
    throw new Error("未登录");
  }
  if (studentUser.role !== "学生") {
    throw new Error("仅学生可以提交作业");
  }
  const selectedFiles = normalizeFileList(files, file);
  if (!selectedFiles.length) {
    throw new Error("请选择至少一个文件");
  }
  const targetClassId = toSafeString(classId);
  if (!targetClassId) {
    throw new Error("请选择提交班级");
  }

  const db = await openDb();
  const classTx = db.transaction([STORE_CLASSES], "readonly");
  const klass = await getRecord(classTx.objectStore(STORE_CLASSES), targetClassId, "读取班级失败");
  await txDone(classTx);
  if (!klass) {
    db.close();
    throw new Error("班级不存在");
  }
  if (!(klass.memberUsernames || []).includes(studentUser.username)) {
    db.close();
    throw new Error("请先加入该班级，再提交作业");
  }

  const submissionFiles = await buildSubmissionFiles(db, selectedFiles);

  const submission = {
    id: crypto.randomUUID(),
    studentUsername: studentUser.username,
    studentName: studentUser.displayName,
    classId: klass.id,
    className: klass.name,
    files: submissionFiles,
    submitTime: nowIso(),
    status: AssignmentStatus.SUBMITTED.code,
    teacherNote: null,
  };

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  tx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(tx);
  db.close();

  return submission;
}

export async function ensureOnlineEditableContent({ submissionId, fileId }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");

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
  const file = getSubmissionFileEntryOrThrow(submission, targetFileId);
  if (!isTextFileName(file.fileName)) throw new Error("当前文件类型不支持在线编辑");

  const originalText = await loadSubmissionOriginalText(submission, file.id);
  const current = file.onlineReviewContent;
  if (isRichContent(current)) {
    return { submission, file, originalText, richContent: current };
  }

  const rich = migrateLegacyToRich(originalText, file.onlineReviewContent, file.onlineStudentFixContent);
  file.onlineReviewContent = rich;
  file.onlineStudentFixContent = "";
  file.lineNotes = {};

  const saveDb = await openDb();
  const saveTx = saveDb.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  saveDb.close();
  return { submission, file, originalText, richContent: rich };
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

export async function listSubmissionsForTeacher(teacherUsername) {
  const u = toSafeString(teacherUsername);
  if (!u) return [];

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS, STORE_CLASSES], "readonly");
  const submissions = await getAllRecords(tx.objectStore(STORE_SUBMISSIONS), "读取作业列表失败");
  const classes = await getAllRecords(tx.objectStore(STORE_CLASSES), "读取班级列表失败");
  await txDone(tx);
  db.close();

  const accessibleClassIds = new Set(classes.filter((klass) => hasTeacherClassAccess(klass, u)).map((klass) => klass.id));
  const visible = submissions.filter((submission) => !submission.classId || accessibleClassIds.has(submission.classId));
  visible.sort((a, b) => String(b.submitTime).localeCompare(String(a.submitTime)));
  return visible;
}

export async function listSubmissionsForAssignmentLegacy(assignmentId) {
  const id = toSafeString(assignmentId);
  if (!id) return [];

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const index = tx.objectStore(STORE_SUBMISSIONS).index("byAssignment");
  const submissions = await new Promise((resolve, reject) => {
    const req = index.getAll(id);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("读取作业提交列表失败"));
  });
  await txDone(tx);
  db.close();
  submissions.sort((a, b) => String(b.submitTime).localeCompare(String(a.submitTime)));
  return submissions;
}

export async function listSubmissionsForAssignment(assignmentId, teacherUsername = "") {
  const id = toSafeString(assignmentId);
  if (!id) return [];
  const u = toSafeString(teacherUsername);

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS, STORE_CLASSES], "readonly");
  const submissionStore = tx.objectStore(STORE_SUBMISSIONS);
  let submissions = [];

  if (submissionStore.indexNames.contains("byAssignment")) {
    const index = submissionStore.index("byAssignment");
    submissions = await new Promise((resolve, reject) => {
      const req = index.getAll(id);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("读取作业提交列表失败"));
    });
  } else {
    const allSubmissions = await getAllRecords(submissionStore, "读取作业提交列表失败");
    submissions = allSubmissions.filter((submission) => submission.assignmentId === id);
  }

  if (u) {
    const classes = await getAllRecords(tx.objectStore(STORE_CLASSES), "读取班级列表失败");
    const accessibleClassIds = new Set(classes.filter((klass) => hasTeacherClassAccess(klass, u)).map((klass) => klass.id));
    submissions = submissions.filter((submission) => !submission.classId || accessibleClassIds.has(submission.classId));
  }

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

export async function saveOriginalTextFile({ submissionId, fileId, text }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");

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

  const file = getSubmissionFileEntryOrThrow(submission, targetFileId);
  if (!isTextFileName(file.fileName)) {
    db.close();
    throw new Error("当前文件类型不支持在线编辑");
  }

  const fileRecord = await putTextFile(db, { name: file.fileName, text });
  file.originalFileKey = fileRecord.key;

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function saveOnlineReview({ submissionId, fileId, reviewContent, teacherNote, teacherUser }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");

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
  await assertTeacherCanAccessSubmission(db, submission, teacherUser);
  const file = getSubmissionFileEntryOrThrow(submission, targetFileId);

  const nextReviewContent = String(reviewContent ?? "");
  assertProtectedSourceUnchanged(file.onlineReviewContent, nextReviewContent, "S", "教师不能修改学生的蓝色订正内容");
  file.onlineReviewContent = nextReviewContent;
  submission.teacherNote = toSafeString(teacherNote) || null;
  submission.status = AssignmentStatus.REVIEWED.code;

  if (isTextFileName(file.fileName)) {
    const editedName = deriveFileName(file.fileName, "_edited");
    const plain = exportPlainTextFromRich(file.onlineReviewContent);
    const fileRecord = await putTextFile(db, { name: editedName, text: plain });
    file.reviewFileKey = fileRecord.key;
    file.reviewFileName = editedName;
  }

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function saveStudentCorrection({ submissionId, fileId, correctionContent, studentUser }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");

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
  if (studentUser?.role !== "学生" || submission.studentUsername !== studentUser.username) {
    db.close();
    throw new Error("只能订正本人提交的作业");
  }
  const file = getSubmissionFileEntryOrThrow(submission, targetFileId);

  const nextCorrectionContent = String(correctionContent ?? "");
  assertProtectedSourceUnchanged(file.onlineReviewContent, nextCorrectionContent, "T", "学生不能修改教师的红色批注内容");
  file.onlineReviewContent = nextCorrectionContent;
  file.onlineStudentFixContent = "";
  submission.status = AssignmentStatus.REVISED.code;

  if (isTextFileName(file.fileName)) {
    const editedName = deriveFileName(file.fileName, "_edited");
    const plain = exportPlainTextFromRich(file.onlineReviewContent);
    const fileRecord = await putTextFile(db, { name: editedName, text: plain });
    file.revisedFileKey = fileRecord.key;
    file.revisedFileName = editedName;
  }

  const saveTx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  saveTx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(saveTx);
  db.close();
  return submission;
}

export async function uploadReviewFile({ submissionId, fileId, reviewFile, teacherNote, teacherUser }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");
  if (!(reviewFile instanceof File)) throw new Error("请选择批改文件");

  const db = await openDb();
  const loadTx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const submission = await getRecord(loadTx.objectStore(STORE_SUBMISSIONS), id, "读取作业失败");
  await txDone(loadTx);

  if (!submission) {
    db.close();
    throw new Error("作业不存在");
  }
  await assertTeacherCanAccessSubmission(db, submission, teacherUser);
  const file = getSubmissionFileEntryOrThrow(submission, targetFileId);

  const fileRecord = await putFile(db, reviewFile);

  file.reviewFileKey = fileRecord.key;
  file.reviewFileName = reviewFile.name;
  submission.teacherNote = toSafeString(teacherNote) || null;
  submission.status = AssignmentStatus.REVIEWED.code;

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  const store = tx.objectStore(STORE_SUBMISSIONS);
  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function saveSubmissionTeacherNote({ submissionId, teacherNote, teacherUser }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");

  const db = await openDb();
  const loadTx = db.transaction([STORE_SUBMISSIONS], "readonly");
  const submission = await getRecord(loadTx.objectStore(STORE_SUBMISSIONS), id, "读取作业失败");
  await txDone(loadTx);

  if (!submission) {
    db.close();
    throw new Error("作业不存在");
  }
  await assertTeacherCanAccessSubmission(db, submission, teacherUser);

  submission.teacherNote = toSafeString(teacherNote) || null;
  if (submission.teacherNote && submission.status === AssignmentStatus.SUBMITTED.code) {
    submission.status = AssignmentStatus.REVIEWED.code;
  }

  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  tx.objectStore(STORE_SUBMISSIONS).put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function deleteSubmissionFile({ submissionId, fileId, studentUser }) {
  const id = toSafeString(submissionId);
  if (!id) throw new Error("参数错误");
  const targetFileId = toSafeString(fileId);
  if (!targetFileId) throw new Error("请选择文件");
  if (studentUser?.role !== "学生" || !studentUser?.username) {
    throw new Error("仅学生可以删除提交文件");
  }

  const db = await openDb();
  const tx = db.transaction([STORE_SUBMISSIONS], "readwrite");
  const store = tx.objectStore(STORE_SUBMISSIONS);
  const submission = await getRecord(store, id, "读取作业失败");

  if (!submission) {
    tx.abort();
    db.close();
    throw new Error("作业不存在");
  }
  if (submission.studentUsername !== studentUser.username) {
    tx.abort();
    db.close();
    throw new Error("只能删除本人提交中的文件");
  }

  const remainingFiles = getSubmissionFiles(submission).filter((file) => file.id !== targetFileId);
  if (remainingFiles.length === getSubmissionFiles(submission).length) {
    tx.abort();
    db.close();
    throw new Error("文件不存在");
  }

  if (!remainingFiles.length) {
    store.delete(submission.id);
    await txDone(tx);
    db.close();
    return null;
  }

  submission.files = remainingFiles;
  submission.submitTime = nowIso();
  store.put(submission);
  await txDone(tx);
  db.close();
  return submission;
}

export async function loadSubmissionOriginalText(submission, fileId) {
  const file = getSubmissionFileEntryOrThrow(submission, fileId);
  const fileKey = file.originalFileKey;
  const fileRecord = await getFileRecord(fileKey);
  if (!fileRecord?.blob) {
    throw new Error("原始作业文件不存在");
  }
  return await fileRecord.blob.text();
}
