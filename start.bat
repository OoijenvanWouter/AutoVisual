@echo off
title AutoVisual
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py

%PY% -c "import yt_dlp" >nul 2>nul
if not errorlevel 1 goto run

echo.
echo yt-dlp is nodig om YouTube-, Instagram- en TikTok-links op te halen.
choice /M "yt-dlp nu installeren met pip"
if errorlevel 2 goto run
%PY% -m pip install --user -U yt-dlp

:run
%PY% server.py
pause

