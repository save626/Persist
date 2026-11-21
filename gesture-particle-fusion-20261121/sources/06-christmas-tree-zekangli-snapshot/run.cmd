@echo off
rem Launch the Christmas tree demo using the local virtualenv.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtualenv missing. Creating it now...
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
".venv\Scripts\python.exe" tree.py
