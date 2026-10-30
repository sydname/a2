<#
  오드 동기화 진단. 미터기 PC 에서 실행하면 상태를 diag\ 폴더에 모으고 GitHub 에 올린다.
  → 사무실에서 Claude 에게 "진단 올렸음" 이라고 하면 diag\ 를 보고 원인을 찾는다.
#>
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Dir = Join-Path $PSScriptRoot "diag"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Report = Join-Path $Dir "report.txt"
$DbUrl = "https://a2-tracker-default-rtdb.asia-southeast1.firebasedatabase.app"
$SiteData = "https://sydname.github.io/a2/data/all.json"
$lines = New-Object System.Collections.Generic.List[string]
function Add($s) { $lines.Add("$s"); Write-Host $s }
function Section($s) { Add ""; Add "===== $s =====" }

Section "기본"
Add ("시각: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"))
Add ("PowerShell: {0} / OS: {1}" -f $PSVersionTable.PSVersion, [Environment]::OSVersion.VersionString)
Add ("스크립트 폴더: {0}" -f $PSScriptRoot)

Section "실행 중인 프로세스"
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
$sync = $procs | Where-Object { $_.CommandLine -match "notmeter_ode_sync\.ps1" -and $_.CommandLine -notmatch "DryRun" }
Add ("동기화 스크립트(감시 모드): {0}개" -f @($sync).Count)
$sync | ForEach-Object { Add ("  PID {0} 시작 {1}" -f $_.ProcessId, $_.CreationDate) }
$nm = $procs | Where-Object { $_.Name -match "NotMeter" }
Add ("NotMeter: {0}" -f $(if ($nm) { ($nm | ForEach-Object { "$($_.Name) PID $($_.ProcessId)" }) -join ", " } else { "실행 안 됨" }))

Section "시작프로그램 등록"
$startup = [Environment]::GetFolderPath("Startup")
Get-ChildItem $startup -ErrorAction SilentlyContinue | ForEach-Object { Add ("  {0}" -f $_.Name) }

Section "aether-energy.json / abyss-corridors.json 위치"
$roots = @($env:APPDATA, $env:LOCALAPPDATA, (Join-Path $env:USERPROFILE "Documents"), "C:\NOT METER DB") | Where-Object { $_ -and (Test-Path $_) }
$hits = $roots | ForEach-Object {
  Get-ChildItem -Path $_ -Recurse -Depth 4 -Include aether-energy.json, abyss-corridors.json -File -ErrorAction SilentlyContinue
}
if (-not $hits) { Add "  못 찾음 (APPDATA/LOCALAPPDATA/문서/C:\NOT METER DB)" }
$hits | Sort-Object LastWriteTime -Descending | ForEach-Object {
  Add ("  {0}  {1:N0} bytes  수정 {2:yyyy-MM-dd HH:mm:ss}" -f $_.FullName, $_.Length, $_.LastWriteTime)
}
foreach ($n in @("aether-energy.json", "abyss-corridors.json")) {
  $f = $hits | Where-Object { $_.Name -eq $n } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { Copy-Item $f.FullName (Join-Path $Dir $n) -Force }
}

Section "네트워크"
foreach ($u in @($SiteData, "$DbUrl/ode.json")) {
  try {
    $wc = New-Object Net.WebClient; $wc.Encoding = [Text.Encoding]::UTF8
    $body = $wc.DownloadString($u)
    Add ("  OK  {0}  ({1} bytes)" -f $u, $body.Length)
    if ($u -like "*ode.json") { Add ("  현재 사이트 오드 값: {0}" -f $body) }
  } catch { Add ("  실패 {0}: {1}" -f $u, $_.Exception.Message) }
}

Section "DryRun (업로드 없이 올릴 값)"
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "notmeter_ode_sync.ps1") -DryRun 2>&1
$out | ForEach-Object { Add ("  {0}" -f $_) }

Section "동기화 로그 (마지막 80줄)"
$log = Join-Path $PSScriptRoot "notmeter_ode_sync.log"
if (Test-Path $log) { Get-Content $log -Tail 80 -Encoding UTF8 | ForEach-Object { Add ("  {0}" -f $_) } }
else { Add "  로그 없음 → 스크립트가 한 번도 실행된 적 없음" }

$lines | Set-Content -Path $Report -Encoding UTF8

Section "GitHub 업로드"
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Add "  git 없음 → $Dir 폴더를 압축해서 다른 방법(카톡/메일 등)으로 사무실 PC 에 옮겨주세요."
} else {
  Push-Location (Split-Path (Split-Path $PSScriptRoot))
  try {
    git add -- "scripts/notmeter/diag" 2>&1 | Out-Null
    git commit -m ("NotMeter 진단 ({0})" -f (Get-Date -Format "yyyy-MM-dd HH:mm")) -- "scripts/notmeter/diag" 2>&1 | ForEach-Object { Add "  $_" }
    git pull --rebase 2>&1 | ForEach-Object { Add "  $_" }
    git push 2>&1 | ForEach-Object { Add "  $_" }
    if ($LASTEXITCODE -eq 0) { Add "  ✅ 업로드 완료. 사무실에서 Claude 에게 '진단 올렸음' 이라고 하면 됨." }
    else { Add "  ❌ push 실패 → $Dir 폴더를 압축해서 다른 방법으로 옮겨주세요." }
  } finally { Pop-Location }
}
