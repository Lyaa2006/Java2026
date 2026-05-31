# 代码/作业互助批改平台（Web 本地存储版）

本仓库当前提供一个无需后端的 Web 版本：所有数据与文件都存储在浏览器本地（IndexedDB），可以直接部署到 Netlify 作为静态站点给体验者使用。

## Web 版功能概览

- 双角色登录/注册（内置默认教师账号）
- 学生端：上传作业、查看状态、下载批改文件、在线订正
- 教师端：查看提交列表、下载作业、上传批改文件并填写批注、在线批改
- 在线编辑：左侧为文本内容编辑区，右侧为旁注区（按行关联）
- 三色区分：原始作业/老师批改/学生订正
- 行锁：同一站点下多标签页可演示“同一行不可同时编辑”

## 数据与隐私说明（重要）

- 本 Web 版不包含服务器；数据不会写回仓库文件。
- 数据按浏览器与站点域名隔离：同一台设备/同一浏览器/同一域名下会保留数据；其他用户不会看到你的本地数据。
- 若需要清空体验数据：浏览器开发者工具 → Application/应用 → Storage → IndexedDB，删除站点数据即可。

## 本地运行（Web 版）

前置要求：安装 Node.js（推荐 18+）。

在项目根目录启动一个静态服务器：

```powershell
cd d:\JavaScript\期末大作业
npx --yes http-server . -p 5173 -c-1
```

浏览器打开：

- http://127.0.0.1:5173/

## 默认账号

- 教师账号：`teacher` / `123456`

## 模块架构（Web 版）

- 页面入口
  - [index.html](file:///d:/JavaScript/%E6%9C%9F%E6%9C%AB%E5%A4%A7%E4%BD%9C%E4%B8%9A/index.html)：静态入口页面，加载样式与主脚本
- 前端 UI/交互
  - [app.js](file:///d:/JavaScript/%E6%9C%9F%E6%9C%AB%E5%A4%A7%E4%BD%9C%E4%B8%9A/web/app.js)：登录/注册、学生端/教师端、在线编辑（左侧编辑+右侧旁注）、行锁（同站点多标签页演示）
- 本地数据层
  - [storage.js](file:///d:/JavaScript/%E6%9C%9F%E6%9C%AB%E5%A4%A7%E4%BD%9C%E4%B8%9A/web/storage.js)：IndexedDB 封装（users/submissions/files），文件 Blob 存储与读取、提交/批改/订正/写回文件等业务接口
- 样式
  - [styles.css](file:///d:/JavaScript/%E6%9C%9F%E6%9C%AB%E5%A4%A7%E4%BD%9C%E4%B8%9A/web/styles.css)：整体 UI 与三色区分样式（原始/批改/订正）
