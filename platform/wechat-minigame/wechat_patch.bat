@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Phaser 4 to WeChat Mini Game

set "CONVERTER_DIR=%~dp0"
for %%I in ("%CONVERTER_DIR%\..\..") do set "PHASER_EDITOR_ROOT=%%~fI"
cd /d "%PHASER_EDITOR_ROOT%"

set "INTERACTIVE=0"
if "%~1"=="" set "INTERACTIVE=1"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  goto :fatal
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  goto :fatal
)

if "%~1"=="" goto :interactive
set "FIRST_ARG=%~1"
if "%FIRST_ARG:~0,2%"=="--" goto :passthrough

set "PROJECT=%~1"
set "OUTPUT=%~2"
set "APPID="
goto :prepare

:interactive
echo.
echo Phaser 4 to WeChat Mini Game
echo.
set /p "PROJECT=Phaser project path: "
if not defined PROJECT (
  echo [ERROR] Project path is required.
  goto :fatal
)
set /p "OUTPUT=Output path, leave blank for project-name-wechat: "
set /p "APPID=AppID, leave blank to preserve existing or use touristappid: "

:prepare

for %%I in ("%PROJECT%") do set "PROJECT=%%~fI"
if not exist "%PROJECT%\package.json" (
  echo [ERROR] package.json was not found in "%PROJECT%".
  goto :fatal
)
if not exist "%PROJECT%\index.html" (
  echo [ERROR] index.html was not found in "%PROJECT%".
  goto :fatal
)

if defined OUTPUT (
  for %%I in ("%OUTPUT%") do set "OUTPUT=%%~fI"
  goto :run
)
for %%I in ("%PROJECT%") do set "PROJECT_NAME=%%~nxI"
for %%I in ("%PROJECT%\..") do set "PROJECT_PARENT=%%~fI"
set "OUTPUT=%PROJECT_PARENT%\%PROJECT_NAME%-wechat"

:run

echo.
echo [INFO] Source: %PROJECT%
echo [INFO] Output: %OUTPUT%
echo.

if defined APPID (
  node "%CONVERTER_DIR%scripts\run.mjs" --project "%PROJECT%" --output "%OUTPUT%" --appid "%APPID%"
) else (
  node "%CONVERTER_DIR%scripts\run.mjs" --project "%PROJECT%" --output "%OUTPUT%"
)
set "EXIT_CODE=%ERRORLEVEL%"
goto :result

:passthrough
node "%CONVERTER_DIR%scripts\run.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
goto :result

:result
echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] Conversion completed.
) else if "%EXIT_CODE%"=="2" (
  echo [WARNING] Conversion completed with runtime or package warnings.
) else (
  echo [ERROR] Conversion failed with exit code %EXIT_CODE%.
)

if not "%INTERACTIVE%"=="1" goto :finish
if "%EXIT_CODE%"=="0" goto :offer_open
if "%EXIT_CODE%"=="2" goto :offer_open
goto :finish

:offer_open
if not exist "%OUTPUT%" goto :finish
set "OPEN_OUTPUT="
set /p "OPEN_OUTPUT=Open output folder? [Y/n]: "
if not defined OPEN_OUTPUT set "OPEN_OUTPUT=Y"
if /I "%OPEN_OUTPUT%"=="Y" start "" "%OUTPUT%"

:finish
if "%INTERACTIVE%"=="1" pause
exit /b %EXIT_CODE%

:fatal
if "%INTERACTIVE%"=="1" pause
exit /b 1
