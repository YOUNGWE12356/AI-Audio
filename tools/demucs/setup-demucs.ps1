param(
  [string]$PythonExe = "",
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cpu"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDir = Join-Path $scriptDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

function Resolve-PythonCommand {
  if ($PythonExe -and (Test-Path -LiteralPath $PythonExe)) {
    return @($PythonExe)
  }

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    try {
      & py -3.11 --version *> $null
      if ($LASTEXITCODE -eq 0) { return @("py", "-3.11") }
    } catch {}

    try {
      & py -3.10 --version *> $null
      if ($LASTEXITCODE -eq 0) { return @("py", "-3.10") }
    } catch {}
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @($python.Source)
  }

  throw "Python 3.10/3.11 was not found. Install Python 3.11 first, or pass -PythonExe."
}

$pythonCommand = Resolve-PythonCommand

if (!(Test-Path -LiteralPath $venvPython)) {
  Write-Host "Creating Demucs virtual environment at $venvDir"
  $pythonArgs = @()
  if ($pythonCommand.Length -gt 1) {
    $pythonArgs = $pythonCommand[1..($pythonCommand.Length - 1)]
  }
  & $pythonCommand[0] @pythonArgs -m venv $venvDir
}

Write-Host "Upgrading pip"
& $venvPython -m pip install --upgrade pip setuptools wheel

Write-Host "Installing PyTorch / torchaudio"
& $venvPython -m pip install --upgrade torch torchaudio --index-url $TorchIndexUrl

Write-Host "Installing Demucs"
& $venvPython -m pip install --upgrade demucs

Write-Host ""
Write-Host "Demucs setup complete."
Write-Host "Restart the Node server. It will auto-detect:"
Write-Host $venvPython
