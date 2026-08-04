@echo off
REM Starts the CRM server, then a Cloudflare quick tunnel pointed at it.
REM Close this window to stop both. See ..\TUNNEL.md for setup.
cd /d "%~dp0"

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared not found on PATH. See TUNNEL.md for install steps.
  pause
  exit /b 1
)

echo Starting Pipeline CRM server...
start "Pipeline CRM server" cmd /c "node server.js"

timeout /t 2 /nobreak >nul
echo.
echo Starting Cloudflare tunnel - look for the https://...trycloudflare.com link below:
echo.
cloudflared tunnel --url http://localhost:3000
