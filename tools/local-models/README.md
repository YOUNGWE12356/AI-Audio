# 本地模型包

本目录保存 AI-Audio 已安装模型的权重、分词器和必要配置。`manifest.json` 记录原始来源、安装路径、文件大小和 SHA-256；`objects/` 按内容去重并使用 Git LFS 存储。

权重按最多 16 MiB 分块上传，避免单个大文件传输超时。清单保留分块顺序、各块校验和及完整文件校验和；还原后与原始模型逐字节一致，运行时仍使用完整模型文件。

包含 Chatterbox、CosyVoice3、Qwen3-TTS、Seed-VC 及其现有公共依赖、BS-RoFormer、YourMT3/钢琴转谱、Basic Pitch ONNX 和现有 Demucs 模型。只备份本机已经下载的文件，不补下载缺失权重，不保证未安装的引擎可用。

不包含 Python/虚拟环境、第三方源代码、用户音频、生成结果、下载日志、密钥及无关模型缓存。模型继续适用其上游许可；各模型来源见清单，已有模型卡随配置一起保存。

## 下载和还原

先安装 Git LFS，并按各工具的说明安装推理依赖和第三方仓库。然后在工程根目录执行：

```powershell
git lfs install
git lfs pull origin
python tools/local-models/manage_models.py verify
python tools/local-models/manage_models.py restore
```

也可以用 `git lfs pull git17zjh` 从另一个仓库下载。必须下载实际 LFS 对象，只有指针的源码 ZIP 不能用于还原模型。

`restore` 将模型还原到原来的工程相对路径；Seed-VC 权重还原到 `tools/seed-vc/repo/checkpoints`。共享的 Hugging Face 依赖还原到 `HF_HUB_CACHE`、`HF_HOME/hub` 或用户默认缓存。Basic Pitch 的 ONNX 模型还原到当前 Windows 安装路径，其他平台可从清单找到该文件并放入已安装的 Basic Pitch 模型目录。

程序会先校验全部对象。遇到校验错误、路径越界或已存在但内容不同的目标文件会停止，不覆盖本地文件。还原可重复执行。

可以通过 `--project-root` 和 `--hf-hub-cache` 指定还原位置。维护者在确认模型文件归属后，可运行 `build` 重新制作模型包，再运行 `verify`；新增对象必须经 Git LFS 上传到两个仓库。
