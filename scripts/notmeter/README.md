# NotMeter 오드 → 사이트 자동 업로드 가이드

NotMeter(<https://github.com/Not4You-Dev>)가 게임 패킷에서 읽은 **캐릭터별 오드 현황**을
사이트의 오드 칸(Firebase `ode/<캐릭터키>`)에 자동으로 올리는 방법.

## 동작 원리 — 언제 실행해야 하나?

```
게임 + NotMeter 실행 → 캐릭터 감지 → NotMeter 가 aether-energy.json 에 저장 (디스크)
                                                   │
                         이 스크립트가 파일을 읽어서 ─┘→ Firebase → 사이트
```

- NotMeter 는 감지한 값을 **파일로 저장**해 둔다. 게임/미터기를 끈 뒤에도 파일은 남아있다.
- 스크립트는 게임 패킷이 아니라 **이 파일만 읽는다**.
  → **게임을 끈 뒤에 실행해도 된다.** 게임 켜기 전/후 아무 때나 OK.
- 단, 파일에 들어가는 값은 "NotMeter 가 마지막으로 감지한 값"이다.
  게임 중 NotMeter 가 꺼져 있었다면 그 사이 변화는 반영되지 않는다.
- 감시 모드(아래 4번)로 켜두면 파일이 바뀔 때마다 자동 업로드 → 신경 쓸 일 없음.

> ⚠️ "게임 끄면 파일도 비워진다"면 위 전제가 깨진다. **2번 확인 절차에서 꼭 체크**.

## 파일 구성

| 파일 | 용도 |
|---|---|
| `notmeter_ode_sync.ps1` | 본체 스크립트 |
| `diagnose_ode_sync.cmd` | 더블클릭 → 진단 정보 모아서 GitHub 에 올림 (문제 생겼을 때) |
| `test_ode_sync.cmd` | 더블클릭 → 업로드 없이 무엇을 올릴지만 출력 (확인용) |
| `start_ode_sync.cmd` | 더블클릭 → 창 없이 백그라운드 감시 모드 실행 |
| `notmeter_ode_sync.log` | 실행 기록 (자동 생성, git 제외) |

## 1. 준비 (집 PC, 처음 한 번)

```powershell
cd <레포 폴더>
git pull
```

git 이 없으면 GitHub 에서 `scripts/notmeter/` 폴더만 받아도 된다.

## 2. 파일 위치/저장 동작 확인

1. 게임 + NotMeter 실행 → 캐릭터 접속해서 NotMeter 에 오드가 뜨는지 확인
2. PowerShell 에서 파일 찾기:

   ```powershell
   Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Depth 4 `
     -Include aether-energy.json,abyss-corridors.json,daily-points.json `
     -ErrorAction SilentlyContinue | Select FullName,Length,LastWriteTime
   ```

   안 나오면 범위를 넓혀서 (조금 오래 걸림):

   ```powershell
   Get-ChildItem C:\ -Recurse -Filter aether-energy.json -ErrorAction SilentlyContinue | Select FullName,LastWriteTime
   ```

3. **게임과 NotMeter 를 모두 끈 뒤** 위 명령을 다시 실행 → 파일이 그대로 있고 크기(Length)가 0 이 아니면 OK.
   내용 보기:

   ```powershell
   Get-Content "<위에서 찾은 경로>" -Encoding UTF8 | Select -First 60
   ```

## 3. 테스트 (업로드 안 함)

`test_ode_sync.cmd` 더블클릭. 이런 식으로 나오면 정상:

```
대상 파일: C:\Users\...\aether-energy.json
  감자밍 (2010-d7b11559c850) = 712  @ 2026-10-29T...
  ...
DryRun: PATCH https://.../ode.json {"2010-d7b11559c850":712,...}
```

- 파일을 못 찾으면 → 2번에서 찾은 경로로 직접 지정:
  `powershell -ExecutionPolicy Bypass -File .\notmeter_ode_sync.ps1 -DryRun -Path "C:\...\aether-energy.json"`
  (매번 쓰기 귀찮으면 환경변수 `NOTMETER_AETHER` 에 경로 저장)
- `건너뜀: XXX (사이트에 없는 캐릭터)` → `characters.json` 에 없는 캐릭터. 무시해도 됨.
- `기록 없음` → 파일 구조가 예상과 다름. 5번(샘플 내보내기) 후 알려주기.

## 4. 실제 업로드

**수동 (필요할 때만)** — PowerShell 에서:

```powershell
powershell -ExecutionPolicy Bypass -File .\notmeter_ode_sync.ps1 -Once
```

게임 끈 뒤 아무 때나 한 번 실행하면 마지막 값이 올라간다.

**자동 (추천)** — 로그인할 때마다 백그라운드 감시:

1. `Win + R` → `shell:startup` → 시작프로그램 폴더 열림
2. `start_ode_sync.cmd` 를 **오른쪽 버튼 드래그 → 여기에 바로 가기 만들기**
3. 지금 바로 켜려면 `start_ode_sync.cmd` 더블클릭 (창 안 뜸)

잘 도는지는 `notmeter_ode_sync.log` 로 확인. 끄려면 작업 관리자에서 `Windows PowerShell` 종료.
스크립트를 업데이트(`git pull`)했으면 PowerShell 을 종료하고 `start_ode_sync.cmd` 를 다시 실행해야 새 버전이 돈다.

로그 읽는 법:

| 로그 | 의미 |
|---|---|
| `업로드 완료: N명 / 현재 사이트 값: {...}` | 정상. 사이트 값이 게임 값과 같아야 함 |
| `파일 수정 시각: ...` 이 오래전 | NotMeter 가 파일을 아직 안 씀 (게임 중 감지 안 됨 / 종료 시에만 저장) |
| `변경 없음 - 업로드 생략` | 값이 그대로라 안 올림 (정상) |
| `실패: ...` / `오류로 종료: ...` | 에러 — 이 줄을 그대로 알려주기 |

## 5. 샘플 내보내기 (회랑/입장권/키나 연동용)

`aether-energy.json` 에는 오드 외에 악몽·각성전 입장권, 키나/각인키나(캐릭터 전용)도 있고,
`abyss-corridors.json` 에는 캐릭터별 어비스 회랑 기록이 있다. 사이트 연동하려면 실제 구조가 필요:

```powershell
powershell -ExecutionPolicy Bypass -File .\notmeter_ode_sync.ps1 -Export
git add samples ; git commit -m "NotMeter 샘플" ; git push
```

`samples\` 에 두 파일이 복사된다. (레포가 Public 이면 캐릭터명/수치가 공개되는 점 참고)

## 공유가 안 될 때 (미터기 PC 에서 Claude 없이)

**1단계 — 스스로 확인 (5분)**

1. 작업 관리자 → 세부 정보 탭에 `powershell.exe` 가 있는지 → 없으면 `start_ode_sync.cmd` 더블클릭
2. `notmeter_ode_sync.log` 를 메모장으로 열어 **맨 아래 줄** 확인 → 아래 "로그 읽는 법" 표 대로
3. 그래도 모르겠으면: 작업 관리자에서 `Windows PowerShell` 종료 → `git pull` → `start_ode_sync.cmd` 다시 실행
4. NotMeter 에서 캐릭터 오드가 떠 있는 상태인지 확인 (안 뜨면 NotMeter 쪽 문제 — 게임 재접속)

**2단계 — 진단 올리기 (1분)**

`diagnose_ode_sync.cmd` 더블클릭. 실행 상태 · 파일 위치/수정 시각 · 네트워크 · 로그 · 올릴 값을
`diag\` 폴더에 모으고 **자동으로 GitHub 에 push** 한다.
→ 사무실에서 Claude 에게 **"진단 올렸음"** 이라고만 하면 됨. (push 실패 시 `diag\` 폴더를 압축해서 옮기기)

**3단계 — 급하면 수동 입력**

사이트 '기본' 탭의 오드 칸을 눌러 숫자를 직접 입력하면 바로 저장된다 (폰에서도 가능).
스크립트가 다음에 정상 동작하면 그 값으로 덮어쓴다.

## 문제 해결

| 증상 | 해결 |
|---|---|
| "스크립트를 실행할 수 없습니다" (실행 정책) | `.cmd` 로 실행하거나 `-ExecutionPolicy Bypass` 붙이기 |
| 한글이 깨짐 | `.cmd` 로 실행 (UTF-8 로 맞춰줌) |
| 업로드 완료인데 사이트에 안 바뀜 | 사이트 상단 저장 위치가 "Firebase 동기화"인지 확인, 새로고침 |
| 값이 게임과 다름 | 스크립트는 기본 오드(`Base`)만 올림. NotMeter 의 마지막 감지 시점 값임 |
