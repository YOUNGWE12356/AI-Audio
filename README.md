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
4. 浏览器访问 `http://localhost:4030`

本地 `.env` 支持以下配置：

- `TOKENHUB_API_KEY`：当前使用的 GPT 网关，优先处理文本、图片和视频关键帧分析
- 音频分析默认调用现有 GPT 网关解读本地检测指标，并注明“未直接听音”；配置 `GPT_AUDIO_API_KEY`、`GPT_AUDIO_BASE_URL`（默认 OpenAI `/v1`）、`GPT_AUDIO_MODEL`（默认 `gpt-audio-1.5`）后改为直接听音，提交最多 36 秒的开头/中间/结尾片段。音频接口失败会显示错误并保留本地指标，不会悄悄换成指标解读。音频密钥只留在服务端，与文本/视觉网关独立。
- `ELEVENLABS_API_KEY`：音效、音乐、配音和语音工具
- `PORT`：可选，服务端口，默认 `4030`

### 服务器部署（Linux）

#### 一键部署（自动选择 Docker / systemd）

以项目目录所属用户执行。宿主机 Node.js 20+ 正常工作时使用 systemd（需要 npm、Git、curl、flock）；Node 缺失、版本不足或出现 `GLIBC_*` / `GLIBCXX_*` 错误时自动切换到 Docker（需要已安装且运行的 Docker、Git、flock）。仅管理系统服务或访问 Docker 需要时通过 sudo 提权：

```bash
bash deploy.sh
```

脚本拉取当前分支（仅快进）、安装依赖、检查并构建，随后启动 `ai-audio`，固定端口 **4030**。首次缺少 `.env` 时会创建模板并退出，填写配置后再次运行即可。已有 `.env`、`data/` 和 `uploads/` 保留，脚本通过进程环境将端口设为 4030。

##### 旧系统库服务器：Docker 部署

参考 `kakavideogenerator` 的容器部署方式，Node 与 FFmpeg 在 Alpine 镜像内运行，不使用宿主机的 Node 或 glibc。脚本不升级系统库、不安装 Docker、不修改 Docker 镜像源。先由管理员配置可用的 Docker，然后执行：

```bash
DEPLOY_MODE=docker bash deploy.sh
# 或直接执行：bash docker-deploy.sh
docker logs -f ai-audio
docker ps --filter name=ai-audio
```

若当前账号需要 sudo 访问 Docker，上面查看容器/日志命令也加 sudo。镜像默认 `node:22-alpine`；若服务器拉取 Docker Hub 受限，可指定已验证可访问的镜像源，例如：

```bash
NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine DEPLOY_MODE=docker bash deploy.sh
```

容器以当前用户 UID/GID 运行，挂载 `.env`（只读）、`data/`、`uploads/`，支持 SELinux 标签。镜像构建完成后才切换旧服务；健康检查失败时尝试恢复旧容器/原 systemd 服务。Docker 的 `unless-stopped` 策略负责重启，开机恢复还需要 Docker 服务已启用开机启动。改 `.env` 后重跑部署脚本。切换前先手动停止旧 nohup 进程。

容器包含 FFmpeg 和 Python 3；Seed-VC、Demucs 等本地模型、GPU、虚拟环境及模型文件需另行配置，本脚本不迁移宿主机的这些可选组件。

##### systemd 管理命令

```bash
sudo journalctl -u ai-audio -f    # 日志
sudo systemctl status ai-audio  # 状态
sudo systemctl restart ai-audio # 重启
sudo systemctl stop ai-audio    # 停止
SKIP_PULL=1 bash deploy.sh      # 部署当前本地代码，跳过拉取
DEPLOY_MODE=systemd bash deploy.sh # 强制使用宿主机 Node
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
- 部署脚本回归测试（模拟 Docker/systemd，无真实部署）：`python3 tests/deploy_test.py`

## 当前架构说明

### AI 音乐画面参考

- AI 音乐风格框上方可选择或拖入一张图片／一个视频，也可点击上传区域后粘贴截图。点击“分析并填入提示词”后，根据画面生成中文音乐提示词并回填原风格框，用户可修改；点击生成音乐时自动转换为英文提交。已有风格描述作为偏好约束；分析不会自动调用音乐生成。
- 画面配乐词借鉴 AI 音频设计的整曲格式，涵盖用途、风格、情绪/能量、配器分工、速度/BPM、调性、旋律/混音、结构/结尾和排除项；不含视频时间码。生成时的英文转换保留这些制作要求，转换失败可重试，不静默替换成简化描述。
- 配乐提示词不写总秒数或分钟数。画面分析仅在内部参考“期望生成时长”安排音乐展开，实际生成长度使用该控件在生成时的当前值；英文转换也省略总时长说明，保留 BPM 速度。
- 视频优先在浏览器提取最多 8 张关键帧，只提交画面；浏览器无法解码时复用服务器关键帧接口并清理临时视频。不分析原声。图片在浏览器压缩后提交。
- `POST /api/ai/music-prompt/from-visual` 使用现有 GPT 视觉网关、身份和 Token 积分结算；按原音乐时长和纯音乐／人声偏好生成提示词。只接受图片数据，限制帧数与总大小。失败或取消保留原有提示词。
- 回归测试：`npx tsx --test src/services/musicVisualPrompt.test.ts src/services/audioDesignAnalysis.test.ts`。

### 音效多站搜索

- 联网音效搜索并行查询 Envato Elements、Pro Sound Effects、Epidemic Sound 和 Mixkit；结果足够时，最多 100 条按约 50% Envato、50% 其他来源混排，备用来源之间均分并互相补足。Freesound 已移除，不再请求或采集。
- PSE 使用网站公开的目录搜索与对应 MP3 试听，仅保留 PSE 自有目录，分页使用真实 `pageIndex`。Epidemic 使用网站当前公开搜索动作（从页面动态发现接口标识并短期缓存），仅返回接口实际提供的十条搜索结果，不抓首页推荐，也不假设支持后续分页。两站公开接口可能随网站更新变化，失效时自动降级到健康来源。
- Pond5 当前阻止服务端自动访问（HTTP 403 / 网站验证），尚未接通搜索/试听；界面明确显示待官方接口接入，保留来源入口。需取得 [Pond5 官方 API](https://www.pond5.com/api) 的访问权限与文档后完成集成，不尝试绕过网站验证。
- Mixkit 按关键词匹配实际音效分类；没有匹配分类时不使用首页推荐凑数。结果不足时按实际数量返回。
- 所有来源先按音效名称做关键词与保守近义词过滤，再进行来源配比和排序；分类标签本身不能作为相关性依据。例如 Water 分类下的 Hard pop click 会被剔除，Water flowing / Liquid bubble 会保留。优先直接匹配，再展示相关词匹配；这属于元数据筛选，不代表已经听音验证。
- 单站超时、验证或连接失败不影响其他站点；全站失败后该来源冷却 60 秒再尝试，健康来源自动补位。单个页面失败保留其他页面结果，后续批次重试失败页。
- 继续搜索保留尚未展示的候选并去重。候选会话随服务重启或 30 分钟过期，过期需刷新重新搜索。
- 每批有结果才结算一次公司积分，不按网站或翻页次数重复结算。只采集公开试听，保留来源、作者和原试听水印；FFmpeg 只处理下载到本地的文件。
- 回归测试：`npx tsx --test src/services/onlineSfxServer.test.ts src/services/onlineSfxRelevance.test.ts`。

### 智能助手执行层

智能助手通过服务端 Responses 工具调用循环执行任务，不再只生成导航计划。一次指令可跨模块调用配音/批量配音、翻译、音乐、音效、需求表、视频分析、音频工厂、本地分轨、MIDI、本地克隆、UCS命名、音效库和导出功能。

- `POST /api/ai/assistant/jobs`：上传指令和多个素材，立即返回后台任务ID。
- `GET /api/ai/assistant/jobs/:id`：读取真实执行进度和产物；浏览器切页和刷新后继续跟踪。
- `POST /api/ai/assistant/jobs/:id/reply`：补充必要信息；生成中的任务会自行等待并推进，无须调用此接口。
- `POST /api/ai/assistant/jobs/:id/cancel`：停止后续步骤。已经提交到供应商的请求可能仍在完成并计费。
- 页面制作会持续上报当前片段进度与连接心跳；右下角助手在生成、等待下一步、重连期间持续显示工作状态。暂停或失败会停止动画并显示具体原因。页面超过3分钟失联会明确结束当前步骤，不会无限静默等待。
- 视频时间线上重叠的系统音效片段，在分析、助手编辑和打开工程时会自动分配到多条音效轨；不会改变原有时间点或丢弃已生成音频。
- 日常运行使用 `npm run build` 后 `npm start`，默认提供正式构建，不监听源码变化、不触发热刷新。`npm run dev` 仅用于需要热更新的开发调试。
- 任务记录保存在 `data/assistant-jobs`，产物保存在 `data/private-uploads`。不保存第三方密钥和管理员Cookie。进程重启中断的任务会明确标记失败并保留产物，避免重复付费生成。
- 模型只能调用明确注册的工具，不能执行任意HTTP或命令。原有同源API继续检查用户额度与音效库管理员权限；每轮规划也检查额度。
- 支持真实的等待、文件依赖、时间线秒数和完成校验；视频混音同时交付可编辑工程。
- 视频配声通过 `video_workspace` 在“视频声音制作”页面执行导入、画面分析、片段编辑/合成和混音导出，复用手动按钮的相同函数和工程状态。聊天只接收指令和汇报进度，产物在对应页面预览、编辑和导出。页面执行通过命令领取/结果回执推进，未完成时不会进入依赖步骤；同一操作刷新重连复用服务端结果，避免重复生成。
- 引擎不可用、缺少必要素材或权限时明确报告，不伪造分析和制作结果。音频分析页支持 GPT 指标解读及单独配置的 GPT 音频模型；音乐分析命名、AI音频设计的音频参考、对话助手的对应工具均支持“本地音频指标 + GPT解读”，未直接听音。本地检测最长取前300秒并标注覆盖范围，不上传原始音频到文本模型。命名分类属于待审核建议，缺少证据时保留 Review/Manual；设计中的风格、配器与Suno词是创作建议。PDF分析仍不可用。

执行层回归测试：`npx tsx --test src/services/assistantAgent.test.ts`。

当前版本已将 GPT 网关与 ElevenLabs 调用放在服务端同源 API，并加入飞书认证、创作积分管理、限流、私人文件隔离和安全错误处理。部署要求见 SECURITY-DEPLOYMENT.md。

### 飞书账号登录

使用飞书授权码换取用户信息，服务端保存 8 小时会话，浏览器只持有随机 HttpOnly Cookie。注销或进程重启即撤销会话；旧版 Cookie 需重新登录。授权 state 在进程中保存 5 分钟且绑定发起登录的浏览器，只能使用一次。当前仅支持单进程，多实例需要共享 state、会话、限流和积分存储。

在 `.env` 配置：

```dotenv
FEISHU_AUTH_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=应用密钥
FEISHU_REDIRECT_URI=http://localhost:4030/api/auth/callback
```

也兼容 OneTable 的 `LARK_APP_ID`、`LARK_APP_SECRET`、`LARK_REDIRECT_URI` 变量；`FEISHU_*` 优先。复用应用时仍需配置本项目自己的回调地址。

1. 在飞书开放平台对应应用的安全设置中添加完整回调地址（本地为上面的 localhost 地址，线上必须为 HTTPS）。
2. 开通登录所需的 `contact:user.base:readonly` 权限，发布应用版本，并确认使用者在应用可用范围内。
3. 重启服务；进入首页后点击“使用飞书账号登录”，完成授权。


启用后，业务 `/api/*` 及 `/uploads/*` 必须登录才能访问；`/api/auth/me`、登录、回调及退出端点用于建立和管理会话。侧栏显示飞书姓名、头像和退出入口。额度和用量按服务端验证的飞书 `open_id` 统计。历史设备用量不会自动归并；音效库由登录成员共享，上传素材与生成文件按服务端身份隔离。管理员操作仍需单独验证管理密码。

无飞书配置时必须配置 AUTH_USERS_JSON 本地账号，否则所有业务接口拒绝访问；只填写部分配置或显式启用但缺少配置时，服务拒绝启动。修改 `.env` 后重启服务。HTTPS 下登录 Cookie 自动启用 Secure 属性；修改类请求必须携带与回调地址一致的 Origin。

认证回归测试：`npm run test:auth`。测试使用模拟飞书 API，不消耗真实授权或访问密钥。

## 创作积分管理


在“设置”输入管理密码后，进入“创作积分管理”。管理员可以查看公司和成员的已用、冻结和可用积分，按月份/成员筛选流水（每页 50 条），设置每人默认月上限、公司共享月上限，以及成员当月专项上限。成员进入工作台后自动建立积分账户，侧栏显示本人余额；接口层同样验证管理权限，客户端隐藏页面不是权限边界。

- 默认每人每月 200 分、公司共享每月 6,000 分。游客登录已移除，旧环境开关不再生效；账本中的历史游客记录及日上限字段保留以兼容旧数据。
- 周期为北京时间自然月。管理员可提前配置未来月份；默认规则从选定月份持续生效，个人专项上限仅限该月。留空恢复默认，设置 0 停止新消费。历史月份只读，修改必须填写原因并保留审计记录。
- 新账本从启用开始记录，不追扣旧供应商 credits/Token 用量；旧 credits 配额写入接口返回 410，用量报表仍保留用于成本分析。
- 音效每版本 2 分，音乐 9 分/分钟，云端配音 1 分/100 字符；云端变声/人声提取 10 分/分钟，转录 4 分/分钟；标准翻译配音按转录时长加翻译后的文本计费。Dubbing V2 定价未确认，暂不开放。
- 本地克隆/Seed-VC/MIDI 为 3 分/分钟，Demucs 2 分/分钟，高质量六轨分离 5 分/分钟（不乘轨道数）。时长按秒折算并向上取整。试听、下载、混音、普通导出、FFmpeg 基础分离免费；文本辅助和分析暂不扣分。
- 服务端生成前冻结，成功后消费、失败后退回；A/B 两个生成请求分别记录。上传计时使用 FFmpeg 实测时长。输出时长/译文长度未知的克隆、翻译任务先保守冻结，成功后结算并退差额，实际费用不超过冻结上限。视频分离先按云端提取上限冻结，Demucs 或 FFmpeg 成功后退差额。付费模型自动重试在同一业务请求内只结算一次；用户主动再次生成是新的任务。
- 高质量分轨在任务成功后结算，不在 HTTP 202 接受时扣费；取消、失败退回。跨月任务归属创建月份。降低额度不撤销已有冻结任务，但会阻止超过可用余额的新任务。
- 账本存储于 `data/creation-points.json`，用原子替换保存设置、冻结、消费和审计流水。仅支持单 Node 进程；不要让多个服务进程共享写入该文件。服务重启会释放未完成任务冻结金额；上线多实例前应迁移到有事务和唯一约束的数据库。请将账本纳入备份。

验证命令：`npm run test:points`。测试覆盖并发余额保护、个人/公司/游客额度、失败退款、幂等结算、跨月、持久化和管理操作。

## Git 工作流

本地模型使用 Git LFS 随仓库保存，清单、校验及还原方法见 [本地模型包](tools/local-models/README.md)。推理环境、上传素材和生成结果仍不进入版本库。

开发在独立的 `agent/*` 分支进行，通过 Draft Pull Request 合并到 `main`。不要提交 `.env`、用户上传文件、运行时数据或构建产物。
