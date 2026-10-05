@echo off
rem dev.cmd: double-click to start the T-180 Track Builder with LIVE RELOAD (npm run dev, scripts/dev.js).
rem A saved file in app\, src\ or tools\ reloads the open window about a second later. Close the window, or press
rem Ctrl+C here, to stop. The first start compiles the native side, a minute or two; later starts take seconds.
setlocal
cd /d "%~dp0.."

where node >nul 2>nul || (echo Node.js is not installed or not on PATH: get it from https://nodejs.org & goto :failed)
where cargo >nul 2>nul || (echo Rust is not installed or not on PATH: get it from https://rustup.rs & goto :failed)
cargo tauri --version >nul 2>nul || (echo tauri-cli 2 is missing: run   cargo install tauri-cli --version "^2" --locked & goto :failed)

echo Starting T-180 Track Builder with live reload in %CD%
call npm run dev
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo The builder did not start (see above). Press a key to close this window.
pause >nul
exit /b 1
