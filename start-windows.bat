@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"

if errorlevel 1 (
  echo.
  echo 启动失败，请查看上方错误信息。
  pause
  exit /b 1
)
