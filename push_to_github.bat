@echo off
setlocal
cd /d "%~dp0"
set GIT_EXE=D:\Projects\New1\.tools\git\cmd\git.exe
if not exist "%GIT_EXE%" set GIT_EXE=git

echo ======================================================
echo   MKD Messenger Backend - Push to GitHub
echo ======================================================
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g. https://github.com/username/mkd-backend.git): "
if "%REPO_URL%"=="" (
    echo Error: No URL provided.
    pause
    exit /b 1
)

"%GIT_EXE%" remote remove origin 2>nul
"%GIT_EXE%" remote add origin %REPO_URL%
"%GIT_EXE%" branch -M main
echo.
echo Pushing to GitHub repository: %REPO_URL%
echo.
"%GIT_EXE%" push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ======================================================
    echo   SUCCESS: Backend pushed to GitHub!
    echo ======================================================
) else (
    echo.
    echo Push failed. If prompted, please ensure you have write permissions or enter your GitHub Personal Access Token (PAT).
)
echo.
pause
