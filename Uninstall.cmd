@echo off
node "%~dp0setup.mjs" --uninstall
if errorlevel 1 pause
