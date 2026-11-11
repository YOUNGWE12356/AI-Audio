# T1 Ai Audio MCP

本项目提供 Streamable HTTP MCP，与网页使用同一账号身份、积分计费、音效库与私有文件空间。部署包含这次代码的版本后启用，不需要另开一个模型服务。

## 接入

1. 正常登录网站。
2. 打开 `https://kaka-ai-audio.wepieoa.com/mcp/setup`，创建个人令牌并复制配置。每人使用自己的令牌，不能共用管理员令牌。令牌默认30天，可选7或90天；只显示一次，可以随时撤销。
3. 在支持 Streamable HTTP 以及自定义请求头的 MCP 客户端配置：

```json
{
  "mcpServers": {
    "t1-ai-audio": {
      "url": "https://kaka-ai-audio.wepieoa.com/mcp",
      "headers": {
        "Authorization": "Bearer <个人令牌>"
      }
    }
  }
}
```

部分客户端还需要显式设置 `type: "http"` 或选择 Streamable HTTP，按该客户端格式填写即可。此版本使用个人令牌，不提供 OAuth 自动授权；仅接受 OAuth 的客户端不能只填 URL 完成接入。网页飞书登录态、上游模型密钥不能作为 MCP 令牌。

只支持 stdio 的客户端可使用仓库内 `scripts/mcp-stdio.mjs`：先在本仓库运行 `npm ci`，再配置 `command: "node"`、`args: ["<仓库绝对路径>/scripts/mcp-stdio.mjs"]`，环境变量 `T1_AUDIO_MCP_URL` 为上述地址、`T1_AUDIO_MCP_TOKEN` 为个人令牌。适配脚本只代理协议，不在客户端运行模型，也不需要公司模型密钥。

## 功能范围

| 功能 | MCP 工具 |
| --- | --- |
| 语种、声音列表与匹配 | `list_languages`, `list_voices`, `match_voice` |
| 配音、批量配音、台词增强与翻译 | `generate_speech`, `generate_speech_batch`, `enhance_voice_text`, `translate_text` |
| 云端声音转换、翻译配音、语音识别、人声提取 | `change_voice`, `translate_dubbing`, `transcribe_speech`, `cloud_isolation` |
| 音乐、歌词、配乐提示词、画面配乐分析 | `generate_music`, `generate_lyrics`, `edit_lyrics`, `music_prompt`, `visual_music_prompt` |
| 音效默认制作入口、指定AI生成、联网搜索、采集试听 | `produce_sound_effect`, `generate_sound_effect`, `prepare_sfx_query`, `search_online_sound_effects`, `capture_online_sound_effect` |
| 音效需求表、批量需求分析、批量搜索或生成 | `sound_requirements`, `analyze_sfx_batch`, `produce_sfx_batch` |
| 音频设计、视频画面/配乐/音效/字幕时间线分析 | `audio_design`, `analyze_video` |
| 裁剪、压缩、格式、音量、响度、变速、移调、淡化、降噪、提取视频音轨 | `process_audio` |
| 响度测量、BPM/调式信号估算、云端音频分析、指标解读 | `measure_audio`, `analyze_music_metrics`, `analyze_audio`, `semantic_audio_analysis` |
| 时间线混音、音视频导出、分轨导出 | `mix_timeline`, `export_timeline_stems` |
| 音乐分析命名、UCS元数据、重命名副本 | `music_analysis_naming`, `ucs_metadata`, `rename_files` |
| 音效库搜索、读取、分类、上传与元数据修改 | `library_search`, `library_get_files`, `library_categories`, `library_import`, `library_edit_metadata` |
| 文件上传/分块读取、文档/截图读取、报告与ZIP打包 | `upload_asset`, `read_asset`, `read_document`, `image_ocr`, `save_report`, `package_files` |
| 能力、额度与后台任务 | `inspect_tools`, `inspect_assets`, `engine_status`, `start_audio_job`, `get_audio_job`, `cancel_audio_job` |

运行 `tools/list` 获得完整参数定义，或先调用 `inspect_tools` 检索功能。依赖本地模型的音色克隆、多角色克隆、Seed-VC、本地人声/乐器分离及音频转MIDI不开放。FFmpeg和普通音频信号计算可在CPU运行，保留。Dubbing v2沿用网页暂停状态。

音效库写操作沿用管理权限；创建令牌时可勾选管理授权，但必须先在网页音效库验证管理密码，且有效期只到当次管理会话过期（通常30分钟）。普通令牌不能修改公共音效库或账户积分配置。MCP不开放账号、积分后台、服务器设置等管理功能。

## 文件传输

所有输入文件先上传取得 `assetId`。小文件可调用 `upload_asset` 传base64（最多8MB）；较大文件使用同一令牌通过HTTP上传（最多100MB）：

```sh
curl --fail -H "Authorization: Bearer <个人令牌>" \
  -F "file=@/path/to/audio.wav" \
  https://kaka-ai-audio.wepieoa.com/api/mcp/files
```

文件响应包含 `id`、名称、大小、实际探测的时长以及 `downloadUrl`。下载请求也必须带相同账号的Bearer令牌；不生成公开无鉴权的音频链接。MCP的 `read_asset` 可每次读取最多1MB base64，按 `nextOffset` 继续。

不接受客户端任意磁盘路径或任意URL作为输入。音效库和公开试听经现有受控服务读取。联网采集后会创建独立的私有副本，避免下一轮网页搜索清理试听时丢失MCP文件；保留来源信息，不会移除水印或改变素材授权。

## 推荐调用流程

普通“需要某种音效”请求使用 `produce_sound_effect`，批量使用 `produce_sfx_batch`，`mode`不填或填`auto`。默认先搜索并采集试听；搜索或候选采集服务报错且没有可用音效时，自动改为AI生成一次，返回`method=generate`、`fallback=true`和`fallbackReason`说明实际方式。部分候选失败但仍有可用音效时继续返回搜索结果。正常的空搜索结果会提示无匹配，不自动生成；登录、权限、积分不足、限流、参数错误和用户取消时停止。明确要求AI生成时填`mode=generate`，直接生成，不先查询或翻译搜索词；明确只搜索时填`mode=search`，失败也不自动生成。批量的单条`mode`可覆盖批次设置。

音效批量制作：上传需求截图/文档/视频 → `analyze_sfx_batch` → 修改返回的需求 → `produce_sfx_batch` → 试听 → `process_audio`裁剪 → `package_files`下载。搜索模式与网页复用Envato30%、其他三库合计30%、全网40%及来源互补逻辑；中文关键词在搜索时提炼为1～2个英文检索词，生成时保留完整音效描述。生成与搜索均沿用原有计费；回退AI生成按实际生成计费，不是所有批量任务固定只扣1分。

视频制作：上传视频 → `analyze_video`分别分析所需轨道 → 配乐/音效/配音生成工具逐条生成 → 试听/修改 → 用户明确需要导出时调用 `mix_timeline`，可再 `export_timeline_stems`。远程MCP不操作网页按钮，不会自动打开或跳转工作台。

耗时操作优先放到后台：

```json
{
  "name": "start_audio_job",
  "arguments": {
    "tool": "analyze_sfx_batch",
    "arguments": {"assetId": "<上传响应的id>", "instructions": "保留所有原始需求行"},
    "requestId": "<客户端生成的唯一UUID>"
  }
}
```

随后调用 `get_audio_job`，参数为 `{"jobId":"<返回的id>"}`。相同账号、相同 `requestId` 和参数返回原任务，不重复生成；换参数须新ID。客户端超时后先查询原任务，不要盲目重复生成。一次批量搜索重试时也应沿用返回的 `searchBatchId`，保持现有批次去重计费。任务最长30分钟，每人最多2个后台任务，同时执行全站最多8个。

取消会停止后续步骤并尽力中止当前请求，已产生的上游费用按原规则计入；某些已提交的上游/现有后台分析不能保证立即中止。服务重启后保留文件及已完成结果，未完成的MCP任务标为失败，不自动重跑扣费。令牌撤销或到期会拒绝后续调用并停止该令牌启动的MCP后台任务。

## 部署与验证

- 安装锁定依赖 `npm ci`，运行 `npm run build`，沿用现有发布流程；本次无需下载任何本地模型。
- 反向代理须将 `/mcp`、`/mcp/setup`、`/mcp/setup.js` 和 `/api/mcp/*` 转发到现有Node服务，保留 `Authorization`、`Host`，避免将 `/mcp` 重写为SPA页面。`APP_ORIGIN` 应为 `https://kaka-ai-audio.wepieoa.com`。
- 工程的 `data/` 目录须持久化且仅服务账号可访问。`data/mcp/tokens.json`只保存令牌哈希及所属身份，不保存明文；`data/mcp/workspaces`保存私有文件清单与任务结果。不要将data目录上传到Git或作为静态资源公开。当前适合单Node实例；多副本部署须先改为共享数据库和任务调度，不能各自持有不同令牌缓存。
- `npm run test:mcp`：官方SDK握手/工具调用、授权范围、过期/撤销、文件隔离、真实FFmpeg裁剪与下载、后台任务去重，以及不访问付费上游的搜索/配音路由复用测试。
- 上线后未带令牌的 `POST /mcp` 应返回401；使用个人令牌后官方MCP客户端应能 `initialize`、`tools/list`、查询本人积分、上传并处理测试音频。若返回网页HTML或404，说明版本未部署或代理未转发，不能把网站主页地址当MCP地址。

自动测试不会实际花费用户积分去调用每一种付费模型。对应功能仍需要公司环境已配置相应云端服务的密钥与额度；MCP不会让缺少上游配置的功能凭空可用。
