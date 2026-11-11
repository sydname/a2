<#
  NotMeter 오드 현황 + 악몽 티켓 -> 사이트(Firebase ode/<캐릭터키>, 악몽은 .nm) 자동 업로드.

  NotMeter 는 캐릭터별 오드 기록을 aether-energy.json 에 저장한다.
  이 스크립트는 그 파일을 감시하다가 바뀌면 기본 오드(Base)·충전 오드(Bonus)·감지 시각을 Firebase 에 PATCH 한다.
  사이트는 감지 시각 이후 자연 충전(3시간마다 +15)을 더해서 보여준다.
  게임/미터기를 켜두는 동안 백그라운드로 돌려두면 끄기 전에 따로 할 일이 없다.

  사용법 (집 PC, PowerShell):
    .\notmeter_ode_sync.ps1 -DryRun      # 파일 찾고, 뭘 올릴지 출력만 (처음 확인용)
    .\notmeter_ode_sync.ps1 -Once        # 한 번만 업로드
    .\notmeter_ode_sync.ps1              # 감시 모드 (파일이 바뀔 때마다 업로드)
    .\notmeter_ode_sync.ps1 -Path "C:\...\aether-energy.json"   # 파일 위치 직접 지정
    .\notmeter_ode_sync.ps1 -Export      # aether-energy.json / abyss-corridors.json 을 samples\ 로 복사 (구조 확인용)
    .\notmeter_ode_sync.ps1 -InstallStartup   # 시작프로그램에 바로가기 등록 (install_startup.cmd 가 호출)
#>
param(
  [string]$Path = $env:NOTMETER_AETHER,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$Export,
  [switch]$InstallStartup,
  [string]$Field = "Base",
  [int]$IntervalMinutes = 5,
  [string]$SiteData = "https://sydname.github.io/a2/data/all.json",
  [string]$DbUrl = "https://a2-tracker-default-rtdb.asia-southeast1.firebasedatabase.app"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$LogFile = Join-Path $PSScriptRoot "notmeter_ode_sync.log"

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}

function Find-AetherFile {
  if ($Path) {
    if (Test-Path $Path) { return (Resolve-Path $Path).Path }
    throw "지정한 파일이 없음: $Path"
  }
  $roots = @($env:APPDATA, $env:LOCALAPPDATA, (Join-Path $env:USERPROFILE "Documents"),
             $PSScriptRoot, "C:\NOT METER DB") | Where-Object { $_ -and (Test-Path $_) }
  foreach ($r in $roots) {
    $hit = Get-ChildItem -Path $r -Filter "aether-energy.json" -Recurse -Depth 4 -File -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  throw "aether-energy.json 을 못 찾음. NotMeter 에서 오드 현황판이 한 번 떠야 생성됩니다. -Path 로 직접 지정하세요."
}

function Get-Prop($obj, [string]$name) {
  # 대소문자 무시 (CharacterName / characterName 둘 다 대응)
  $p = $obj.PSObject.Properties | Where-Object { $_.Name -ieq $name } | Select-Object -First 1
  if ($p) { return $p.Value }
  return $null
}

function Get-Records($node, $acc) {
  # 파일 구조를 모르므로 CharacterName 을 가진 객체를 전부 재귀로 수집
  if ($null -eq $node) { return }
  if ($node -is [System.Collections.IEnumerable] -and $node -isnot [string]) {
    foreach ($x in $node) { Get-Records $x $acc }
    return
  }
  if ($node -is [System.Management.Automation.PSCustomObject]) {
    $name = Get-Prop $node "CharacterName"
    $val = Get-Prop $node $Field
    if ($name -and $null -ne $val -and "$val" -match '^\d+$') {
      $at = Get-Prop $node "AetherReceivedAt"
      if (-not $at) { $at = Get-Prop $node "ObservedAt" }
      $bonus = Get-Prop $node "Bonus"
      if ("$bonus" -notmatch '^\d+$') { $bonus = 0 }
      # 악몽 티켓 (Nightmare.Base / Bonus / ObservedAt)
      $nm = $null
      $n = Get-Prop $node "Nightmare"
      if ($n -and "$(Get-Prop $n 'Base')" -match '^\d+$') {
        $nb = Get-Prop $n "Bonus"; if ("$nb" -notmatch '^\d+$') { $nb = 0 }
        $nat = Get-Prop $n "ObservedAt"; if (-not $nat) { $nat = $at }
        $nm = [ordered]@{ base = [int](Get-Prop $n "Base"); bonus = [int]$nb; at = "$nat" }
      }
      $acc.Add([pscustomobject]@{ Name = "$name"; Server = "$(Get-Prop $node 'ServerId')"; Value = [int]$val; Bonus = [int]$bonus; At = "$at"; Nm = $nm })
    }
    foreach ($p in $node.PSObject.Properties) { Get-Records $p.Value $acc }
  }
}

function Read-Json($file) {
  # NotMeter 가 쓰는 도중이면 잠겨있을 수 있어 몇 번 재시도
  for ($i = 0; $i -lt 5; $i++) {
    try { return (Get-Content -Path $file -Raw -Encoding UTF8 | ConvertFrom-Json) }
    catch { Start-Sleep -Milliseconds 500 }
  }
  throw "JSON 읽기 실패: $file"
}

function Get-CharKeys {
  $wc = New-Object Net.WebClient
  $wc.Encoding = [Text.Encoding]::UTF8
  $data = $wc.DownloadString($SiteData) | ConvertFrom-Json
  $map = @{}
  foreach ($c in $data.characters) {
    if ($c.profile -and $c.profile.name) { $map[$c.profile.name] = $c.key }
    if ($c.label) { $map[$c.label] = $c.key }
  }
  return $map
}

$script:LastPayload = $null

function Sync-Once($file, [switch]$Force) {
  Log ("파일 수정 시각: {0}" -f (Get-Item $file).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
  $json = Read-Json $file
  $recs = New-Object System.Collections.Generic.List[object]
  Get-Records $json $recs
  if ($recs.Count -eq 0) { Log "기록 없음 (필드 '$Field' 를 가진 캐릭터 레코드를 못 찾음)"; return }

  $keys = Get-CharKeys
  $body = [ordered]@{}
  foreach ($g in ($recs | Group-Object Name)) {
    $k = $keys[$g.Name]
    if (-not $k) { Log ("  건너뜀: {0} (사이트에 없는 캐릭터)" -f $g.Name); continue }
    # 다른 서버의 동명 캐릭터는 제외 (캐릭터 키 = <서버ID>-...). 남은 것 중 가장 최근 레코드.
    $server = $k.Split('-')[0]
    $r = $g.Group | Where-Object { -not $_.Server -or $_.Server -eq $server } |
         Sort-Object At -Descending | Select-Object -First 1
    if (-not $r) { Log ("  건너뜀: {0} (서버 {1} 기록 없음)" -f $g.Name, $server); continue }
    $body[$k] = [ordered]@{ base = $r.Value; bonus = $r.Bonus; at = $r.At }
    if ($r.Nm) { $body[$k].nm = $r.Nm }
    Log ("  {0} ({1}) = {2}(+{3})  악몽 {4}  @ {5}" -f $r.Name, $k, $r.Value, $r.Bonus,
      $(if ($r.Nm) { "{0}(+{1})" -f $r.Nm.base, $r.Nm.bonus } else { "-" }), $r.At)
  }
  if ($body.Count -eq 0) { return }

  $payload = $body | ConvertTo-Json -Compress -Depth 5
  if ($DryRun) { Log "DryRun: PATCH $DbUrl/ode.json $payload"; return }
  if (-not $Force -and $payload -eq $script:LastPayload) { Log "변경 없음 - 업로드 생략"; return }
  Invoke-RestMethod -Method Patch -Uri "$DbUrl/ode.json" -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
  $script:LastPayload = $payload
  # 실제 반영 확인용으로 다시 읽어서 기록
  $now = Invoke-RestMethod -Uri "$DbUrl/ode.json"
  Log ("업로드 완료: {0}명 / 현재 사이트 값: {1}" -f $body.Count, ($now | ConvertTo-Json -Compress -Depth 5))
}

function Try-Sync($file, [switch]$Force) {
  try { Sync-Once $file -Force:$Force; return $true }
  catch { Log ("실패: {0}" -f $_.Exception.Message); return $false }
}

function Install-Startup {
  # 시작프로그램 폴더에 start_ode_sync.cmd 를 "복사"하면 %~dp0 이 시작프로그램 폴더가 돼서
  # notmeter_ode_sync.ps1 을 못 찾고 조용히 실패한다. 그래서 절대경로 바로가기(.lnk)로 등록.
  $startup = [Environment]::GetFolderPath("Startup")
  $target = Join-Path $PSScriptRoot "start_ode_sync.cmd"
  foreach ($old in @("start_ode_sync.cmd", "start_ode_sync.cmd.lnk", "start_ode_sync.lnk")) {
    $p = Join-Path $startup $old
    if (Test-Path $p) { Remove-Item $p -Force; Log "기존 등록 제거: $p" }
  }
  $lnk = Join-Path $startup "NotMeter 오드 동기화.lnk"
  $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $sc.TargetPath = $target
  $sc.WorkingDirectory = $PSScriptRoot
  $sc.WindowStyle = 7  # 최소화
  $sc.Save()
  Log "시작프로그램 등록: $lnk -> $target"
}

# 창 없이 돌 때 에러가 묻히지 않도록 로그에 남기고 종료
trap { Log ("오류로 종료: {0}" -f $_.Exception.Message); break }

# PowerShell 5.1 기본값이 TLS1.0 일 수 있어 명시
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if ($InstallStartup) { Install-Startup; return }
Log ("시작 (PowerShell {0}, 모드: {1})" -f $PSVersionTable.PSVersion, $(if ($DryRun) {"DryRun"} elseif ($Once) {"Once"} elseif ($Export) {"Export"} else {"감시"}))
$file = Find-AetherFile
Log "대상 파일: $file"
if ($Export) {
  $dst = Join-Path $PSScriptRoot "samples"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  foreach ($n in @("aether-energy.json", "abyss-corridors.json")) {
    $src = Join-Path (Split-Path $file) $n
    if (Test-Path $src) { Copy-Item $src $dst -Force; Log "복사: $src -> $dst" }
    else { Log "없음: $src" }
  }
  return
}
if ($Once -or $DryRun) { Sync-Once $file -Force; return }

# 감시 모드는 하나만 (시작프로그램 + 수동 실행이 겹쳐도 중복으로 안 돌게)
$script:Mutex = New-Object Threading.Mutex($false, "Local\notmeter_ode_sync")
if (-not $script:Mutex.WaitOne(0)) { Log "이미 감시 중인 스크립트가 있음 - 종료"; return }

# 로그인 직후엔 네트워크가 아직 없을 수 있어 성공할 때까지 재시도
for ($i = 0; -not (Try-Sync $file -Force) -and $i -lt 20; $i++) { Start-Sleep -Seconds 30 }

# 감시 모드: 파일이 바뀌면 3초 모아서(연속 쓰기 대비) 업로드.
# 임시파일→이름변경 방식 저장은 감시가 놓칠 수 있어 IntervalMinutes 마다 수정 시각도 확인.
$fsw = New-Object IO.FileSystemWatcher (Split-Path $file), (Split-Path $file -Leaf)
$fsw.NotifyFilter = [IO.NotifyFilters]"LastWrite, Size, FileName"
$fsw.EnableRaisingEvents = $true
$lastWrite = (Get-Item $file).LastWriteTime
$nextPoll = (Get-Date).AddMinutes($IntervalMinutes)
Log "감시 시작 (Ctrl+C 로 종료, $IntervalMinutes 분마다 확인)"
while ($true) {
  $r = $fsw.WaitForChanged([IO.WatcherChangeTypes]::All, 30000)
  $changed = -not $r.TimedOut
  if (-not $changed -and (Get-Date) -ge $nextPoll) {
    $nextPoll = (Get-Date).AddMinutes($IntervalMinutes)
    try { $changed = (Get-Item $file).LastWriteTime -ne $lastWrite } catch {}
  }
  if (-not $changed) { continue }
  Start-Sleep -Seconds 3
  try { $lastWrite = (Get-Item $file).LastWriteTime } catch {}
  Try-Sync $file | Out-Null
}
