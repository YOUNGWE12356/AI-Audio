param(
  [string]$PythonExe = "",
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu124",
  [switch]$SkipModelDownload
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDir = Join-Path $scriptDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$modelsDir = Join-Path $scriptDir "models"
$modelSlug = "roformer-model-bs-roformer-sw-by-jarredou"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Resolve-PythonCommand {
  if ($PythonExe -and (Test-Path -LiteralPath $PythonExe)) {
    return @($PythonExe)
  }

  $projectRuntime = Join-Path (Split-Path -Parent $scriptDir) "demucs\.venv\Scripts\python.exe"
  if (Test-Path -LiteralPath $projectRuntime) {
    return @($projectRuntime)
  }

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    foreach ($version in @("-3.12", "-3.11", "-3.10")) {
      try {
        & py $version --version *> $null
        if ($LASTEXITCODE -eq 0) { return @("py", $version) }
      } catch {}
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return @($python.Source) }

  throw "Python 3.10-3.12 was not found. Install Python 3.12 first, or pass -PythonExe."
}

$pythonCommand = Resolve-PythonCommand
if (!(Test-Path -LiteralPath $venvPython)) {
  Write-Host "Creating the music-separation virtual environment at $venvDir"
  $pythonArgs = @()
  if ($pythonCommand.Length -gt 1) {
    $pythonArgs = $pythonCommand[1..($pythonCommand.Length - 1)]
  }
  & $pythonCommand[0] @pythonArgs -m venv $venvDir
}

Write-Host "Installing CUDA PyTorch"
& $venvPython -m pip install --upgrade pip setuptools wheel
& $venvPython -m pip install --upgrade "torch==2.6.0+cu124" "torchaudio==2.6.0+cu124" --index-url $TorchIndexUrl

Write-Host "Installing BS-RoFormer inference runtime"
& $venvPython -m pip install --upgrade -r (Join-Path $scriptDir "requirements.txt")

if (!$SkipModelDownload) {
  New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
  Write-Host "Downloading and verifying the recommended 6-stem model"
  $downloader = Join-Path $venvDir "Scripts\bs-roformer-download.exe"
  & $downloader --model $modelSlug --output-dir $modelsDir
}

Write-Host ""
Write-Host "Music separation setup complete. Restart the Node server, then open Audio Tools > High Quality Music Separation."
