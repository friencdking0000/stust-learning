(function () {
  "use strict";
  var D = window.SITE_DATA || { courses: [] };
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
  function typeset(el) {
    try { if (el && window.MathJax && MathJax.typesetPromise) return MathJax.typesetPromise([el]).catch(function () {}); } catch (e) {}
    return Promise.resolve();
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

  /* ---------- routing ---------- */
  function route() {
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
    if (np) tabs.push(["probs", "🎯 題庫（" + np + "）"]);
    if (c.quiz) tabs.push(["quiz", "❓ 測驗"]);
    if (c.embeds && c.embeds.length) tabs.push(["embed", "🧩 互動工具"]);
    if (c.notes && c.notes.length) tabs.push(["notes", "📄 筆記"]);
    
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
      else if (t === "probs") { tabc.innerHTML = tabProblems(c); bindProblemTab(c); }
      else if (t === "embed") tabc.innerHTML = tabEmbed(c);
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
    var allF = [];
    c.steps.forEach(function (s) { (s.formulas || []).forEach(function (f) { allF.push(f); }); });
    var h = '<div class="course-head"><p class="lead">' + esc(c.summary) + "</p>" +
      '<div class="progtxt" id="stepprog">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + '%)</div><div class="progwrap"><div class="progbar" id="stepbar" style="width:' + pr.pct + '%"></div></div>';
    if (allF.length) h += '<details class="cheat"><summary>📐 公式速查（' + allF.length + ' 式）</summary>' +
      allF.map(function (f) { return '<div class="formula"><span class="flabel">' + esc(f.label) + '</span><span class="feq">\\[' + f.tex + '\\]</span></div>'; }).join("") + "</details>";
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
  function stepBodyHtml(c, s, si) {
    var h = "";
    if (s.formulas && s.formulas.length) {
      h += '<div class="formulas"><div class="ft">📐 重點公式</div>' + s.formulas.map(function (f) {
        return '<div class="formula"><span class="flabel">' + esc(f.label) + '</span><span class="feq">\\[' + f.tex + '\\]</span></div>';
      }).join("") + "</div>";
    }
    if (s.noteIndex >= 0 && c.notes[s.noteIndex]) h += '<div class="markdown-body">' + md(c.notes[s.noteIndex].content) + "</div>";
    else h += '<p class="note">本步驟重點見課程主筆記(見「筆記」分頁)。</p>';
    h += problemsHtml(c, s, si);
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
    h += '<div class="stepnav">' + (si > 0 ? '<button class="btn ghost" data-go="' + (si - 1) + '">← 上一步</button>' : "<span></span>") +
      '<button class="btn" data-finish="' + si + '">✓ 完成這步' + (si < c.steps.length - 1 ? "，下一步 →" : "") + "</button></div>";
    return h;
  }
  function bindSteps(c, openIdx) {
    var cont = main.querySelector(".steps"); if (!cont) return;
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
      bindProblems(body, c);
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
      (p.plain ? '<div class="prob-plain hidden">🗣 ' + md(p.plain, true) + "</div>" : "") +
      '<ol class="prob-hints"></ol>' +
      '<div class="prob-orig hidden">' + (p.img ? '<img loading="lazy" src="' + attr(p.img) + '" alt="原題頁">' : "") +
      (p.pdf ? '<a class="btn ghost" href="' + attr(p.pdf) + '" target="_blank">↗ 開啟原 PDF 該頁</a>' : "") + "</div>" +
      '<div class="prob-sol hidden"><div class="markdown-body">' + md(p.solution, true) + "</div>";
    if (p.answer) h += '<div class="prob-ans">✅ <b>答案</b>　' + md(p.answer).replace(/^<p>|<\/p>\s*$/g, "") + "</div>";
    if (p.pitfalls && p.pitfalls.length) h += '<div class="prob-pit"><b>⚠️ 常見錯誤</b><ul>' + p.pitfalls.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>\s*$/g, "") + "</li>"; }).join("") + "</ul></div>";
    if (p.notes && p.notes.length) h += '<div class="prob-notes"><b>📖 術語註釋</b><dl>' + p.notes.map(function (n) {
      return "<dt>" + esc(n.term) + (n.url ? ' <a href="' + attr(n.url) + '" target="_blank" rel="noopener">↗</a>' : "") + "</dt><dd>" + md(n.def).replace(/^<p>|<\/p>\s*$/g, "") + "</dd>";
    }).join("") + "</dl></div>";
    if (p.links && p.links.length) h += '<div class="prob-links"><b>🔗 延伸閱讀</b> ' + linkList(p.links) + "</div>";
    return h + "</div></div>";
  }
  function problemsHtml(c, s, si) {
    if (!s.problems || !s.problems.length) return "";
    return '<section class="probs"><div class="sl-t">🎯 原教材例題 · 專業詳解（' + s.problems.length + ' 題）<span class="sl-sub">先自己想 → 白話翻譯 → 提示一個一個開 → 最後看詳解</span></div>' +
      s.problems.map(function (p) { return probCardHtml(c, p, si); }).join("") + "</section>";
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
      if (act === "plain") { var pl = tog(".prob-plain"); if (pl) typeset(pl); }
      else if (act === "hint") {
        var ol = card.querySelector(".prob-hints"), n = ol.children.length, hs = p.hints || [];
        if (n < hs.length) { var li = document.createElement("li"); li.innerHTML = md(hs[n]).replace(/^<p>|<\/p>\s*$/g, ""); ol.appendChild(li); typeset(li); n++; }
        b.querySelector(".hcnt").textContent = n + "/" + hs.length;
        if (n >= hs.length) b.classList.add("on");
      }
      else if (act === "sol") { var so = tog(".prob-sol"); if (so && !so._ts) { so._ts = true; typeset(so); } }
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
      '<select id="pf-step"><option value="">全部步驟</option>' + c.steps.map(function (s, i) {
        return (s.problems && s.problems.length) ? '<option value="' + i + '">' + s.step + ". " + esc(s.title) + "（" + s.problems.length + "）</option>" : "";
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
      return '<div class="pgroup" data-si="' + i + '"><h3>' + s.step + ". " + esc(s.title) + "</h3>" +
        s.problems.map(function (p) { return probCardHtml(c, p, i); }).join("") + "</div>";
    }).join("") + "</div>";
    return h;
  }
  function bindProblemTab(c) {
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
    typeset(list).then(function () { annotateTerms(list, c); });
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

  window.addEventListener("hashchange", route);
  renderNav();
  route();
})();
