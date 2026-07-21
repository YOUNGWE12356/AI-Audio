# AI Audio Suite

AI Audio Suite 是一个基于 React、Vite 和 Express 的 AI 音频工作台，集成 Gemini 与 ElevenLabs，覆盖音频设计、音乐与音效生成、配音、转录、音频处理和视频配乐时间线。

## 产品形态

本项目以 HTML5 Web 应用为唯一客户端目标，通过现代浏览器访问，不依赖 Electron、Unity 或其他桌面运行时。

- 浏览器端：HTML、CSS、JavaScript、React、Web Audio API、Canvas、File API
- 服务端：身份认证、AI 服务调用、文件管理、FFmpeg 转码与混音、持久化
- 部署形态：静态网页资源与 HTTPS API 服务

API 密钥、系统命令和长期文件存储不得进入浏览器端。浏览器只通过同源 `/api/*` 接口访问这些能力。

## 本地开发

### 前置条件

- Node.js 20 或更高版本
- npm 11
- FFmpeg（视频混音和音轨导出需要，并且必须加入系统 `PATH`）

### 安装与启动

1. 复制 `.env.example` 为 `.env`，填写本地开发所需的 API 密钥。
2. 安装依赖：`npm ci`
3. 启动开发服务：`npm run dev`
4. 浏览器访问 `http://localhost:3000`

### 验证命令

- 类型检查：`npm run lint`
- 生产构建：`npm run build`
- 完整检查：`npm run check`
- 清理构建产物：`npm run clean`

## 当前架构说明

当前版本仍处于产品原型向生产架构迁移阶段。前端存在直接调用第三方 AI API 的历史实现，因此不要将带有真实密钥的构建产物公开部署。后续重构会把第三方 API 调用全部迁移到服务端，并加入身份认证、请求校验、限流以及正式的文件和项目存储。

## Git 工作流

开发在独立的 `agent/*` 分支进行，通过 Draft Pull Request 合并到 `main`。不要提交 `.env`、用户上传文件、运行时数据或构建产物。
