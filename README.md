# 代码/作业互助批改平台（Java Swing 本地版）

本项目是一个纯 Java 本地运行的作业互助批改平台，包含学生端与教师端的完整流程闭环，覆盖 Java 核心技术（GUI、IO 流、集合框架、面向对象、异常处理、接口/抽象类、多线程）。

## 功能概览

- 双角色登录/注册
- 学生端：作业上传、查看状态、下载批改文件
- 教师端：查看提交列表、下载作业、上传批改文件并填写批注
- 在线查看作业、在线批改与在线订正（支持 txt/java/md/csv）
- 作业状态管理与消息提示
- 统一文件管理与异常处理

## 模块说明

- `app.Main`
  - 程序入口，初始化外观并启动登录界面。
- `app.AppContext`
  - 应用上下文，集中管理服务实例。
- `app.model`
  - `User`（抽象类）：用户基类，封装用户名/密码/姓名等公共字段。
  - `Student` / `Teacher`：学生与教师角色实体。
  - `Submission`：作业提交记录，包含状态、批注与文件信息。
  - `AssignmentStatus`：作业状态枚举。
- `app.service`
  - `UserService`（接口）：登录/注册服务。
  - `UserServiceImpl`：用户校验与注册实现。
  - `SubmissionService`（接口）：提交、查询、批改服务。
  - `SubmissionServiceImpl`：作业文件管理与状态更新。
  - `DataStore`：序列化持久化（用户与作业提交）。
- `app.util.FileUtils`
  - IO 流工具类，负责文件复制与目录创建。
- `app.ui`
  - `LoginFrame`：登录/注册界面。
  - `DashboardFrame`：根据角色切换学生/教师工作台。
  - `StudentPanel`：学生端上传、查看与下载。
  - `TeacherPanel`：教师端列表、下载与批改回传。
  - `SubmissionTableModel`：Swing 表格数据模型。
  - `OnlineReviewDialog`：教师在线批改界面。
  - `OnlineCorrectionDialog`：学生在线订正界面。
  - `OnlineReviewViewerDialog`：学生在线查看批改界面。

## 数据与文件说明

- `data/users.dat`：用户数据（序列化保存）
- `data/submissions.dat`：作业提交数据（序列化保存）
- `data/submissions/<student>`：学生作业文件存储目录
- `data/reviews/<student>`：教师批改文件存储目录

## 运行方式（Windows PowerShell）

编译：

```powershell
javac -encoding UTF-8 -d out (Get-ChildItem -Recurse -Filter *.java | ForEach-Object { $_.FullName })
```

运行：

```powershell
java -cp out app.Main
```

## 默认账号

- 教师账号：`teacher` / `123456`

## 说明

- 所有文件均为本地 IO 读写，无需网络。
- 上传/下载/回传操作通过 `SwingWorker` 在后台执行，保证界面响应。
- 在线批改与订正仅支持纯文本类文件（txt/java/md/csv）。
