$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop 'Local AI Chatbot.lnk'
$Launcher = Join-Path $PSScriptRoot 'start-desktop.vbs'
$ElectronExe = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $Launcher)) {
  Write-Error "Lipseste launcher-ul: $Launcher"
}

if (-not (Test-Path $ElectronExe)) {
  Write-Host "Electron nu este instalat. Ruleaza npm install in proiect..." -ForegroundColor Yellow
  Push-Location $ProjectRoot
  npm install
  Pop-Location

  if (-not (Test-Path $ElectronExe)) {
    Write-Error "npm install nu a instalat Electron. Verifica proiectul si incearca din nou."
  }
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$Shortcut.Arguments = "`"$Launcher`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'Porneste Local AI Chatbot (Ollama)'
$Shortcut.IconLocation = "$ElectronExe,0"
$Shortcut.Save()

Write-Host "Shortcut creat:" -ForegroundColor Green
Write-Host $ShortcutPath
