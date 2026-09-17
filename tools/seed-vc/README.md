# Seed-VC 本地适配器

这个目录是 AI Audio 的服务端适配层。官方仓库已放在 `tools/seed-vc/repo`，权重缓存位于 `tools/seed-vc/repo/checkpoints`。Seed-VC 使用独立的 `tools/seed-vc/.venv`，避免和 Chatterbox 的 Transformers 版本冲突；该环境复用项目已安装的 CUDA/PyTorch 运行库，并补齐官方推理依赖。

服务端通过 `SEED_VC_PYTHON` 指定 Python，通过 `SEED_VC_REPO_DIR` 指定官方仓库路径。默认脚本入口是 `voice_convert.py`，它会调用官方 `inference_v2.py` 或 `inference.py`，不会回退到 Chatterbox 或 CosyVoice。适配器会自动设置 `PYTHONPATH` 和项目的 `ffmpeg-static` 路径。

Seed-VC 的输入关系是：`source` 为目标语言内容语音，`target` 为原始人物参考音。它只做声音/风格转换，不做文本翻译。
