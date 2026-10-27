/* 아이온 2 캐릭터 트래커 — 프론트엔드 (외부 라이브러리 없음)
   표(기본관리 / 강화관리) + 카드(캐릭터 선택형) + 시뮬(아이템레벨) 세 뷰. 표가 기본. */
(function () {
  "use strict";

  var DATA_URL = "./data/all.json";
  var MANUAL_URL = "./manual.json";
  var ARCANA_URL = "./data/arcana.json";
  var ILV_URL = "./data/ilv.json";       // 시뮬 상세 (수동 갱신, 캐릭터별)
  var TIERS_URL = "./data/tiers.json";   // 인벤 DB 단계 테이블
  var app = document.getElementById("app");
  var metaLine = document.getElementById("metaLine");
  var toggle = document.getElementById("viewToggle");

  var STATE = {
    data: null,
    manual: {},
    arcana: {},           // 아르카나 상세 (arcana.json)
    arcanaGeneratedAt: null,
    view: lsGet("aion2.view") || "table",
    tab: lsGet("aion2.tab") || "basic",       // basic | enhance | bt | pot | soul | wing
    sel: lsGet("aion2.sel") || null,          // 카드뷰 선택 캐릭터 key
    cardTab: lsGet("aion2.cardtab") || "gear", // gear | arcana
    potEdit: false,                           // 잠재력 편집 모드
    wingEdit: false,                          // 날개 편집 모드
    wings: [],                                // 날개 목록 (manual.json wings)
    ilv: {},                                  // 시뮬 상세 (ilv.json characters)
    tiers: {},                                // 인벤 단계 테이블 (tiers.json families)
  };

  // dow: 0=일 … 3=수 … 6=토 / hour: 리셋 시각(KST). 그 시각을 지나면 초기화.
  var CHECK_FIELDS = [
    { key: "hallway", label: "회랑", dow: 3, hour: 22 },
    { key: "once", label: "일회", dow: 6, hour: 22 },
    { key: "awaken", label: "각성", dow: 3, hour: 5 },
    { key: "rudra", label: "루드라", dow: 3, hour: 5 },
    { key: "erosion", label: "침식", dow: 3, hour: 5 },
    { key: "muspel", label: "무스펠", dow: 3, hour: 5 },
    { key: "grief", label: "비탄", dow: 3, hour: 5 },
    { key: "trial", label: "시련", dow: 3, hour: 5 },
  ];
  var BT_SLOTS = [
    ["MainHand", "무기"], ["SubHand", "가더"], ["Necklace", "목걸이"],
    ["Earring1", "귀걸이1"], ["Earring2", "귀걸이2"], ["Ring1", "반지1"], ["Ring2", "반지2"],
    ["Bracelet1", "팔찌1"], ["Bracelet2", "팔찌2"], ["Brooch1", "브로치1"], ["Brooch2", "브로치2"],
  ];

  // ---------- utils ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function N(n) { return (n == null || n === "" || isNaN(n)) ? "–" : Number(n).toLocaleString("ko-KR"); }
  function K(n) { return (n == null || isNaN(n)) ? "–" : Math.round(n / 1000).toLocaleString("ko-KR"); }
  function gradeCls(g) { return "grade " + (g || "Normal"); }

  function deltaHtml(v, opt) {
    opt = opt || {};
    if (v == null || v === 0) return "";
    var up = v > 0;
    var val = opt.k ? K(Math.abs(v)) : N(Math.abs(v));
    return ' <span class="delta ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") + val + "</span>";
  }
  function timeAgo(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 90) return "방금 전";
    var m = Math.floor(s / 60); if (m < 60) return m + "분 전";
    var h = Math.floor(m / 60); if (h < 48) return h + "시간 전";
    return Math.floor(h / 24) + "일 전";
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || "");
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // 지정 요일/시각(KST) 의 가장 최근 경계 → 기간 키. 그 경계를 지나면 값이 바뀌어 초기화됨.
  function periodKey(dow, hour) {
    var now = new Date();
    var kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
    var diff = (kst.getDay() - dow + 7) % 7;
    if (diff === 0 && kst.getHours() < hour) diff = 7;
    var a = new Date(kst);
    a.setDate(kst.getDate() - diff);
    a.setHours(hour, 0, 0, 0);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return a.getFullYear() + pad(a.getMonth() + 1) + pad(a.getDate()) + "-" + hour;
  }
  function fieldPk(f) { return periodKey(f.dow, f.hour); }
  var CUR_PKS = {};
  CHECK_FIELDS.forEach(function (f) { CUR_PKS[fieldPk(f)] = 1; });

  // ---------- Firebase (선택) — 없으면 localStorage 로 폴백 ----------
  var FB_CFG = window.AION2_FIREBASE || null;
  var fbdb = null, fbChecks = {}, fbOde = {}, fbPot = {}, fbWing = {};
  function fbActive() { return !!fbdb; }
  function skipRerender() {
    var a = document.activeElement;
    return a && a.classList && (a.classList.contains("ode-inp") ||
      a.classList.contains("pv") || a.classList.contains("pt-sel") ||
      a.classList.contains("wg-sel") || a.classList.contains("sim-inp"));
  }
  function fbInit() {
    if (!FB_CFG || !window.firebase || !FB_CFG.databaseURL) return;
    try {
      firebase.initializeApp(FB_CFG);
      fbdb = firebase.database();
      fbdb.ref("checks").on("value", function (s) {
        fbChecks = s.val() || {};
        if (STATE.data && !skipRerender()) render();
      });
      fbdb.ref("ode").on("value", function (s) {
        fbOde = s.val() || {};
        if (STATE.data && !skipRerender()) render();
      });
      fbdb.ref("pot").on("value", function (s) {
        fbPot = s.val() || {};
        if (STATE.data && !skipRerender()) render();
      });
      fbdb.ref("wing").on("value", function (s) {
        fbWing = s.val() || {};
        if (STATE.data && !skipRerender()) render();
      });
      // 지난 기간 체크 데이터 정리 (best effort)
      fbdb.ref("checks").once("value", function (s) {
        s.forEach(function (ch) { if (!CUR_PKS[ch.key]) ch.ref.remove(); });
      });
    } catch (e) { console.warn("Firebase 연결 실패, localStorage 로 폴백:", e); }
  }

  // 잠재력(단계/티어) 수동 값: Firebase 우선, 없으면 manual.json
  function potLsKey(charKey) { return "aion2.pot." + charKey; }
  function fbPotChar(charKey) {
    if (fbActive()) return fbPot[charKey] || {};
    try { return JSON.parse(lsGet(potLsKey(charKey)) || "{}"); } catch (e) { return {}; }
  }
  function getPot(c, slot) {
    var ov = fbPotChar(c.key)[slot];
    if (ov && (ov.v != null || ov.t != null)) return { v: ov.v == null ? "" : ov.v, t: ov.t || "" };
    var m = STATE.manual[c.label] || {};
    var v = (m.potential || {})[slot];
    return { v: (v == null ? "" : v), t: (m.potentialTier || {})[slot] || "" };
  }
  function setPot(charKey, slot, v, t) {
    var payload = { v: (v === "" ? null : v), t: (t || null) };
    if (fbActive()) { fbdb.ref("pot/" + charKey + "/" + slot).set(payload); return; }
    var all = fbPotChar(charKey);
    all[slot] = payload;
    lsSet(potLsKey(charKey), JSON.stringify(all));
  }

  // 날개 강화 수치: Firebase 우선, 없으면 manual.json. 값 = 숫자(강화) / "-"(미보유)
  function wingSafe(name) { return String(name).replace(/[.#$\[\]\/]/g, "_"); }
  function wingLsKey(charKey) { return "aion2.wing." + charKey; }
  function fbWingChar(charKey) {
    if (fbActive()) return fbWing[charKey] || {};
    try { return JSON.parse(lsGet(wingLsKey(charKey)) || "{}"); } catch (e) { return {}; }
  }
  function getWing(c, name) {
    var ov = fbWingChar(c.key)[wingSafe(name)];
    if (ov != null) return ov === "-" ? null : Number(ov);
    var v = (manualOf(c).wings || {})[name];
    return v == null ? null : Number(v);
  }
  function setWing(charKey, name, v) {
    var val = (v === "" || v == null) ? "-" : Number(v);
    if (fbActive()) { fbdb.ref("wing/" + charKey + "/" + wingSafe(name)).set(val); return; }
    var all = fbWingChar(charKey);
    all[wingSafe(name)] = val;
    lsSet(wingLsKey(charKey), JSON.stringify(all));
  }
  function wingTotal(c) {
    return STATE.wings.reduce(function (s, w) { return s + (getWing(c, w.name) || 0); }, 0);
  }

  // field 는 CHECK_FIELDS 항목(객체). 항목마다 리셋 주기가 다름.
  function checkKey(charKey, f) { return "aion2.chk." + fieldPk(f) + "." + charKey + "." + f.key; }
  function getCheck(charKey, f) {
    var pk = fieldPk(f);
    if (fbActive()) return !!(fbChecks[pk] && fbChecks[pk][charKey] && fbChecks[pk][charKey][f.key]);
    return lsGet(checkKey(charKey, f)) === "1";
  }
  function setCheck(charKey, f, on) {
    if (fbActive()) { fbdb.ref("checks/" + fieldPk(f) + "/" + charKey + "/" + f.key).set(!!on); return; }
    lsSet(checkKey(charKey, f), on ? "1" : "0");
  }
  function pruneOldChecks() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("aion2.chk.") === 0) {
          var pk = k.split(".")[2];
          if (!CUR_PKS[pk]) kill.push(k);
        }
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function odeKey(charKey) { return "aion2.ode." + charKey; }
  function setOde(charKey, raw) {
    var v = String(raw == null ? "" : raw).trim();
    if (fbActive()) { fbdb.ref("ode/" + charKey).set(v === "" ? null : Number(v)); return; }
    lsSet(odeKey(charKey), v);
  }
  function getOde(c) {
    if (fbActive()) {
      if (fbOde[c.key] != null && fbOde[c.key] !== "") return Number(fbOde[c.key]);
    } else {
      var ov = lsGet(odeKey(c.key));
      if (ov != null && ov !== "") return Number(ov);
    }
    var m = STATE.manual[c.label];
    return m && m.ode != null ? m.ode : null;
  }
  function potentialOf(c, slot) {
    var m = STATE.manual[c.label];
    if (!m || !m.potential) return "";
    var v = m.potential[slot];
    return (v == null) ? "" : v;
  }

  // ---------- load ----------
  Promise.all([
    fetch(DATA_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("all.json HTTP " + r.status); return r.json();
    }),
    fetch(MANUAL_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch(ARCANA_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch(ILV_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    fetch(TIERS_URL, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
  ]).then(function (res) {
    STATE.data = res[0];
    STATE.manual = (res[1] && res[1].characters) || {};
    STATE.wings = (res[1] && res[1].wings) || [];
    STATE.arcana = (res[2] && res[2].characters) || {};
    STATE.arcanaGeneratedAt = res[2] && res[2].generatedAt || null;
    STATE.ilv = (res[3] && res[3].characters) || {};
    STATE.tiers = (res[4] && res[4].families) || {};
    pruneOldChecks();
    if (!STATE.sel && STATE.data.characters[0]) STATE.sel = STATE.data.characters[0].key;
    render();
    fbInit();
  }).catch(function (e) {
    app.innerHTML = '<div class="err">데이터를 불러오지 못했습니다 (' + esc(e.message) + ").<br>" +
      "GitHub Actions 가 한 번 이상 실행되어 <code>docs/data/all.json</code> 이 생성되어야 합니다.</div>";
  });

  toggle.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    STATE.view = b.getAttribute("data-view");
    lsSet("aion2.view", STATE.view);
    render();
  });

  // ---------- render ----------
  function render() {
    if (!STATE.data) return;
    var chars = STATE.data.characters || [];
    Array.prototype.forEach.call(toggle.querySelectorAll("button"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === STATE.view);
    });
    var okCount = chars.filter(function (c) { return c.ok !== false; }).length;
    metaLine.innerHTML = "<b>" + chars.length + "명</b> · 마지막 수집 <b>" + esc(fmtDateTime(STATE.data.generatedAt)) +
      "</b> (" + esc(timeAgo(STATE.data.generatedAt)) + ")" +
      (okCount < chars.length ? " · <span style='color:var(--neg)'>수집 실패 " + (chars.length - okCount) + "명</span>" : "") +
      " · 체크/오드 저장: <b>" + (fbActive() ? "Firebase 동기화" : "이 브라우저") + "</b>";

    if (!chars.length) { app.innerHTML = '<div class="empty">characters.json 에 캐릭터를 추가하세요.</div>'; return; }

    app.innerHTML = "";
    app.appendChild(STATE.view === "card" ? renderCardView(chars) :
      STATE.view === "sim" ? renderSimView(chars) : renderTableView(chars));
  }

  /* =====================================================================
     표 뷰 — 기본 / 강화 / 돌파 / 잠재력 / 영혼각인
     정렬 없음. 행 순서는 항상 characters.json (= all.json) 순서.
     ===================================================================== */
  var TABS = [
    ["basic", "기본"], ["enhance", "강화"], ["bt", "돌파"],
    ["pot", "잠재력"], ["soul", "영혼각인"], ["wing", "날개"],
  ];
  var POT_SLOTS = BT_SLOTS; // 무기/가더/목/귀1/귀2/반1/반2/팔1/팔2/브1/브2

  function renderTableView(chars) {
    var box = el("div");
    var tabs = el("div", "subtabs");
    TABS.forEach(function (t) {
      var b = el("button", STATE.tab === t[0] ? "active" : "", esc(t[1]));
      b.addEventListener("click", function () { STATE.tab = t[0]; lsSet("aion2.tab", t[0]); render(); });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    var tab = STATE.tab;

    var scroll = el("div", "table-scroll");
    scroll.appendChild(
      tab === "enhance" ? enhanceTable(chars) :
      tab === "bt" ? breakthroughTable(chars) :
      tab === "pot" ? potentialTable(chars) :
      tab === "soul" ? soulTable(chars) :
      tab === "wing" ? wingTable(chars) :
      basicTable(chars)
    );
    box.appendChild(scroll);

    if (tab === "pot") {
      var pbar = el("div", "detail-bar pot-bar");
      var pbtn = el("button", "refresh-btn" + (STATE.potEdit ? " on" : ""),
        STATE.potEdit ? "편집 종료" : "정보 수정");
      pbtn.addEventListener("click", function () { STATE.potEdit = !STATE.potEdit; render(); });
      pbar.appendChild(pbtn);
      pbar.appendChild(el("span", "arc-upd", STATE.potEdit
        ? ("칸의 단계·티어를 바꾸면 즉시 저장됩니다 (" + (fbActive() ? "Firebase 동기화" : "이 브라우저") + ")")
        : "엑셀 기준값. 수정하려면 [정보 수정]"));
      box.appendChild(pbar);
    }

    if (tab === "wing") {
      var wbar = el("div", "detail-bar pot-bar");
      var wbtn = el("button", "refresh-btn" + (STATE.wingEdit ? " on" : ""),
        STATE.wingEdit ? "편집 종료" : "정보 수정");
      wbtn.addEventListener("click", function () { STATE.wingEdit = !STATE.wingEdit; render(); });
      wbar.appendChild(wbtn);
      wbar.appendChild(el("span", "arc-upd", STATE.wingEdit
        ? ("칸의 강화 수치를 바꾸면 즉시 저장됩니다 (" + (fbActive() ? "Firebase 동기화" : "이 브라우저") + ")")
        : "엑셀 날개 시트 기준값. 수정하려면 [정보 수정]"));
      box.appendChild(wbar);
    }

    if (tab === "soul") {
      var det = STATE.arcanaGeneratedAt;
      var bar = el("div", "detail-bar");
      bar.innerHTML =
        '<a class="refresh-btn" href="' + esc(actionsUrl("arcana.yml")) + '" target="_blank" rel="noopener">상세 갱신 ↗</a>' +
        (det ? '<span class="arc-upd">상세 수집 ' + esc(fmtDateTime(det)) + " (" + esc(timeAgo(det)) + ")</span>"
             : '<span class="arc-upd">상세 미수집 — [상세 갱신] 을 눌러 한 번 수집하세요</span>');
      box.appendChild(bar);
    }

    var note = el("p", "tbl-note");
    if (tab === "basic")
      note.innerHTML = "체크박스 자동 초기화(KST): <b>회랑</b> 수 22시 · <b>일회</b> 토 22시 · <b>각성·루드라·침식·무스펠·비탄·시련</b> 수 05시. " +
        "저장 위치는 상단 표시(Firebase 동기화 / 이 브라우저). 오드 값은 칸을 눌러 수정.";
    else if (tab === "bt")
      note.innerHTML = "돌파 단계는 공식 API 에서 매일 자동 갱신됩니다. 색: 0 회색 · 1 초록 · 2 파랑 · 3 주황 · 4 빨강 · 5 진한 검정.";
    else if (tab === "pot")
      note.innerHTML = "왼쪽 = 부위별 잠재력 <b>단계</b>(0~4), 칸 색 = 티어 " + potLegendHtml() +
        " 오른쪽 = 4단계까지 <b>남은 재화</b>를 티어별로 합산 (단계 상승 비용 — 영웅 2·4·6·8, 유일 1·2·3·4).";
    else if (tab === "wing")
      note.innerHTML = "보유 날개의 <b>강화 수치 합</b>이 아이템 레벨에 그대로 더해집니다 (강화 1 = 템렙 1). " +
        "<b>·</b> 미보유 · <b>0</b> 보유(미강화) · <span style='color:var(--muted-2)'>10</span> 최대 강화(회색). 맨 윗줄 = 날개 템렙 합 (시뮬 탭에서 사용).";
    else if (tab === "soul")
      note.innerHTML = "영혼각인(방어구 subStats)은 <b>수동 갱신</b>입니다. [상세 갱신] → GitHub Actions 에서 Run workflow. " +
        "머리행 구분이 해당 부위에 각인돼 있으면 <b>O</b>. " +
        "<b>공증</b>=공격력 증가 · <b>피증</b>=피해 증폭 · <b>치피증</b>=치명타 피해 증폭 · <b>피내</b>=피해 내성 · <b>전속</b>=전투 속도 · <b>이속</b>=이동 속도 · 강타 · 완벽";
    else
      note.innerHTML = "데바니온 · 스티그마는 공식 API 에서 매일 자동 갱신됩니다. 표에서는 증감을 표시하지 않습니다.";
    box.appendChild(note);
    return box;
  }

  // table-layout:fixed 용 colgroup — 열 너비의 단일 기준
  function makeCols(cols) {
    var cg = el("colgroup");
    cols.forEach(function (c) { cg.appendChild(el("col", c.cls || "")); });
    return cg;
  }
  // 정렬 없는 단순 헤더
  function headerRow(cols) {
    var tr = el("tr");
    cols.forEach(function (col) {
      var th = el("th", col.cls || "", esc(col.label));
      if (col.title) th.title = col.title;
      tr.appendChild(th);
    });
    return tr;
  }
  // 그룹 헤더 (colspan). specs = [{span, label, grp}]
  function groupRow(specs) {
    var tr = el("tr", "grouprow");
    specs.forEach(function (s) {
      var th = el("th", (s.grp ? "grp" : "") + (s.left ? " l" : ""), s.label ? esc(s.label) : "");
      if (s.span > 1) th.colSpan = s.span;
      tr.appendChild(th);
    });
    return tr;
  }
  function td(html, cls, title) {
    var n = el("td", cls || "", html);
    if (title) n.title = title;
    return n;
  }
  function nameCell(c) {
    return td('<span class="cn">' + esc(c.profile.name || c.label) +
      (c.label && c.label !== c.profile.name ? ' <span class="lbl">' + esc(c.label) + "</span>" : "") +
      (c.ok === false ? ' <span class="badge-fail">실패</span>' : "") + "</span>", "l name");
  }
  function classCell(c) { return td(esc(c.profile.className || "–"), "l cls"); }
  function gradeBySlot(c) {
    var m = {};
    (c.equipment || []).forEach(function (e) { m[e.slot] = e.grade; });
    return m;
  }
  // 등급 → 색 클래스 (영웅=Epic 붉은색, 유일=Unique 노란색)
  function gcol(grade) {
    if (grade === "Epic") return "gcol-epic";
    if (grade === "Unique") return "gcol-unique";
    return "gcol-other";
  }
  // 잠재력 티어 코드 → 배경색 클래스 (엑셀 부캐영각 색상 그대로)
  var PT_CODES = { E3: 1, E4: 1, E5: 1, U4: 1, U5: 1, U6: 1 };
  function ptClass(code) { return PT_CODES[code] ? "pt pt-" + code : ""; }
  function ptLabel(code) {
    return { E3: "영웅3", E4: "영웅4", E5: "영웅5", U4: "유일4", U5: "유일5", U6: "유일6" }[code] || "";
  }
  function manualOf(c) { return STATE.manual[c.label] || {}; }
  function fmtManual(v) { return (v === "" || v == null) ? "·" : esc(String(v)); }

  // ---- 기본 ----
  function basicTable(chars) {
    var cols = [
      { label: "이름", cls: "l name" }, { label: "직업", cls: "l cls" },
      { label: "아이템레벨", cls: "num" }, { label: "전투력", cls: "num" }, { label: "오드현황", cls: "num" },
    ];
    var DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
    CHECK_FIELDS.forEach(function (f) {
      cols.push({ label: f.label, cls: "chk", title: f.label + " · " + DOW_KO[f.dow] + " " + f.hour + "시(KST) 초기화" });
    });

    var t = el("table", "grid");
    t.appendChild(makeCols(cols));
    var thead = el("thead"); thead.appendChild(headerRow(cols)); t.appendChild(thead);
    var tb = el("tbody");
    chars.forEach(function (c) {
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      tr.appendChild(td(N(c.profile.itemLevel), "num"));
      tr.appendChild(td(N(c.profile.combatPower), "num"));

      var odeTd = td("", "num ode");
      var inp = el("input", "ode-inp");
      inp.type = "number";
      inp.value = (getOde(c) == null ? "" : getOde(c));
      inp.placeholder = "–";
      inp.addEventListener("change", function () { setOde(c.key, inp.value); });
      odeTd.appendChild(inp);
      tr.appendChild(odeTd);

      CHECK_FIELDS.forEach(function (f) {
        var cell = td("", "chk");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = getCheck(c.key, f);
        if (cb.checked) cell.classList.add("on");
        cb.addEventListener("change", function () {
          setCheck(c.key, f, cb.checked);
          cell.classList.toggle("on", cb.checked);
        });
        cell.appendChild(cb);
        tr.appendChild(cell);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- 강화 (데바니온 + 스티그마) ----
  function enhanceTable(chars) {
    var cols = [{ label: "이름", cls: "l name" }, { label: "직업", cls: "l cls" },
      { label: "기본", cls: "num" }, { label: "아리엘", cls: "num" },
      { label: "마르쿠탄", cls: "num" }, { label: "유스티엘", cls: "num" }];
    for (var i = 1; i <= 6; i++) cols.push({ label: "" + i, cls: "sm" });

    var t = el("table", "grid");
    t.appendChild(makeCols(cols));
    var thead = el("thead");
    thead.appendChild(groupRow([
      { span: 2 },
      { span: 4, label: "데바니온", grp: true },
      { span: 6, label: "상위 스티그마 6", grp: true },
    ]));
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var d = c.daevanion || {};
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      tr.appendChild(td(N(d.basic), "num"));
      tr.appendChild(td(N(d.arielle), "num"));
      tr.appendChild(td(N(d.markutan), "num"));
      tr.appendChild(td(N(d.yustiel), "num"));
      for (var i = 0; i < 6; i++) {
        var st = c.stigma[i];
        tr.appendChild(td(st ? N(st.level) : "–", "num sm", st ? st.name : ""));
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- 돌파 (자동) ----
  function breakthroughTable(chars) {
    var cols = [{ label: "이름", cls: "l name" }, { label: "직업", cls: "l cls" }];
    BT_SLOTS.forEach(function (s) { cols.push({ label: s[1], cls: "sm" }); });
    cols.push({ label: "팬던트", cls: "sm" });

    var t = el("table", "grid");
    t.appendChild(makeCols(cols));
    var thead = el("thead");
    thead.appendChild(groupRow([
      { span: 2 },
      { span: 11, label: "돌파 단계", grp: true },
      { span: 1, label: "강화", grp: true },
    ]));
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      BT_SLOTS.forEach(function (sl) {
        var v = c.breakthrough && c.breakthrough.bySlot ? c.breakthrough.bySlot[sl[0]] : null;
        tr.appendChild(td(v == null ? "–" : String(v), "num sm ex ex-" + v));
      });
      var pe = c.breakthrough ? c.breakthrough.pendantEnchant : null;
      tr.appendChild(td(pe == null ? "–" : "+" + pe, "num sm"));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- 잠재력 (manual.json, 엑셀값) ----
  // 단계 상승 비용: 영웅 [2,4,6,8], 유일 [1,2,3,4] (1→4단계). 남은 비용 = 현재단계 이후 합.
  var POT_STEP = { E: [2, 4, 6, 8], U: [1, 2, 3, 4] };
  function needFor(code, cur) {
    if (!code) return { tier: 0, need: 0 };
    var steps = POT_STEP[code[0]] || POT_STEP.U;
    var tier = Number(code.slice(1)) || 0;
    var lvl = (cur === "" || cur == null || cur === "-") ? NaN : Number(cur);
    if (isNaN(lvl) || lvl >= 4) return { tier: tier, need: 0 };
    var s = 0;
    for (var i = Math.max(0, lvl); i < 4; i++) s += steps[i];
    return { tier: tier, need: s };
  }
  var NEED_TIERS = [3, 4, 5, 6];

  var POT_V_OPTS = [["", "·"], ["-", "–"], ["0", "0"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]];
  var POT_T_OPTS = [["", "–"], ["E3", "영웅3"], ["E4", "영웅4"], ["E5", "영웅5"],
    ["U4", "유일4"], ["U5", "유일5"], ["U6", "유일6"]];
  function mkSelect(cls, opts, cur, onChange) {
    var s = el("select", cls);
    opts.forEach(function (o) {
      var op = el("option", null, o[1]);
      op.value = o[0];
      if (String(cur) === o[0]) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  function potentialTable(chars) {
    var edit = STATE.potEdit;
    var cols = [{ label: "이름", cls: "l name" }, { label: "직업", cls: "l cls" }];
    POT_SLOTS.forEach(function (s) { cols.push({ label: s[1], cls: edit ? "med" : "sm" }); });
    NEED_TIERS.forEach(function (n) { cols.push({ label: n + "티어", cls: "sm" }); });

    var t = el("table", "grid" + (edit ? " edit" : ""));
    t.appendChild(makeCols(cols));
    var thead = el("thead");
    thead.appendChild(groupRow([
      { span: 2 },
      { span: 11, label: "부위별 잠재력 단계" + (edit ? " (수정 중)" : ""), grp: true },
      { span: 4, label: "티어별 필요 재화", grp: true },
    ]));
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var need = { 3: 0, 4: 0, 5: 0, 6: 0 };
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      POT_SLOTS.forEach(function (sl) {
        var slot = sl[0];
        var cur = getPot(c, slot);
        var code = cur.t || "";
        if (edit) {
          var cell = td("", "med pt-edit " + ptClass(code));
          cell.appendChild(mkSelect("pv", POT_V_OPTS, cur.v == null ? "" : cur.v, function (val) {
            setPot(c.key, slot, val, getPot(c, slot).t); render();
          }));
          cell.appendChild(mkSelect("pt-sel", POT_T_OPTS, code, function (val) {
            setPot(c.key, slot, getPot(c, slot).v, val); render();
          }));
          tr.appendChild(cell);
        } else {
          var shown = (cur.v === "" || cur.v == null) ? "·" : (cur.v === "-" ? "–" : String(cur.v));
          tr.appendChild(td("<b>" + esc(shown) + "</b>", "num sm " + ptClass(code), ptLabel(code)));
        }
        var r = needFor(code, cur.v);
        if (r.tier && need.hasOwnProperty(r.tier)) need[r.tier] += r.need;
      });
      NEED_TIERS.forEach(function (n) {
        var val = need[n];
        tr.appendChild(td(val ? "<b>" + val + "</b>" : '<span class="soul-off">·</span>', "num sm"));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- 영혼각인 (방어구 subStats, 수동 갱신 arcana.json) ----
  // 부위별 추적 각인 구분 (7명 실제 데이터 기준 고정 라인)
  var SOUL_GRID = [
    { slot: "Helmet", ko: "투구", stats: ["공증", "강타"] },
    { slot: "Shoulder", ko: "견갑", stats: ["치피증"] },
    { slot: "Torso", ko: "상의", stats: ["피증"] },
    { slot: "Pants", ko: "하의", stats: ["공증", "완벽", "피내"] },
    { slot: "Gloves", ko: "장갑", stats: ["전속", "완벽"] },
    { slot: "Boots", ko: "신발", stats: ["이속", "완벽"] },
    { slot: "Cape", ko: "망토", stats: ["공증", "강타", "완벽"] },
  ];
  var SOUL_FULL = {
    "공증": "공격력 증가", "강타": "강타", "피증": "피해 증폭",
    "치피증": "치명타 피해 증폭", "피내": "피해 내성",
    "전속": "전투 속도", "이속": "이동 속도", "완벽": "완벽",
  };

  function soulTable(chars) {
    var flat = [];
    SOUL_GRID.forEach(function (g) { g.stats.forEach(function (ab) { flat.push([g.slot, g.ko, ab]); }); });

    var cols = [{ label: "이름", cls: "l name" }, { label: "직업", cls: "l cls" }];
    flat.forEach(function (p) { cols.push({ label: p[2], cls: "chk", title: p[1] + " · " + (SOUL_FULL[p[2]] || p[2]) }); });

    var t = el("table", "grid");
    t.appendChild(makeCols(cols));
    var thead = el("thead");
    var specs = [{ span: 2 }];
    SOUL_GRID.forEach(function (grp) { specs.push({ span: grp.stats.length, label: grp.ko, grp: true }); });
    thead.appendChild(groupRow(specs));
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var det = STATE.arcana[c.key];
      var bySlot = {}, gradeSlot = {};
      ((det && det.soul) || []).forEach(function (s) {
        bySlot[s.slot] = (s.subStats || []).map(function (x) { return x.name; });
        gradeSlot[s.slot] = s.grade;
      });
      var gm = gradeBySlot(c);
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      flat.forEach(function (p) {
        var names = bySlot[p[0]];
        if (!names) { tr.appendChild(td('<span class="soul-off">·</span>', "chk soul")); return; }
        var gc = gcol(gradeSlot[p[0]] || gm[p[0]]);
        var on = names.indexOf(SOUL_FULL[p[2]] || p[2]) >= 0;
        tr.appendChild(td(on ? "O" : '<span class="soul-off">·</span>',
          "chk soul " + gc + (on ? " on" : ""), p[1] + " · " + (SOUL_FULL[p[2]] || p[2])));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  // ---- 날개 (manual.json + Firebase 수정값) ----
  var WING_OPTS = [["", "·"]];
  for (var _w = 0; _w <= 10; _w++) WING_OPTS.push(["" + _w, "" + _w]);
  function wingGradeCls(g) {
    return { "유일": "gcol-unique", "전승": "wg-legend", "희귀": "wg-rare" }[g] || "gcol-other";
  }
  // 등급 내림차순 (같은 등급은 엑셀 순서 유지)
  var WING_RANK = { "유일": 0, "전승": 1, "희귀": 2, "일반": 3 };
  function sortedWings() {
    return STATE.wings.map(function (w, i) { return { w: w, i: i }; }).sort(function (a, b) {
      var ra = WING_RANK[a.w.grade], rb = WING_RANK[b.w.grade];
      return (ra == null ? 9 : ra) - (rb == null ? 9 : rb) || a.i - b.i;
    }).map(function (x) { return x.w; });
  }
  function wingTable(chars) {
    var edit = STATE.wingEdit;
    var cols = [{ label: "등급", cls: "chk" }, { label: "날개", cls: "l wname" }, { label: "강화효과", cls: "l weff" }];
    chars.forEach(function (c) { cols.push({ label: c.label || c.profile.name, cls: "sm" }); });

    var t = el("table", "grid" + (edit ? " edit" : ""));
    t.appendChild(makeCols(cols));
    var thead = el("thead");
    thead.appendChild(groupRow([{ span: 3 },
      { span: chars.length, label: "캐릭터별 강화 수치" + (edit ? " (수정 중)" : ""), grp: true }]));
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    var sum = el("tr", "wing-sum");
    sum.appendChild(td("", "chk"));
    sum.appendChild(td("날개 템렙 합", "l"));
    sum.appendChild(td("", "l"));
    chars.forEach(function (c) { sum.appendChild(td("<b>" + N(wingTotal(c)) + "</b>", "num sm")); });
    tb.appendChild(sum);

    sortedWings().forEach(function (w) {
      var tr = el("tr");
      tr.appendChild(td(esc(w.grade), "chk " + wingGradeCls(w.grade)));
      tr.appendChild(td(esc(w.name), "l", w.name));
      tr.appendChild(td(esc(w.effect || ""), "l weff", w.effect || ""));
      chars.forEach(function (c) {
        var v = getWing(c, w.name);
        if (edit) {
          var cell = td("", "sm pt-edit");
          cell.appendChild(mkSelect("wg-sel", WING_OPTS, v == null ? "" : String(v), function (val) {
            setWing(c.key, w.name, val); render();
          }));
          tr.appendChild(cell);
        } else {
          tr.appendChild(td(v == null ? '<span class="soul-off">·</span>' : String(v),
            "num sm" + (v === 10 ? " wg-max" : "")));
        }
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return t;
  }

  /* =====================================================================
     카드 뷰 — 캐릭터 선택형
     ===================================================================== */
  function renderCardView(chars) {
    var box = el("div", "cardview");

    var picker = el("div", "picker");
    chars.forEach(function (c) {
      var b = el("button", c.key === STATE.sel ? "active" : "", esc(c.label || c.profile.name) +
        (c.ok === false ? ' <span class="badge-fail">!</span>' : ""));
      b.addEventListener("click", function () { STATE.sel = c.key; lsSet("aion2.sel", c.key); render(); });
      picker.appendChild(b);
    });
    box.appendChild(picker);

    var c = chars.filter(function (x) { return x.key === STATE.sel; })[0] || chars[0];

    var sub = el("div", "subtabs card-subtabs");
    [["gear", "장비"], ["arcana", "아르카나"]].forEach(function (t) {
      var b = el("button", STATE.cardTab === t[0] ? "active" : "", esc(t[1]));
      b.addEventListener("click", function () { STATE.cardTab = t[0]; lsSet("aion2.cardtab", t[0]); render(); });
      sub.appendChild(b);
    });
    box.appendChild(sub);

    var body = el("div", "card-body" + (STATE.cardTab === "arcana" ? " arcana-mode" : ""));
    body.innerHTML = STATE.cardTab === "arcana" ? cardArcanaTab(c) : cardGearTab(c);
    box.appendChild(body);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(body.querySelectorAll(".bar > i"), function (i) { i.style.width = i.getAttribute("data-w") + "%"; });
    });
    return box;
  }

  // 방어구 구획: 방어구 7부위 → 허리띠 → 아뮬렛 → 팬던트 → 룬1 → 룬2 순
  var CARD_ARMOR_ORDER = ["Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape",
    "Belt", "Amulet", "Pendant", "Rune1", "Rune2"];
  var CARD_ARMOR = {};
  CARD_ARMOR_ORDER.forEach(function (s) { CARD_ARMOR[s] = 1; });

  function cheadHtml(c) {
    var p = c.profile || {};
    return '<div class="chead">' +
      '<div class="c-name">' + esc(p.name || c.label) +
        (c.label && c.label !== p.name ? ' <span class="lbl">' + esc(c.label) + "</span>" : "") + "</div>" +
      '<div class="c-tags">' +
        tag(p.className) + tag(p.raceName) + (p.guildName ? tag(p.guildName) : "") +
        wingTag(c) +
        (c.ok === false ? '<span class="badge-fail">수집실패</span>' : "") +
      "</div>" +
      '<a class="c-link" href="' + esc(c.officialUrl) + '" target="_blank" rel="noopener">공식 페이지 ↗</a>' +
      "</div>";
  }

  function potLegendHtml() {
    return '<span class="pot-legend">' + [["E3", "영웅3"], ["E4", "영웅4"], ["E5", "영웅5"],
      ["U4", "유일4"], ["U5", "유일5"], ["U6", "유일6"]].map(function (x) {
      return '<span class="pt pt-' + x[0] + '">' + x[1] + "</span>";
    }).join("") + "</span>";
  }

  function gearRowHtml(c, e) {
    var pp = getPot(c, e.slot);
    var potBadge = "";
    if (pp.v === "-") {
      potBadge = '<span class="g-pot g-pot-none">잠재 -</span>';
    } else if (pp.v !== "" && pp.v != null) {
      potBadge = '<span class="g-pot ' + ptClass(pp.t) + '" title="' + esc(ptLabel(pp.t)) + '">잠재 ' + esc(String(pp.v)) + "</span>";
    }
    return '<div class="gear ' + gradeCls(e.grade) + '">' +
      '<div class="g-ic">' + (e.icon ? '<img loading="lazy" alt="" src="' + esc(e.icon) + '">' : "") + "</div>" +
      '<div class="g-main">' +
        '<div class="g-slot">' + esc(e.slotKo || e.slot) + "</div>" +
        '<div class="g-name">' + esc(e.name || "–") + "</div>" +
      "</div>" +
      '<div class="g-nums">' +
        '<span class="g-en">+' + (e.enchant || 0) + "</span>" +
        (e.exceed ? '<span class="g-ex">' + e.exceed + "돌파</span>" : "") +
        potBadge +
      "</div>" +
      "</div>";
  }

  // ---- 카드: 장비 탭 ----
  function cardGearTab(c) {
    var p = c.profile || {}, ex = c.exceed || {}, d = c.daevanion || {}, dl = c.delta || {};
    function kpiCells(rows) {
      return rows.map(function (r) {
        return '<div class="kpi"><div class="k">' + esc(r[0]) + '</div><div class="v">' + r[1] + (r[2] || "") + "</div></div>";
      }).join("");
    }
    var kpisTop = kpiCells([
      ["아이템 레벨", N(p.itemLevel), deltaHtml(dl.itemLevel)],
      ["전투력", N(p.combatPower) + ' <small>(' + K(p.combatPower) + "k)</small>", deltaHtml(dl.combatPower, { k: true })],
      ["데바니온(기본)", N(d.basic) + ' <small>+유스 ' + N(d.yustiel) + "</small>", deltaHtml(dl.daevanionBasic)],
    ]);
    var kpisBt = kpiCells([
      ["무기 + 가더 돌파", N(ex.weapon.total), deltaHtml(dl.weaponExceed)],
      ["방어구 돌파", N(ex.armor.total), deltaHtml(dl.armorExceed)],
      ["악세서리 돌파", N(ex.accessory.total), deltaHtml(dl.accessoryExceed)],
    ]);

    var gearAll = (c.equipment || []).filter(function (e) { return !e.isArcana; });
    var bySlot = {};
    gearAll.forEach(function (e) { bySlot[e.slot] = e; });
    var armor = CARD_ARMOR_ORDER.map(function (s) { return bySlot[s]; }).filter(Boolean);
    var wacc = gearAll.filter(function (e) { return !CARD_ARMOR[e.slot]; });
    var waHtml = wacc.map(function (e) { return gearRowHtml(c, e); }).join("");
    var arHtml = armor.map(function (e) { return gearRowHtml(c, e); }).join("");

    var stigmaChips = (c.stigma || []).map(function (s) {
      return '<span class="stig">' + esc(s.name) + ' <b>' + N(s.level) + "</b></span>";
    }).join("");

    var boards = (d.boards || []).map(function (b) {
      var pct = b.totalNodeCount ? Math.round((b.openNodeCount / b.totalNodeCount) * 100) : (b.openPercent || 0);
      var basic = ["네자칸", "지켈", "바이젤", "트리니엘"].indexOf(b.name) >= 0;
      return '<div class="drow' + (basic ? " basic" : "") + '">' +
        '<span class="dn">' + esc(b.name) + (basic ? ' <em>기본</em>' : "") + "</span>" +
        '<span class="bar"><i data-w="' + pct + '" style="width:0%"></i></span>' +
        '<span class="dc">' + N(b.openNodeCount) + " / " + N(b.totalNodeCount) + "</span>" +
        "</div>";
    }).join("");

    return (
      '<section class="cbox">' + cheadHtml(c) +
        '<div class="kpis">' + kpisTop + "</div>" +
        '<div class="kpis-label">분야별 돌파</div>' +
        '<div class="kpis bt">' + kpisBt + "</div>" +
        (dl && dl.sinceDate ? '<div class="since">▲▼ ' + esc(dl.sinceDate) + " 대비 증감</div>" : "") +
      "</section>" +

      '<section class="cbox">' +
        "<h3>무기 · 가더 · 악세서리 <span class=\"cnt\">" + wacc.length + "</span></h3>" +
        '<div class="gear-list">' + (waHtml || '<p class="muted">–</p>') + "</div>" +
      "</section>" +

      '<section class="cbox">' +
        "<h3>방어구 <span class=\"cnt\">" + armor.length + "</span></h3>" +
        '<div class="gear-list">' + (arHtml || '<p class="muted">–</p>') + "</div>" +
      "</section>" +

      '<div class="cbox-stack">' +
        '<section class="cbox">' +
          "<h3>데바니온 <span class=\"cnt\">" + d.openedBoards + " / " + d.totalBoards + "</span> " +
          "<small>개방 노드 " + N(d.openNodeTotal) + " / " + N(d.nodeTotal) + "</small></h3>" +
          '<div class="daev">' + boards + "</div>" +
        "</section>" +
        (stigmaChips
          ? '<section class="cbox"><h3>상위 스티그마</h3><div class="stig-list">' + stigmaChips + "</div></section>"
          : "") +
      "</div>" +

      '<section class="cbox">' +
        "<h3>잠재력 <small>장비 칸의 [잠재] 배지 색 = 티어</small></h3>" +
        potLegendHtml() +
      "</section>"
    );
  }

  // ---- 카드: 아르카나 탭 ----
  function cardArcanaTab(c) {
    var arc = c.arcana || [];
    var arcEnchTotal = arc.reduce(function (s, a) { return s + (a.enchant || 0); }, 0);
    var det = STATE.arcana[c.key];
    var detBySlot = {};
    ((det && det.arcana) || []).forEach(function (a) { detBySlot[a.slot] = a; });

    var arcHtml = arc.map(function (a) {
      var dd = detBySlot[a.slot];
      var head = '<div class="a-head">' +
        '<div class="a-ic">' + (a.icon ? '<img loading="lazy" alt="" src="' + esc(a.icon) + '">' : "") + "</div>" +
        '<div class="a-name">' + esc(a.name || a.slotKo) +
          (dd && dd.category ? ' <span class="a-cat">' + esc(dd.category) + "</span>" : "") + "</div>" +
        '<div class="a-en">+' + (a.enchant || 0) + (dd && dd.maxEnchant ? " <small>/ " + dd.maxEnchant + "</small>" : "") + "</div>" +
        "</div>";
      var body = "";
      if (dd) {
        var ms = (dd.mainStats || []).map(function (s) {
          return '<div class="a-stat">' + esc(s.name) + " <b>" + esc(s.value) + "</b>" +
            (s.extra && s.extra !== "0" ? ' <span class="a-extra">(+' + esc(s.extra) + ")</span>" : "") + "</div>";
        }).join("");
        var sk = (dd.subSkills || []).map(function (s) {
          return '<div class="a-skill">' + (s.icon ? '<img alt="" src="' + esc(s.icon) + '">' : "") +
            "<span>" + esc(s.name) + "</span> <b>Lv." + N(s.level) + "</b></div>";
        }).join("");
        body = '<div class="a-detail"><div class="a-stats">' + ms + "</div>" +
          (sk ? '<div class="a-skills">' + sk + "</div>" : "") + "</div>";
      }
      return '<div class="arc ' + gradeCls(a.grade) + (dd ? " has-detail" : "") + '">' + head + body + "</div>";
    }).join("");

    var arcMeta = det && det.updatedAt
      ? '<span class="arc-upd">상세 수집 ' + esc(fmtDateTime(det.updatedAt)) + " (" + esc(timeAgo(det.updatedAt)) + ")</span>"
      : '<span class="arc-upd">상세 미수집 — [상세 갱신] 을 눌러 한 번 수집하세요</span>';

    return (
      '<section class="cbox">' + cheadHtml(c) + "</section>" +
      '<section class="cbox">' +
        '<div class="arc-top">' +
          "<h3>아르카나 <span class=\"cnt\">" + arc.length + "</span> <small>강화 합계 +" + arcEnchTotal + "</small></h3>" +
          '<a class="refresh-btn" href="' + esc(actionsUrl("arcana.yml")) + '" target="_blank" rel="noopener">상세 갱신 ↗</a>' +
        "</div>" +
        '<div class="arc-meta">' + arcMeta + "</div>" +
        '<div class="arc-list grid6">' + (arcHtml || '<p class="muted">착용한 아르카나가 없습니다.</p>') + "</div>" +
      "</section>" +
      skillMatrixSection(det, c.skills || {})
    );
  }

  var SKILL_SRC = ["성배", "양피지", "나침반", "종", "거울", "천칭"];
  // 스킬명 매칭용 정규화 (공백/구두점 차이 흡수)
  function skKey(s) { return String(s || "").replace(/[\s:·]/g, ""); }
  function skillMatrixSection(det, skillTotals) {
    if (!det || !(det.arcana || []).length) return "";
    var totByKey = {};
    Object.keys(skillTotals || {}).forEach(function (n) { totByKey[skKey(n)] = skillTotals[n]; });

    var bySrc = {};
    SKILL_SRC.forEach(function (s) { bySrc[s] = {}; });
    (det.arcana || []).forEach(function (a) {
      if (bySrc[a.category]) (a.subSkills || []).forEach(function (s) { bySrc[a.category][s.name] = s.level || 0; });
    });
    var eqSk = det.equipSkills || {};
    var names = {};
    SKILL_SRC.forEach(function (s) { Object.keys(bySrc[s]).forEach(function (n) { names[n] = 1; }); });
    Object.keys(eqSk).forEach(function (n) { names[n] = 1; });
    var rows = Object.keys(names).map(function (n) {
      var vals = SKILL_SRC.map(function (s) { return bySrc[s][n] || 0; });
      var eq = eqSk[n] || 0;
      var lvl = totByKey[skKey(n)];
      var active = !!(bySrc["양피지"][n] || bySrc["나침반"][n]);
      return {
        name: n, vals: vals, eq: eq, active: active,
        total: vals.reduce(function (a, b) { return a + b; }, 0) + eq,
        lvl: (lvl == null ? null : lvl),
        hi: active && lvl != null && lvl >= 20,
      };
    }).sort(function (a, b) {
      return (b.active - a.active) || (b.lvl || 0) - (a.lvl || 0) || b.total - a.total || a.name.localeCompare(b.name, "ko");
    });
    if (!rows.length) return "";

    var colSpan = 1 + SKILL_SRC.length + 3;
    var head = "<tr><th>스킬</th>" + SKILL_SRC.map(function (s) { return "<th>" + esc(s) + "</th>"; }).join("") +
      "<th>장비</th><th>합계</th><th>총 레벨</th></tr>";
    function grpRow(label) {
      return '<tr class="skill-grp"><td colspan="' + colSpan + '">' + label + "</td></tr>";
    }
    var body = "", prevActive = null;
    rows.forEach(function (r) {
      if (r.active !== prevActive) {
        body += grpRow(r.active ? "액티브 (양피지 · 나침반)" : "패시브 (종 · 거울 등)");
        prevActive = r.active;
      }
      var cells = r.vals.map(function (v) { return '<td class="' + (v ? "" : "z") + '">' + (v || "·") + "</td>"; }).join("");
      body += "<tr><td>" + esc(r.name) + "</td>" + cells +
        '<td class="' + (r.eq ? "" : "z") + '">' + (r.eq || "·") + "</td>" +
        '<td class="tot">' + r.total + "</td>" +
        '<td class="lvl' + (r.hi ? " skill-hi" : "") + '">' + (r.lvl == null ? "·" : r.lvl) + "</td></tr>";
    });

    return '<section class="cbox">' +
      "<h3>아르카나 스킬 현황 <small>종·거울 포함 · 장비=장착장비 영혼각인 스킬 합계 · 총 레벨=공식 스킬 레벨</small></h3>" +
      '<div style="overflow-x:auto"><table class="skill-mat"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" +
      '<p class="muted" style="margin:6px 0 0;font-size:11px">액티브(양피지·나침반) 스킬이 20 이상이면 <b style="color:#2f6ef0">파란색</b>. 종·거울(패시브)은 검정색.</p>' +
      "</section>";
  }

  /* =====================================================================
     시뮬 뷰 — 아이템레벨 시뮬레이터
     템렙 = Σ(기본레벨 + 강화 + 돌파×5 + 마석 + 신석) + 데바니온 노드 + 날개 강화 합 (+ 보정)
     마석/데바니온: 흰1 · 초록2 · 파랑3 · 노랑4 / 신석: 초록1 · 파랑2
     API 등급명: Common=흰 · Rare=초록 · Legend(전승)=파랑 · Unique(유일)=노랑
     상세(기본레벨·마석·노드 등급)는 ilv.json (수동 갱신), 단계 목록은 tiers.json (인벤 DB) + 착용템.
     ===================================================================== */
  var ILV_W = { Common: 1, Rare: 2, Legend: 3, Unique: 4 };
  var GOD_W = { Rare: 1, Legend: 2 };
  var STONE_MID = 2.5; // 시뮬에서 새로 바꾼 아이템의 마석 1줄 = 중간값
  var GRADE_KO = { Epic: "영웅", Unique: "유일", Legend: "전승", Rare: "희귀", Special: "특별", Common: "일반" };
  var SIM_SLOT_KO = { Amulet: "아뮬렛", Seal1: "인장1", Seal2: "인장2" };
  // 등급별 강화/돌파 상한 기본값 (착용템 실측값이 있으면 그걸 우선)
  var EN_DEFAULT = {
    gear: { Epic: [20, 5], Unique: [15, 5], Legend: [15, 5], Rare: [10, 0] },
    belt: { Epic: [10, 0], Unique: [10, 0], Legend: [10, 0], Rare: [10, 0] },
    pendant: { Unique: [20, 0], Legend: [15, 0], Rare: [10, 0] },
    rune: { Special: [10, 0] },
    arcana: { Unique: [5, 0], Epic: [5, 0] },
  };

  function stoneSum(e) { return (e.stones || []).reduce(function (s, g) { return s + (ILV_W[g] || 0); }, 0); }
  function godSum(e) { return (e.godStones || []).reduce(function (s, g) { return s + (GOD_W[g] || 0); }, 0); }
  function itemIlv(e) {
    return (e.baseLevel || 0) + (e.enchant || 0) + 5 * (e.exceed || 0) + stoneSum(e) + godSum(e);
  }
  // 현재 장비(all.json, 매일) + 상세(ilv.json). 상세 수집 이후 아이템이 바뀐 슬롯은 stale.
  function ilvEquip(c) {
    var det = (STATE.ilv[c.key] || {}).items || {};
    return (c.equipment || []).map(function (e) {
      var d = det[e.slot];
      var x = {};
      for (var k in e) x[k] = e[k];
      if (d && d.name === e.name) {
        ["baseLevel", "maxEnchant", "maxExceed", "stones", "stoneSlots", "godStones"].forEach(function (k) { x[k] = d[k]; });
      } else {
        x.stale = true; x.baseLevel = null; x.stones = []; x.godStones = [];
      }
      return x;
    });
  }
  function daevIlv(c) {
    var det = STATE.ilv[c.key];
    if (!det || !det.nodeGrades) return null;
    var g = det.nodeGrades;
    var v = Object.keys(g).reduce(function (s, k) { return s + (ILV_W[k] || 0) * g[k]; }, 0);
    // 상세 수집 이후 새로 연 노드는 흰색(+1)으로 가정
    var extra = ((c.daevanion || {}).openNodeTotal || 0) - (det.openNodeTotal || 0);
    return { value: v + Math.max(0, extra), extra: extra };
  }
  function calcIlv(c, eq) {
    var dv = daevIlv(c);
    var r = { equip: 0, stones: 0, god: 0, daev: dv ? dv.value : 0, daevExtra: dv ? dv.extra : 0, wing: wingTotal(c) };
    eq.forEach(function (e) {
      r.equip += (e.baseLevel || 0) + (e.enchant || 0) + 5 * (e.exceed || 0);
      r.stones += stoneSum(e);
      r.god += godSum(e);
    });
    r.total = r.equip + r.stones + r.god + r.daev + r.wing;
    return r;
  }

  // 단계 그룹: 무기(무기·가더) / 방어구 / 악세(목귀반팔) / 브로치·인장 / 허리띠·아뮬렛 / 펜던트 / 룬 / 아르카나
  function simFamily(slot) {
    if (slot === "MainHand" || slot === "SubHand") return "weapon";
    if (/^(Helmet|Shoulder|Torso|Pants|Gloves|Boots|Cape)$/.test(slot)) return "armor";
    if (/^(Brooch|Seal)/.test(slot)) return "brooch";
    if (/^Arcana/.test(slot)) return "arcana";
    if (/^Rune/.test(slot)) return "rune";
    if (slot === "Belt" || slot === "Amulet") return "belt";
    if (slot === "Pendant") return "pendant";
    return "acc";
  }
  function enFamily(fam) { return EN_DEFAULT[fam] ? fam : "gear"; }
  function tierPrefix(name) {
    var n = String(name || ""), i = n.lastIndexOf("의 ");
    return i > 0 ? n.slice(0, i) : n;
  }
  function tierKey(lv, grade) { return lv + "|" + grade; }
  var TIER_CACHE = null;
  function simTiers(chars) {
    if (TIER_CACHE && TIER_CACHE.src === STATE.data) return TIER_CACHE.t;
    var t = {};
    function add(fam, lv, grade, name, o) {
      var f = t[fam] || (t[fam] = {}), k = tierKey(lv, grade);
      var x = f[k] || (f[k] = { key: k, level: lv, grade: grade, names: {}, maxEnchant: 0, maxExceed: 0, stoneSlots: 0, seen: false });
      if (name) x.names[name] = 1;
      if (o.seen) {
        x.seen = true;
        x.maxEnchant = Math.max(x.maxEnchant, o.maxEnchant || 0);
        x.maxExceed = Math.max(x.maxExceed, o.maxExceed || 0);
      }
      x.stoneSlots = Math.max(x.stoneSlots, o.stoneSlots || 0);
    }
    Object.keys(STATE.tiers || {}).forEach(function (fam) {
      (STATE.tiers[fam] || []).forEach(function (r) {
        (r.names || []).forEach(function (n) { add(fam, r.level, r.grade, n, { stoneSlots: r.stoneSlots }); });
      });
    });
    chars.forEach(function (c) {
      ilvEquip(c).forEach(function (e) {
        if (e.baseLevel == null) return;
        add(simFamily(e.slot), e.baseLevel, e.grade, tierPrefix(e.name), {
          seen: true, maxEnchant: e.maxEnchant, maxExceed: e.maxExceed,
          stoneSlots: e.stoneSlots || (e.stones || []).length });
      });
    });
    Object.keys(t).forEach(function (fam) {
      t[fam] = Object.keys(t[fam]).map(function (k) {
        var x = t[fam][k];
        if (!x.seen) {
          var d = (EN_DEFAULT[enFamily(fam)] || {})[x.grade] || [0, 0];
          x.maxEnchant = d[0]; x.maxExceed = d[1];
        }
        return x;
      }).sort(function (a, b) { return b.level - a.level || String(a.grade).localeCompare(String(b.grade)); });
    });
    TIER_CACHE = { src: STATE.data, t: t };
    return t;
  }
  function tierLabel(x) {
    var names = Object.keys(x.names);
    return x.level + " · " + (GRADE_KO[x.grade] || x.grade) + " · " +
      names.slice(0, 4).join("/") + (names.length > 4 ? " 외" + (names.length - 4) : "");
  }

  // 시뮬 입력값 (브라우저 저장, 캐릭터별)
  function simLsKey(charKey) { return "aion2.sim." + charKey; }
  function getSim(charKey) {
    try { return JSON.parse(lsGet(simLsKey(charKey)) || "{}"); } catch (e) { return {}; }
  }
  function saveSim(charKey, s) { lsSet(simLsKey(charKey), JSON.stringify(s)); }

  function simInput(val, min, max, onChange) {
    var i = el("input", "sim-inp");
    i.type = "number"; i.value = val; i.min = min; if (max != null) i.max = max;
    i.addEventListener("change", function () {
      var v = Number(i.value);
      if (isNaN(v)) v = 0;
      if (v < min) v = min;
      if (max != null && v > max) v = max;
      onChange(v);
    });
    return i;
  }

  function simRefreshBar(c) {
    var det = STATE.ilv[c.key];
    var bar = el("div", "detail-bar");
    bar.innerHTML =
      '<a class="refresh-btn" href="' + esc(actionsUrl("ilv.yml")) + '" target="_blank" rel="noopener">' +
        esc(c.label) + " 상세 갱신 ↗</a>" +
      '<span class="arc-upd">' + (det && det.updatedAt
        ? "상세 수집 " + esc(fmtDateTime(det.updatedAt)) + " (" + esc(timeAgo(det.updatedAt)) + ")"
        : "상세 미수집") +
      " · Actions 에서 Run workflow → 캐릭터 <b>" + esc(c.label) + "</b> 선택 → 실행 (1~2분 뒤 새로고침)</span>";
    return bar;
  }

  function renderSimView(chars) {
    var box = el("div", "simview");
    var picker = el("div", "picker");
    chars.forEach(function (c) {
      var b = el("button", c.key === STATE.sel ? "active" : "", esc(c.label || c.profile.name));
      b.addEventListener("click", function () { STATE.sel = c.key; lsSet("aion2.sel", c.key); render(); });
      picker.appendChild(b);
    });
    box.appendChild(picker);

    var c = chars.filter(function (x) { return x.key === STATE.sel; })[0] || chars[0];
    if (!STATE.ilv[c.key]) {
      var emp = el("section", "cbox");
      emp.innerHTML = cheadHtml(c) + '<p class="muted">이 캐릭터는 시뮬 상세(아이템 기본레벨·마석·데바니온 노드)가 아직 없습니다. 아래 버튼으로 한 번 받아주세요.</p>';
      emp.appendChild(simRefreshBar(c));
      box.appendChild(emp);
      return box;
    }

    var tiers = simTiers(chars);
    var eqAll = ilvEquip(c);
    var staleN = eqAll.filter(function (e) { return e.stale; }).length;
    var sim = getSim(c.key);
    sim.slots = sim.slots || {};
    var cur = calcIlv(c, eqAll);
    var actual = c.profile.itemLevel;

    var simEquip = 0, simStones = 0, simGod = 0, estTotal = 0;
    var rows = eqAll.map(function (e) {
      var fam = simFamily(e.slot);
      var list = tiers[fam] || [];
      // 상세 없는(바뀐) 아이템은 이름 접두어로 단계 추정
      var guess = e.stale ? list.filter(function (x) { return x.grade === e.grade && x.names[tierPrefix(e.name)]; })[0] : null;
      var curKey = e.stale ? (guess ? guess.key : "") : tierKey(e.baseLevel, e.grade);
      var s = sim.slots[e.slot] || {};
      var k = s.k || curKey;
      var tier = list.filter(function (x) { return x.key === k; })[0];
      var same = k === curKey && !e.stale;
      var maxEn = (same ? e.maxEnchant : tier && tier.maxEnchant) || e.maxEnchant || 20;
      var maxEx = (same ? e.maxExceed : tier && tier.maxExceed) || 0;
      var lv = same ? e.baseLevel : tier ? tier.level : 0;
      var en = Math.min(s.en != null ? s.en : (e.enchant || 0), maxEn);
      var ex = Math.min(s.ex != null ? s.ex : (e.exceed || 0), maxEx);
      if (ex > 0) en = maxEn; // 돌파는 최대 강화 이후
      var lines = same ? null : (tier ? (tier.stoneSlots || { Epic: 5, Unique: 4 }[tier.grade] || 0) : 0);
      var st = same ? stoneSum(e) : lines * STONE_MID;
      var god = godSum(e);
      var val = (lv || 0) + en + 5 * ex + st + god;
      // 시뮬 미변경 기준값 (상세 없는 슬롯은 추정 단계 기준)
      var def = !e.stale ? itemIlv(e) : guess ? guess.level + (e.enchant || 0) + 5 * (e.exceed || 0) +
        (guess.stoneSlots || { Epic: 5, Unique: 4 }[guess.grade] || 0) * STONE_MID + god : 0;
      estTotal += def;
      simEquip += (lv || 0) + en + 5 * ex; simStones += st; simGod += god;
      return { e: e, fam: fam, k: k, tier: tier, same: same, lv: lv, en: en, ex: ex,
        maxEn: maxEn, maxEx: maxEx, st: st, lines: lines, val: val,
        cur: def, changed: k !== curKey || en !== (e.enchant || 0) || ex !== (e.exceed || 0) };
    });

    var simDaev = sim.daev != null ? sim.daev : cur.daev;
    var simWing = sim.wing != null ? sim.wing : cur.wing;
    var simTotal = simEquip + simStones + simGod + simDaev + simWing;
    estTotal += cur.daev + cur.wing;
    var offset = actual != null ? actual - estTotal : 0;
    var diff = simTotal - estTotal;
    var simIlv = (actual != null ? actual : estTotal) + diff;

    function update(fn) { fn(sim); saveSim(c.key, sim); render(); }

    // ---- 요약 ----
    var top = el("section", "cbox sim-top");
    top.innerHTML = cheadHtml(c) +
      '<div class="kpis">' +
        '<div class="kpi"><div class="k">현재 아이템 레벨</div><div class="v">' + N(actual) + "</div></div>" +
        '<div class="kpi"><div class="k">시뮬 아이템 레벨</div><div class="v">' + N(Math.round(simIlv)) +
          (Math.round(diff * 10) ? ' <span class="delta ' + (diff > 0 ? "up" : "down") + '">' + (diff > 0 ? "▲" : "▼") +
            N(Math.round(Math.abs(diff) * 10) / 10) + "</span>" : "") + "</div></div>" +
        '<div class="kpi"><div class="k">공식 계산 / 보정</div><div class="v">' + N(Math.round(estTotal)) +
          ' <small>' + (offset >= 0 ? "+" : "") + N(Math.round(offset * 10) / 10) + (staleN ? " (추정)" : "") + "</small></div></div>" +
      "</div>";
    var reset = el("button", "refresh-btn", "현재 장비로 초기화");
    reset.addEventListener("click", function () { saveSim(c.key, {}); render(); });
    top.appendChild(reset);
    top.appendChild(simRefreshBar(c));
    if (staleN || cur.daevExtra) {
      top.appendChild(el("p", "sim-warn",
        (staleN ? "상세 수집 이후 바뀐 장비 " + staleN + "개는 이름으로 단계를 추정했습니다(마석 중간값). " : "") +
        (cur.daevExtra ? "데바니온 노드가 상세 수집 이후 " + (cur.daevExtra > 0 ? "+" : "") + cur.daevExtra + "개 달라져 흰색(+1)으로 가정했습니다. " : "") +
        "정확히 하려면 [상세 갱신]."));
    }
    box.appendChild(top);

    // ---- 구성 (장비 외) ----
    var comp = el("section", "cbox");
    comp.innerHTML = "<h3>구성 <small>현재 → 시뮬</small></h3>";
    var ct = el("table", "sim-comp");
    function compRow(label, a, b, inputEl) {
      var tr = el("tr");
      tr.appendChild(el("td", "l", esc(label)));
      tr.appendChild(el("td", "", N(a)));
      var tdv = el("td", "");
      if (inputEl) tdv.appendChild(inputEl); else tdv.innerHTML = N(Math.round(b * 10) / 10);
      tr.appendChild(tdv);
      var d = Math.round((b - a) * 10) / 10;
      tr.appendChild(el("td", "d", d ? deltaHtml(d) : ""));
      ct.appendChild(tr);
    }
    compRow("장비 (기본+강화+돌파×5)", cur.equip, simEquip);
    compRow("마석", cur.stones, simStones);
    compRow("신석", cur.god, simGod);
    compRow("데바니온 노드", cur.daev, simDaev,
      simInput(simDaev, 0, null, function (v) { update(function (s) { s.daev = v; }); }));
    compRow("날개 강화 합", cur.wing, simWing,
      simInput(simWing, 0, null, function (v) { update(function (s) { s.wing = v; }); }));
    comp.appendChild(ct);
    comp.appendChild(el("p", "muted sim-note",
      "보정 = 실제 템렙 − 공식 계산값 (출처 미확인 항목). 시뮬 템렙 = 현재 템렙 + 증감. " +
      "단계를 바꾼 부위의 마석은 줄 수 × " + STONE_MID + " (중간값). 단계 목록 = 인벤 DB + 우리 캐릭 착용템."));
    box.appendChild(comp);

    // ---- 부위별 ----
    var sec = el("section", "cbox sim-slots");
    sec.innerHTML = "<h3>부위별 <small>단계를 고르고 강화·돌파를 입력하세요</small></h3>";
    var scroll = el("div", "table-scroll");
    var t = el("table", "grid sim-grid");
    var cols = [{ label: "부위", cls: "l cls" }, { label: "현재", cls: "l sname" },
      { label: "단계", cls: "l stier" }, { label: "강화", cls: "sm" }, { label: "돌파", cls: "sm" },
      { label: "마석", cls: "sm" }, { label: "템렙", cls: "sm" }, { label: "증감", cls: "sm" }];
    t.appendChild(makeCols(cols));
    var thead = el("thead"); thead.appendChild(headerRow(cols)); t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var e = r.e;
      var tr = el("tr", r.changed ? "sim-changed" : "");
      tr.appendChild(td(esc(SIM_SLOT_KO[e.slot] || e.slotKo || e.slot), "l cls"));
      tr.appendChild(td('<span class="' + gcol(e.grade) + '">' + esc(e.name || "–") + "</span>" +
        ' <small class="muted">' + (e.stale ? "상세없음" : N(e.baseLevel)) + " · +" + (e.enchant || 0) +
        (e.exceed ? " · " + e.exceed + "돌" : "") + "</small>", "l", e.name));

      var tcell = td("", "l");
      var opts = (tiers[r.fam] || []).map(function (x) { return [x.key, tierLabel(x)]; });
      if (!r.tier) opts.unshift([r.k, "– 단계 선택 –"]);
      tcell.appendChild(mkSelect("sim-inp sim-tier", opts, r.k, function (val) {
        update(function (s) { s.slots[e.slot] = { k: val }; });
      }));
      tr.appendChild(tcell);

      var ecell = td("", "sm");
      ecell.appendChild(simInput(r.en, 0, r.maxEn, function (v) {
        update(function (s) { var o = s.slots[e.slot] || (s.slots[e.slot] = { k: r.k }); o.en = v; if (v < r.maxEn) o.ex = 0; });
      }));
      tr.appendChild(ecell);
      var xcell = td("", "sm");
      if (r.maxEx) {
        xcell.appendChild(simInput(r.ex, 0, r.maxEx, function (v) {
          update(function (s) { var o = s.slots[e.slot] || (s.slots[e.slot] = { k: r.k }); o.ex = v; });
        }));
      } else xcell.innerHTML = '<span class="soul-off">·</span>';
      tr.appendChild(xcell);
      tr.appendChild(td(r.same ? N(r.st) : r.lines + "줄≈" + r.st, "num sm", r.same ? (e.stones || []).join(", ") : "중간값"));
      tr.appendChild(td(N(Math.round(r.val * 10) / 10), "num sm"));
      var d = r.cur == null ? null : Math.round((r.val - r.cur) * 10) / 10;
      tr.appendChild(td(d ? deltaHtml(d) : "", "num sm"));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    scroll.appendChild(t);
    sec.appendChild(scroll);
    box.appendChild(sec);
    return box;
  }

  function tag(t) { return t ? '<span class="tag">' + esc(t) + "</span>" : ""; }

  function wingTag(c) {
    var w = c && c.petwing && c.petwing.wing;
    if (!w || !w.name) return "";
    var en = w.enchantLevel ? " +" + w.enchantLevel : "";
    return '<span class="tag tag-wing ' + (gcol(w.grade) || "") + '">' +
      (w.icon ? '<img loading="lazy" alt="" src="' + esc(w.icon) + '">' : "") +
      esc(w.name) + en + "</span>";
  }

  // github.io 주소에서 저장소 Actions 워크플로 URL 을 추론
  function actionsUrl(workflowFile) {
    try {
      var host = location.hostname; // sydname.github.io
      if (/\.github\.io$/.test(host)) {
        var owner = host.replace(/\.github\.io$/, "");
        var repo = (location.pathname.split("/").filter(Boolean)[0]) || (owner + ".github.io");
        return "https://github.com/" + owner + "/" + repo + "/actions/workflows/" + workflowFile;
      }
    } catch (e) {}
    return "https://github.com";
  }
})();
