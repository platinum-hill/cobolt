@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo          Installing Cobolt dependencies
echo ======================================================
echo.

:: Check if winget is installed
where winget >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/3] Winget is not installed. Please install Winget manually from the Microsoft Store.
    echo Installation cannot continue without winget.
    pause
    exit /b
) else (
    echo [1/3] Winget is already installed.
)

echo.
echo [2/3] Checking Python installation...

:: Check Python version
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYTHON_VERSION=%%v
if not defined PYTHON_VERSION set PYTHON_VERSION=0.0.0

set MIN_VERSION=3.10.0
for /f "tokens=1,2,3 delims=." %%a in ("%PYTHON_VERSION%") do (
    set /a VER_CUR=%%a*10000 + %%b*100 + %%c
)
for /f "tokens=1,2,3 delims=." %%a in ("%MIN_VERSION%") do (
    set /a VER_MIN=%%a*10000 + %%b*100 + %%c
)

if %VER_CUR% LSS %VER_MIN% (
    echo Installing Python 3.10 or later...
    winget install -e --id Python.Python.3
    echo Python installation completed.
) else (
    echo Python %PYTHON_VERSION% is already installed and up-to-date.
)

echo [3/3] Installing required system dependencies...

:: Required dependencies list
set DEPENDENCIES=libidn2 mbedtls openssl libsodium ollama

for %%d in (%DEPENDENCIES%) do (
    echo Checking %%d...
    winget list | findstr /i "%%d" >nul 2>nul
    if errorlevel 1 (
        echo Installing %%d...
        winget install -e --id %%d
        echo %%d installed successfully.
    ) else (
        echo %%d is already installed.
    )
)

echo.
echo [6/3] Creating configuration files...
