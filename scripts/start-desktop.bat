@echo off
cd /d "%~dp0.."

if not exist "node_modules\.bin\electron.cmd" (
  echo Ruleaza mai intai: npm install
  echo in folderul proiectului chatbot.
  pause
  exit /b 1
)

call "node_modules\.bin\electron.cmd" .
