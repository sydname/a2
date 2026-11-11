@echo off
rem 더블클릭: 시작프로그램에 오드 동기화 바로가기 등록 + 지금 바로 실행
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0notmeter_ode_sync.ps1" -InstallStartup
call "%~dp0start_ode_sync.cmd"
echo.
echo 등록 완료. 다음 로그인부터 자동으로 켜집니다. (지금도 백그라운드에서 실행 중)
pause
