@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
cls

set "PORT=8084"
set "AUTO_OPEN=1"
set "BACKUP_PORT=8085"

echo.
echo ================================================================
echo              M6-B Keyboard Tool Server v2.0
echo ================================================================
echo.

set "PORT_IN_USE=0"
set "PORT_PID="

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% " ^| findstr LISTENING') do (
    set "PORT_PID=%%a"
    set "PORT_IN_USE=1"
)

if !PORT_IN_USE! equ 1 (
    echo [WARN] Port %PORT% is in use (PID: !PORT_PID!)

    if !PORT_PID! leq 4 (
        echo [INFO] Trying backup port %BACKUP_PORT%...
        set "PORT=%BACKUP_PORT%"
    ) else (
        echo [WARN] Stopping existing process...
        taskkill /F /PID !PORT_PID! >nul 2>&1
        timeout /t 1 /nobreak >nul

        set "PORT_IN_USE=0"
        for /f "tokens=5" %%b in ('netstat -ano ^| findstr /R /C:":%PORT% " ^| findstr LISTENING') do (
            set "PORT_IN_USE=1"
        )

        if !PORT_IN_USE! equ 1 (
            echo [INFO] Using backup port %BACKUP_PORT%
            set "PORT=%BACKUP_PORT%"
        )
    )
)

echo [OK] Using port %PORT%
echo.

powershell -Command "if ($PSVersionTable.PSVersion.Major -lt 5) { exit 1 }"
if %errorlevel% neq 0 (
    echo [ERROR] PowerShell 5.0+ required
    pause
    exit /b 1
)

echo [OK] PowerShell available
echo.
echo ================================================================
echo           Server starting on http://localhost:%PORT%
echo ================================================================
echo.
echo Press Ctrl+C to stop
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port %PORT% -AutoOpen %AUTO_OPEN%

echo.
echo ================================================================
echo                   Server stopped
echo ================================================================
pause