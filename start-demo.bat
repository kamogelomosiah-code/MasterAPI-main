@echo off
REM MasterAPI Startup Script for Windows

echo.
echo ========================================
echo  MasterAPI - Demo Server
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo Starting MasterAPI Demo Server...
echo.
echo Your dashboard will be available at:
echo   http://localhost:3000/dashboard
echo.
echo API Endpoints:
echo   http://localhost:3000/api
echo.
echo Press Ctrl+C to stop the server
echo.

node demo-server.js

pause
