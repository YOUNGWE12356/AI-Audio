# Local voice cloning experiment

## 在应用中启用

本功能不是需要单独启动端口的 HTTP 服务。请在项目根目录保持主应用运行：

    npm run dev

然后在网页的“AI 配音”中选择“本机生成克隆配音”，上传参考音频或视频，填写或提取目标语言台词，并点击“重新检查本地引擎”。主应用会按需调用 tools\\python311\\python.exe；检查通过后才会执行克隆。

可用下面的命令单独检查 Python、PyTorch 和 CUDA：

    tools\\python311\\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '无 CUDA')"

如果页面仍显示未就绪，请重启 npm run dev 后再点击“重新检查本地引擎”。首次运行还需要下载模型权重，模型文件会放在本目录的 models\\ 下。

This experiment uses Chatterbox Multilingual with a local CUDA GPU. It is
isolated from the application's existing ElevenLabs routes.

Supported target languages include Chinese, English, Spanish, French, German,
Arabic, Hindi, Japanese, Korean, and 14 others.

```powershell
tools\python311\python.exe tools\local-voice-clone\clone_voice.py `
  --reference tools\local-voice-clone\output\reference.wav `
  --language zh `
  --text "这是一次完全在本地运行的声音克隆测试。" `
  --output tools\local-voice-clone\output\clone-zh.wav
```

Use a clean, single-speaker reference recording around 10 to 20 seconds long.
The first run downloads several gigabytes of model weights into `models/`.

On Windows, Perth's native implicit watermarker may be unavailable. The test
tool falls back to Perth's dummy implementation in that case, so local test
outputs are not watermarked and must not be treated as production artifacts.

The model supports `--exaggeration`, `--cfg-weight`, and `--temperature`. For
cross-language cloning, start with `--cfg-weight 0.3`; lower values reduce the
source language accent but may weaken voice similarity.
