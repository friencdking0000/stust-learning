(function () {
  "use strict";
  var D = window.SITE_DATA || { courses: [] };
  // 私人論文對照:只有本機 site/private.js 存在時才有(gitignore、不發布)
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
  function badge(c) { return '<span class="badge s-' + c.status + '">' + c.completeness + "</span>"; }
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

  /* 手機:☰ 開關側欄抽屜 */
  var sidebar = document.getElementById("sidebar"), menuBtn = document.getElementById("menu-btn");
  function setMenu(open) { sidebar.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", open); }
  menuBtn.addEventListener("click", function () { setMenu(!sidebar.classList.contains("open")); });

  /* ---------- routing ---------- */
  function route() {
    setMenu(false);
    if (search.value.trim().length >= 2) return;
    var m = location.hash.match(/^#\/c\/([^/]+)(?:\/(\w+))?(?:\/(\d+))?/);
    if (m) renderCourse(decodeURIComponent(m[1]), m[2] || "steps", m[3] ? parseInt(m[3], 10) : 0);
    else renderHome();
    highlight();
  }

  function renderHome() {
    main.innerHTML =
      '<header class="chead"><h1>📚 stustclass 互動學習網站</h1><p class="sub">六門課程 · 學習路徑 · 原教材例題專業詳解 · 術語註釋 · 互動測驗</p></header>' +
      '<div class="cards">' + D.courses.map(function (c) {
        var pr = courseProg(c);
        var prog = pr.total ? '<div class="progwrap"><div class="progbar" style="width:' + pr.pct + '%"></div></div><div class="progtxt">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + "%)</div>" : "";
        var np = allProblems(c).length;
        return '<a class="card" href="#/c/' + c.id + '"><div class="card-top">' + badge(c) + "<h3>" + c.title + "</h3></div><p>" + esc(c.summary) + "</p>" + prog +
          (np ? '<div class="progtxt">🎯 例題 ' + np + " 題(原教材 " + allProblems(c).filter(function (x) { return x.p.origin === "原教材"; }).length + " · 其餘依講義改編)· " + (c.glossary || []).length + " 條術語註釋</div>" : "") +
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
    var tabs = [["steps", "📚 學習路徑"]];
    var np = allProblems(c).length;
    if (np) tabs.push(["probs", "🎯 例題練習（" + np + "）"]);
    if (c.quiz) tabs.push(["quiz", "❓ 測驗"]);
    if (c.embeds && c.embeds.length) tabs.push(["embed", "🧩 互動工具"]);
    if (c.notes && c.notes.length) tabs.push(["notes", "📄 筆記"]);
    if (thesisFor(c)) tabs.push(["thesis", "🔬 我的論文"]);
    
    main.innerHTML =
      '<header class="chead"><div class="crumb"><a href="#/">首頁</a> / ' + c.title + "</div>" +
      "<h1>" + c.title + " " + badge(c) + "</h1><p class='sub'>" + esc(c.subtitle || "") + "</p></header>" +
      '<div class="tabbar">' + tabs.map(function (t) { return '<button class="tab" data-t="' + t[0] + '">' + t[1] + "</button>"; }).join("") +
      '</div><div id="tabc"></div>';
    var tabc = document.getElementById("tabc");
    function show(t) {
      [].forEach.call(main.querySelectorAll(".tab"), function (b) { b.classList.toggle("active", b.dataset.t === t); });
      if (t === "overview") tabc.innerHTML = tabOverview(c);
      else if (t === "notes") { tabc.innerHTML = tabNotes(c, arg); bindNotes(c); typeset(tabc).then(function () { annotateTerms(document.getElementById("notebody"), c); }); }
      else if (t === "quiz") { tabc.innerHTML = tabQuiz(c); bindQuiz(c); }
      else if (t === "probs") { tabc.innerHTML = tabProblems(c); bindProblemTab(c, /\/probs\/\d+$/.test(location.hash) ? arg : null); }
      else if (t === "embed") tabc.innerHTML = tabEmbed(c);
      else if (t === "thesis" && thesisFor(c)) { tabc.innerHTML = tabThesis(c); typesetLazy(tabc, ".th-sec"); focusThesis(/\/thesis\/\d+$/.test(location.hash) ? arg : null); }
      else if (t === "mat") tabc.innerHTML = tabMat(c);
      else { tabc.innerHTML = tabSteps(c); bindSteps(c, arg); typeset(tabc); }
    }
    main.querySelector(".tabbar").addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) show(b.dataset.t); });
    show(tab);
    window.scrollTo(0, 0);
  }

  function tabOverview(c) {
    var pr = courseProg(c);
    var h = '<p class="lead">' + esc(c.summary) + "</p>";
    if (pr.total) h += '<div class="progwrap"><div class="progbar" style="width:' + pr.pct + '%"></div></div><div class="progtxt">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + "%)</div>";
    h += "<h3>主題</h3><div class='chips big'>" + c.topics.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>";
    if (c.crossLinks && c.crossLinks.length) h += "<h3>跨課關聯</h3><div class='chips'>" + c.crossLinks.map(function (x) { var t = byId(x); return '<a class="chip link" href="#/c/' + x + '">' + (t ? t.title : x) + "</a>"; }).join("") + "</div>";
    if (c.appliesTo) h += '<p class="note">📌 ' + esc(c.appliesTo) + "</p>";
    if (c.todo) h += '<p class="note warn">⚠️ ' + esc(c.todo) + "</p>";
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
      h += lazyDetails("cheat", "📐 公式速查（" + nF + " 式，附符號說明）", function () {
        return c.steps.map(function (s) {
          if (!s.formulas || !s.formulas.length) return "";
          return '<div class="fgroup"><div class="fg-t">第 ' + s.step + " 章 · " + esc(s.title) + "</div>" + s.formulas.map(formulaHtml).join("") + "</div>";
        }).join("");
      });
      var nSym = {};
      c.steps.forEach(function (s) { (s.formulas || []).forEach(function (f) { (f.vars || []).forEach(function (v) { nSym[String(v.s).replace(/\s+/g, "")] = 1; }); }); });
      if (Object.keys(nSym).length) h += lazyDetails("cheat symidx", "🔤 全課符號總表（" + Object.keys(nSym).length + " 個符號）", function () {
        var full = symbolIndexHtml(c);
        return full.slice(full.indexOf("</summary>") + 10, full.lastIndexOf("</details>"));
      });
    }
    h += "</div>";
    h += '<div class="steps">' + c.steps.map(function (s, i) {
      var done = isDone(c.id, i);
      var hasImg = s.images && s.images.length;
      var meta = (s.noteIndex >= 0 ? "📄 筆記" : "") + (s.problems && s.problems.length ? "　🎯 例題 ×" + s.problems.length : "") + (hasImg ? "　🖼 投影片 ×" + s.images.length : "");
      return '<div class="step' + (done ? " done" : "") + '" data-i="' + i + '">' +
        '<div class="step-head"><span class="step-no">' + (done ? "✓" : s.step) + "</span>" +
        '<span class="step-title">' + esc(s.title) + '<span class="step-meta">' + meta + "</span></span>" +
        '<label class="step-chk" onclick="event.stopPropagation()"><input type="checkbox" ' + (done ? "checked" : "") + ' data-chk="' + i + '"> 完成</label>' +
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
    if (f.plain) h += '<div class="fplain">💬 ' + inl(f.plain) + "</div>";
    if (f.vars && f.vars.length) h += '<table class="fvars"><tbody>' + f.vars.map(function (v) {
      return '<tr><td class="fs">\\(' + esc(v.s) + '\\)</td><td class="fname">' + inl(v.name || "") +
        (v.note ? '<div class="fnote">⚠️ ' + inl(v.note) + "</div>" : "") + '</td><td class="funit">' + esc(v.unit || "") + "</td></tr>";
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
    return '<details class="cheat symidx"><summary>🔤 全課符號總表（' + order.length + ' 個符號）</summary>' +
      '<input class="sym-q" type="search" placeholder="找符號或中文,例如 阻尼、omega、質量">' +
      '<table class="fvars"><thead><tr><th>符號</th><th>意思</th><th>單位</th><th>章</th></tr></thead>' +
      order.map(function (k) {
        var m = map[k], multi = m.defs.length > 1, q = k.toLowerCase();
        m.defs.forEach(function (d) { q += " " + d.name + " " + d.note; });
        return '<tbody data-q="' + attr(q.toLowerCase()) + '">' + m.defs.map(function (d, i) {
          return "<tr>" + (i === 0 ? '<td class="fs" rowspan="' + m.defs.length + '">\\(' + esc(m.s) + "\\)" + (multi ? '<div class="fmulti">一符多義</div>' : "") + "</td>" : "") +
            '<td class="fname">' + inl(d.name) + (d.note ? '<div class="fnote">⚠️ ' + inl(d.note) + "</div>" : "") + "</td>" +
            '<td class="funit">' + esc(d.unit) + '</td><td class="fstep">' + d.steps.join("、") + "</td></tr>";
        }).join("") + "</tbody>";
      }).join("") + "</table></details>";
  }
  /* ---- 🔬 我的論文(私人,只在本機) ---- */
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
    h += '<div class="th-head"><div class="th-lock">🔒 只在本機顯示(private.js 已排除在 GitHub 與公開網站之外)</div>' +
      "<h2>" + inl(P.title || "我的論文") + "</h2>" + (P.oneLine ? '<p class="sub">' + inl(P.oneLine) + "</p>" : "") + "</div>";
    if (P.overview) h += '<div class="markdown-body th-ov">' + md(P.overview, true) + "</div>";
    var secs = P.sections || [];
    if (secs.length) h += '<div class="th-toc">' + secs.map(function (x, i) {
      return '<a href="#/c/' + encodeURIComponent(c.id) + "/thesis/" + i + '">' + esc(x.thesisRef || x.id) + " · " + esc(x.concept || "") + "</a>";
    }).join("") + "</div>";
    if (P.symbolDiffs && P.symbolDiffs.length) {
      h += '<details class="cheat th-diff" open><summary>⚠️ 論文寫法 ≠ 課程寫法(' + P.symbolDiffs.length + ")</summary>" +
        '<table class="fvars"><thead><tr><th>論文</th><th>課程</th><th>意思</th><th>出現在</th></tr></thead><tbody>' +
        P.symbolDiffs.map(function (d) {
          return "<tr><td>" + inl(d.thesis) + "</td><td>" + inl(d.course) + "</td><td>" + inl(d.meaning || "") + "</td><td>" + inl(d.where || "") + "</td></tr>";
        }).join("") + "</tbody></table></details>";
    }
    secs.forEach(function (x, i) {
      h += '<section class="th-sec" id="th-' + i + '"><div class="th-st"><span class="th-ref">' + esc(x.thesisRef || x.id) + "</span>" +
        "<b>" + inl(x.concept || "") + "</b>" + inferredTag(x.inferred) + "</div>";
      if (x.summary) h += '<p class="th-sum">' + inl(x.summary) + "</p>";
      if (x.steps && x.steps.length) h += '<div class="chips">📚 對應課程:' + x.steps.map(function (si) { return stepChip(c, si); }).join("") + "</div>";
      else h += '<p class="note">此節不在本課範圍。</p>';
      (x.formulas || []).forEach(function (fr) {
        var f = findFormula(c, fr.step, fr.label);
        if (!f) return;
        h += '<div class="th-f">' + formulaHtml(f) + (fr.use ? '<div class="th-use">📝 <b>在你的論文裡:</b>' + inl(fr.use) + "</div>" : "") + "</div>";
      });
      if (x.symbols && x.symbols.length) {
        h += '<table class="fvars th-sym"><thead><tr><th>符號</th><th>課程意思</th><th>在你的論文裡</th><th>數值</th></tr></thead><tbody>' +
          x.symbols.map(function (v) {
            return '<tr><td class="fs">' + inl(v.s) + "</td><td>" + inl(v.course || "") + "</td><td>" + inl(v.thesis || "") + inferredTag(v.inferred) +
              (v.diff ? '<div class="fnote">⚠️ ' + inl(v.diff) + "</div>" : "") + "</td><td>" + inl(v.value || "—") + (v.unit ? " " + esc(v.unit) : "") + "</td></tr>";
          }).join("") + "</tbody></table>";
      }
      if (x.physics) h += '<div class="th-box th-phy"><div class="th-bt">' + esc(LB.physics || "🧠 物理意義(白話)") + '</div><div class="markdown-body">' + md(x.physics, true) + "</div></div>";
      if (x.check) h += '<div class="th-box th-chk"><div class="th-bt">' + esc(LB.check || "✅ 數值合不合理") + '</div><div class="markdown-body">' + md(x.check, true) + "</div></div>";
      if (x.notes) h += '<p class="note">🔎 ' + inl(x.notes) + "</p>";
      h += "</section>";
    });
    if (P.openQuestions && P.openQuestions.length) h += '<div class="th-box th-q"><div class="th-bt">❓ 值得再確認的地方</div><ul>' +
      P.openQuestions.map(function (q) { return "<li>" + inl(q) + "</li>"; }).join("") + "</ul></div>";
    return h;
  }
  function focusThesis(i) {
    if (i == null) return;
    var el = document.getElementById("th-" + i);
    if (!el) return;
    setTimeout(function () { el.scrollIntoView({ block: "start" }); el.classList.add("flash"); setTimeout(function () { el.classList.remove("flash"); }, 1600); }, 60);
  }
  // 每章結尾:這章對應論文哪裡
  function thesisLinkHtml(c, si) {
    var P = thesisFor(c);
    if (!P) return "";
    var hit = [];
    (P.sections || []).forEach(function (x, i) { if ((x.steps || []).indexOf(si) >= 0) hit.push([x, i]); });
    if (!hit.length) return "";
    return '<div class="th-link"><div class="th-bt">🔬 這章對應你論文的:</div>' + hit.map(function (p) {
      return '<a href="#/c/' + encodeURIComponent(c.id) + "/thesis/" + p[1] + '"><span class="th-ref">' + esc(p[0].thesisRef || p[0].id) + "</span> " + inl(p[0].concept || "") + " →</a>";
    }).join("") + "</div>";
  }
  // 步驟結尾:去例題分頁第 N 章練習
  function practiceCtaHtml(c, s, si) {
    if (!s.problems || !s.problems.length) return "";
    var got = s.problems.filter(function (p) { return probGot(c.id, p.id); }).length;
    return '<a class="practice-cta" href="#/c/' + encodeURIComponent(c.id) + "/probs/" + si + '">' +
      '<span class="pc-ic">🎯</span><span class="pc-t"><b>讀完了?去例題練習第 ' + s.step + " 章</b>" +
      '<span class="pc-sub">本章 ' + s.problems.length + " 題 · 我會了 " + got + " 題 · 白話翻譯 → 提示 → 詳解</span></span>" +
      '<span class="pc-go">開始練習 →</span></a>';
  }
  function stepBodyHtml(c, s, si) {
    var h = "";
    if (s.formulas && s.formulas.length) {
      h += '<div class="formulas"><div class="ft">📐 重點公式(表格是每個符號的意思)</div>' + s.formulas.map(formulaHtml).join("") + "</div>";
    }
    if (s.noteIndex >= 0 && c.notes[s.noteIndex]) h += '<div class="markdown-body">' + md(c.notes[s.noteIndex].content) + "</div>";
    else h += '<p class="note">本步驟重點見課程主筆記(見「筆記」分頁)。</p>';
    h += galleryHtml("📐 PDF 原圖(點圖放大,附說明)", s.figures, "fig");
    h += galleryHtml("🖼 投影片頁(點圖放大)", s.images, "img");
    if (s.pdfs && s.pdfs.length) {
      h += '<div class="pdfref"><div class="sl-t">📄 參考投影片 PDF(開啟 / 預覽 / 下載)</div>';
      s.pdfs.forEach(function (p) {
        h += '<div class="pdfrow"><span class="pdfname">📑 ' + esc(p.title) + "</span>" +
          '<a class="btn ghost" href="' + p.rel + '" target="_blank">↗ 開啟</a>' +
          '<a class="btn ghost" href="' + p.rel + '" download>⬇ 下載</a>' +
          '<button class="btn ghost pdfprev" data-rel="' + p.rel + '">👁 預覽</button></div>' +
          '<div class="pdfframe hidden"></div>';
      });
      h += "</div>";
    }
    h += practiceCtaHtml(c, s, si);
    h += thesisLinkHtml(c, si);
    h += '<div class="stepnav">' + (si > 0 ? '<button class="btn ghost" data-go="' + (si - 1) + '">← 上一步</button>' : "<span></span>") +
      '<button class="btn" data-finish="' + si + '">✓ 完成這步' + (si < c.steps.length - 1 ? "，下一步 →" : "") + "</button></div>";
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
        if (box && !box.checked) { box.checked = true; setDone(c.id, fi, true); var se = cont.querySelector('.step[data-i="' + fi + '"]'); se.classList.add("done"); se.querySelector(".step-no").textContent = "✓"; refreshProg(); }
        document.getElementById("sb" + fi).classList.add("collapsed");
        if (fi < c.steps.length - 1) openStep(fi + 1);
        return;
      }
      var chk = e.target.closest("input[data-chk]");
      if (chk) { var ci = parseInt(chk.getAttribute("data-chk"), 10); setDone(c.id, ci, chk.checked); var st = cont.querySelector('.step[data-i="' + ci + '"]'); st.classList.toggle("done", chk.checked); st.querySelector(".step-no").textContent = chk.checked ? "✓" : c.steps[ci].step; refreshProg(); return; }
      var head = e.target.closest(".step-head");
      if (head && !e.target.closest(".step-body")) { var i = parseInt(head.parentNode.getAttribute("data-i"), 10); toggle(head.parentNode, i); }
    });
    // 預設展開第一步(或指定)
    var first = openIdx || 0;
    var fb = document.getElementById("sb" + first);
    if (fb) { fill(fb, first); fb.classList.remove("collapsed"); }
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
          frame.classList.remove("hidden"); btn.textContent = "👁 收合";
        } else { frame.classList.add("hidden"); btn.textContent = "👁 預覽"; }
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
    return (arr || []).map(function (l) { return '<a href="' + attr(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + " ↗</a>"; }).join("");
  }
  function probCardHtml(c, p, si) {
    var got = probGot(c.id, p.id), hints = p.hints || [];
    var src = p.source && p.source.label ? p.source.label : (p.source && p.source.path ? p.source.path.split("/").pop() + (p.source.page ? " p." + p.source.page : "") : "");
    var h = '<div class="prob' + (got ? " got" : "") + '" data-pid="' + attr(p.id) + '" data-si="' + si + '">' +
      '<div class="prob-head"><span class="lv lv-' + attr(p.level || "基礎") + '">' + esc(p.level || "基礎") + "</span>" +
      '<span class="org org-' + attr(p.origin || "自編") + '">' + esc(p.origin || "自編") + "</span>" +
      '<span class="prob-title"><span class="pid">' + esc(p.id) + "</span> " + esc(p.title || "") + "</span>" +
      (src ? '<span class="prob-src">📄 ' + esc(src) + "</span>" : "") +
      '<label class="prob-got" title="勾起來 = 我已經會解這題"><input type="checkbox" data-got ' + (got ? "checked" : "") + "> 我會了</label></div>" +
      '<div class="prob-q markdown-body">' + md(p.q, true) + "</div>" +
      '<div class="prob-acts">' +
      (p.plain ? '<button class="pbtn" data-act="plain">🗣 白話翻譯</button>' : "") +
      (hints.length ? '<button class="pbtn" data-act="hint">💡 提示 <span class="hcnt">0/' + hints.length + "</span></button>" : "") +
      '<button class="pbtn main" data-act="sol">📝 專業詳解</button>' +
      (p.img || p.pdf ? '<button class="pbtn" data-act="orig">🖼 看原題頁</button>' : "") +
      '<span class="pai"><button class="pbtn ai" data-act="claude">🤖 問 Claude</button>' +
      '<button class="pbtn ai" data-act="chatgpt">🤖 問 ChatGPT</button>' +
      '<button class="pbtn ghost" data-act="copy" title="複製給 AI 的提示詞">📋</button></span></div>' +
      (p.plain ? '<div class="prob-plain hidden"></div>' : "") +
      '<ol class="prob-hints"></ol>' +
      '<div class="prob-orig hidden">' + (p.img ? '<img loading="lazy" src="' + attr(p.img) + '" alt="原題頁">' : "") +
      (p.pdf ? '<a class="btn ghost" href="' + attr(p.pdf) + '" target="_blank">↗ 開啟原 PDF 該頁</a>' : "") + "</div>" +
      '<div class="prob-sol hidden"></div></div>';
    return h;
  }
  // 詳解內容(點「專業詳解」才產生,減少頁面元素)
  function probSolHtml(p) {
    var h = '<div class="markdown-body">' + md(p.solution, true) + "</div>";
    if (p.answer) h += '<div class="prob-ans">✅ <b>答案</b>　' + md(p.answer).replace(/^<p>|<\/p>\s*$/g, "") + "</div>";
    if (p.pitfalls && p.pitfalls.length) h += '<div class="prob-pit"><b>⚠️ 常見錯誤</b><ul>' + p.pitfalls.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>\s*$/g, "") + "</li>"; }).join("") + "</ul></div>";
    if (p.notes && p.notes.length) h += '<div class="prob-notes"><b>📖 術語註釋</b><dl>' + p.notes.map(function (n) {
      return "<dt>" + esc(n.term) + (n.url ? ' <a href="' + attr(n.url) + '" target="_blank" rel="noopener">↗</a>' : "") + "</dt><dd>" + md(n.def).replace(/^<p>|<\/p>\s*$/g, "") + "</dd>";
    }).join("") + "</dl></div>";
    if (p.links && p.links.length) h += '<div class="prob-links"><b>🔗 延伸閱讀</b> ' + linkList(p.links) + "</div>";
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
    function ok() { if (btn) { var o = btn.textContent; btn.textContent = "✔ 已複製"; setTimeout(function () { btn.textContent = o; }, 1400); } }
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
      if (act === "plain") { var pl = tog(".prob-plain"); if (pl && !pl.innerHTML) { pl.innerHTML = "🗣 " + md(p.plain, true); typeset(pl); } }
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
    if (c.glossary && c.glossary.length) h += '<details class="cheat gloss"><summary>📖 全課術語註釋（' + c.glossary.length + ' 條）</summary><dl>' +
      c.glossary.map(function (g) {
        return "<dt>" + esc(g.term) + (g.alias && g.alias.length ? ' <span class="alias">' + esc(g.alias.join(" / ")) + "</span>" : "") +
          (g.url ? ' <a href="' + attr(g.url) + '" target="_blank" rel="noopener">↗</a>' : "") + "</dt><dd>" + esc(g.def) + "</dd>";
      }).join("") + "</dl></details>";
    h += '<div id="plist">' + c.steps.map(function (s, i) {
      if (!s.problems || !s.problems.length) return "";
      return '<div class="pgroup" data-si="' + i + '"><h3>第 ' + s.step + " 章 · " + esc(s.title) +
        ' <a class="pg-back" href="#/c/' + encodeURIComponent(c.id) + "/steps/" + i + '">↩ 回本章筆記</a></h3>' +
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
          "<br>" + esc(g.def) + (g.url ? '<br><a href="' + attr(g.url) + '" target="_blank" rel="noopener">延伸閱讀 ↗</a>' : "");
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
      return '<button class="noteitem ' + (i === idx ? "active" : "") + '" data-i="' + i + '">' + (n.primary ? "⭐ " : "") + esc(n.title) + "</button>";
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
      var exp = card.querySelector(".qexp"); exp.textContent = (k === correct ? "✅ 正確。" : "❌ 正解是「" + q.items[i].options[correct] + "」。") + (q.items[i].explain || ""); exp.classList.remove("hidden");
      document.getElementById("qscore").textContent = (q.title || "互動測驗") + "　得分 " + score + " / " + q.items.length;
    });
  }

  /* ---- embed ---- */
  function tabEmbed(c) {
    return c.embeds.map(function (e) {
      return '<div class="embedwrap"><h3>🧩 ' + esc(e.title) + '<a class="embed-open" href="' + e.rel + '" target="_blank">↗ 開新視窗</a></h3>' +
        '<iframe src="' + e.rel + '" loading="lazy"></iframe></div>';
    }).join("");
  }

  /* ---- materials ---- */
  function tabMat(c) {
    var cats = [["lectures", "講義"], ["notes", "筆記檔"], ["data", "數據與工具"], ["external", "外部資源"], ["homework", "作業"]];
    var h = "";
    cats.forEach(function (p) {
      var arr = c.materials[p[0]] || []; if (!arr.length) return;
      h += "<h3>" + p[1] + '</h3><ul class="matlist">' + arr.map(function (m) {
        return '<li><a href="' + m.rel + '" target="_blank">' + (m.type === "folder" ? "📁" : "📄") + " " + esc(m.label) + "</a>" + (m.desc ? '<span class="mdesc">' + esc(m.desc) + "</span>" : "") + "</li>";
      }).join("") + "</ul>";
    });
    return h || '<p class="empty">無資料。</p>';
  }

  /* ---------- search ---------- */
  var sidx = null;
  function buildIndex() {
    sidx = [];
    D.courses.forEach(function (c) {
      c.notes.forEach(function (n, i) { sidx.push({ cid: c.id, ctitle: c.title, href: "#/c/" + c.id + "/notes/" + i, title: n.title, text: (n.title + "\n" + n.content).toLowerCase() }); });
      allProblems(c).forEach(function (x) { var p = x.p; sidx.push({ cid: c.id, ctitle: c.title, href: "#/c/" + c.id + "/probs", title: "🎯 " + p.id + " " + (p.title || ""), text: [p.title, p.q, p.plain, p.solution].join("\n").toLowerCase() }); });
    });
  }
  search.addEventListener("input", function () {
    var q = search.value.trim().toLowerCase();
    if (q.length < 2) { route(); return; }
    if (!sidx) buildIndex();
    var hits = sidx.filter(function (x) { return x.text.indexOf(q) >= 0; }).slice(0, 40);
    main.innerHTML = '<header class="chead"><h1>🔍 搜尋:「' + esc(search.value.trim()) + '」</h1><p class="sub">' + hits.length + " 筆結果</p></header>" +
      (hits.length ? '<div class="results">' + hits.map(function (x) {
        var pos = x.text.indexOf(q), snip = x.text.slice(Math.max(0, pos - 40), pos + 60);
        return '<a class="result" href="' + x.href + '"><b>' + x.ctitle + "</b> › " + esc(x.title) + '<span class="snip">…' + esc(snip) + "…</span></a>";
      }).join("") + "</div>" : '<p class="empty">查無結果。</p>');
  });
  main.addEventListener("click", function (e) { if (e.target.closest(".result")) search.value = ""; });

  /* ---------- 字體大小(記在瀏覽器) ---------- */
  var ZKEY = "stust_zoom";
  function setZoom(z) { z = Math.max(0.85, Math.min(1.5, Math.round(z * 100) / 100)); document.documentElement.style.setProperty("--zoom", z); try { localStorage.setItem(ZKEY, z); } catch (e) {} }
  var z0 = 1; try { z0 = parseFloat(localStorage.getItem(ZKEY)) || 1; } catch (e) {}
  setZoom(z0);
  [["fs-dn", -0.1], ["fs-up", 0.1], ["fs-rs", 0]].forEach(function (b) {
    var el = document.getElementById(b[0]); if (!el) return;
    el.onclick = function () { var cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1; setZoom(b[1] ? cur + b[1] : 1); };
  });

  /* ---------- 作者登入(公開版用;本機版有 private.js 就不需要) ----------
     assets/v.dat 是 publish.py 用 AES-256-GCM 加密的論文對照;金鑰 = PBKDF2(學號大寫 + "\n" + 密碼)。
     入口不顯示在畫面上(使用者自訂的隱藏手勢);記住裝置時只存推導出的金鑰,登出即清除。 */
  var AKEY = "stust_ak", AUTH_TAPS = 15, AUTH_GAP = 800;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function b64d(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64e(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  var vaultP = null;
  function loadVault() {
    if (!vaultP) vaultP = fetch("assets/v.dat", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("no vault"); return r.json(); });
    vaultP.catch(function () { vaultP = null; });
    return vaultP;
  }
  function deriveKey(id, pw, v) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(id.trim().toUpperCase() + "\n" + pw), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64d(v.salt), iterations: v.iter, hash: "SHA-256" }, k, 256);
    });
  }
  function openVault(raw, v) {
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]).then(function (k) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(v.iv) }, k, b64d(v.ct));
    }).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }
  var canCrypto = !!(window.crypto && crypto.subtle && window.TextEncoder);
  // 記住裝置:啟動時自動解開(金鑰對不上就清掉,例如換過密碼)
  if (!PRIV && canCrypto && lsGet(AKEY)) {
    loadVault().then(function (v) { return openVault(b64d(lsGet(AKEY)), v); })
      .then(function (d) { PRIV = d; route(); })
      .catch(function (e) { if (e && e.name === "OperationError") lsDel(AKEY); });
  }
  function closeAuth() { var m = document.getElementById("authm"); if (m) m.remove(); }
  function showAuth() {
    closeAuth();
    var m = document.createElement("div");
    m.id = "authm"; m.className = "auth-ov";
    var body;
    if (window.PRIVATE) body = '<p class="auth-msg">本機版已直接顯示論文對照,不需要登入。</p><div class="auth-acts"><button class="btn" data-a="close">關閉</button></div>';
    else if (PRIV) body = '<p class="auth-msg">✅ 已登入作者模式</p><div class="auth-acts"><button class="btn ghost" data-a="logout">登出</button><button class="btn" data-a="close">關閉</button></div>';
    else body = '<form class="auth-f"><label>帳號<input name="uid" autocomplete="username" autocapitalize="characters" required></label>' +
      '<label>密碼<input name="pw" type="password" autocomplete="current-password" required></label>' +
      '<label class="auth-rm"><input name="rm" type="checkbox" checked> 記住這台裝置</label>' +
      '<p class="auth-msg" id="authmsg"></p><div class="auth-acts"><button type="button" class="btn ghost" data-a="close">取消</button><button class="btn" type="submit">登入</button></div></form>';
    m.innerHTML = '<div class="auth-box" role="dialog" aria-modal="true"><div class="auth-t">作者登入</div>' + body + "</div>";
    document.body.appendChild(m);
    m.addEventListener("click", function (e) {
      if (e.target === m) return closeAuth();
      var a = e.target.closest("[data-a]"); if (!a) return;
      if (a.dataset.a === "logout") { lsDel(AKEY); PRIV = null; route(); }
      closeAuth();
    });
    var f = m.querySelector("form"); if (!f) return;
    f.elements.uid.focus();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("authmsg"), btn = f.querySelector('button[type="submit"]');
      if (!canCrypto) { msg.textContent = "這個瀏覽器不支援,請改用 Chrome 或 Safari。"; return; }
      btn.disabled = true; msg.textContent = "驗證中…";
      var v0;
      loadVault().then(function (v) { v0 = v; return deriveKey(f.elements.uid.value, f.elements.pw.value, v); })
        .then(function (raw) { return openVault(raw, v0).then(function (d) { return [raw, d]; }); })
        .then(function (r) {
          if (f.elements.rm.checked) lsSet(AKEY, b64e(r[0]));
          PRIV = r[1]; closeAuth(); route();
        })
        .catch(function () { msg.textContent = "登入失敗"; btn.disabled = false; f.elements.pw.value = ""; });
    });
  }
  // 隱藏入口:首頁大標題的「📚 st」範圍內連續點 AUTH_TAPS 下(每下間隔 < AUTH_GAP ms;左上角 logo 不算)
  (function () {
    var n = 0, last = 0;
    document.addEventListener("click", function (e) {
      var el = e.target.closest(".chead h1"), tn = el && el.firstChild;
      if (!tn || tn.nodeType !== 3 || tn.nodeValue.indexOf("📚 st") !== 0) return;
      var r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 5);  // "📚 st" = 5 個 UTF-16 單位
      var rc = r.getBoundingClientRect();
      if (e.clientX > rc.right + 4 || e.clientY < rc.top - 12 || e.clientY > rc.bottom + 12) { n = 0; return; }
      var now = Date.now(); n = now - last < AUTH_GAP ? n + 1 : 1; last = now;
      if (n >= AUTH_TAPS) { n = 0; showAuth(); }
    });
  })();
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAuth(); });

  window.addEventListener("hashchange", route);
  renderNav();
  route();
})();
