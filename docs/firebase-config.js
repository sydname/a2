/* ─────────────────────────────────────────────────────────────
   체크박스(회랑/일회/각성 · 루드라/침식/무스펠) + 오드 값을
   기기 간에 동기화하려면 아래 window.AION2_FIREBASE 를
   실제 Firebase 설정으로 바꾸고 커밋하세요.

   설정하지 않으면(= null 그대로) 이 값들은 이 브라우저
   (localStorage)에만 저장됩니다. 나머지 기능은 그대로 동작합니다.

   ── 설정 방법 (약 5분, 무료) ──
   1) https://console.firebase.google.com → 프로젝트 만들기
   2) 왼쪽 메뉴 '빌드 → Realtime Database' → 데이터베이스 만들기
      - 위치 아무거나, '잠금 모드'로 시작해도 됨(아래 3에서 규칙 교체)
   3) Realtime Database → '규칙' 탭에 아래를 붙여넣고 게시:
        {
          "rules": {
            "checks": { ".read": true, ".write": true },
            "ode":    { ".read": true, ".write": true }
          }
        }
      (개인용이라 공개 읽기/쓰기. 더 잠그려면 Firebase 익명 인증 + ".write": "auth != null")
   4) 프로젝트 설정(톱니) → '내 앱' → </> 웹 앱 추가 → firebaseConfig 복사
   5) 아래 예시처럼 붙여넣기. databaseURL 이 반드시 있어야 합니다
      (Realtime Database 를 먼저 만들었으면 자동 포함됨).
   6) 커밋/푸시 → 사이트 상단에 '체크/오드 저장: Firebase 동기화' 표시되면 완료.
   ───────────────────────────────────────────────────────────── */

window.AION2_FIREBASE = null;

/* 예시 (값을 본인 것으로 교체 후 위 null 줄을 지우세요):
window.AION2_FIREBASE = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "my-aion2.firebaseapp.com",
  databaseURL: "https://my-aion2-default-rtdb.firebasedatabase.app",
  projectId: "my-aion2",
  appId: "1:1234567890:web:abcdef1234567890"
};
*/
