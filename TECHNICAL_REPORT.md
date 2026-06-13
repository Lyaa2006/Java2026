# 技术报告 — 代码/作业互助批改平台（Java 桌面版）

本文只挑选项目中实现最明确、能直接对应课程知识点的技术要点，并给出对应源码位置与简短代码片段，便于课堂提交与教师评阅。

## 一、项目概要（两句话）
- 桌面版基于 Swing 实现前端界面，业务逻辑由 Service 层实现，数据以文件序列化与磁盘文件方式持久化。关键源码位于 `src/app`。

## 二、关键文件一览（用于定位）
- 模型：`src/app/model/*`（`User`, `Student`, `Teacher`, `Submission`, `AssignmentStatus`）
- 服务：`src/app/service/*`（`UserService`, `SubmissionService`, `SubmissionServiceImpl`, `DataStore`）
- UI：`src/app/ui/*`（`LoginFrame`, `DashboardFrame`, `StudentPanel`, `TeacherPanel`, `OnlineReviewDialog`, `OnlineCorrectionDialog`）
- 工具：`src/app/util/FileUtils.java`
- 程序入口/上下文：`src/app/Main.java`, `src/app/AppContext.java`

## 三、课程要点与项目中明确体现的实现

1) 面向对象：类与继承

- 位置：`src/app/model/User.java`, `Student.java`, `Teacher.java`
- 要点：`User` 为抽象类，`Student` 与 `Teacher` 继承并实现 `getRole()`，体现继承、封装与多态。

```java
public abstract class User implements Serializable { ...; public abstract String getRole(); }
public class Student extends User { @Override public String getRole() { return "学生"; } }
```

2) 抽象类与接口、分层设计

- 位置：`src/app/service/UserService.java`, `SubmissionService.java` 与对应的 `*Impl` 实现。
- 要点：接口定义业务契约，`*Impl` 实现具体逻辑，体现接口编程和服务层解耦。

3) Java 集合与泛型

- 位置：`src/app/service/DataStore.java`（`Map<String, User>`、`List<Submission>`、`Map<String, OnlineEditLock>`）
- 要点：使用泛型集合做用户与提交记录管理，便于按 username 快速查找与按序维护提交历史。

4) 输入/输出（含二进制文件处理）

- 位置：`src/app/util/FileUtils.java`、`src/app/service/DataStore.java`
- 要点：文件拷贝与文本读写使用字节流（`FileInputStream` / `FileOutputStream`），`DataStore` 使用 `ObjectInputStream` / `ObjectOutputStream` 做对象序列化持久化。

简短片段：
```java
public static void copyFile(File source, File target) throws IOException {
    try (FileInputStream in = new FileInputStream(source);
         FileOutputStream out = new FileOutputStream(target)) {
        byte[] buf = new byte[8192]; int r; while ((r = in.read(buf))!=-1) out.write(buf,0,r);
    }
}
```

5) GUI（Swing）与 MVC 思路

- 位置：`src/app/ui/*`，尤其 `SubmissionTableModel.java`（表格模型）与 `StudentPanel.java` / `TeacherPanel.java`（视图与事件）
- 要点：`AbstractTableModel` 用作模型，`JTable` 用作视图，Panel 处理用户事件并调用 Service，符合 MVC 分工。

示例（表头数组与 getValueAt 的方法体现数组与方法设计）：
```java
private final String[] columns;
public SubmissionTableModel(String[] columns) { this.columns = columns; }
@Override public Object getValueAt(int r,int c){ Submission s=submissions.get(r); return switch(c){ case 0->s.getId(); case 1->s.getStudentName(); ... }; }
```

6) 在线富文本表示、行来源标记与行级合并（算法）

- 位置：核心在 `src/app/service/SubmissionServiceImpl.java` 与 UI 的 `OnlineReviewDialog.java` / `OnlineCorrectionDialog.java`。
- 要点：项目采用自定义“rich”格式保存在线编辑内容（以魔术头 `RICH1\n` 开头，每段按来源字符（O/T/S）+ Base64 编码保存），以便在 `JTextPane` 中按来源设置颜色显示并在多次批改/订正后保留来源信息。

rich 格式（示意）：
```
RICH1
O:BASE64(...)\n
T:BASE64(...)\n
S:BASE64(...)\n
```

- 算法：`SubmissionServiceImpl` 实现了基于行的 LCS（最长公共子序列）匹配 `lcsMatches`，用于将原始/教师/学生多阶段内容按行比对并生成按来源的段落 runs（`buildRunsByLine` / `buildRichFromRuns`）。这是字符串处理与算法课程点的直接体现。

7) 并发与线程安全（局部并发控制）

- 位置：`src/app/ui/*` 使用 `SwingWorker` 执行耗时 IO；`src/app/service/DataStore.java` 的关键方法带 `synchronized`；`SubmissionServiceImpl` 在锁操作处使用 `synchronized (dataStore)`。
- 要点：
  - `SwingWorker` 防止 EDT 阻塞，保证界面响应性（文件上传/下载、保存在线编辑时使用）。
  - 在线编辑使用 `OnlineEditLock`（保存在 `DataStore`）记录持有者与时间戳，并在 `SubmissionServiceImpl` 中判断锁过期与归属，结合 `synchronized` 保证同一 JVM 内并发安全。

小片段（锁尝试逻辑缩略）：
```java
synchronized(dataStore){
  OnlineEditLock ex = dataStore.getOnlineEditLock(submission.getId());
  if (ex==null || isLockExpired(ex) || isSameOwner(ex,role,user)) { dataStore.putOnlineEditLock(id,new OnlineEditLock(role,user,now)); dataStore.save(); return null; }
  return ex.getRole()+"（"+ex.getUsername()+"）";
}
```

8) 异常处理与用户提示

- 位置：Service 层方法多 `throws Exception` 做参数/状态校验，UI 层捕获并通过 `JOptionPane` 提示用户（例如上传失败、保存失败等）。

示例：
```java
try { submissionService.submit(student, selected); }
catch (Exception ex) { JOptionPane.showMessageDialog(this, "上传失败: " + ex.getMessage()); }
```

9) 设计模式与架构要点

- `AppContext` 提供单点全局获取（类似简单单例/工厂）：`getUserService()`、`getSubmissionService()`。
- 分层：UI -> Service -> DataStore，职责清晰，便于后续替换 DataStore 为数据库实现。

## 四、结论（简短）
- 项目在桌面端明确实现并能良好演示的课程点包括：面向对象（抽象类/继承/多态）、接口与分层设计、集合与泛型、IO（字节与对象序列化）、Swing GUI（StyledDocument 与 DocumentFilter）、行级比对算法（LCS）与富文本来源合并、以及局部并发控制（SwingWorker + synchronized + 锁结构）。
- 报告内容仅聚焦项目中已有并且实现明确的技术点，便于教师对照评分。

---
文件位置：`TECHNICAL_REPORT.md`（仓库根目录）
