@echo off
rem NotMeter 오드 자동 업로드 (창 없이 백그라운드 실행). 시작프로그램(shell:startup)에 바로가기를 넣어두면 로그인 때마다 켜짐.
chcp 65001 >nul
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0notmeter_ode_sync.ps1"
