/* 아이온 2 캐릭터 트래커 — 프론트엔드 (외부 라이브러리 없음)
   표(기본관리 / 강화관리) + 카드(캐릭터 선택형) 두 뷰. 표가 기본. */
(function () {
  "use strict";

  var DATA_URL = "./data/all.json";
  var MANUAL_URL = "./manual.json";
  var app = document.getElementById("app");
  var metaLine = document.getElementById("metaLine");
  var toggle = document.getElementById("viewToggle");

  var STATE = {
    data: null,
    manual: {},
    view: lsGet("aion2.view") || "table",
    tab: lsGet("aion2.tab") || "basic",       // basic | enhance
    sel: lsGet("aion2.sel") || null,          // 카드뷰 선택 캐릭터 key
    sort: {
      basic: { k: lsGet("aion2.sort.basic.k") || "itemLevel", dir: lsGet("aion2.sort.basic.dir") || "desc" },
      enhance: { k: lsGet("aion2.sort.enhance.k") || "daevBasic", dir: lsGet("aion2.sort.enhance.dir") || "desc" },
    },
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
  ]).then(function (res) {
    STATE.data = res[0];
    STATE.manual = (res[1] && res[1].characters) || {};
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
     표 뷰
     ===================================================================== */
  function renderTableView(chars) {
    var box = el("div");

    var tabs = el("div", "subtabs");
    [["basic", "기본 관리"], ["enhance", "강화 관리"]].forEach(function (t) {
      var b = el("button", STATE.tab === t[0] ? "active" : "", esc(t[1]));
      b.addEventListener("click", function () { STATE.tab = t[0]; lsSet("aion2.tab", t[0]); render(); });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    var scroll = el("div", "table-scroll");
    scroll.appendChild(STATE.tab === "enhance" ? enhanceTable(chars) : basicTable(chars));
    box.appendChild(scroll);

    var note = el("p", "tbl-note");
    note.innerHTML = STATE.tab === "basic"
      ? "체크박스는 이 브라우저에 저장되고 <b>매주 수요일 05:00(KST)</b> 자동 초기화됩니다. 오드 값은 칸을 눌러 바로 수정할 수 있고, 영구 반영은 <code>manual.json</code> 을 편집하세요."
      : "돌파 · 스티그마 · 데바니온은 공식 API 에서 매일 자동 갱신됩니다. 표에서는 증감을 표시하지 않습니다.";
    box.appendChild(note);
    return box;
  }

  function sortedRows(chars, tab) {
    var s = STATE.sort[tab];
    var val = tab === "enhance" ? enhVal : basVal;
    return chars.slice().sort(function (a, b) {
      var va = val(a, s.k), vb = val(b, s.k);
      var r = (typeof va === "number" && typeof vb === "number")
        ? va - vb : String(va).localeCompare(String(vb), "ko");
      return s.dir === "asc" ? r : -r;
    });
  }
  function headerRow(cols, tab) {
    var s = STATE.sort[tab];
    var tr = el("tr");
    cols.forEach(function (col) {
      var th = el("th", col.cls || "", esc(col.label) +
        (s.k === col.k ? ' <span class="ar">' + (s.dir === "asc" ? "▲" : "▼") + "</span>" : ""));
      if (col.k) {
        th.style.cursor = "pointer";
        th.addEventListener("click", function () {
          if (s.k === col.k) s.dir = s.dir === "asc" ? "desc" : "asc";
          else { s.k = col.k; s.dir = col.txt ? "asc" : "desc"; }
          lsSet("aion2.sort." + tab + ".k", s.k);
          lsSet("aion2.sort." + tab + ".dir", s.dir);
          render();
        });
      }
      tr.appendChild(th);
    });
    return tr;
  }
  function td(html, cls, title) {
    var n = el("td", cls || "", html);
    if (title) n.title = title;
    return n;
  }

  // ---- 기본 관리 ----
  function basVal(c, k) {
    switch (k) {
      case "name": return c.profile.name || c.label;
      case "className": return c.profile.className || "";
      case "itemLevel": return c.profile.itemLevel || 0;
      case "combatPower": return c.profile.combatPower || 0;
      case "ode": return getOde(c) || 0;
      default: return 0;
    }
  }
  function basicTable(chars) {
    var cols = [
      { k: "name", label: "이름", txt: true, cls: "l" },
      { k: "className", label: "직업", txt: true, cls: "l" },
      { k: "itemLevel", label: "아이템레벨" },
      { k: "combatPower", label: "전투력" },
      { k: "ode", label: "오드현황" },
    ];
    CHECK_FIELDS.forEach(function (f) { cols.push({ label: f.label, cls: "chk" }); });

    var t = el("table", "grid");
    var thead = el("thead"); thead.appendChild(headerRow(cols, "basic")); t.appendChild(thead);
    var tb = el("tbody");
    sortedRows(chars, "basic").forEach(function (c) {
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(td('<span class="cn">' + esc(c.profile.name || c.label) +
        (c.label && c.label !== c.profile.name ? ' <span class="lbl">' + esc(c.label) + "</span>" : "") +
        (c.ok === false ? ' <span class="badge-fail">실패</span>' : "") + "</span>", "l"));
      tr.appendChild(td(esc(c.profile.className || "–"), "l"));
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

  // ---- 강화 관리 ----
  function enhVal(c, k) {
    if (k === "name") return c.profile.name || c.label;
    if (k === "className") return c.profile.className || "";
    if (k === "daevBasic") return c.daevanion.basic || 0;
    if (k === "yustiel") return c.daevanion.yustiel || 0;
    if (k === "pendant") return (c.breakthrough && c.breakthrough.pendantEnchant) || 0;
    if (k && k.indexOf("st") === 0 && k.length <= 3) {
      var si = Number(k.slice(2)) - 1;
      return (c.stigma[si] && c.stigma[si].level) || 0;
    }
    if (k && k.indexOf("bt.") === 0) {
      var slot = k.slice(3);
      return (c.breakthrough && c.breakthrough.bySlot && c.breakthrough.bySlot[slot]) || 0;
    }
    return 0;
  }
  function enhanceTable(chars) {
    var cols = [
      { k: "name", label: "이름", txt: true, cls: "l" },
      { k: "className", label: "직업", txt: true, cls: "l" },
      { k: "daevBasic", label: "기본데바니온" },
      { k: "yustiel", label: "유스티엘" },
    ];
    for (var i = 1; i <= 6; i++) cols.push({ k: "st" + i, label: "스" + i, cls: "sm" });
    BT_SLOTS.forEach(function (s) { cols.push({ k: "bt." + s[0], label: s[1], cls: "sm" }); });
    cols.push({ k: "pendant", label: "팬던트", cls: "sm" });

    var t = el("table", "grid");
    var thead = el("thead");
    var g = el("tr", "grouprow");
    g.appendChild(el("th", "l", "")); g.appendChild(el("th", "l", ""));
    g.appendChild(el("th", "grp", "데바니온")); g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "grp", "상위 스티그마 6"));
    for (var s2 = 0; s2 < 5; s2++) g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "grp", "돌파 현황"));
    for (var w = 0; w < 10; w++) g.appendChild(el("th", "", ""));
    g.appendChild(el("th", "", ""));
    thead.appendChild(g);
    thead.appendChild(headerRow(cols, "enhance"));
    t.appendChild(thead);

    var tb = el("tbody");
    sortedRows(chars, "enhance").forEach(function (c) {
      var tr = el("tr", c.ok === false ? "stale" : "");
      tr.appendChild(td('<span class="cn">' + esc(c.profile.name || c.label) +
        (c.ok === false ? ' <span class="badge-fail">실패</span>' : "") + "</span>", "l"));
      tr.appendChild(td(esc(c.profile.className || "–"), "l"));
      tr.appendChild(td(N(c.daevanion.basic), "num"));
      tr.appendChild(td(N(c.daevanion.yustiel), "num"));
      for (var i = 0; i < 6; i++) {
        var st = c.stigma[i];
        tr.appendChild(td(st ? N(st.level) : "–", "num sm", st ? st.name : ""));
      }
      BT_SLOTS.forEach(function (sl) {
        var v = c.breakthrough && c.breakthrough.bySlot ? c.breakthrough.bySlot[sl[0]] : null;
        tr.appendChild(td(v == null ? "–" : N(v), "num sm"));
      });
      var pe = c.breakthrough ? c.breakthrough.pendantEnchant : null;
      tr.appendChild(td(pe == null ? "–" : "+" + pe, "num sm"));
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

    var kpis = [
      ["아이템 레벨", N(p.itemLevel), deltaHtml(dl.itemLevel)],
      ["전투력", N(p.combatPower) + ' <small>(' + K(p.combatPower) + "k)</small>", deltaHtml(dl.combatPower, { k: true })],
      ["무기+가더 돌파", N(ex.weapon.total), deltaHtml(dl.weaponExceed)],
      ["방어구 돌파", N(ex.armor.total), deltaHtml(dl.armorExceed)],
      ["악세서리 돌파", N(ex.accessory.total), deltaHtml(dl.accessoryExceed)],
      ["데바니온(기본)", N(d.basic) + ' <small>+유스 ' + N(d.yustiel) + "</small>", deltaHtml(dl.daevanionBasic)],
    ].map(function (r) {
      return '<div class="kpi"><div class="k">' + esc(r[0]) + '</div><div class="v">' + r[1] + (r[2] || "") + "</div></div>";
    }).join("");

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
    var arcHtml = arc.map(function (a) {
      return '<div class="arc ' + gradeCls(a.grade) + '">' +
        '<div class="a-ic">' + (a.icon ? '<img loading="lazy" alt="" src="' + esc(a.icon) + '">' : "") + "</div>" +
        '<div class="a-name">' + esc(a.name || a.slotKo) + "</div>" +
        '<div class="a-en">+' + (a.enchant || 0) + "</div>" +
        "</div>";
    }).join("");

    var boards = (d.boards || []).map(function (b) {
      var pct = b.totalNodeCount ? Math.round((b.openNodeCount / b.totalNodeCount) * 100) : (b.openPercent || 0);
      var basic = [61, 62, 63, 64].indexOf(b.id) >= 0;
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
        '<div class="kpis">' + kpis + "</div>" +
        (dl && dl.sinceDate ? '<div class="since">▲▼ ' + esc(dl.sinceDate) + " 대비 증감</div>" : "") +
      "</section>" +

      '<section class="cbox">' +
        "<h3>착용 장비 <span class=\"cnt\">" + gearItems.length + "</span></h3>" +
        '<div class="gear-list">' + gear + "</div>" +
        (stigmaChips ? '<h4 class="mt">상위 스티그마</h4><div class="stig-list">' + stigmaChips + "</div>" : "") +
      "</section>" +

      '<section class="cbox">' +
        "<h3>아르카나 <span class=\"cnt\">" + arc.length + "</span> <small>강화 합계 +" + arcEnchTotal + "</small></h3>" +
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
})();
