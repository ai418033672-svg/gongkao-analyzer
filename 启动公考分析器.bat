@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe server.py --open
  if errorlevel 1 pause
  exit /b
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 server.py --open
) else (
  python server.py --open
)
if errorlevel 1 (
  echo 启动失败。请确认已安装 Python 3.9 或以上版本。
  pause
)
