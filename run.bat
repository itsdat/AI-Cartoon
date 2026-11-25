@echo off
cd /d %~dp0
where ffmpeg >nul 2>nul || (echo Can cai ffmpeg truoc & pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate
pip install -q -r requirements.txt
start "" http://localhost:8765
python -m uvicorn app:app --port 8765
