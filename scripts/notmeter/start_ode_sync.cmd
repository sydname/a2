@echo off
rem NotMeter 오드 자동 업로드 (창 없이 백그라운드 실행). 시작프로그램 등록은 install_startup.cmd 로 (복사 X, 바로가기 O).
chcp 65001 >nul
set "PS1=%~dp0notmeter_ode_sync.ps1"
if not exist "%PS1%" (
  echo [오류] %~dp0 에 notmeter_ode_sync.ps1 이 없습니다.
  echo 이 파일을 시작프로그램 폴더에 복사하면 안 됩니다. 시작프로그램에서 지우고
  echo scripts\notmeter\install_startup.cmd 를 더블클릭해서 등록하세요.
  pause
  exit /b 1
)
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS1%"
