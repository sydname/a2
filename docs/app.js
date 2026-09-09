/* 아이온 2 캐릭터 트래커 — 프론트엔드 (외부 라이브러리 없음)
   표(기본관리 / 강화관리) + 카드(캐릭터 선택형) 두 뷰. 표가 기본. */
(function () {
  "use strict";

  var DATA_URL = "./data/all.json";
  var MANUAL_URL = "./manual.json";
  var ARCANA_URL = "./data/arcana.json";
  var app = document.getElementById("app");
  var metaLine = document.getElementById("metaLine");
  var toggle = document.getElementById("viewToggle");

  var STATE = {
    data: null,
    manual: {},
    arcana: {},           // 아르카나 상세 (arcana.json)
    arcanaGeneratedAt: null,
    view: lsGet("aion2.view") || "table",
    tab: lsGet("aion2.tab") || "basic",       // basic | enhance | bt | pot | soul
    sel: lsGet("aion2.sel") || null,          // 카드뷰 선택 캐릭터 key
  };

  var CHECK_FIELDS = [
    { key: "hallway", label: "회랑" },
    { key: "once", label: "일회" },
    { key: "awaken", label: "각성" },
    { key: "rudra", label: "루드라" },
    { key: "erosion", label: "침식" },
    { key: "muspel", label: "무스펠" },
  ];
  var BT_SLOTS = [
    ["MainHand", "무기"], ["SubHand", "가더"], ["Necklace", "목"],
    ["Earring1", "귀1"], ["Earring2", "귀2"], ["Ring1", "반1"], ["Ring2", "반2"],
    ["Bracelet1", "팔1"], ["Bracelet2", "팔2"], ["Brooch1", "브1"], ["Brooch2", "브2"],
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

  // 매주 수요일 05:00 KST 기준 주간 키
  function weekKey() {
    var now = new Date();
    var kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
    var diff = (kst.getDay() - 3 + 7) % 7;            // 3 = 수요일
    if (diff === 0 && kst.getHours() < 5) diff = 7;
    var anchor = new Date(kst);
    anchor.setDate(kst.getDate() - diff);
    anchor.setHours(5, 0, 0, 0);
    return anchor.getFullYear() + "-" + (anchor.getMonth() + 1) + "-" + anchor.getDate();
  }
  var WK = weekKey();
  function checkKey(charKey, field) { return "aion2.chk." + WK + "." + charKey + "." + field; }
  function getCheck(charKey, field) { return lsGet(checkKey(charKey, field)) === "1"; }
  function setCheck(charKey, field, on) { lsSet(checkKey(charKey, field), on ? "1" : "0"); }
  function pruneOldChecks() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("aion2.chk.") === 0 && k.indexOf("aion2.chk." + WK + ".") !== 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function odeKey(charKey) { return "aion2.ode." + charKey; }
  function getOde(c) {
    var ov = lsGet(odeKey(c.key));
    if (ov != null && ov !== "") return Number(ov);
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
  ]).then(function (res) {
    STATE.data = res[0];
    STATE.manual = (res[1] && res[1].characters) || {};
    STATE.arcana = (res[2] && res[2].characters) || {};
    STATE.arcanaGeneratedAt = res[2] && res[2].generatedAt || null;
    pruneOldChecks();
    if (!STATE.sel && STATE.data.characters[0]) STATE.sel = STATE.data.characters[0].key;
    render();
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
      (okCount < chars.length ? " · <span style='color:var(--neg)'>수집 실패 " + (chars.length - okCount) + "명</span>" : "");

    if (!chars.length) { app.innerHTML = '<div class="empty">characters.json 에 캐릭터를 추가하세요.</div>'; return; }

    app.innerHTML = "";
    app.appendChild(STATE.view === "card" ? renderCardView(chars) : renderTableView(chars));
  }

  /* =====================================================================
     표 뷰 — 기본 / 강화 / 돌파 / 잠재력 / 영혼각인
     정렬 없음. 행 순서는 항상 characters.json (= all.json) 순서.
     ===================================================================== */
  var TABS = [
    ["basic", "기본"], ["enhance", "강화"], ["bt", "돌파"],
    ["pot", "잠재력"], ["soul", "영혼각인"],
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
      basicTable(chars)
    );
    box.appendChild(scroll);

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
      note.innerHTML = "체크박스는 이 브라우저에 저장되고 <b>매주 수요일 05:00(KST)</b> 자동 초기화됩니다. 오드 값은 칸을 눌러 바로 수정하고, 영구 반영은 <code>docs/manual.json</code>.";
    else if (tab === "bt")
      note.innerHTML = "돌파 단계는 공식 API 에서 매일 자동 갱신됩니다. 색: 0 회색 · 1 초록 · 2 파랑 · 3 주황 · 4 빨강 · 5 진한 검정.";
    else if (tab === "pot")
      note.innerHTML = "잠재력 값 = 강화 단계, 칸 배경색 = 그 부위 아이템 티어 (엑셀 부캐영각 색 그대로). " +
        "<span style='background:#e06666;padding:0 5px;border-radius:4px'>영웅3</span> " +
        "<span style='background:#e69138;padding:0 5px;border-radius:4px'>영웅4</span> " +
        "<span style='background:#f1c232;padding:0 5px;border-radius:4px'>영웅5</span> " +
        "<span style='background:#a2c4c9;padding:0 5px;border-radius:4px'>유일4</span> " +
        "<span style='background:#d9d2e9;padding:0 5px;border-radius:4px'>유일5</span> " +
        "<span style='background:#f9cb9c;padding:0 5px;border-radius:4px'>유일6</span>";
    else if (tab === "soul")
      note.innerHTML = "영혼각인(방어구 subStats)은 <b>수동 갱신</b>입니다. [상세 갱신] → GitHub Actions 에서 Run workflow. " +
        "머리행 구분이 해당 부위에 각인돼 있으면 <b>O</b>. " +
        "<b>공증</b>=공격력 증가 · <b>피증</b>=피해 증폭 · <b>치피증</b>=치명타 피해 증폭 · <b>피내</b>=피해 내성 · <b>전속</b>=전투 속도 · <b>이속</b>=이동 속도 · 강타 · 완벽";
    else
      note.innerHTML = "데바니온 · 스티그마는 공식 API 에서 매일 자동 갱신됩니다. 표에서는 증감을 표시하지 않습니다.";
    box.appendChild(note);
    return box;
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
  function td(html, cls, title) {
    var n = el("td", cls || "", html);
    if (title) n.title = title;
    return n;
  }
  function nameCell(c) {
    return td('<span class="cn">' + esc(c.profile.name || c.label) +
      (c.label && c.label !== c.profile.name ? ' <span class="lbl">' + esc(c.label) + "</span>" : "") +
      (c.ok === false ? ' <span class="badge-fail">실패</span>' : "") + "</span>", "l");
  }
  function classCell(c) { return td(esc(c.profile.className || "–"), "l"); }
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
      { label: "이름", cls: "l" }, { label: "직업", cls: "l" },
      { label: "아이템레벨" }, { label: "전투력" }, { label: "오드현황" },
    ];
    CHECK_FIELDS.forEach(function (f) { cols.push({ label: f.label, cls: "chk" }); });

    var t = el("table", "grid");
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
      inp.addEventListener("change", function () { lsSet(odeKey(c.key), inp.value.trim()); });
      odeTd.appendChild(inp);
      tr.appendChild(odeTd);

      CHECK_FIELDS.forEach(function (f) {
        var cell = td("", "chk");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = getCheck(c.key, f.key);
        if (cb.checked) cell.classList.add("on");
        cb.addEventListener("change", function () {
          setCheck(c.key, f.key, cb.checked);
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
    var cols = [{ label: "이름", cls: "l" }, { label: "직업", cls: "l" },
      { label: "기본데바니온" }, { label: "유스티엘" }];
    for (var i = 1; i <= 6; i++) cols.push({ label: "" + i, cls: "sm" });

    var t = el("table", "grid");
    var thead = el("thead");
    var g = el("tr", "grouprow");
    g.appendChild(el("th", "l", "")); g.appendChild(el("th", "l", ""));
    g.appendChild(el("th", "grp", "데바니온")); g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "grp", "상위 스티그마 6"));
    for (var s2 = 0; s2 < 5; s2++) g.appendChild(el("th", "", ""));
    thead.appendChild(g);
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      tr.appendChild(td(N(c.daevanion.basic), "num"));
      tr.appendChild(td(N(c.daevanion.yustiel), "num"));
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
    var cols = [{ label: "이름", cls: "l" }, { label: "직업", cls: "l" }];
    BT_SLOTS.forEach(function (s) { cols.push({ label: s[1], cls: "sm" }); });
    cols.push({ label: "팬던트", cls: "sm" });

    var t = el("table", "grid");
    var thead = el("thead");
    var g = el("tr", "grouprow");
    g.appendChild(el("th", "l", "")); g.appendChild(el("th", "l", ""));
    g.appendChild(el("th", "grp", "돌파 단계"));
    for (var w = 0; w < 10; w++) g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "grp", "강화"));
    thead.appendChild(g);
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
  function potentialTable(chars) {
    var cols = [{ label: "이름", cls: "l" }, { label: "직업", cls: "l" }];
    POT_SLOTS.forEach(function (s) { cols.push({ label: s[1], cls: "sm" }); });
    cols.push({ label: "유일", cls: "sm" });
    cols.push({ label: "영웅", cls: "sm" });
    cols.push({ label: "티어", cls: "l" });

    var t = el("table", "grid");
    var thead = el("thead");
    var g = el("tr", "grouprow");
    g.appendChild(el("th", "l", "")); g.appendChild(el("th", "l", ""));
    g.appendChild(el("th", "grp", "부위별 잠재력"));
    for (var w = 0; w < 10; w++) g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "grp", "티어 정보")); g.appendChild(el("th", "", "")); g.appendChild(el("th", "", ""));
    thead.appendChild(g);
    thead.appendChild(headerRow(cols));
    t.appendChild(thead);

    var tb = el("tbody");
    chars.forEach(function (c) {
      var m = manualOf(c);
      var p = m.potential || {};
      var pt = m.potentialTier || {};
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(nameCell(c));
      tr.appendChild(classCell(c));
      POT_SLOTS.forEach(function (sl) {
        var v = (sl[0] in p) ? p[sl[0]] : "";
        var shown = (v === "" || v == null) ? "·" : (v === "-" ? "–" : String(v));
        var code = pt[sl[0]] || "";
        tr.appendChild(td("<b>" + esc(shown) + "</b>", "num sm " + ptClass(code), ptLabel(code)));
      });
      tr.appendChild(td("<b>" + fmtManual(m.potentialUnique) + "</b>", "num sm " + ptClass(m.potentialUniqueTier), ptLabel(m.potentialUniqueTier)));
      tr.appendChild(td("<b>" + fmtManual(m.potentialEpic) + "</b>", "num sm " + ptClass(m.potentialEpicTier), ptLabel(m.potentialEpicTier)));
      tr.appendChild(td(m.tierName
        ? '<span class="' + ptClass(m.tierCode) + ' tier-txt">' + esc(m.tierName) + "</span>" : "–", "l"));
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

    var cols = [{ label: "이름", cls: "l" }, { label: "직업", cls: "l" }];
    flat.forEach(function (p) { cols.push({ label: p[2], cls: "chk", title: p[1] + " · " + (SOUL_FULL[p[2]] || p[2]) }); });

    var t = el("table", "grid");
    var thead = el("thead");
    var g = el("tr", "grouprow");
    g.appendChild(el("th", "l", "")); g.appendChild(el("th", "l", ""));
    SOUL_GRID.forEach(function (grp) {
      grp.stats.forEach(function (_, i) {
        g.appendChild(el("th", i === 0 ? "grp" : "", i === 0 ? esc(grp.ko) : ""));
      });
    });
    thead.appendChild(g);
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
    var body = el("div", "card-body");
    body.innerHTML = cardTemplate(c);
    box.appendChild(body);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(body.querySelectorAll(".bar > i"), function (i) { i.style.width = i.getAttribute("data-w") + "%"; });
    });
    return box;
  }

  function cardTemplate(c) {
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

    var gearItems = (c.equipment || []).filter(function (e) { return !e.isArcana; });
    var gear = gearItems.map(function (e) {
      var pot = potentialOf(c, e.slot);
      return '<div class="gear ' + gradeCls(e.grade) + '">' +
        '<div class="g-ic">' + (e.icon ? '<img loading="lazy" alt="" src="' + esc(e.icon) + '">' : "") + "</div>" +
        '<div class="g-main">' +
          '<div class="g-slot">' + esc(e.slotKo || e.slot) + "</div>" +
          '<div class="g-name">' + esc(e.name || "–") + "</div>" +
        "</div>" +
        '<div class="g-nums">' +
          '<span class="g-en">+' + (e.enchant || 0) + "</span>" +
          (e.exceed ? '<span class="g-ex">' + e.exceed + "돌파</span>" : "") +
          (pot !== "" ? '<span class="g-pot">잠재 ' + esc(pot) + "</span>" : "") +
        "</div>" +
        "</div>";
    }).join("");

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
          return '<span class="a-skill">' + (s.icon ? '<img alt="" src="' + esc(s.icon) + '">' : "") +
            esc(s.name) + ' <b>Lv.' + N(s.level) + "</b></span>";
        }).join("");
        body = '<div class="a-detail">' + ms +
          (sk ? '<div class="a-skills">' + sk + "</div>" : "") + "</div>";
      }
      return '<div class="arc ' + gradeCls(a.grade) + (dd ? " has-detail" : "") + '">' + head + body + "</div>";
    }).join("");

    var aUrl = actionsUrl("arcana.yml");
    var refreshBtn = '<a class="refresh-btn" href="' + esc(aUrl) + '" target="_blank" rel="noopener" ' +
      'title="GitHub Actions 에서 \'Run workflow\' 를 눌러 아르카나 상세를 다시 수집합니다">상세 갱신 ↗</a>';
    var arcMeta = det && det.updatedAt
      ? '<span class="arc-upd">상세 수집 ' + esc(fmtDateTime(det.updatedAt)) + " (" + esc(timeAgo(det.updatedAt)) + ")</span>"
      : '<span class="arc-upd">상세 미수집 — [상세 갱신] 을 눌러 한 번 수집하세요</span>';

    var boards = (d.boards || []).map(function (b) {
      var pct = b.totalNodeCount ? Math.round((b.openNodeCount / b.totalNodeCount) * 100) : (b.openPercent || 0);
      var basic = ["네자칸", "지켈", "바이젤", "트리니엘"].indexOf(b.name) >= 0;
      return '<div class="drow' + (basic ? " basic" : "") + '">' +
        '<span class="dn">' + esc(b.name) + (basic ? ' <em>기본</em>' : "") + "</span>" +
        '<span class="bar"><i data-w="' + pct + '" style="width:0%"></i></span>' +
        '<span class="dc">' + N(b.openNodeCount) + " / " + N(b.totalNodeCount) + "</span>" +
        "</div>";
    }).join("");

    var stigmaChips = (c.stigma || []).map(function (s) {
      return '<span class="stig">' + esc(s.name) + ' <b>' + N(s.level) + "</b></span>";
    }).join("");

    return (
      '<section class="cbox">' +
        '<div class="chead">' +
          '<div class="c-name">' + esc(p.name || c.label) +
            (c.label && c.label !== p.name ? ' <span class="lbl">' + esc(c.label) + "</span>" : "") + "</div>" +
          '<div class="c-tags">' +
            tag(p.className) + tag(p.raceName) + (p.guildName ? tag(p.guildName) : "") +
            (c.ok === false ? '<span class="badge-fail">수집실패</span>' : "") +
          "</div>" +
          '<a class="c-link" href="' + esc(c.officialUrl) + '" target="_blank" rel="noopener">공식 페이지 ↗</a>' +
        "</div>" +
        '<div class="kpis">' + kpisTop + "</div>" +
        '<div class="kpis-label">분야별 돌파</div>' +
        '<div class="kpis bt">' + kpisBt + "</div>" +
        (dl && dl.sinceDate ? '<div class="since">▲▼ ' + esc(dl.sinceDate) + " 대비 증감</div>" : "") +
      "</section>" +

      '<section class="cbox">' +
        "<h3>착용 장비 <span class=\"cnt\">" + gearItems.length + "</span></h3>" +
        '<div class="gear-list">' + gear + "</div>" +
        (stigmaChips ? '<h4 class="mt">상위 스티그마</h4><div class="stig-list">' + stigmaChips + "</div>" : "") +
      "</section>" +

      '<section class="cbox">' +
        '<div class="arc-top">' +
          "<h3>아르카나 <span class=\"cnt\">" + arc.length + "</span> <small>강화 합계 +" + arcEnchTotal + "</small></h3>" +
          refreshBtn +
        "</div>" +
        '<div class="arc-meta">' + arcMeta + "</div>" +
        '<div class="arc-list">' + (arcHtml || '<p class="muted">착용한 아르카나가 없습니다.</p>') + "</div>" +
      "</section>" +

      '<section class="cbox">' +
        "<h3>데바니온 <span class=\"cnt\">" + d.openedBoards + " / " + d.totalBoards + "</span> " +
        "<small>개방 노드 " + N(d.openNodeTotal) + " / " + N(d.nodeTotal) + "</small></h3>" +
        '<div class="daev">' + boards + "</div>" +
      "</section>"
    );
  }
  function tag(t) { return t ? '<span class="tag">' + esc(t) + "</span>" : ""; }

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
