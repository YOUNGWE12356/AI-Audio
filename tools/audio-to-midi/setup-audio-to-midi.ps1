$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$python310 = Join-Path $projectRoot 'tools\python310\python.exe'
$python311 = Join-Path $projectRoot 'tools\python311\python.exe'
$checkpointDir = Join-Path $PSScriptRoot 'models\mt3'
$transformersCompatDir = Join-Path $PSScriptRoot 'vendor\transformers438'

if (-not (Test-Path -LiteralPath $python310 -PathType Leaf)) {
    throw "Missing Python 3.10 runtime: $python310"
}
if (-not (Test-Path -LiteralPath $python311 -PathType Leaf)) {
    throw "Missing Python 3.11 runtime: $python311"
}

& $python310 -m pip install piano-transcription-inference 'git+https://github.com/xavriley/ADTOF-pytorch.git'
& $python311 -m pip install 'mt3-infer[torch]'
& $python311 -m pip install --upgrade --no-deps --target $transformersCompatDir `
    'transformers==4.38.2' 'tokenizers==0.15.2' 'huggingface-hub==0.20.3'

$env:MT3_CHECKPOINT_DIR = $checkpointDir
& (Join-Path (Split-Path $python311) 'Scripts\mt3-infer.exe') download yourmt3
& $python310 (Join-Path $PSScriptRoot 'transcribe_specialized.py') download-piano

Write-Host 'Audio-to-MIDI engines are installed.' -ForegroundColor Green
