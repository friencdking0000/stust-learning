(function () {
  "use strict";
  var D = window.SITE_DATA || { courses: [] };
  // 私人論文對照:只有本機 site/private.js 存在時才有(gitignore、不發布;公開版沒有任何論文資料或登入入口)
  var PRIV = window.PRIVATE || null;
  var main = document.getElementById("main");
  var nav = document.getElementById("course-nav");
  var search = document.getElementById("search");
  var genEl = document.getElementById("gen");
  if (genEl) genEl.textContent = "資料產出 " + (D.generated || "");

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  // 先把 $$..$$ / \[..\] / \(..\) / $..$ 換成佔位符,避免 marked 吃掉反斜線與底線,渲染後再放回給 MathJax
  var MATH_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?![\s$])[^$\n]+?\$/g;
  function md(t, br) {
    if (!t) return "";
    var maths = [], s = String(t).replace(MATH_RE, function (m) { maths.push(m); return "@@MATH" + (maths.length - 1) + "@@"; });
    var html = null;
    try { if (window.marked) html = marked.parse ? marked.parse(s, br ? { breaks: true } : undefined) : marked(s); } catch (e) {}
    if (html === null) html = "<pre>" + esc(s) + "</pre>";
    return html.replace(/@@MATH(\d+)@@/g, function (_, i) { return esc(maths[+i]); });
  }
  // MathJax 排版(效能):全部排隊執行、每批約 40 個公式後讓出主執行緒,大頁面不再一次凍住數秒;
  // 帶 tex2jax_ignore 的區塊先跳過,等 typesetLazy() 捲到附近才排
  var mjq = Promise.resolve();
  function mjReady() { return !!(window.MathJax && MathJax.typesetPromise); }
  function whenMJ() {
    if (mjReady()) return Promise.resolve();
    return new Promise(function (r) {
      var t = setInterval(function () { if (mjReady()) { clearInterval(t); r(); } }, 100);
      setTimeout(function () { clearInterval(t); r(); }, 20000);
    });
  }
  // 暖機:首頁閒置時先排一個隱藏公式,把 MathJax 第一次啟動的成本(低階手機約 1 秒)移出點課程的那一刻
  whenMJ().then(function () {
    var go = function () {
      if (!mjReady()) return;
      var w = document.createElement("div");
      w.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
      w.textContent = "$\\frac{1}{2}\\omega_n^2\\zeta\\sigma\\lambda\\Omega\\sqrt{x}\\sum_{i=1}^{N} e^{-j\\theta}\\le\\Delta f$";
      document.body.appendChild(w);
      typeset(w).then(function () { w.remove(); });
    };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 800);
  });
  function mcount(el) { return (el.textContent.match(/\$|\\\(|\\\[/g) || []).length; }
  function directText(el) { for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true; return false; }
  function mathUnits(el, out) {
    if (el.classList && el.classList.contains("tex2jax_ignore")) return out;
    var k = mcount(el);
    if (!k) return out;
    if (k > 60 && el.children.length && !directText(el)) [].forEach.call(el.children, function (c) { mathUnits(c, out); });
    else out.push(el);
    return out;
  }
  function typeset(el) {
    if (!el) return Promise.resolve();
    mjq = mjq.then(whenMJ).then(function () {
      if (!mjReady() || !el.isConnected) return;
      var units = mathUnits(el, []), i = 0;
      function next() {
        if (i >= units.length || !el.isConnected) return;
        var batch = [], n = 0;
        while (i < units.length && n < 40) { var u = units[i++]; batch.push(u); n += mcount(u); }
        return MathJax.typesetPromise(batch).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(next);
      }
      return next();
    }).catch(function () {});
    return mjq;
  }
  // 只排版捲到畫面附近的區塊(其餘標 tex2jax_ignore 先跳過);after(el) 在該區塊排完後呼叫
  function typesetLazy(root, sel, after) {
    var els = [].slice.call(root.querySelectorAll(sel));
    if (!els.length || !("IntersectionObserver" in window))
      return typeset(root).then(function () { if (after) els.forEach(after); });
    els.forEach(function (e) { e.classList.add("tex2jax_ignore"); });
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var t = en.target; io.unobserve(t); t.classList.remove("tex2jax_ignore");
        typeset(t).then(function () { if (after) after(t); });
      });
    }, { rootMargin: "600px 0px" });
    els.forEach(function (e) { io.observe(e); });
    return typeset(root);
  }
  // 收合區塊:內容用 fn() 產生,第一次展開才組 HTML、放進頁面並排版
  var LAZY = {}, lazySeq = 0;
  function lazyDetails(cls, summary, fn) {
    var id = "lz" + (++lazySeq); LAZY[id] = fn;
    return '<details class="' + cls + '" data-lazy="' + id + '"><summary>' + summary + "</summary></details>";
  }
  function bindLazyDetails(root, sel, onFill) {
    [].forEach.call(root.querySelectorAll("details[data-lazy]"), function (d) {
      d.addEventListener("toggle", function () {
        var fn = LAZY[d.dataset.lazy];
        if (!d.open || !fn) return;
        delete LAZY[d.dataset.lazy];
        d.insertAdjacentHTML("beforeend", fn());
        if (onFill) onFill(d);
        typesetLazy(d, sel);
      });
    });
  }
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }
  /* 線條圖示:節錄自 Lucide(https://lucide.dev),ISC License, Copyright (c) Lucide Contributors。
     viewBox 24、stroke=currentColor,大小跟著文字(.ic = 1.15em),深色模式自動變色 */
  var ICONS = {
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sunmoon: '<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    "chev-l": '<path d="m15 18-6-6 6-6"/>',
    "chev-r": '<path d="m9 18 6-6-6-6"/>'
  };
  function ico(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  [].forEach.call(document.querySelectorAll("[data-ic]"), function (el) { el.innerHTML = ico(el.dataset.ic); });  // index.html 的固定按鈕
  var EXT = " " + ico("ext");  // 外部連結
  // 私人對照的標籤可能自帶 emoji,顯示前拿掉(資料本身不動)
  function noEmo(s) { return String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]\s*/gu, "").trim(); }
  function byId(id) { for (var i = 0; i < D.courses.length; i++) if (D.courses[i].id === id) return D.courses[i]; return null; }
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- progress (localStorage) ---------- */
  var PKEY = "stust_prog_v2";
  function allProg() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (e) { return {}; } }
  function saveProg(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {} }
  function isDone(cid, i) { var p = allProg(); return !!(p[cid] && p[cid][i]); }
  function setDone(cid, i, v) { var p = allProg(); p[cid] = p[cid] || {}; if (v) p[cid][i] = 1; else delete p[cid][i]; saveProg(p); }
  function courseProg(c) {
    var total = (c.steps && c.steps.length) || 0, done = 0, p = allProg()[c.id] || {};
    for (var k in p) if (p[k]) done++;
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  /* ---------- lightbox ---------- */
  var LB = { list: [], idx: 0 };
  var lb = document.getElementById("lightbox"), lbImg = document.getElementById("lb-img"), lbCap = document.getElementById("lb-cap");
  function lbShow() { var it = LB.list[LB.idx]; if (!it) return; lbImg.src = it.url; lbCap.textContent = (it.caption ? it.caption + " — " : "") + (it.src || "") + (it.page ? " p." + it.page : "") + "  (" + (LB.idx + 1) + "/" + LB.list.length + ")"; }
  function openLB(list, idx) { LB.list = list; LB.idx = idx; lb.classList.remove("hidden"); lbShow(); }
  function closeLB() { lb.classList.add("hidden"); lbImg.src = ""; }
  function lbStep(d) { if (!LB.list.length) return; LB.idx = (LB.idx + d + LB.list.length) % LB.list.length; lbShow(); }
  document.getElementById("lb-close").onclick = closeLB;
  document.getElementById("lb-prev").onclick = function () { lbStep(-1); };
  document.getElementById("lb-next").onclick = function () { lbStep(1); };
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLB(); });
  document.addEventListener("keydown", function (e) {
    if (lb.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLB(); else if (e.key === "ArrowLeft") lbStep(-1); else if (e.key === "ArrowRight") lbStep(1);
  });

  /* ---------- sidebar ---------- */
  function renderNav() {
    nav.innerHTML = D.courses.map(function (c) {
      var pr = courseProg(c), tag = pr.total ? '<span class="mini-prog">' + pr.pct + "%</span>" : "";
      return '<a class="cnav" data-id="' + c.id + '"><span class="dot s-' + c.status + '"></span>' + c.title + tag + "</a>";
    }).join("");
  }
  nav.addEventListener("click", function (e) { var a = e.target.closest(".cnav"); if (a) location.hash = "#/c/" + encodeURIComponent(a.dataset.id); });
  function highlight() {
    var m = location.hash.match(/^#\/c\/([^/]+)/), id = m ? decodeURIComponent(m[1]) : null;
    [].forEach.call(document.querySelectorAll(".cnav"), function (a) { a.classList.toggle("active", a.dataset.id === id); });
  }

  /* 手機:選單鈕開關側欄抽屜 */
  var sidebar = document.getElementById("sidebar"), menuBtn = document.getElementById("menu-btn");
  function setMenu(open) { sidebar.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", open); }
  menuBtn.addEventListener("click", function () { setMenu(!sidebar.classList.contains("open")); });

  /* ---------- routing ---------- */
  function route() {
    setMenu(false);
    tutorSync();
    var m = location.hash.match(/^#\/c\/([^/]+)(?:\/(\w+))?(?:\/(\d+))?/);
    if (m) renderCourse(decodeURIComponent(m[1]), m[2] || "steps", m[3] ? parseInt(m[3], 10) : 0);
    else renderHome();
    highlight();
  }

  var LOGO = (document.querySelector(".brand .logo") || {}).outerHTML || "";  // 與側欄同一份 SVG
  function renderHome() {
    main.innerHTML =
      '<header class="chead"><h1 class="home-h1"><span class="hk">' + LOGO + 'st</span>ust<b>class</b> 互動學習網站</h1><p class="sub">六門課程 · 學習路徑 · 原教材例題專業詳解 · 術語註釋 · 互動測驗</p></header>' +
      '<div class="cards">' + D.courses.map(function (c) {
        var pr = courseProg(c);
        var prog = pr.total ? '<div class="progwrap"><div class="progbar" style="width:' + pr.pct + '%"></div></div><div class="progtxt">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + "%)</div>" : "";
        var np = allProblems(c).length;
        return '<a class="card" href="#/c/' + c.id + '"><div class="card-top"><h3>' + c.title + "</h3></div><p>" + esc(c.summary) + "</p>" + prog +
          (np ? '<div class="progtxt">例題 ' + np + " 題(原教材 " + allProblems(c).filter(function (x) { return x.p.origin === "原教材"; }).length + " · 其餘依講義改編)· " + (c.glossary || []).length + " 條術語註釋</div>" : "") +
          '<div class="chips">' + c.topics.slice(0, 3).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") +
          (c.topics.length > 3 ? '<span class="chip more">+' + (c.topics.length - 3) + "</span>" : "") + "</div></a>";
      }).join("") + "</div>" +
      '<section class="xmap"><h2>跨課程關聯</h2>' + (D.crossMap || []).map(function (x) {
        return '<div class="xrow"><b>' + x.between.join(" ↔ ") + "</b><span>" + esc(x.why) + "</span></div>";
      }).join("") + "</section>";
  }

  /* ---------- course ---------- */
  function renderCourse(id, tab, arg) {
    var c = byId(id); if (!c) return renderHome();
    var tabs = [["steps", "學習路徑"]];
    var np = allProblems(c).length;
    if (np) tabs.push(["probs", "例題練習（" + np + "）"]);
    if (c.quiz) tabs.push(["quiz", "測驗"]);
    if (c.embeds && c.embeds.length) tabs.push(["embed", "互動工具"]);
    if (c.notes && c.notes.length) tabs.push(["notes", "筆記"]);
    if (thesisFor(c)) tabs.push(["thesis", "我的論文"]);
    if (libFor(c).length) tabs.push(["lib", "PI 資料庫（" + libFor(c).length + "）"]);
    
    main.innerHTML =
      '<header class="chead"><div class="crumb"><a href="#/">首頁</a> / ' + c.title + "</div>" +
      "<h1>" + c.title + "</h1><p class='sub'>" + esc(c.subtitle || "") + "</p></header>" +
      '<div class="tabwrap"><div class="tabbar">' + tabs.map(function (t) { return '<button class="tab" data-t="' + t[0] + '">' + t[1] + "</button>"; }).join("") +
      '</div></div><div id="tabc"></div>';
    var tabc = document.getElementById("tabc");
    var bar = main.querySelector(".tabbar");
    function show(t) {
      [].forEach.call(main.querySelectorAll(".tab"), function (b) { b.classList.toggle("active", b.dataset.t === t); });
      if ((location.hash.match(/^#\/c\/[^/]+\/(\w+)/) || [])[1] !== t) history.replaceState(null, "", "#/c/" + encodeURIComponent(c.id) + "/" + t);
      var a = bar.querySelector(".tab.active");
      if (a && a.offsetLeft + a.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = a.offsetLeft - 24;  // 手機:選中的分頁在畫面外就捲過去
      if (t === "overview") tabc.innerHTML = tabOverview(c);
      else if (t === "notes") { tabc.innerHTML = tabNotes(c, arg); bindNotes(c); typeset(tabc).then(function () { annotateTerms(document.getElementById("notebody"), c); }); }
      else if (t === "quiz") { tabc.innerHTML = tabQuiz(c); bindQuiz(c); }
      else if (t === "probs") { tabc.innerHTML = tabProblems(c); bindProblemTab(c, /\/probs\/\d+$/.test(location.hash) ? arg : null); }
      else if (t === "embed") tabc.innerHTML = tabEmbed(c);
      else if (t === "thesis" && thesisFor(c)) { tabc.innerHTML = tabThesis(c); bindThesis(tabc); typeset(tabc); focusThesis(/\/thesis\/\d+$/.test(location.hash) ? arg : null); }
      else if (t === "lib") { tabc.innerHTML = tabLib(c); bindLib(c); }
      else if (t === "mat") tabc.innerHTML = tabMat(c);
      else { tabc.innerHTML = tabSteps(c); bindSteps(c, arg); typeset(tabc); }
    }
    bar.addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) show(b.dataset.t); });
    bar.addEventListener("scroll", tabMore);
    show(tab);
    tabMore();
    window.scrollTo(0, 0);
  }

  function tabOverview(c) {
    var pr = courseProg(c);
    var h = '<p class="lead">' + esc(c.summary) + "</p>";
    if (pr.total) h += '<div class="progwrap"><div class="progbar" style="width:' + pr.pct + '%"></div></div><div class="progtxt">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + "%)</div>";
    h += "<h3>主題</h3><div class='chips big'>" + c.topics.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>";
    if (c.crossLinks && c.crossLinks.length) h += "<h3>跨課關聯</h3><div class='chips'>" + c.crossLinks.map(function (x) { var t = byId(x); return '<a class="chip link" href="#/c/' + x + '">' + (t ? t.title : x) + "</a>"; }).join("") + "</div>";
    if (c.appliesTo) h += '<p class="note">' + esc(c.appliesTo) + "</p>";
    if (c.todo) h += '<p class="note warn">' + ico("alert") + " " + esc(c.todo) + "</p>";
    return h;
  }

  /* ---- interactive learning path ---- */
  function tabSteps(c) {
    if (!c.steps || !c.steps.length) return '<p class="empty">此課尚無學習路徑。</p>';
    var pr = courseProg(c);
    var nF = 0;
    c.steps.forEach(function (s) { nF += (s.formulas || []).length; });
    var h = '<div class="course-head"><p class="lead">' + esc(c.summary) + "</p>" +
      '<div class="progtxt" id="stepprog">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + '%)</div><div class="progwrap"><div class="progbar" id="stepbar" style="width:' + pr.pct + '%"></div></div>';
    if (nF) {
      h += lazyDetails("cheat", "公式速查（" + nF + " 式，附符號說明）", function () {
        return c.steps.map(function (s) {
          if (!s.formulas || !s.formulas.length) return "";
          return '<div class="fgroup"><div class="fg-t">第 ' + s.step + " 章 · " + esc(s.title) + "</div>" + s.formulas.map(formulaHtml).join("") + "</div>";
        }).join("");
      });
      var nSym = {};
      c.steps.forEach(function (s) { (s.formulas || []).forEach(function (f) { (f.vars || []).forEach(function (v) { nSym[String(v.s).replace(/\s+/g, "")] = 1; }); }); });
      if (Object.keys(nSym).length) h += lazyDetails("cheat symidx", "全課符號總表（" + Object.keys(nSym).length + " 個符號）", function () {
        var full = symbolIndexHtml(c);
        return full.slice(full.indexOf("</summary>") + 10, full.lastIndexOf("</details>"));
      });
    }
    h += "</div>";
    h += '<div class="steps">' + c.steps.map(function (s, i) {
      var done = isDone(c.id, i);
      var hasImg = s.images && s.images.length;
      var meta = [s.noteIndex >= 0 ? "筆記" : "", s.problems && s.problems.length ? "例題 ×" + s.problems.length : "", hasImg ? "投影片 ×" + s.images.length : ""].filter(Boolean).join(" · ");
      return '<div class="step' + (done ? " done" : "") + '" data-i="' + i + '">' +
        '<div class="step-head"><span class="step-no">' + (done ? ico("check") : s.step) + "</span>" +
        '<span class="step-title">' + esc(s.title) + '<span class="step-meta">' + meta + "</span></span>" +
        '<label class="step-chk"><input type="checkbox" ' + (done ? "checked" : "") + ' data-chk="' + i + '"> 完成</label>' +
        '<span class="step-toggle">▾</span></div>' +
        '<div class="step-body collapsed" id="sb' + i + '"></div></div>';
    }).join("") + "</div>";
    return h;
  }
  function galleryHtml(title, arr, gal) {
    if (!arr || !arr.length) return "";
    return '<div class="slides"><div class="sl-t">' + title + '</div><div class="thumbs">' +
      arr.map(function (im, k) {
        var cap = im.caption ? im.caption : (im.src + " p." + im.page);
        return '<div class="thumb" data-gal="' + gal + '" data-k="' + k + '"><img loading="lazy" src="' + im.url + '" alt=""><div class="cap">' + esc(cap) + "</div></div>";
      }).join("") + "</div></div>";
  }
  function inl(t) { return md(t).replace(/^<p>|<\/p>\s*$/g, ""); }
  // 公式 + 白話 + 符號說明表
  function formulaHtml(f) {
    var h = '<div class="formula"><span class="flabel">' + esc(f.label) + '</span><span class="feq">\\[' + esc(f.tex) + '\\]</span>';  // esc:TeX 裡的 < 會被當成 HTML 標籤
    if (f.plain) h += '<div class="fplain">' + inl(f.plain) + "</div>";
    if (f.vars && f.vars.length) h += '<table class="fvars"><tbody>' + f.vars.map(function (v) {
      return '<tr><td class="fs">\\(' + esc(v.s) + '\\)</td><td class="fname">' + inl(v.name || "") +
        (v.note ? '<div class="fnote">' + ico("alert") + " " + inl(v.note) + "</div>" : "") + '</td><td class="funit">' + esc(v.unit || "") + "</td></tr>";
    }).join("") + "</tbody></table>";
    return h + "</div>";
  }
  // 全課符號總表:同一符號在不同章意思不同時分開列
  function coreName(n) { return String(n || "").replace(/[（(].*$/, "").replace(/\s*=.*$/, "").replace(/\s+[A-Za-z].*$/, "").trim(); }
  function symbolIndexHtml(c) {
    var map = {}, order = [];
    c.steps.forEach(function (s) {
      (s.formulas || []).forEach(function (f) {
        (f.vars || []).forEach(function (v) {
          var k = String(v.s).replace(/\s+/g, ""), m = map[k];
          if (!m) { m = map[k] = { s: v.s, defs: [] }; order.push(k); }
          // 同義只是寫法不同(「質量 mass」vs「質量」)就合併,顯示寫得最完整的那個
          var d = null, cv = coreName(v.name);
          for (var i = 0; i < m.defs.length; i++) {
            var cd = coreName(m.defs[i].name);
            if (cd === cv) d = m.defs[i];
          }
          if (d && (v.name || "").length > d.name.length) d.name = v.name;
          if (!d) { d = { name: v.name || "", unit: v.unit || "", note: v.note || "", steps: [] }; m.defs.push(d); }
          if (d.steps.indexOf(s.step) < 0) d.steps.push(s.step);
          if (!d.note && v.note) d.note = v.note;
        });
      });
    });
    if (!order.length) return "";
    function key(k) { return (/^\\[a-zA-Z]/.test(k) ? "1" : "0") + k.replace(/[\\{}_^]/g, "").toLowerCase(); }
    order.sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
    return '<details class="cheat symidx"><summary>全課符號總表（' + order.length + ' 個符號）</summary>' +
      '<input class="sym-q" type="search" placeholder="找符號或中文,例如 阻尼、omega、質量">' +
      '<table class="fvars"><thead><tr><th>符號</th><th>意思</th><th>單位</th><th>章</th></tr></thead>' +
      order.map(function (k) {
        var m = map[k], multi = m.defs.length > 1, q = k.toLowerCase();
        m.defs.forEach(function (d) { q += " " + d.name + " " + d.note; });
        return '<tbody data-q="' + attr(q.toLowerCase()) + '">' + m.defs.map(function (d, i) {
          return "<tr>" + (i === 0 ? '<td class="fs" rowspan="' + m.defs.length + '">\\(' + esc(m.s) + "\\)" + (multi ? '<div class="fmulti">一符多義</div>' : "") + "</td>" : "") +
            '<td class="fname">' + inl(d.name) + (d.note ? '<div class="fnote">' + ico("alert") + " " + inl(d.note) + "</div>" : "") + "</td>" +
            '<td class="funit">' + esc(d.unit) + '</td><td class="fstep">' + d.steps.join("、") + "</td></tr>";
        }).join("") + "</tbody>";
      }).join("") + "</table></details>";
  }
  /* ---- 我的論文(私人,只在本機) ---- */
  function thesisFor(c) { return PRIV && PRIV.courses && c ? PRIV.courses[c.id] || null : null; }
  function findFormula(c, st, label) {
    var s = c.steps[st];
    if (!s) return null;
    for (var i = 0; i < (s.formulas || []).length; i++) if (s.formulas[i].label === label) return s.formulas[i];
    return null;
  }
  function stepChip(c, si) {
    var s = c.steps[si];
    return s ? '<a class="chip link" href="#/c/' + encodeURIComponent(c.id) + "/steps/" + si + '">第 ' + s.step + " 章 · " + esc(s.title) + "</a>" : "";
  }
  function inferredTag(x) { return x ? '<span class="th-inf" title="論文沒有明寫,由對照者推定">推定</span>' : ""; }
  function tabThesis(c) {
    var P = thesisFor(c), LB = P.labels || {}, h = "";
    h += '<div class="th-head"><div class="th-lock">作者專用:只在本機顯示,不會發布到公開網站</div>' +
      "<h2>" + inl(P.title || "我的論文") + "</h2>" + (P.oneLine ? '<p class="sub">' + inl(P.oneLine) + "</p>" : "") + "</div>";
    if (P.overview) h += lazyDetails("th-fold th-ovf", "總覽：這份論文在做什麼、這門課扮演什麼角色", function () { return '<div class="markdown-body">' + md(P.overview, true) + "</div>"; });
    var secs = P.sections || [];
    // 各節已收合成標題列,不再另列目錄
    if (secs.length) h += '<div class="th-all"><button class="btn ghost" data-thall="1">展開全部章節</button><button class="btn ghost" data-thall="0">收合全部</button></div>';
    if (P.symbolDiffs && P.symbolDiffs.length) {
      h += '<details class="cheat th-diff"><summary>' + ico("alert") + ' 論文寫法 ≠ 課程寫法(' + P.symbolDiffs.length + ")</summary>" +
        '<table class="fvars"><thead><tr><th>論文</th><th>課程</th><th>意思</th><th>出現在</th></tr></thead><tbody>' +
        P.symbolDiffs.map(function (d) {
          return "<tr><td>" + inl(d.thesis) + "</td><td>" + inl(d.course) + "</td><td>" + inl(d.meaning || "") + "</td><td>" + inl(d.where || "") + "</td></tr>";
        }).join("") + "</tbody></table></details>";
    }
    secs.forEach(function (x, i) {
      // 整節收合:預設只顯示標題,點開才產生內容(裡面的 5 顆收合也是點開才產生)
      var lid = "lz" + (++lazySeq);
      h += '<details class="th-sec" id="th-' + i + '" data-lazy="' + lid + '"><summary class="th-st"><span class="th-ref">' + esc(x.thesisRef || x.id) + "</span>" +
        "<b>" + inl(x.concept || "") + "</b>" + inferredTag(x.inferred) + "</summary></details>";
      LAZY[lid] = function () {
      var h = "";
      if (x.summary) h += '<p class="th-sum">' + inl(x.summary) + "</p>";
      if (x.steps && x.steps.length) h += '<div class="chips">對應課程:' + x.steps.map(function (si) { return stepChip(c, si); }).join("") + "</div>";
      else h += '<p class="note">此節不在本課範圍。</p>';
      // 細節全部收合:按了才產生內容並排版(手機上一節不再捲十幾個畫面)
      var fs = (x.formulas || []).filter(function (fr) { return findFormula(c, fr.step, fr.label); });
      if (fs.length) h += lazyDetails("th-fold", "用到的課程公式（" + fs.length + "）", function () {
        return fs.map(function (fr) {
          return '<div class="th-f">' + formulaHtml(findFormula(c, fr.step, fr.label)) + (fr.use ? '<div class="th-use"><b>在你的論文裡:</b>' + inl(fr.use) + "</div>" : "") + "</div>";
        }).join("");
      });
      if (x.symbols && x.symbols.length) h += lazyDetails("th-fold", "符號與數值（" + x.symbols.length + "）", function () {
        return '<table class="fvars th-sym"><thead><tr><th>符號</th><th>課程意思</th><th>在你的論文裡</th><th>數值</th></tr></thead><tbody>' +
          x.symbols.map(function (v) {
            return '<tr><td class="fs">' + inl(v.s) + "</td><td>" + inl(v.course || "") + "</td><td>" + inl(v.thesis || "") + inferredTag(v.inferred) +
              (v.diff ? '<div class="fnote">' + ico("alert") + " " + inl(v.diff) + "</div>" : "") + "</td><td>" + inl(v.value || "—") + (v.unit ? " " + esc(v.unit) : "") + "</td></tr>";
          }).join("") + "</tbody></table>";
      });
      if (x.physics) h += lazyDetails("th-fold th-phy", esc(noEmo(LB.physics || "物理意義(白話)")), function () { return '<div class="markdown-body">' + md(x.physics, true) + "</div>"; });
      if (x.check) h += lazyDetails("th-fold th-chk", esc(noEmo(LB.check || "數值合不合理")), function () { return '<div class="markdown-body">' + md(x.check, true) + "</div>"; });
      if (x.notes) h += lazyDetails("th-fold th-nt", "資料來源與推定說明", function () { return '<p class="note">' + inl(x.notes) + "</p>"; });
      return h;
      };
    });
    if (P.openQuestions && P.openQuestions.length) h += '<div class="th-box th-q"><div class="th-bt">值得再確認的地方</div><ul>' +
      P.openQuestions.map(function (q) { return "<li>" + inl(q) + "</li>"; }).join("") + "</ul></div>";
    return h;
  }
  var TH_SEL = ".th-f, tbody tr, .markdown-body > *";
  function bindThesis(root) {
    function nest(d) { bindLazyDetails(d, TH_SEL, nest); }  // 節裡面的收合按鈕也要綁
    bindLazyDetails(root, TH_SEL, nest);
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-thall]"); if (!b) return;
      var open = b.dataset.thall === "1";
      [].forEach.call(root.querySelectorAll("details.th-sec"), function (d) { d.open = open; });
    });
  }
  function focusThesis(i) {
    if (i == null) return;
    var el = document.getElementById("th-" + i);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    setTimeout(function () { el.scrollIntoView({ block: "start" }); el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 1600); }, 60);
  }
  // 每章結尾:這章對應論文哪裡
  function thesisLinkHtml(c, si) {
    var P = thesisFor(c);
    if (!P) return "";
    var hit = [];
    (P.sections || []).forEach(function (x, i) { if ((x.steps || []).indexOf(si) >= 0) hit.push([x, i]); });
    if (!hit.length) return "";
    return '<div class="th-link"><div class="th-bt">這章對應你論文的:</div>' + hit.map(function (p) {
      return '<a href="#/c/' + encodeURIComponent(c.id) + "/thesis/" + p[1] + '"><span class="th-ref">' + esc(p[0].thesisRef || p[0].id) + "</span> " + inl(p[0].concept || "") + " →</a>";
    }).join("") + "</div>";
  }
  /* ---- 延伸資源(雙佐證:GPT 上網搜尋 → Claude 逐筆開頁核對,只收核對通過的項目) ---- */
  function resItem(r) {
    var tag = [r.lang === "zh" ? "中文" : r.lang === "en" ? "英文" : "", r.level].filter(Boolean).join("・");
    return '<li class="res-item"><a href="' + attr(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + EXT + "</a>" +
      (tag ? '<span class="res-tag">' + esc(tag) + "</span>" : "") +
      (r.covers ? '<div class="res-d">' + esc(r.covers) + (r.why ? '<span class="res-why">　' + esc(r.why) + "</span>" : "") + "</div>" : "") + "</li>";
  }
  function resData(d) {
    var tag = [d.dataset, d.id].filter(Boolean).join(" ");
    return '<li class="res-item"><a href="' + attr(d.url) + '" target="_blank" rel="noopener">' + esc(d.title) + EXT + "</a>" +
      (tag ? '<span class="res-tag">' + esc(tag) + "</span>" : "") +
      (d.what ? '<div class="res-d">' + esc(d.what) + "</div>" : "") +
      (d.exercise ? '<div class="res-ex">練習：' + esc(d.exercise) + "</div>" : "") +
      (d.license ? '<div class="res-lic">授權：' + esc(d.license) + "</div>" : "") + "</li>";
  }
  function resourcesHtml(s) {
    var R = s.resources; if (!R) return "";
    var n = (R.top || []).length + (R.more || []).length + (R.data || []).length;
    if (!n) return "";
    return lazyDetails("res-box", "延伸資源（" + n + "）· 外部講解與真實數據", function () {
      var h = "";
      if (R.top && R.top.length) h += '<div class="res-h">最推薦</div><ul class="res-list">' + R.top.map(resItem).join("") + "</ul>";
      if (R.data && R.data.length) h += '<div class="res-h">真實數據（可下載）</div><ul class="res-list">' + R.data.map(resData).join("") + "</ul>";
      if (R.more && R.more.length) h += lazyDetails("res-more", "更多資源（" + R.more.length + "）", function () {
        return '<ul class="res-list">' + R.more.map(resItem).join("") + "</ul>";
      });
      return h + '<p class="res-src">來源經「雙佐證」：GPT 上網搜尋 → Claude 逐筆開頁核對，只收錄核對通過的項目。</p>';
    });
  }
  function nestLazy(d) { bindLazyDetails(d, ".res-item", nestLazy); }  // 收合裡還有收合(更多資源)
  // 步驟結尾:去例題分頁第 N 章練習
  function practiceCtaHtml(c, s, si) {
    if (!s.problems || !s.problems.length) return "";
    var got = s.problems.filter(function (p) { return probGot(c.id, p.id); }).length;
    return '<a class="practice-cta" href="#/c/' + encodeURIComponent(c.id) + "/probs/" + si + '">' +
      '<span class="pc-t"><b>讀完了?去例題練習第 ' + s.step + " 章</b>" +
      '<span class="pc-sub">本章 ' + s.problems.length + " 題 · 我會了 " + got + " 題 · 白話翻譯 → 提示 → 詳解</span></span>" +
      '<span class="pc-go">開始練習 →</span></a>';
  }
  function stepBodyHtml(c, s, si) {
    var h = "";
    if (s.formulas && s.formulas.length) {
      h += '<div class="formulas"><div class="ft">重點公式(表格是每個符號的意思)</div>' + s.formulas.map(formulaHtml).join("") + "</div>";
    }
    if (s.noteIndex >= 0 && c.notes[s.noteIndex]) h += '<div class="markdown-body">' + md(c.notes[s.noteIndex].content) + "</div>";
    else h += '<p class="note">本步驟重點見課程主筆記(見「筆記」分頁)。</p>';
    h += galleryHtml("PDF 原圖(點圖放大,附說明)", s.figures, "fig");
    h += galleryHtml("投影片頁(點圖放大)", s.images, "img");
    if (s.pdfs && s.pdfs.length) {
      h += '<div class="pdfref"><div class="sl-t">參考投影片 PDF(開啟 / 預覽 / 下載)</div>';
      s.pdfs.forEach(function (p) {
        h += '<div class="pdfrow"><span class="pdfname">' + esc(p.title) + "</span>" +
          '<a class="btn ghost" href="' + p.rel + '" target="_blank">開啟' + EXT + '</a>' +
          '<a class="btn ghost" href="' + p.rel + '" download>下載</a>' +
          '<button class="btn ghost pdfprev" data-rel="' + p.rel + '">預覽</button></div>' +
          '<div class="pdfframe hidden"></div>';
      });
      h += "</div>";
    }
    h += resourcesHtml(s);
    h += practiceCtaHtml(c, s, si);
    h += embedCtaHtml(c, si);
    h += thesisLinkHtml(c, si);
    h += '<div class="stepnav">' + (si > 0 ? '<button class="btn ghost" data-go="' + (si - 1) + '">← 上一步</button>' : "<span></span>") +
      '<button class="btn" data-finish="' + si + '">完成這步' + (si < c.steps.length - 1 ? "，下一步 →" : "") + "</button></div>";
    return h;
  }
  function bindSteps(c, openIdx) {
    var cont = main.querySelector(".steps"); if (!cont) return;
    bindLazyDetails(main.querySelector(".course-head"), ".formula, .symidx tbody", function (d) {
      var sq = d.querySelector(".sym-q");
      if (sq) sq.addEventListener("input", function () {
        var q = sq.value.trim().toLowerCase();
        [].forEach.call(d.querySelectorAll("tbody"), function (tb) { tb.style.display = !q || tb.getAttribute("data-q").indexOf(q) >= 0 ? "" : "none"; });
      });
    });
    function refreshProg() {
      var pr = courseProg(c);
      var t = document.getElementById("stepprog"), b = document.getElementById("stepbar");
      if (t) t.textContent = "學習進度 " + pr.done + "/" + pr.total + " (" + pr.pct + "%)";
      if (b) b.style.width = pr.pct + "%";
      renderNav();
    }
    function toggle(stepEl, i) {
      var body = document.getElementById("sb" + i);
      if (body.classList.contains("collapsed")) { if (!body.innerHTML) fill(body, i); body.classList.remove("collapsed"); }
      else body.classList.add("collapsed");
    }
    function fill(body, i) {
      body.innerHTML = stepBodyHtml(c, c.steps[i], i);
      bindLazyDetails(body, ".res-item", nestLazy);
      bindThumbs(body, c.steps[i]).then(function () { annotateTerms(body.querySelector(".markdown-body"), c); });
    }
    function openStep(i) {
      var st = cont.querySelector('.step[data-i="' + i + '"]'), body = document.getElementById("sb" + i); if (!st) return;
      if (!body.innerHTML) fill(body, i);
      body.classList.remove("collapsed");
      st.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    cont.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go) { openStep(parseInt(go.getAttribute("data-go"), 10)); return; }
      var fin = e.target.closest("[data-finish]");
      if (fin) {
        var fi = parseInt(fin.getAttribute("data-finish"), 10), box = cont.querySelector('input[data-chk="' + fi + '"]');
        if (box && !box.checked) { box.checked = true; setDone(c.id, fi, true); var se = cont.querySelector('.step[data-i="' + fi + '"]'); se.classList.add("done"); se.querySelector(".step-no").innerHTML = ico("check"); refreshProg(); }
        document.getElementById("sb" + fi).classList.add("collapsed");
        if (fi < c.steps.length - 1) openStep(fi + 1);
        return;
      }
      var chk = e.target.closest("input[data-chk]");
      if (chk) { var ci = parseInt(chk.getAttribute("data-chk"), 10); setDone(c.id, ci, chk.checked); var st = cont.querySelector('.step[data-i="' + ci + '"]'); st.classList.toggle("done", chk.checked); st.querySelector(".step-no").innerHTML = chk.checked ? ico("check") : c.steps[ci].step; refreshProg(); return; }
      var head = e.target.closest(".step-head");
      if (head && !e.target.closest(".step-body, .step-chk")) { var i = parseInt(head.parentNode.getAttribute("data-i"), 10); toggle(head.parentNode, i); }
    });
    // 預設展開第一步(或指定)
    var first = openIdx || 0;
    var fb = document.getElementById("sb" + first);
    if (fb) { fill(fb, first); fb.classList.remove("collapsed"); }
    if (first > 0) setTimeout(function () { openStep(first); }, 0);  // 等 renderCourse 的 scrollTo(0,0) 之後
  }
  function bindThumbs(body, s) {
    [].forEach.call(body.querySelectorAll(".thumb"), function (el) {
      el.addEventListener("click", function () {
        var gal = el.getAttribute("data-gal"), k = parseInt(el.getAttribute("data-k"), 10);
        openLB(gal === "fig" ? s.figures : s.images, k);
      });
    });
    [].forEach.call(body.querySelectorAll(".pdfprev"), function (btn) {
      btn.addEventListener("click", function () {
        var frame = btn.closest(".pdfrow").nextElementSibling;
        if (frame.classList.contains("hidden")) {
          if (!frame.innerHTML) frame.innerHTML = '<iframe src="' + btn.getAttribute("data-rel") + '"></iframe>';
          frame.classList.remove("hidden"); btn.textContent = "收合";
        } else { frame.classList.add("hidden"); btn.textContent = "預覽"; }
      });
    });
    return typeset(body);
  }

  /* ---- 原教材例題 · 專業詳解 (v3) ---- */
  var QKEY = "stust_prob_v3";
  function probGot(cid, pid) { try { var p = JSON.parse(localStorage.getItem(QKEY) || "{}"); return !!(p[cid] && p[cid][pid]); } catch (e) { return false; } }
  function setProbGot(cid, pid, v) {
    try {
      var p = JSON.parse(localStorage.getItem(QKEY) || "{}"); p[cid] = p[cid] || {};
      if (v) p[cid][pid] = 1; else delete p[cid][pid];
      localStorage.setItem(QKEY, JSON.stringify(p));
    } catch (e) {}
  }
  function allProblems(c) {
    var out = [];
    (c.steps || []).forEach(function (s, si) { (s.problems || []).forEach(function (p) { out.push({ p: p, si: si }); }); });
    return out;
  }
  function findProblem(c, pid) {
    var all = allProblems(c);
    for (var i = 0; i < all.length; i++) if (all[i].p.id === pid) return all[i];
    return null;
  }
  function linkList(arr) {
    return (arr || []).map(function (l) { return '<a href="' + attr(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + EXT + "</a>"; }).join("");
  }
  function probCardHtml(c, p, si) {
    var got = probGot(c.id, p.id), hints = p.hints || [];
    var src = p.source && p.source.label ? p.source.label : (p.source && p.source.path ? p.source.path.split("/").pop() + (p.source.page ? " p." + p.source.page : "") : "");
    var h = '<div class="prob' + (got ? " got" : "") + '" data-pid="' + attr(p.id) + '" data-si="' + si + '">' +
      '<div class="prob-head"><span class="lv lv-' + attr(p.level || "基礎") + '">' + esc(p.level || "基礎") + "</span>" +
      '<span class="org org-' + attr(p.origin || "自編") + '">' + esc(p.origin || "自編") + "</span>" +
      '<span class="prob-title"><span class="pid">' + esc(p.id) + "</span> " + esc(p.title || "") + "</span>" +
      (src ? '<span class="prob-src">' + esc(src) + "</span>" : "") +
      '<label class="prob-got" title="勾起來 = 我已經會解這題"><input type="checkbox" data-got ' + (got ? "checked" : "") + "> 我會了</label></div>" +
      '<div class="prob-q markdown-body">' + md(p.q, true) + "</div>" +
      '<div class="prob-acts">' +
      (p.plain ? '<button class="pbtn" data-act="plain">白話翻譯</button>' : "") +
      (hints.length ? '<button class="pbtn" data-act="hint">提示 <span class="hcnt">0/' + hints.length + "</span></button>" : "") +
      '<button class="pbtn main" data-act="sol">專業詳解</button>' +
      (p.img || p.pdf ? '<button class="pbtn" data-act="orig">看原題頁</button>' : "") +
      '<span class="pai"><button class="pbtn ai" data-act="claude">問 Claude</button>' +
      '<button class="pbtn ai" data-act="chatgpt">問 ChatGPT</button>' +
      '<button class="pbtn ghost" data-act="copy" title="複製給 AI 的提示詞" aria-label="複製給 AI 的提示詞">' + ico("copy") + '</button></span></div>' +
      (p.plain ? '<div class="prob-plain hidden"></div>' : "") +
      '<ol class="prob-hints"></ol>' +
      '<div class="prob-orig hidden">' + (p.img ? '<img loading="lazy" src="' + attr(p.img) + '" alt="原題頁">' : "") +
      (p.pdf ? '<a class="btn ghost" href="' + attr(p.pdf) + '" target="_blank">開啟原 PDF 該頁' + EXT + '</a>' : "") + "</div>" +
      '<div class="prob-sol hidden"></div></div>';
    return h;
  }
  // 詳解內容(點「專業詳解」才產生,減少頁面元素)
  function probSolHtml(p) {
    var h = '<div class="markdown-body">' + md(p.solution, true) + "</div>";
    if (p.answer) h += '<div class="prob-ans"><b>答案</b>　' + md(p.answer).replace(/^<p>|<\/p>\s*$/g, "") + "</div>";
    if (p.pitfalls && p.pitfalls.length) h += '<div class="prob-pit"><b>' + ico("alert") + ' 常見錯誤</b><ul>' + p.pitfalls.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>\s*$/g, "") + "</li>"; }).join("") + "</ul></div>";
    if (p.notes && p.notes.length) h += '<div class="prob-notes"><b>術語註釋</b><dl>' + p.notes.map(function (n) {
      return "<dt>" + esc(n.term) + (n.url ? ' <a href="' + attr(n.url) + '" target="_blank" rel="noopener" aria-label="延伸閱讀">' + ico("ext") + '</a>' : "") + "</dt><dd>" + md(n.def).replace(/^<p>|<\/p>\s*$/g, "") + "</dd>";
    }).join("") + "</dl></div>";
    if (p.links && p.links.length) h += '<div class="prob-links"><b>延伸閱讀</b> ' + linkList(p.links) + "</div>";
    return h;
  }
  function stripMd(t) { return String(t || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "[圖]").replace(/[*_`>#]/g, "").trim(); }
  function aiPrompt(c, p, si) {
    var st = c.steps[si] || {};
    var q = stripMd(p.q); if (q.length > 1400) q = q.slice(0, 1400) + "…";
    return "我是南臺科大學生，正在學「" + c.title + "」的「" + (st.title || "") + "」。\n" +
      "請用繁體中文，以考試寫法（已知 / 求 / 觀念 / 逐步計算含單位 / 檢查）帶我解下面這題，並解釋每一步為什麼要這樣做、對應課本上的哪個專業觀念。" +
      "請先只給第一步提示，等我回覆後再繼續。\n\n【題目】" + q +
      (p.answer ? "\n\n【參考答案（請幫我確認並解釋）】" + stripMd(p.answer) : "") + "\n\n【我卡住的地方】";
  }
  function copyText(t, btn) {
    function ok() { if (btn) { var o = btn.innerHTML; btn.innerHTML = ico("check") + " 已複製"; setTimeout(function () { btn.innerHTML = o; }, 1400); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fallback); else fallback();
    function fallback() { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) {} document.body.removeChild(ta); }
  }
  function askAI(which, c, p, si) {
    var t = aiPrompt(c, p, si), enc = encodeURIComponent(t);
    var url = which === "claude" ? "https://claude.ai/new?q=" + enc : "https://chatgpt.com/?q=" + enc;
    copyText(t);   // 備援:若網站沒吃到預填,直接貼上即可
    window.open(url, "_blank", "noopener");
  }
  function bindProblems(root, c) {
    if (!root || root._probBound) return; root._probBound = true;
    root.addEventListener("change", function (e) {
      var g = e.target.closest("input[data-got]"); if (!g) return;
      var card = g.closest(".prob"); setProbGot(c.id, card.dataset.pid, g.checked); card.classList.toggle("got", g.checked);
      var sum = document.getElementById("probsum"); if (sum) sum.textContent = probSummary(c);
    });
    root.addEventListener("click", function (e) {
      var b = e.target.closest(".pbtn"); if (!b) return;
      var card = b.closest(".prob"), f = findProblem(c, card.dataset.pid); if (!f) return;
      var p = f.p, act = b.dataset.act;
      function tog(sel) { var el = card.querySelector(sel); if (!el) return null; el.classList.toggle("hidden"); b.classList.toggle("on", !el.classList.contains("hidden")); return el; }
      if (act === "plain") { var pl = tog(".prob-plain"); if (pl && !pl.innerHTML) { pl.innerHTML = md(p.plain, true); typeset(pl); } }
      else if (act === "hint") {
        var ol = card.querySelector(".prob-hints"), n = ol.children.length, hs = p.hints || [];
        if (n < hs.length) { var li = document.createElement("li"); li.innerHTML = md(hs[n]).replace(/^<p>|<\/p>\s*$/g, ""); ol.appendChild(li); typeset(li); n++; }
        b.querySelector(".hcnt").textContent = n + "/" + hs.length;
        if (n >= hs.length) b.classList.add("on");
      }
      else if (act === "sol") { var so = tog(".prob-sol"); if (so && !so.innerHTML) { so.innerHTML = probSolHtml(p); typeset(so).then(function () { annotateTerms(so.querySelector(".markdown-body"), c); }); } }
      else if (act === "orig") tog(".prob-orig");
      else if (act === "claude" || act === "chatgpt") askAI(act, c, p, f.si);
      else if (act === "copy") copyText(aiPrompt(c, p, f.si), b);
    });
    root.addEventListener("click", function (e) {
      var im = e.target.closest(".prob-orig img"); if (!im) return;
      openLB([{ url: im.getAttribute("src"), caption: "原題頁", src: "", page: 0 }], 0);
    });
  }
  function probSummary(c) {
    var all = allProblems(c), got = all.filter(function (x) { return probGot(c.id, x.p.id); }).length;
    return "共 " + all.length + " 題 · 我會了 " + got + " 題";
  }
  function tabProblems(c) {
    var all = allProblems(c);
    if (!all.length) return '<p class="empty">此課尚無例題。</p>';
    var h = '<div class="pfilter"><span id="probsum" class="progtxt">' + probSummary(c) + "</span>" +
      '<select id="pf-step"><option value="">全部章節</option>' + c.steps.map(function (s, i) {
        return (s.problems && s.problems.length) ? '<option value="' + i + '">第 ' + s.step + " 章 " + esc(s.title) + "（" + s.problems.length + "）</option>" : "";
      }).join("") + "</select>" +
      '<select id="pf-lv"><option value="">全部難度</option><option>基礎</option><option>考試</option><option>進階</option></select>' +
      '<label class="pf-chk"><input type="checkbox" id="pf-todo"> 只看還不會的</label></div>';
    if (c.glossary && c.glossary.length) h += '<details class="cheat gloss"><summary>全課術語註釋（' + c.glossary.length + ' 條）</summary><dl>' +
      c.glossary.map(function (g) {
        return "<dt>" + esc(g.term) + (g.alias && g.alias.length ? ' <span class="alias">' + esc(g.alias.join(" / ")) + "</span>" : "") +
          (g.url ? ' <a href="' + attr(g.url) + '" target="_blank" rel="noopener" aria-label="延伸閱讀">' + ico("ext") + '</a>' : "") + "</dt><dd>" + esc(g.def) + "</dd>";
      }).join("") + "</dl></details>";
    h += '<div id="plist">' + c.steps.map(function (s, i) {
      if (!s.problems || !s.problems.length) return "";
      return '<div class="pgroup" data-si="' + i + '"><h3>第 ' + s.step + " 章 · " + esc(s.title) +
        ' <a class="pg-back" href="#/c/' + encodeURIComponent(c.id) + "/steps/" + i + '">← 回本章筆記</a></h3>' +
        s.problems.map(function (p) { return probCardHtml(c, p, i); }).join("") + "</div>";
    }).join("") + "</div>";
    return h;
  }
  function bindProblemTab(c, si) {
    var list = document.getElementById("plist"); if (!list) return;
    bindProblems(list, c);
    function apply() {
      var st = $("#pf-step").value, lv = $("#pf-lv").value, todo = $("#pf-todo").checked;
      [].forEach.call(list.querySelectorAll(".pgroup"), function (g) {
        var any = false;
        [].forEach.call(g.querySelectorAll(".prob"), function (card) {
          var f = findProblem(c, card.dataset.pid), show = true;
          if (st !== "" && String(f.si) !== st) show = false;
          if (lv && (f.p.level || "基礎") !== lv) show = false;
          if (todo && probGot(c.id, f.p.id)) show = false;
          card.style.display = show ? "" : "none"; if (show) any = true;
        });
        g.style.display = any ? "" : "none";
      });
    }
    ["#pf-step", "#pf-lv", "#pf-todo"].forEach(function (s) { $(s).addEventListener("change", apply); });
    if (si !== null && si !== undefined && c.steps[si] && c.steps[si].problems && c.steps[si].problems.length) { $("#pf-step").value = String(si); apply(); }
    typesetLazy(list, ".prob", function (card) { annotateTerms(card.querySelector(".prob-q"), c); });
  }

  /* ---- 術語自動註解:筆記中每個術語第一次出現 → 虛線底 + 浮動說明 + 外部連結 ---- */
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function annotateTerms(el, c) {
    var G = c.glossary; if (!el || !G || !G.length) return;
    var map = {}, keys = [];
    G.forEach(function (g, gi) {
      [g.term].concat(g.alias || []).forEach(function (k) {
        if (!k || k.length < 2) return; var lk = k.toLowerCase();
        if (!(lk in map)) { map[lk] = gi; keys.push(k); }
      });
    });
    if (!keys.length) return;
    keys.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp(keys.map(reEsc).join("|"), "gi"), used = {};
    var SKIP = /^(PRE|CODE|A|SCRIPT|STYLE|MJX-CONTAINER|H1|BUTTON|TEXTAREA|SELECT|DT|SUMMARY)$/;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var p = n.parentNode; p && p !== el; p = p.parentNode) {
          if (SKIP.test(p.nodeName) || (p.classList && (p.classList.contains("term") || p.classList.contains("prob-acts")))) return NodeFilter.FILTER_REJECT;
        }
        return /\$|\\\(|\\\[|@@MATH/.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue, m, last = 0, frag = null; re.lastIndex = 0;
      while ((m = re.exec(text))) {
        var gi = map[m[0].toLowerCase()];
        if (gi === undefined || used[gi]) continue;
        used[gi] = true; frag = frag || document.createDocumentFragment();
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var g = G[gi], sp = document.createElement("span");
        sp.className = "term"; sp.tabIndex = 0; sp.textContent = m[0];
        var tip = document.createElement("span"); tip.className = "tip";
        tip.innerHTML = "<b>" + esc(g.term) + "</b>" + (g.alias && g.alias.length ? ' <i>' + esc(g.alias.join(" / ")) + "</i>" : "") +
          "<br>" + esc(g.def) + (g.url ? '<br><a href="' + attr(g.url) + '" target="_blank" rel="noopener">延伸閱讀' + EXT + '</a>' : "");
        sp.appendChild(tip); frag.appendChild(sp); last = m.index + m[0].length;
      }
      if (frag) { frag.appendChild(document.createTextNode(text.slice(last))); node.parentNode.replaceChild(frag, node); }
    });
  }

  /* ---- notes ---- */
  function tabNotes(c, idx) {
    if (!c.notes.length) return '<p class="empty">此課尚無可顯示的筆記。</p>';
    idx = Math.min(idx || 0, c.notes.length - 1);
    return '<div class="noteswrap"><div class="notelist">' + c.notes.map(function (n, i) {
      return '<button class="noteitem ' + (i === idx ? "active" : "") + '" data-i="' + i + '">' + esc(n.title) + (n.primary ? ' <span class="pill">主要</span>' : "") + "</button>";
    }).join("") + '</div><article class="markdown-body" id="notebody">' + md(c.notes[idx].content) + "</article></div>";
  }
  function bindNotes(c) {
    var list = main.querySelector(".notelist"); if (!list) return;
    list.addEventListener("click", function (e) {
      var b = e.target.closest(".noteitem"); if (!b) return;
      [].forEach.call(list.querySelectorAll(".noteitem"), function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      var nb = document.getElementById("notebody");
      nb.innerHTML = md(c.notes[parseInt(b.dataset.i, 10)].content);
      typeset(nb).then(function () { annotateTerms(nb, c); });
      window.scrollTo(0, 0);
    });
  }

  /* ---- quiz ---- */
  // 選項每次隨機排列(題庫正解常集中在 A);data-k 保留原始索引供判分
  function shuffled(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function tabQuiz(c) {
    var q = c.quiz; if (!q || !q.items) return '<p class="empty">無測驗。</p>';
    var h = '<div class="qscore" id="qscore">' + esc(q.title || "互動測驗") + "　得分 0 / " + q.items.length + "</div>";
    if (q.note) h += '<p class="progtxt" style="margin:6px 2px">' + esc(q.note) + "</p>";
    h += '<div class="quiz">' + q.items.map(function (it, i) {
      return '<div class="qcard" data-i="' + i + '"><div class="qq"><span class="qn">Q' + (i + 1) + ".</span>" + esc(it.q) + "</div>" +
        shuffled(it.options.map(function (o, k) { return '<button class="qopt" data-k="' + k + '">' + esc(o) + "</button>"; })).join("") +
        '<div class="qexp hidden"></div></div>';
    }).join("") + "</div>";
    return h;
  }
  function bindQuiz(c) {
    var q = c.quiz, answered = {}, score = 0;
    var wrap = main.querySelector(".quiz"); if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      var opt = e.target.closest(".qopt"); if (!opt) return;
      var card = opt.closest(".qcard"), i = parseInt(card.dataset.i, 10);
      if (answered[i]) return;
      answered[i] = true;
      var k = parseInt(opt.dataset.k, 10), correct = q.items[i].a;
      [].forEach.call(card.querySelectorAll(".qopt"), function (b) {
        var bk = parseInt(b.dataset.k, 10);
        b.classList.add("disabled");
        if (bk === correct) b.classList.add("correct");
        if (bk === k && k !== correct) b.classList.add("wrong");
      });
      if (k === correct) score++;
      var exp = card.querySelector(".qexp"); exp.innerHTML = (k === correct ? ico("check") + " 正確。" : ico("x") + " 正解是「" + esc(q.items[i].options[correct]) + "」。") + esc(q.items[i].explain || ""); exp.classList.remove("hidden");
      document.getElementById("qscore").textContent = (q.title || "互動測驗") + "　得分 " + score + " / " + q.items.length;
    });
  }

  /* ---- embed ---- */
  function tabEmbed(c) {
    // 外部工具在手機上不內嵌(太擠),改成大按鈕開新視窗
    var narrow = !!(window.matchMedia && window.matchMedia("(max-width: 820px)").matches);
    return c.embeds.map(function (e) {
      var meta = e.external ? '<div class="embed-meta">' + (e.desc ? esc(e.desc) + "<br>" : "") +
        "外部網站（非本站製作）· 作者 " + esc(e.author || "—") + (e.license ? " · 授權 " + esc(e.license) : "") +
        (e.source ? ' · <a href="' + attr(e.source) + '" target="_blank" rel="noopener">原始碼' + EXT + '</a>' : "") + "</div>" : "";
      var body = e.external && narrow
        ? '<a class="btn embed-big" href="' + attr(e.rel) + '" target="_blank" rel="noopener">在新視窗開啟 ' + esc(e.title) + EXT + "</a>"
        : '<iframe src="' + e.rel + '" loading="lazy"></iframe>';
      return '<div class="embedwrap"><h3>' + esc(e.title) + '<a class="embed-open" href="' + e.rel + '" target="_blank" rel="noopener">開新視窗' + EXT + '</a></h3>' + meta + body + "</div>";
    }).join("");
  }
  // 章末:這一步有對應的互動工具就提示去玩
  function embedCtaHtml(c, si) {
    return (c.embeds || []).filter(function (e) { return e.steps && e.steps.indexOf(si) >= 0; }).map(function (e) {
      return '<a class="practice-cta embed-cta" href="#/c/' + encodeURIComponent(c.id) + '/embed">' +
        '<span class="pc-t"><b>動手玩：' + esc(e.title) + "</b>" + (e.desc ? '<span class="pc-sub">' + esc(e.desc) + "</span>" : "") + "</span>" +
        '<span class="pc-go">打開互動工具 →</span></a>';
    }).join("");
  }

  /* ---- materials ---- */
  function tabMat(c) {
    var cats = [["lectures", "講義"], ["notes", "筆記檔"], ["data", "數據與工具"], ["external", "外部資源"], ["homework", "作業"]];
    var h = "";
    cats.forEach(function (p) {
      var arr = c.materials[p[0]] || []; if (!arr.length) return;
      h += "<h3>" + p[1] + '</h3><ul class="matlist">' + arr.map(function (m) {
        return '<li><a href="' + m.rel + '" target="_blank">' + esc(m.label) + (m.type === "url" ? EXT : "") + "</a>" + (m.desc ? '<span class="mdesc">' + esc(m.desc) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
    });
    return h || '<p class="empty">無資料。</p>';
  }

  /* ---- PI 資料庫:只連 PI 官網原檔(索引由 _整合/library/make_pi_library.py 產生) ---- */
  var LIBK = { CAT: "型錄", BRO: "手冊", TEC: "技術文", WP: "白皮書", SS: "應用案例", DS: "規格書" };
  var LIBP = "https://www.physikinstrumente.com/fileadmin/user_upload/";
  function libFor(c) { return (D.library || []).filter(function (x) { return x.courses.indexOf(c.id) >= 0; }); }
  function libTitle(x) { return x.kind === "DS" ? x.id + " " + x.t : x.t; }
  function libItem(x) {
    return '<li class="lib-item"><span class="lib-k">' + LIBK[x.kind] + "</span> <b>" + esc(libTitle(x)) + "</b>" +
      (x.zh ? '<span class="mdesc">' + esc(x.zh) + "</span>" : "") +
      '<span class="lib-a"><a href="' + x.url + '" target="_blank" rel="noopener">官網 PDF（英文）</a>' +
      (x.urlCN ? ' · <a href="' + x.urlCN + '" target="_blank" rel="noopener">中文版</a>' : "") + "</span></li>";
  }
  function tabLib(c) {
    var L = libFor(c), kinds = Object.keys(LIBK).filter(function (k) { return L.some(function (x) { return x.kind === k; }); });
    return '<p class="note">從 PI（Physik Instrumente）官網整理的技術文件，連結直接開官網原檔。也可以問右下角的 AI 助教「這章有什麼資料可以看」。</p>' +
      '<div class="lib-bar"><input class="lib-q" type="search" placeholder="搜尋：中文、日文、英文或型號，例如 遲滯、ヒステリシス、hexapod、E-505">' +
      '<div class="chips"><button class="chip link lib-f active" data-k="">全部</button>' +
      kinds.map(function (k) { return '<button class="chip link lib-f" data-k="' + k + '">' + LIBK[k] + "</button>"; }).join("") +
      '</div></div><p class="lib-n"></p><ul class="matlist lib-list">' + L.map(libItem).join("") + "</ul>";
  }
  // 中日文自動翻成英文:D.libGloss = [[英文詞們], [中日文寫法們]];x.g = 這份 PDF 全文出現的詞表索引(make_pi_library.py 產生)
  var LIBCJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/, libForms = null, libFormMax = 0;
  function libTrans(w) {   // 回傳 [{src, ids}];中日文用最長比對切詞(沒在詞表的字略過),英文只認詞表裡的詞(含複數)
    if (!libForms) {
      libForms = {};
      (D.libGloss || []).forEach(function (g, i) {
        g[1].forEach(function (f) {
          f = f.toLowerCase(); libForms[f] = libForms[f] || [];
          if (libForms[f].indexOf(i) < 0) libForms[f].push(i);   // 中文和日文同字(例:六軸)只記一次
          libFormMax = Math.max(libFormMax, f.length);
        });
      });
    }
    var out = [];
    if (!LIBCJK.test(w)) {
      var ids = [];
      (D.libGloss || []).forEach(function (g, i) {
        if (g[0].some(function (e) { e = e.toLowerCase(); return e === w || (e.length > 3 && w.indexOf(e) === 0 && w.length - e.length <= 2); })) ids.push(i);
      });
      return ids.length ? [{ src: w, ids: ids }] : [];
    }
    for (var p = 0; p < w.length;) {
      for (var n = Math.min(libFormMax, w.length - p); n > 0; n--) {
        var f = w.substr(p, n);
        if (libForms.hasOwnProperty(f)) { out.push({ src: f, ids: libForms[f] }); break; }
      }
      p += n || 1;
    }
    return out;
  }
  function bindLib(c) {
    var L = libFor(c), box = document.getElementById("tabc"), q = box.querySelector(".lib-q"), k = "", G = D.libGloss || [];
    var items = box.querySelectorAll(".lib-item"), txt = L.map(function (x) { return [x.id, x.t, x.zh, x.desc].join(" ").toLowerCase(); });
    var tag = L.map(function (x) { var o = {}; (x.g || []).forEach(function (j) { o[j] = 1; }); return o; });
    function hit(i, w, segs) {   // 原字直接出現,或每個切出的詞都對到(中日原文 / 英文 tag / 英文出現在標題介紹)
      return txt[i].indexOf(w) >= 0 || (segs.length > 0 && segs.every(function (s) {
        return txt[i].indexOf(s.src) >= 0 || s.ids.some(function (j) {
          return tag[i][j] || G[j][0].some(function (e) { return txt[i].indexOf(e.toLowerCase()) >= 0; });
        });
      }));
    }
    function apply() {   // 空白分開的每個詞都要出現
      var ws = q.value.toLowerCase().split(/\s+/).filter(Boolean), n = 0, tr = [];
      var segs = ws.map(function (w) {
        var s = libTrans(w);
        if (LIBCJK.test(w)) s.forEach(function (x) { tr.push(x.src + " → " + x.ids.map(function (j) { return G[j][0][0]; }).join(" / ")); });
        return s;
      });
      L.forEach(function (x, i) {
        var on = (!k || x.kind === k) && ws.every(function (w, wi) { return hit(i, w, segs[wi]); });
        items[i].hidden = !on; if (on) n++;
      });
      box.querySelector(".lib-n").textContent = "顯示 " + n + " / " + L.length + " 份" + (tr.length ? "　自動翻譯：" + tr.join("、") : "");
    }
    q.addEventListener("input", apply);
    box.querySelector(".lib-bar .chips").addEventListener("click", function (e) {
      var b = e.target.closest(".lib-f"); if (!b) return;
      k = b.dataset.k;
      [].forEach.call(box.querySelectorAll(".lib-f"), function (x) { x.classList.toggle("active", x === b); });
      apply();
    });
    apply();
  }
  // 給 AI 助教的精簡清單(約 8k token):規格書只給型號、中文只留第一句、網址共同前綴只寫一次
  var LIBDS = LIBP + "physik_instrumente/files/datasheets/";
  function libCtx(c) {
    var L = libFor(c); if (!L.length) return "";
    return "\n\n【PI 資料庫(可推薦)】\n網址:每行最後的路徑若以 ds/ 開頭,完整網址 = " + LIBDS + " + ds/ 後面的檔名;其他 = " + LIBP + " + 路徑。\n" +
      L.map(function (x) {
        return "- " + LIBK[x.kind] + "|" + (x.kind === "DS" ? x.id : x.t) + "|" + String(x.zh || "").split("｜")[0] + "|" +
          (x.url.indexOf(LIBDS) === 0 ? "ds/" + x.url.slice(LIBDS.length) : x.url.replace(LIBP, ""));
      }).join("\n");
  }

  /* ---------- search ---------- */
  var sidx = null;
  function buildIndex() {
    sidx = [];
    D.courses.forEach(function (c) {
      c.notes.forEach(function (n, i) { sidx.push({ cid: c.id, ctitle: c.title, href: "#/c/" + c.id + "/notes/" + i, title: n.title, text: (n.title + "\n" + n.content).toLowerCase() }); });
      allProblems(c).forEach(function (x) { var p = x.p; sidx.push({ cid: c.id, ctitle: c.title, href: "#/c/" + c.id + "/probs", title: "例題 " + p.id + " " + (p.title || ""), text: [p.title, p.q, p.plain, p.solution].join("\n").toLowerCase() }); });
    });
  }
  search.addEventListener("input", function () {
    var q = search.value.trim().toLowerCase();
    if (q.length < 2) { route(); return; }
    if (!sidx) buildIndex();
    var hits = sidx.filter(function (x) { return x.text.indexOf(q) >= 0; }).slice(0, 40);
    main.innerHTML = '<header class="chead"><h1>搜尋:「' + esc(search.value.trim()) + '」</h1><p class="sub">' + hits.length + " 筆結果</p></header>" +
      (hits.length ? '<div class="results">' + hits.map(function (x) {
        var pos = x.text.indexOf(q), snip = x.text.slice(Math.max(0, pos - 40), pos + 60);
        return '<a class="result" href="' + x.href + '"><b>' + x.ctitle + "</b> › " + esc(x.title) + '<span class="snip">…' + esc(snip) + "…</span></a>";
      }).join("") + "</div>" : '<p class="empty">查無結果。</p>');
  });
  main.addEventListener("click", function (e) { var r = e.target.closest(".result"); if (r && r.getAttribute("href") === location.hash) { search.value = ""; route(); } });  // 同頁結果不會觸發 hashchange

  /* ---------- 字體大小(記在瀏覽器) ---------- */
  var ZKEY = "stust_zoom";
  function setZoom(z) { z = Math.max(0.85, Math.min(1.5, Math.round(z * 100) / 100)); document.documentElement.style.setProperty("--zoom", z); try { localStorage.setItem(ZKEY, z); } catch (e) {} }
  var z0 = 1; try { z0 = parseFloat(localStorage.getItem(ZKEY)) || 1; } catch (e) {}
  setZoom(z0);
  [["fs-dn", -0.1], ["fs-up", 0.1], ["fs-rs", 0]].forEach(function (b) {
    var el = document.getElementById(b[0]); if (!el) return;
    el.onclick = function () { var cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1; setZoom(b[1] ? cur + b[1] : 1); };
  });

  /* ---------- 淺色/深色主題(auto = 跟隨系統;index.html <head> 先套用避免閃爍) ---------- */
  var TKEY = "stust_theme", THEMES = { auto: ["sunmoon", "跟隨系統"], light: ["sun", "淺色"], dark: ["moon", "深色"] };
  function setTheme(mode) {
    if (!THEMES[mode]) mode = "auto";
    if (mode === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    try { if (mode === "auto") localStorage.removeItem(TKEY); else localStorage.setItem(TKEY, mode); } catch (e) {}
    var b = document.getElementById("theme-btn");
    if (b) { b.innerHTML = ico(THEMES[mode][0]); b.title = "主題：" + THEMES[mode][1] + "(點一下切換)"; b.dataset.mode = mode; }
  }
  setTheme(document.documentElement.dataset.theme || "auto");
  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) themeBtn.onclick = function () { setTheme({ auto: "light", light: "dark", dark: "auto" }[themeBtn.dataset.mode]); };

  /* ---------- localStorage 小工具(AI 助教用) ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  lsDel("stust_ak");   // 2026-10-30 起停用的舊功能留下的裝置金鑰,清掉

  /* ---------- AI 助教 ----------
     A 轉交:組好「規則 + 本章教材 + 問題」開 Claude / ChatGPT(免費,完整教材另複製到剪貼簿)
     C 自備金鑰:使用者自己的 Anthropic API 金鑰只存在他的瀏覽器,SDK 第一次用才從 CDN 載入、直接串流回答
     只用公開的 SITE_DATA,論文對照(PRIVATE)永遠不放進去 */
  var TK = "stust_claude_key", TM = "stust_tutor_model";
  var SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm";
  var MODELS = [["claude-opus-5-5", "Claude Opus 5.5(最準;約 US$4 / 20 每百萬 token)"],
                ["claude-sonnet-5-5", "Claude Sonnet 5.5(平衡;約 US$2 / 10)"],
                ["claude-haiku-5-5", "Claude Haiku 5.5(最便宜;約 US$0.1 / 0.5)"]];
  var QUICK = [["解釋這一章", "請用白話帶我讀懂這一章:先一句話總結,再列 3–5 個重點觀念(每個配一個例子或數字),最後告訴我考試最常考哪裡。"],
               ["我卡住了", "我卡在:(寫下題號或卡住的地方)\n請先只給我第一步提示,不要直接給完整答案。"],
               ["出 5 題練習", "請依這一章出 5 題練習(2 題觀念、2 題計算、1 題應用),由淺到深,每題標出對應的公式。先只出題目,解答統一放在最後的「解答」段落,讓我先自己作答。"]];
  var T = { open: false, c: null, si: 0, msgs: [], busy: false, sdk: null, owner: false };
  var tutorBtn = document.createElement("button"), tutorBox = document.createElement("aside");
  tutorBtn.id = "tutor-btn"; tutorBtn.className = "hidden"; tutorBtn.innerHTML = ico("cap") + '<span class="tb-t">AI 助教</span>'; tutorBtn.setAttribute("aria-label", "AI 助教");
  tutorBox.id = "tutor"; tutorBox.className = "hidden"; tutorBox.setAttribute("aria-label", "AI 助教");
  document.body.appendChild(tutorBtn); document.body.appendChild(tutorBox);

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  function tutorOwner() { return !!(PRIV && PRIV.claudeKey); }   // 本機版(private.js 有金鑰)用作者自己的金鑰
  function tutorKey() { return (PRIV && PRIV.claudeKey) || ssGet(TK) || lsGet(TK) || ""; }
  function tutorModel() { var m = lsGet(TM); return MODELS.some(function (x) { return x[0] === m; }) ? m : MODELS[0][0]; }
  function tutorEl(sel) { return tutorBox.querySelector(sel); }

  function tutorSync() {   // route() 每次換頁呼叫:跟著目前的課程/章節走,換章就清空對話
    var m = location.hash.match(/^#\/c\/([^/]+)(?:\/(\w+))?(?:\/(\d+))?/), c = m && byId(decodeURIComponent(m[1]));
    tutorBtn.classList.toggle("hidden", !c);
    if (!c) { tutorShow(false); return; }
    var si = (m[2] === "steps" || m[2] === "probs") && m[3] ? Math.min(+m[3], c.steps.length - 1) : (T.c === c ? T.si : 0);
    var own = tutorOwner();   // 登入/登出作者模式也要換面板
    if (T.c !== c || T.si !== si || T.owner !== own) { T.c = c; T.si = si; T.owner = own; T.msgs = []; if (T.open) tutorRender(); }
  }
  function tutorShow(open) {
    T.open = open; tutorBox.classList.toggle("hidden", !open); tutorBtn.classList.toggle("on", open);
    if (open) { tutorRender(); tutorEl(".tt-in").focus(); }
  }

  function tutorRules(c) {
    return "你是南臺科技大學「" + c.title + "」課程的 AI 助教,學生正在讀下面這一章。\n規則:\n" +
      "1. 用繁體中文(台灣用語)回答,簡潔清楚,一次以 600 字內為原則,除非學生要求詳細。\n" +
      "2. 以【本章教材】為主要依據,引用時說出是哪個公式或哪一段;教材沒有的內容可以補充,但要標明「教材外補充」。\n" +
      "3. 先引導再給答案:學生問題目時先給提示並問他下一步;學生已經嘗試過或明確要求時,才給完整解。\n" +
      "4. 計算要寫單位,每一步說明理由;不確定就說不確定,不要編造數字或出處。\n" +
      "5. 數學式用 LaTeX:行內 $...$,獨立一行用 $$...$$。\n" +
      "6. 你自己出的練習題,答案放在最後,並註明「AI 即時產生,未經驗算」。" +
      (libFor(c).length ? "\n7. 學生想深入,或問到應用、產品、規格時,從【PI 資料庫】挑最多 3 份最相關的推薦,說明為什麼值得看,並附完整網址;只能推薦清單裡的文件,不可自己編文件或網址。" : "");
  }
  function tutorContext(c, si) {
    var st = c.steps[si] || {}, note = String((c.notes[st.noteIndex] || {}).content || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "[圖]");
    var f = (st.formulas || []).map(function (x) {
      return "- " + x.label + ":$" + x.tex + "$" + (x.plain ? "(" + x.plain + ")" : "") +
        (x.vars && x.vars.length ? "\n  符號:" + x.vars.map(function (v) { return v.s + " = " + v.name + (v.unit ? " [" + v.unit + "]" : ""); }).join(";") : "");
    }).join("\n");
    var ps = (st.problems || []).map(function (p) { var q = stripMd(p.q); return "- " + p.id + " " + (p.title || "") + ":" + (q.length > 500 ? q.slice(0, 500) + "…" : q); }).join("\n");
    var g = (c.glossary || []).filter(function (x) { return x.term && note.indexOf(x.term) >= 0; }).map(function (x) { return "- " + x.term + ":" + stripMd(x.def); }).join("\n");
    return "【本章教材】\n【課程】" + c.title + (c.subtitle ? "(" + c.subtitle + ")" : "") +
      "\n【章節】第 " + (st.step || si + 1) + " 章 " + (st.title || "") + (st.ref ? "(出處:" + st.ref + ")" : "") +
      (f ? "\n\n【本章公式】\n" + f : "") + "\n\n【本章筆記】\n" + note +
      (ps ? "\n\n【本章例題(只有題目)】\n" + ps : "") + (g ? "\n\n【相關術語】\n" + g : "") + libCtx(c);
  }

  // A 轉交:網址 ?q= 有長度上限,只帶短版;完整教材複製到剪貼簿,需要時貼上
  function tutorHandoff(which) {
    var c = T.c, st = c.steps[T.si] || {}, q = tutorEl(".tt-in").value.trim() || QUICK[0][1];
    var f = (st.formulas || []).map(function (x) { return x.label + ":" + x.tex; }).join(";");
    var short = tutorRules(c) + "\n\n【課程】" + c.title + "\n【章節】第 " + (st.step || T.si + 1) + " 章 " + (st.title || "") +
      (f ? "\n【本章公式】" + f.slice(0, 600) : "") + "\n(如果需要本章完整筆記請跟我說,我會貼給你)\n\n【我的問題】\n" + q;
    copyText(tutorRules(c) + "\n\n" + tutorContext(c, T.si) + "\n\n【我的問題】\n" + q);
    window.open((which === "claude" ? "https://claude.ai/new?q=" : "https://chatgpt.com/?q=") + encodeURIComponent(short), "_blank", "noopener");
    tutorNote("已開新分頁。本章完整教材已複製,對方需要時在對話框貼上(Ctrl+V)即可。");
  }

  // C 自備金鑰:Opus/Sonnet 加伺服器端 fallback(被安全機制拒答時自動換模型);Haiku 沒有
  function loadSDK() { return T.sdk || (T.sdk = import(SDK_URL).then(function (m) { return m.default || m.Anthropic; })); }
  function tutorAsk() {
    var c = T.c, inp = tutorEl(".tt-in"), q = inp.value.trim(), key = tutorKey();
    if (!q || T.busy) return;
    if (!key) { tutorEl(".tt-set").open = true; tutorNote("先在下方「設定」貼上你的 Anthropic API 金鑰;或改按「用 Claude / ChatGPT 開啟」(免費)。"); return; }
    var model = tutorModel(), out = { role: "assistant", content: "" };
    T.msgs.push({ role: "user", content: q }, out); T.busy = true; inp.value = ""; tutorLog();
    var body = tutorEl(".tt-log .tt-msg:last-child .tt-body");
    loadSDK().then(function (Anthropic) {
      var client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }), fb = /opus|sonnet/.test(model);
      var params = {
        model: model, max_tokens: 16000, output_config: { effort: "medium" },
        system: [{ type: "text", text: tutorRules(c) + "\n\n" + tutorContext(c, T.si), cache_control: { type: "ephemeral" } }],
        messages: T.msgs.slice(0, -1).map(function (m) { return { role: m.role, content: m.content }; })
      };
      if (fb) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
      var stream = (fb ? client.beta.messages : client.messages).stream(params);
      stream.on("text", function (d) { out.content += d; body.textContent = out.content; tutorScroll(); });
      return stream.finalMessage();
    }).then(function (msg) {
      if (msg.stop_reason === "refusal") out.content = out.content || "(這個問題被安全機制拒絕回答,請換個問法。)";
      else if (msg.stop_reason === "max_tokens") out.content += "\n\n(回答太長被截斷,可以請我「繼續」。)";
    }).catch(function (e) {
      T.msgs.splice(-2, 2); inp.value = q;   // 失敗就把問題放回輸入框,對話紀錄不留空回答
      return tutorErr(e);
    }).then(function (err) { T.busy = false; tutorLog(); if (err) tutorNote(err, "alert"); });
  }
  function tutorErr(e) {
    var s = e && e.status;
    if (s === 401) return tutorOwner() ? "作者金鑰無效或已被停用:更新 _私人/claude_api_key.txt 後重新建置/發布。" : "金鑰無效或已被停用,請到「設定」重新貼上。";
    if (s === 403) return "這把金鑰沒有權限使用這個模型。";
    if (s === 429) return "請求太頻繁或達到帳號限額,稍等一下再試。";
    if (s === 400 && /credit/i.test(e.message || "")) return "帳號額度不足,請到 Anthropic Console 儲值。";
    if (s >= 500) return "Anthropic 伺服器暫時有問題,稍後再試。";
    if (s) return "發生錯誤(" + s + "):" + (e.message || "");
    return "連不上 Anthropic 或載入失敗,請檢查網路後再試。";
  }

  // AI 回答轉成 HTML 後去掉 script / 事件屬性,避免模型輸出的 HTML 在頁面上執行
  function safeHtml(h) {
    var t = document.createElement("template"); t.innerHTML = h;
    t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button").forEach(function (n) { n.remove(); });
    t.content.querySelectorAll("*").forEach(function (n) {
      for (var i = n.attributes.length - 1; i >= 0; i--) {
        var a = n.attributes[i];
        if (/^on/i.test(a.name) || /^\s*(javascript|data):/i.test(a.value)) n.removeAttribute(a.name);
      }
      if (n.tagName === "A") { n.target = "_blank"; n.rel = "noopener"; }
    });
    return t.innerHTML;
  }
  function tutorScroll() { var l = tutorEl(".tt-log"); if (l) l.scrollTop = l.scrollHeight; }
  function tutorNote(t, ic) { var l = tutorEl(".tt-log"), p = document.createElement("p"); p.className = "tt-note"; p.innerHTML = (ic ? ico(ic) + " " : "") + esc(t); l.appendChild(p); tutorScroll(); }
  function tutorLog() {
    var l = tutorEl(".tt-log"); if (!l) return;
    l.innerHTML = T.msgs.length ? T.msgs.map(function (m, i) {
      var last = i === T.msgs.length - 1;
      return '<div class="tt-msg ' + m.role + '"><div class="tt-who">' + (m.role === "user" ? "你" : "助教") + '</div><div class="tt-body markdown-body">' +
        (m.role === "user" ? esc(m.content).replace(/\n/g, "<br>") : (T.busy && last ? (m.content ? esc(m.content) : '<span class="tt-wait">助教思考中…</span>') : safeHtml(md(m.content, true)))) + "</div></div>";
    }).join("") : '<p class="tt-empty">我會根據「' + esc((T.c.steps[T.si] || {}).title || "") + '」這一章的筆記、公式和例題回答你。<br>可以先點上面的快捷按鈕。</p>';
    if (!T.busy) typeset(l);
    tutorScroll();
  }
  function tutorRender() {
    var c = T.c, key = tutorKey(), model = tutorModel();
    var modelSel = '<label class="tt-ch">模型 <select class="tt-model">' + MODELS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === model ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>";
    tutorBox.innerHTML =
      '<div class="tt-head"><b>AI 助教</b><span class="tt-course">' + esc(c.title) + '</span><button class="tt-x" title="關閉 (Esc)" aria-label="關閉">' + ico("x") + '</button></div>' +
      '<label class="tt-ch">章節 <select class="tt-sel">' + c.steps.map(function (s, i) {
        return '<option value="' + i + '"' + (i === T.si ? " selected" : "") + ">第 " + (s.step || i + 1) + " 章 " + esc(s.title || "") + "</option>";
      }).join("") + "</select></label>" +
      '<div class="tt-quick">' + QUICK.map(function (x, i) { return '<button class="pbtn" data-q="' + i + '">' + x[0] + "</button>"; }).join("") + "</div>" +
      '<div class="tt-log"></div>' +
      '<textarea class="tt-in" rows="3" placeholder="問這一章的任何問題…' + (matchMedia("(max-width:820px), (pointer:coarse)").matches ? "" : "(Ctrl+Enter 送出)") + '"></textarea>' +
      (key  // 沒金鑰時免費轉交當主按鈕
        ? '<div class="tt-acts"><button class="btn tt-send">送出</button><button class="pbtn tt-ho" data-w="claude">用 Claude 開啟</button><button class="pbtn tt-ho" data-w="chatgpt">用 ChatGPT 開啟</button></div>'
        : '<div class="tt-acts"><button class="btn tt-ho" data-w="claude">用 Claude 開啟(免費)</button><button class="pbtn tt-ho" data-w="chatgpt">用 ChatGPT 開啟</button><button class="pbtn tt-send">用自己的金鑰送出</button></div>') +
      (tutorOwner()
        ? '<div class="tt-owner"><div><b>作者模式</b>:使用你自己的 Claude(金鑰只在本機 private.js,不會顯示也不會發布)。</div>' + modelSel + "</div>"
        : '<details class="tt-set"><summary>設定:自備 Anthropic API 金鑰 ' + (key ? "(已設定 …" + esc(key.slice(-4)) + ")" : "(未設定)") + "</summary>" +
          '<input type="password" class="tt-key" placeholder="貼上 sk-ant-… 金鑰" autocomplete="off">' +
          '<label class="tt-rm"><input type="checkbox"' + (lsGet(TK) ? " checked" : "") + '> 記住在這台電腦(公用電腦請不要勾)</label>' + modelSel +
          '<div class="tt-acts"><button class="pbtn tt-save">儲存金鑰</button>' + (key ? '<button class="pbtn tt-clear">清除金鑰</button>' : "") +
          '<a class="tt-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">取得金鑰' + EXT + '</a></div>' +
          '<p class="tt-fine">金鑰只存在你自己的瀏覽器,直接傳給 Anthropic;本網站沒有伺服器,看不到你的金鑰。費用由你的 Anthropic 帳號支付。</p></details>') +
      '<p class="tt-fine">回答由 AI 產生,可能有錯,請對照筆記;即時出的題目未經驗算。</p>';
    tutorLog();
  }

  tutorBtn.addEventListener("click", function () { tutorShow(!T.open); });
  tutorBox.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("tt-x")) tutorShow(false);
    else if (b.dataset.q) { var inp = tutorEl(".tt-in"); inp.value = QUICK[+b.dataset.q][1]; inp.focus(); }
    else if (b.classList.contains("tt-send")) tutorAsk();
    else if (b.classList.contains("tt-ho")) tutorHandoff(b.dataset.w);
    else if (b.classList.contains("tt-save")) {
      var k = tutorEl(".tt-key").value.trim(); if (!k) return;
      if (tutorEl(".tt-rm input").checked) { lsSet(TK, k); ssDel(TK); } else { ssSet(TK, k); lsDel(TK); }
      tutorRender(); tutorNote("金鑰已儲存" + (lsGet(TK) ? "(記住在這台電腦)" : "(關閉分頁後就會清除)") + "。", "check");
    } else if (b.classList.contains("tt-clear")) { ssDel(TK); lsDel(TK); tutorRender(); tutorNote("金鑰已清除。"); }
  });
  tutorBox.addEventListener("change", function (e) {
    if (e.target.classList.contains("tt-sel")) { T.si = +e.target.value; T.msgs = []; tutorLog(); }
    else if (e.target.classList.contains("tt-model")) lsSet(TM, e.target.value);
  });
  tutorBox.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.classList.contains("tt-in")) { e.preventDefault(); tutorAsk(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && T.open) tutorShow(false); });

  // 手機分頁列右邊還有分頁時,顯示漸層＋›
  function tabMore() { var b = main.querySelector(".tabbar"); if (b) b.parentNode.classList.toggle("more", b.scrollLeft + b.clientWidth < b.scrollWidth - 4); }
  window.addEventListener("resize", tabMore);
  window.addEventListener("hashchange", function () { search.value = ""; route(); });  // 換頁就離開搜尋結果
  renderNav();
  route();
})();
