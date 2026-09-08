# 아이온 2 캐릭터 현황 (자동 수집)

아이온 2 공식 홈페이지 **캐릭터 정보실**에서 매일 자정(KST) 캐릭터 정보를 긁어와
GitHub Pages 정적 사이트로 보여줍니다. 서버가 필요 없고 전부 GitHub 안에서 돕니다.

수집 항목: **아이템 레벨 · 전투력 · 착용 장비(강화/돌파) · 분야별 돌파 합계(무기+가더 / 방어구 / 악세서리) ·
데바니온 보드/노드 · 착용 아르카나 · 착용 칭호 · 스탯 · 날개/펫**, 그리고 매일 스냅샷을 쌓아 **추이 그래프**.

화면은 상단 토글로 **카드형**(모바일 세로 피드) / **표형**(엑셀식 비교)을 오갑니다. 화이트 테마.

```
aion2-character-tracker/
├─ characters.json          ← 관리할 캐릭터 목록 (여기만 편집하면 됨)
├─ scripts/fetch.py         ← 수집 스크립트 (파이썬 표준 라이브러리만, pip 불필요)
├─ .github/workflows/update.yml  ← 매일 00:00 KST + 수동 실행
└─ docs/                    ← GitHub Pages 로 공개되는 폴더
   ├─ index.html / style.css / app.js
   └─ data/                 ← 수집 결과(JSON). Actions 가 자동 커밋
```

---

## 설치 (처음 한 번, 약 5분)

1. **새 저장소 만들기** — GitHub 에서 `New repository` → 이름 예: `aion2-tracker` → **Public**
   (Private 도 가능하지만 그러면 Pages 는 유료 플랜 필요).

2. **이 폴더 전체를 올리기**
   ```bash
   cd aion2-character-tracker
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<본인아이디>/aion2-tracker.git
   git push -u origin main
   ```

3. **Actions 쓰기 권한 켜기** — 저장소 `Settings → Actions → General`
   → 아래 **Workflow permissions** 에서 `Read and write permissions` 선택 → Save.
   (Actions 가 수집 결과를 저장소에 커밋해야 하므로 필요)

4. **GitHub Pages 켜기** — 저장소 `Settings → Pages`
   → **Source**: `Deploy from a branch`
   → **Branch**: `main` / 폴더 `/docs` → Save.
   1~2분 뒤 `https://<본인아이디>.github.io/aion2-tracker/` 주소가 생깁니다.

5. **첫 수집 돌리기** — 저장소 `Actions` 탭 → `캐릭터 정보 갱신` → `Run workflow`.
   끝나면 `docs/data/` 에 JSON 이 커밋되고 사이트에 데이터가 뜹니다.

---

## 캐릭터 추가 / 변경

`characters.json` 의 `characters` 배열만 고치면 됩니다. **파일을 커밋/푸시하면 자동으로 한 번 갱신**됩니다.

```jsonc
{
  "language": "ko",
  "historyDays": 180,          // 추이 그래프용 스냅샷 보관 일수
  "characters": [
    {
      "label": "감자밍",        // 사이트에 표시할 별명 (생략하면 실제 캐릭터명)
      "url": "https://aion2.plaync.com/ko-kr/characters/2010/xxxxxxxxxxxxxxxxxxxx="
    },
    {
      "label": "감자미",
      "serverId": 2010,         // url 대신 이렇게 직접 넣어도 됨
      "characterId": "yyyyyyyyyyyyyyyyyyyy="
    }
  ]
}
```

### 캐릭터 주소 얻는 법
1. 공식 홈페이지 캐릭터 검색: <https://aion2.plaync.com/ko-kr/characters/index>
2. 원하는 캐릭터 상세 페이지를 연 뒤 **브라우저 주소창의 URL 을 통째로 복사**해서 `url` 에 붙여넣기.
   - URL 형태: `.../characters/<서버ID>/<캐릭터ID>` — `2010` 이 서버(하달), 뒤가 캐릭터 고유 ID.
3. 자주 보는 캐릭터는 이렇게 URL 만 모아두면 됩니다. (닉네임 자동 검색은 공식 API 가 막아둬서 URL 방식이 안정적입니다.)

---

## 수집 주기 바꾸기

`.github/workflows/update.yml` 의 `cron` 값 (UTC 기준):

| 원하는 주기 | cron |
|---|---|
| 매일 00:00 KST (기본) | `0 15 * * *` |
| 매일 오전 6시 KST | `0 21 * * *` |
| 6시간마다 | `0 */6 * * *` |
| 12시간마다 | `0 3,15 * * *` |

> 게임사/깃허브 차단을 피하려면 **최소 1시간 이상** 간격을 권장합니다. 스크립트는 캐릭터마다 1.5~3초 쉬면서 호출합니다.

---

## 아르카나 상세 강화 내역 (수동 갱신)

아르카나별 메인스탯 / 서브스킬 레벨은 자주 바뀌지 않으므로 **수동 갱신**입니다.

- GitHub 저장소 → **Actions 탭 → "아르카나 상세 갱신 (수동)" → Run workflow**
- 사이트 **카드 뷰 아르카나 구획의 `상세 갱신 ↗` 버튼**을 누르면 이 워크플로 페이지로 이동합니다.
- 결과는 `docs/data/arcana.json` 에 커밋되고, 카드 뷰에 슬롯별 상세가 표시됩니다.
- 브라우저에서 게임사 API 를 직접 부르는 건 CORS 로 막혀 있어 Actions 를 거칩니다.

로컬 실행: `python3 scripts/fetch_arcana.py`

---

## 로컬에서 직접 돌려보기

```bash
python3 scripts/fetch.py          # 파이썬 3.9+ , 설치할 패키지 없음
python3 -m http.server -d docs 8000   # http://localhost:8000 에서 사이트 확인
```

---

## 동작 방식 / 참고

- 수집은 공식 홈페이지가 내부적으로 쓰는 JSON API 3종을 그대로 호출합니다 (로그인 불필요):
  - `GET /api/character/info` — 프로필 · 스탯 · 아이템레벨 · 칭호 · 데바니온 보드
  - `GET /api/character/equipment` — 장비/돌파 · 아르카나 · 날개 · 펫 · 스킨
  - `GET /api/gameinfo/servers` — 서버 목록(참고용)
- **돌파 합계** 분야 구분 (엑셀 `부캐영각` 시트 기준):
  - 무기+가더 = MainHand + SubHand
  - 방어구 = 투구·견갑·상의·하의·장갑·신발·망토
  - 악세서리 = 목걸이·귀걸이2·반지2·팔찌2·브로치2
  - `scripts/fetch.py` 상단의 `WEAPON_SLOTS / ARMOR_SLOTS / ACCESSORY_SLOTS` 에서 조정 가능.
- 한 캐릭터 수집이 실패해도 나머지는 계속 진행하며, 실패한 캐릭터는 **직전 데이터를 유지**합니다.
- 비공식 API 라 게임 업데이트로 응답 형식이 바뀌면 스크립트 수정이 필요할 수 있습니다.
- GitHub Actions 러너 IP 가 게임사에서 차단되면 수집이 실패할 수 있습니다(그럴 땐 로컬 실행 + 커밋으로 대체).
