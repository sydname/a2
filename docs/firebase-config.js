/* 체크박스(회랑/일회/각성 · 루드라/침식/무스펠) + 오드 값 기기 간 동기화용 Firebase 설정.
   비우면(null) 이 값들은 이 브라우저(localStorage)에만 저장됩니다.
   접근 제한은 Realtime Database 규칙으로:
     { "rules": { "checks": { ".read": true, ".write": true }, "ode": { ".read": true, ".write": true } } }
   apiKey 는 웹 공개되어도 되는 값입니다. */

window.AION2_FIREBASE = {
  apiKey: "AIzaSyA6K3jcaYDfuR5dWK9e9tyjfTft9qkYq-Q",
  authDomain: "a2-tracker.firebaseapp.com",
  databaseURL: "https://a2-tracker-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "a2-tracker",
  storageBucket: "a2-tracker.firebasestorage.app",
  messagingSenderId: "798155483839",
  appId: "1:798155483839:web:92e34f5f032e68e790740a"
};
