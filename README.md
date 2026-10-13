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
- 可选：NVIDIA GPU 与 CUDA 版 PyTorch（本地高质量音乐分轨需要）

### 安装与启动

1. 复制 `.env.example` 为 `.env`，填写本地开发所需的 API 密钥。
2. 安装依赖：`npm ci`
3. 启动开发服务：`npm run dev`
4. 浏览器访问 `http://localhost:4030`

本地 `.env` 支持以下配置：

- `GEMINI_API_KEY`：Gemini 多模态分析、翻译和内容规划
- `ELEVENLABS_API_KEY`：音效、音乐、配音和语音工具
- `PORT`：可选，服务端口，默认 `4030`

### 服务器部署（Linux）

#### 一键部署（systemd）

服务器需安装 Node.js 20+、npm、Git、curl 和 flock，并使用 systemd。以项目目录所属用户执行（仅管理 systemd 时通过 sudo 提权）：

```bash
bash deploy.sh
```

脚本拉取当前分支（仅快进）、安装依赖、检查并构建，随后启动 `ai-audio` 服务，固定端口 **4030**，支持异常重启与开机启动。首次缺少 `.env` 时会创建模板并退出，填写配置后再次运行即可。已有 `.env`、`data/` 和 `uploads/` 保留，脚本通过进程环境将端口设为 4030。

```bash
sudo journalctl -u ai-audio -f    # 日志
sudo systemctl status ai-audio  # 状态
sudo systemctl restart ai-audio # 重启
sudo systemctl stop ai-audio    # 停止
SKIP_PULL=1 bash deploy.sh      # 部署当前本地代码，跳过拉取
```

部署会短暂中断服务，并非零停机发布。从旧的 nohup 启动方式切换时，先停止旧进程，避免端口占用和多进程写账本。脚本不调整防火墙或飞书回调配置。

#### 手动部署

在项目根目录执行，首次部署先复制 `.env.example` 为 `.env` 并填写配置；已有 `.env` 时保留原文件，将 `PORT` 设为 `4030`。

```bash
npm ci
npm run build
NODE_ENV=production PORT=4030 npm start
```

服务监听 `0.0.0.0:4030`，同时提供网页和 API。后台运行：

```bash
nohup env NODE_ENV=production PORT=4030 npm start > server.log 2>&1 &
```

访问 `http://服务器IP:4030`，并在服务器防火墙/安全组中放行 TCP 4030。生产飞书登录使用实际 HTTPS 域名的回调地址，并同步更新飞书应用配置；使用反向代理时转发到 4030。账本仅支持单 Node 进程。

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

当前版本已经将 Gemini 与 ElevenLabs 调用迁移到服务端同源 API，浏览器构建产物不会包含第三方密钥。支持可选的飞书登录；公开部署时必须启用，并继续完善请求校验、限流以及正式的文件和项目存储。

### 飞书账号登录

实现参考 OneTable：飞书授权码换取用户信息，使用独立的 `ai_audio_sid` 加密 HttpOnly Cookie 保存 7 天会话。无需 Redis；授权 state 在当前进程中保存 5 分钟且绑定发起登录的浏览器，只能使用一次。服务重启时，正在进行的授权需要重新发起；已登录会话在密钥不变时仍有效。多进程部署需要共享 state 存储或会话粘滞路由。

在 `.env` 配置：

```dotenv
FEISHU_AUTH_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=应用密钥
FEISHU_REDIRECT_URI=http://localhost:4030/api/auth/callback
# 可选，至少 32 字符；未设置时从应用密钥派生本项目专用密钥。
SESSION_SECRET=
```

也兼容 OneTable 的 `LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_REDIRECT_URI` 变量；`FEISHU_*` 优先。复用应用时仍需配置本项目自己的回调地址。

1. 在飞书开放平台对应应用的安全设置中添加完整回调地址（本地为上面的 localhost 地址，线上必须为 HTTPS）。
2. 开通登录所需的 `contact:user.base:readonly` 权限，发布应用版本，并确认使用者在应用可用范围内。
3. 重启服务；进入首页后点击“使用飞书账号登录”，完成授权。

本机调试可另设 `LOCAL_GUEST_LOGIN_ENABLED=true`：登录页同时提供“游客进入”，游客会话支持刷新、退出，仍以设备标识统计额度。该入口仅在回调地址为 localhost/回环地址且请求直接来自本机回环地址时可用，代理转发和远程访问不可用；即使复制游客 Cookie 到远程请求也不会放行。生产构建在本机运行同样支持。管理员操作仍需管理密码，飞书登录入口保持可用。

启用后，业务 `/api/*` 及 `/uploads/*` 必须登录才能访问；`/api/auth/me`、登录、回调及退出端点用于建立和管理会话。侧栏显示飞书姓名、头像和退出入口。额度和用量按服务端验证的飞书 `open_id` 统计，不再依赖浏览器设备标识。历史设备用量不会自动归并；音效库和上传素材仍是登录成员共享资源，浏览器本地历史也未改为云端个人存储。管理员操作仍需单独验证管理密码。

无飞书配置时保持本地访客模式；只填写部分配置或显式启用但缺少配置时，服务拒绝启动，防止误以为登录保护已经生效。修改 `.env` 后重启服务。登录 Cookie 根据回调地址自动启用 HTTPS Secure 属性，因此本地 HTTP 生产构建也能正常登录。

认证回归测试：`npm run test:auth`。测试使用模拟飞书 API，不消耗真实授权或访问密钥。

## 创作积分管理

本地游客登录后可直接在“设置”查看积分管理、消费流水和修改积分上限，无需再输入管理密码。此权限仅授予经过服务端会话验证的本机直连游客；飞书成员仍需管理密码，黑名单、供应商用量及音效库管理等其他权限不变。

在“设置”输入管理密码后，进入“创作积分管理”。管理员可以查看公司和成员的已用、冻结和可用积分，按月份/成员筛选流水（每页 50 条），设置每人默认月上限、公司共享月上限、游客日上限，以及成员当月专项上限。成员进入工作台后自动建立积分账户，侧栏显示本人余额；接口层同样验证管理权限，客户端隐藏页面不是权限边界。

- 默认每人每月 200 分、公司共享每月 6,000 分、本地游客每天最多 20 分（还受个人月上限和公司额度约束）。游客按设备识别，清除设备标识不会重置公司共享额度。
- 周期为北京时间自然月。管理员可提前配置未来月份；默认规则从选定月份持续生效，个人专项上限仅限该月。留空恢复默认，设置 0 停止新消费。历史月份只读，修改必须填写原因并保留审计记录。
- 新账本从启用开始记录，不追扣旧供应商 credits/Token 用量；旧 credits 配额写入接口返回 410，用量报表仍保留用于成本分析。
- 音效每版本 2 分，音乐 9 分/分钟，云端配音 1 分/100 字符；云端变声/人声提取 10 分/分钟，转录 4 分/分钟；标准翻译配音按转录时长加翻译后的文本计费。Dubbing V2 定价未确认，暂不开放。
- 本地克隆/Seed-VC/MIDI 为 3 分/分钟，Demucs 2 分/分钟，高质量六轨分离 5 分/分钟（不乘轨道数）。时长按秒折算并向上取整。试听、下载、混音、普通导出、FFmpeg 基础分离免费；文本辅助和分析暂不扣分。
- 服务端生成前冻结，成功后消费、失败后退回；A/B 两个生成请求分别记录。上传计时使用 FFmpeg 实测时长。输出时长/译文长度未知的克隆、翻译任务先保守冻结，成功后结算并退差额，实际费用不超过冻结上限。视频分离先按云端提取上限冻结，Demucs 或 FFmpeg 成功后退差额。付费模型自动重试在同一业务请求内只结算一次；用户主动再次生成是新的任务。
- 高质量分轨在任务成功后结算，不在 HTTP 202 接受时扣费；取消、失败退回。跨月任务归属创建月份。降低额度不撤销已有冻结任务，但会阻止超过可用余额的新任务。
- 账本存储于 `data/creation-points.json`，用原子替换保存设置、冻结、消费和审计流水。仅支持单 Node 进程；不要让多个服务进程共享写入该文件。服务重启会释放未完成任务冻结金额；上线多实例前应迁移到有事务和唯一约束的数据库。请将账本纳入备份。

验证命令：`npm run test:points`。测试覆盖并发余额保护、个人/公司/游客额度、失败退款、幂等结算、跨月、持久化和管理操作。

## Git 工作流

开发在独立的 `agent/*` 分支进行，通过 Draft Pull Request 合并到 `main`。不要提交 `.env`、用户上传文件、运行时数据或构建产物。
