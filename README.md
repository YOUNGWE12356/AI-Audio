# AI Audio Suite

AI Audio Suite 是一个基于 React、Vite 和 Express 的 AI 音频工作台，集成 GPT 网关与 ElevenLabs，覆盖音频设计、音乐与音效生成、配音、转录、音频处理和视频配乐时间线。

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
- 可选：NVIDIA GPU 与 CUDA 版 PyTorch（本地高质量音乐分轨需要）

### 安装与启动

1. 复制 `.env.example` 为 `.env`，填写本地开发所需的 API 密钥。
2. 安装依赖：`npm ci`
3. 启动开发服务：`npm run dev`
4. 浏览器访问 `http://localhost:3000`

本地 `.env` 支持以下配置：

- `TOKENHUB_API_KEY`：当前使用的 GPT 网关，优先处理文本、图片和视频关键帧分析
- 音频理解尚需单独配置兼容模型；相关入口会提示不可用，不会猜测听音结果
- `ELEVENLABS_API_KEY`：音效、音乐、配音和语音工具
- `PORT`：可选，本地服务端口，默认 `3000`

### 本地高质量音乐分轨

Windows 环境执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/music-separation/setup-music-separation.ps1
```

安装脚本使用独立虚拟环境，不会改变 Seed-VC 或 Demucs 的依赖。完成后重启服务，在“音频工具”中打开“高质量音乐分轨”。

`.env` 已被 Git 忽略，真实密钥不得写入 `.env.example`、前端代码或提交记录。

### 验证命令

- 类型检查：`npm run lint`
- 生产构建：`npm run build`
- 完整检查：`npm run check`
- 清理构建产物：`npm run clean`

## 当前架构说明

### 智能助手执行层

智能助手通过服务端 Responses 工具调用循环执行任务，不再只生成导航计划。一次指令可跨模块调用配音/批量配音、翻译、音乐、音效、需求表、视频分析、音频工厂、本地分轨、MIDI、本地克隆、UCS命名、音效库和导出功能。

- `POST /api/ai/assistant/jobs`：上传指令和多个素材，立即返回后台任务ID。
- `GET /api/ai/assistant/jobs/:id`：读取真实执行进度和产物；浏览器切页和刷新后继续跟踪。
- `POST /api/ai/assistant/jobs/:id/reply`：补充必要信息；生成中的任务会自行等待并推进，无须调用此接口。
- `POST /api/ai/assistant/jobs/:id/cancel`：停止后续步骤。已经提交到供应商的请求可能仍在完成并计费。
- 页面制作会持续上报当前片段进度与连接心跳；右下角助手在生成、等待下一步、重连期间持续显示工作状态。暂停或失败会停止动画并显示具体原因。页面超过3分钟失联会明确结束当前步骤，不会无限静默等待。
- 视频时间线上重叠的系统音效片段，在分析、助手编辑和打开工程时会自动分配到多条音效轨；不会改变原有时间点或丢弃已生成音频。
- 日常运行使用 `npm run build` 后 `npm start`，默认提供正式构建，不监听源码变化、不触发热刷新。`npm run dev` 仅用于需要热更新的开发调试。
- 任务记录保存在 `data/assistant-jobs`，产物保存在 `uploads`。不保存第三方密钥和管理员Cookie。进程重启中断的任务会明确标记失败并保留产物，避免重复付费生成。
- 模型只能调用明确注册的工具，不能执行任意HTTP或命令。原有同源API继续检查用户额度与音效库管理员权限；每轮规划也检查额度。
- 支持真实的等待、文件依赖、时间线秒数和完成校验；视频混音同时交付可编辑工程。
- 视频配声通过 `video_workspace` 在“视频声音制作”页面执行导入、画面分析、片段编辑/合成和混音导出，复用手动按钮的相同函数和工程状态。聊天只接收指令和汇报进度，产物在对应页面预览、编辑和导出。页面执行通过命令领取/结果回执推进，未完成时不会进入依赖步骤；同一操作刷新重连复用服务端结果，避免重复生成。
- 引擎不可用、缺少必要素材或权限时明确报告，不伪造分析和制作结果。当前原生音频语义理解仍不可用；本地BPM/调式指标只属于信号估算。AI音频设计继续禁止音频和PDF输入。

执行层回归测试：`npx tsx --test src/services/assistantAgent.test.ts`。

当前版本已将 GPT 网关与 ElevenLabs 调用放在服务端同源 API，浏览器构建产物不会包含第三方密钥。公开部署前仍需继续加入身份认证、请求校验、限流以及正式的文件和项目存储。

## Git 工作流

开发在独立的 `agent/*` 分支进行，通过 Draft Pull Request 合并到 `main`。不要提交 `.env`、用户上传文件、运行时数据或构建产物。
