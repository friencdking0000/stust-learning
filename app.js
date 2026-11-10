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
    // 筆記裡手寫的 <details>(自我測驗的參考答案)也用同一個 chevron,不用瀏覽器的 ▸
    return html.replace(/@@MATH(\d+)@@/g, function (_, i) { return esc(maths[+i]); }).replace(/<summary>/g, function () { return "<summary>" + sumChev(); });
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
    }).then(function () { if (el.isConnected) { mjNowrap(el); xsScan(el); } }).catch(function () {});
    return mjq;
  }
  // 行內公式和緊接的標點包在一起不換行(句點不會單獨掉到下一行);display 公式不動
  var MJ_PUNCT = /^[.,;:!?、，。；：！？）)」』]+/;
  function mjWrap(c) {
    if (c.parentNode.classList.contains("mjx-nb")) return c.parentNode;
    var w = document.createElement("span"); w.className = "mjx-nb";
    c.parentNode.insertBefore(w, c); w.appendChild(c);
    return w;
  }
  function mjNowrap(el) {
    if (!el.querySelectorAll) return;
    [].forEach.call(el.querySelectorAll('mjx-container:not([display="true"])'), function (c) {
      var n = c.nextSibling, m = n && n.nodeType === 3 && MJ_PUNCT.exec(n.nodeValue);
      if (!m || c.parentNode.classList.contains("mjx-nb")) return;
      if (m[0].length < n.nodeValue.length) n.splitText(m[0].length);
      mjWrap(c).appendChild(n);
    });
  }
  // 題目裡比題卡寬的公式(手機):只讓那個公式自己左右滑,右緣淡出提示,捲到底就拿掉
  function xsHint(el) { el.classList.toggle("xs", el.scrollWidth > el.clientWidth + 1 && el.scrollLeft + el.clientWidth < el.scrollWidth - 2); }
  var XS = ".prob-q, .prob-sol, .prob-plain, .prob-hints li";   // 題目、詳解(含答案與常見錯誤)、白話、提示
  function xsScan(root) {
    if (!root || !root.querySelectorAll) return;
    var qs = root.matches(XS) ? [root] : [].slice.call(root.querySelectorAll(XS)), wide = [], boxes = [];
    qs.forEach(function (q) {
      if (!q.offsetParent) return;
      [].forEach.call(q.querySelectorAll('mjx-container:not([display="true"])'), function (c) {   // 先全部量完再改 class
        var b = c.parentNode.classList.contains("mjx-nb") ? c.parentNode : c, blk = c.closest("p,li,td,th," + XS);
        if (getComputedStyle(blk).display === "inline") blk = blk.parentElement.closest("li,td,th," + XS);   // 白話的 <p> 是 inline,寬度要量外層
        var w = b.classList.contains("mx-x") ? b.scrollWidth > b.clientWidth + 1 : b.offsetWidth > blk.clientWidth + 1, bs = getComputedStyle(blk);
        // 沒比題卡寬、只是從行中間開始又不換行(Firefox 不在不換行的 span 前斷行)而超出右緣
        wide.push([c, w, !w && b.getBoundingClientRect().right > blk.getBoundingClientRect().right - parseFloat(bs.paddingRight) - parseFloat(bs.borderRightWidth) + 1]);
      });
      [].push.apply(boxes, q.querySelectorAll('mjx-container[display="true"]'));
    });
    // mx-x:比題卡寬,自己左右滑;mx-b:改成 inline-block,前面一定可以斷行,整段換到下一行(加了就不拿掉,免得 resize 時來回跳)
    wide.forEach(function (w) { var b = w[1] || w[2] ? mjWrap(w[0]) : w[0].parentNode; if (b.classList.contains("mjx-nb")) { b.classList.toggle("mx-x", w[1]); if (w[2]) b.classList.add("mx-b"); } if (w[1]) boxes.push(b); });
    qs.forEach(function (q) { [].forEach.call(q.querySelectorAll(".mjx-nb.xs:not(.mx-x)"), function (b) { b.classList.remove("xs"); }); });
    boxes.forEach(xsHint);
  }
  document.addEventListener("scroll", function (e) { var t = e.target; if (t.matches && t.matches(".mx-x, mjx-container") && t.closest(XS)) xsHint(t); }, true);
  window.addEventListener("resize", function () { xsScan(document.getElementById("main")); });
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
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    sunmoon: '<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    "chev-l": '<path d="m15 18-6-6 6-6"/>',
    "chev-r": '<path d="m9 18 6-6-6-6"/>',
    "chev-d": '<path d="m6 9 6 6 6-6"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'
  };
  function ico(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  function sumChev() { return '<span class="sum-chev">' + ico("chev-d") + "</span>"; }   // 收合標題前的箭頭(取代瀏覽器的 ▸)
  [].forEach.call(document.querySelectorAll("[data-ic]"), function (el) { el.innerHTML = ico(el.dataset.ic); });  // index.html 的固定按鈕
  var EXT = " " + ico("ext");  // 外部連結
  // LINE 內建瀏覽器:開的是聊天裡貼的網址,而且 Claude / ChatGPT 的 Google 登入會被擋 → 提示改用預設瀏覽器
  var IS_LINE = /\bLine\//i.test(navigator.userAgent), LINE_MSG = "在 LINE 裡有些功能受限，點右上角選單 → 用預設瀏覽器開啟";
  // 目前網址加 openExternalBrowser=1(LINE 看到會改用外部瀏覽器開),hash 保留
  function lineExtUrl() { var u = new URL(location.href); u.searchParams.set("openExternalBrowser", "1"); return u.href; }
  (function lineTip() {
    var el = document.getElementById("line-tip"), app = document.getElementById("app"), off = false;
    try { off = localStorage.getItem("stust_line_tip") === "off"; } catch (e) {}
    if (!IS_LINE || off || !el) return;
    el.innerHTML = ico("info") + '<span class="lt-t">' + LINE_MSG + '<a class="lt-go" href="#">' + ico("ext") + " 用瀏覽器開</a></span>" +
      '<button class="lt-x" aria-label="關閉提示">' + ico("x") + "</button>";
    el.classList.remove("hidden"); app.classList.add("line-on");
    var go = el.querySelector(".lt-go"); go.href = lineExtUrl();
    go.addEventListener("click", function () { go.href = lineExtUrl(); });   // 切分頁用 replaceState 不會觸發 hashchange,按下當下再取一次
    window.addEventListener("hashchange", function () { go.href = lineExtUrl(); });
    el.querySelector(".lt-x").addEventListener("click", function () {
      el.classList.add("hidden"); app.classList.remove("line-on");
      try { localStorage.setItem("stust_line_tip", "off"); } catch (e) {}
    });
  })();
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
  function openLB(list, idx, back) { LB.list = list; LB.idx = idx; LB.back = back || document.activeElement; lb.classList.remove("hidden"); lbShow(); document.getElementById("lb-close").focus(); }
  function closeLB() { lb.classList.add("hidden"); lbImg.src = ""; if (LB.back && LB.back.focus) LB.back.focus(); LB.back = null; }  // 焦點還給點開燈箱的元素
  function lbStep(d) { if (!LB.list.length) return; LB.idx = (LB.idx + d + LB.list.length) % LB.list.length; lbShow(); }
  document.getElementById("lb-close").onclick = closeLB;
  document.getElementById("lb-prev").onclick = function () { lbStep(-1); };
  document.getElementById("lb-next").onclick = function () { lbStep(1); };
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLB(); });
  document.addEventListener("keydown", function (e) {
    if (lb.classList.contains("hidden")) return;
    if (e.key === "Tab") {   // focus trap:Tab / Shift+Tab 只在燈箱的按鈕間循環
      var fs = [].filter.call(lb.querySelectorAll("button, a[href]"), function (x) { return x.getClientRects().length > 0; });
      var i = fs.indexOf(document.activeElement);
      e.preventDefault(); if (fs.length) fs[(i < 0 ? 0 : i + (e.shiftKey ? fs.length - 1 : 1)) % fs.length].focus();
      return;
    }
    if (e.key === "Escape") { closeLB(); e.stopImmediatePropagation(); }   // 只關燈箱,AI 助教面板留著
    else if (e.key === "ArrowLeft") lbStep(-1); else if (e.key === "ArrowRight") lbStep(1);
  });

  /* ---------- sidebar ---------- */
  function renderNav() {
    nav.innerHTML = D.courses.map(function (c) {
      var pr = courseProg(c), tag = pr.total ? '<span class="mini-prog">' + pr.pct + "%</span>" : "";
      return '<a class="cnav" href="#/c/' + encodeURIComponent(c.id) + '" data-id="' + c.id + '"><span class="dot s-' + c.status + '"></span>' + c.title + tag + "</a>";
    }).join("");
  }
  function highlight() {
    var m = location.hash.match(/^#\/c\/([^/]+)/), id = m ? decodeURIComponent(m[1]) : null;
    [].forEach.call(document.querySelectorAll(".cnav"), function (a) { a.classList.toggle("active", a.dataset.id === id); });
  }

  /* 手機:選單鈕開關側欄抽屜 */
  var sidebar = document.getElementById("sidebar"), menuBtn = document.getElementById("menu-btn"), searchBtn = document.getElementById("search-btn");
  // 選單抽屜開著:半透明遮罩蓋住頁面、背景不能捲;搜尋模式不遮(結果顯示在主內容)
  var lineTip = document.getElementById("line-tip");
  var mask = document.createElement("div"); mask.id = "drawer-mask"; mask.className = "hidden"; document.body.appendChild(mask);
  function setMenu(open, searching) {
    sidebar.classList.toggle("open", open); sidebar.classList.toggle("searchmode", !!(open && searching));
    menuBtn.setAttribute("aria-expanded", open && !searching); searchBtn.setAttribute("aria-expanded", !!(open && searching));
    var m = !!(open && !searching); mask.classList.toggle("hidden", !m); document.documentElement.classList.toggle("menu-lock", m);
    main.inert = m; lineTip.inert = m;     // 選單抽屜開著:Tab 不會跑到背後的頁面與 LINE 提示列
    if (open && T.open) tutorShow(false);  // AI 面板(z-index 較高)會蓋住抽屜,先收起
  }
  mask.addEventListener("click", function () { setMenu(false); menuBtn.focus(); });
  // 抽屜開著時視窗變寬(旋轉平板):桌機版沒有選單鈕,要先關掉,不然 main 一直是 inert
  var narrow = matchMedia("(max-width:820px)"), onNarrow = function (e) { if (!e.matches) setMenu(false); };
  if (narrow.addEventListener) narrow.addEventListener("change", onNarrow); else narrow.addListener(onNarrow);
  document.addEventListener("keydown", function (e) {   // Esc 關抽屜,焦點回到打開它的鈕
    if (e.key !== "Escape" || !sidebar.classList.contains("open") || !matchMedia("(max-width:820px)").matches) return;
    var s = searchOpen(); setMenu(false); (s ? searchBtn : menuBtn).focus();
  });
  function searchOpen() { return sidebar.classList.contains("open") && sidebar.classList.contains("searchmode"); }
  menuBtn.addEventListener("click", function () { setMenu(!sidebar.classList.contains("open") || searchOpen()); });
  // 手機頂部列的搜尋鈕:打開抽屜但只留搜尋框;再按一下關閉
  searchBtn.addEventListener("click", function () { if (searchOpen()) { search.blur(); setMenu(false); } else { setMenu(true, true); search.focus(); } });

  /* ---------- routing ---------- */
  function route() { setMenu(false); render(); }
  function render() {  // 重畫目前網址的頁面(不動抽屜;搜尋字數不足時用它還原)
    inSearch = false;
    tutorSync();
    // #/c/<課>/<分頁>/<數字 或 題目 id>/<數字>;第 3 段不是數字就當題目 id(例題深連結)
    var m = location.hash.match(/^#\/c\/([^/]+)(?:\/(\w+))?(?:\/([^/]+))?(?:\/(\d+))?/);
    var a3 = m && m[3] ? decodeURIComponent(m[3]) : "", num = /^\d+$/.test(a3);
    if (m) renderCourse(decodeURIComponent(m[1]), m[2] || "steps", num ? parseInt(a3, 10) : 0, m[4] ? parseInt(m[4], 10) : null, num ? null : a3 || null);
    else renderHome();
    highlight();
  }

  var LOGO = (document.querySelector(".brand .logo") || {}).outerHTML || "";  // 與側欄同一份 SVG
  function renderHome() {
    main.innerHTML =
      '<header class="chead"><h1 class="home-h1"><span class="hk">' + LOGO + 'st</span>ust<b>class</b> 互動學習網站</h1><p class="sub">' + ["六門課程", "學習路徑", "原教材例題專業詳解", "術語註釋", "互動測驗"].map(function (t) { return '<span class="nw">' + t + "</span>"; }).join(" · ") + '</p></header>' +
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
  function renderCourse(id, tab, arg, arg2, pid) {
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
      '<div class="tabwrap"><div class="tabbar" role="tablist" aria-label="課程分頁" tabindex="-1">' + tabs.map(function (t) { return '<button class="tab" role="tab" id="tab-' + t[0] + '" aria-controls="tabc" aria-selected="false" tabindex="-1" data-t="' + t[0] + '">' + t[1] + "</button>"; }).join("") +
      '</div></div><div id="tabc" role="tabpanel"></div>';
    var tabc = document.getElementById("tabc");
    var bar = main.querySelector(".tabbar");
    function show(t) {
      if (t !== tab) { tab = t; arg = 0; arg2 = pid = null; }   // 換分頁:網址只剩 /<分頁>,不沿用上一個分頁的編號
      // roving tabindex:Tab 只停在選中的分頁一次,其餘用 ← →
      var bs = [].slice.call(main.querySelectorAll(".tab")), cur = bs.filter(function (b) { return b.dataset.t === t; })[0];
      bs.forEach(function (b) { var on = b === cur; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on || (!cur && b === bs[0]) ? 0 : -1; });
      // 沒有對應按鈕的分頁(舊連結 #/c/<課>/overview):不指向不存在的 tab-<t>
      if (cur) { tabc.setAttribute("aria-labelledby", cur.id); tabc.removeAttribute("aria-label"); }
      else { tabc.removeAttribute("aria-labelledby"); tabc.setAttribute("aria-label", t === "overview" ? "課程總覽" : "課程內容"); }
      if ((location.hash.match(/^#\/c\/[^/]+\/(\w+)/) || [])[1] !== t) history.replaceState(null, "", "#/c/" + encodeURIComponent(c.id) + "/" + t);
      var a = bar.querySelector(".tab.active");
      if (a && a.offsetLeft + a.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = a.offsetLeft - 24;  // 手機:選中的分頁在畫面外就捲過去
      if (t === "overview") tabc.innerHTML = tabOverview(c);
      else if (t === "notes") { tabc.innerHTML = tabNotes(c, arg); bindNotes(c); typeset(tabc).then(function () { annotateTerms(document.getElementById("notebody"), c); }); }
      else if (t === "quiz") { tabc.innerHTML = tabQuiz(c); bindQuiz(c); }
      else if (t === "probs") { tabc.innerHTML = tabProblems(c); var dl = /\/probs\/[^/]+(\/\d+)?$/.test(location.hash); bindProblemTab(c, dl && !pid ? arg : null, dl ? arg2 : null, dl ? pid : null); }
      else if (t === "embed") tabc.innerHTML = tabEmbed(c);
      else if (t === "thesis" && thesisFor(c)) { tabc.innerHTML = tabThesis(c); bindThesis(tabc); typeset(tabc); focusThesis(/\/thesis\/\d+$/.test(location.hash) ? arg : null); }
      else if (t === "lib") { tabc.innerHTML = tabLib(c); bindLib(c); }
      else if (t === "mat") tabc.innerHTML = tabMat(c);
      else { tabc.innerHTML = tabSteps(c); bindSteps(c, arg); typeset(tabc); }
    }
    bar.addEventListener("click", function (e) { var b = e.target.closest(".tab"); if (b) show(b.dataset.t); });
    bar.addEventListener("keydown", function (e) {   // 分頁列:← → Home End 換分頁(tablist 的慣例)
      var bs = [].slice.call(bar.querySelectorAll(".tab")), i = bs.indexOf(document.activeElement), j;
      if (i < 0) return;
      j = e.key === "ArrowRight" ? (i + 1) % bs.length : e.key === "ArrowLeft" ? (i - 1 + bs.length) % bs.length : e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault(); bs[j].focus(); show(bs[j].dataset.t);
    });
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
    if (c.appliesTo) h += '<p class="note">' + ico("info") + " " + esc(c.appliesTo) + "</p>";
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
      (c.appliesTo ? '<p class="note">' + ico("info") + " " + esc(c.appliesTo) + "</p>" : "") +
      (c.todo ? '<p class="note warn">' + ico("alert") + " " + esc(c.todo) + "</p>" : "") +
      '<div class="progtxt" id="stepprog">學習進度 ' + pr.done + "/" + pr.total + " (" + pr.pct + '%)</div><div class="progwrap"><div class="progbar" id="stepbar" style="width:' + pr.pct + '%"></div></div>';
    if (nF) {
      h += lazyDetails("cheat", sumChev() + "公式速查（" + nF + " 式，附符號說明）", function () {
        return c.steps.map(function (s) {
          if (!s.formulas || !s.formulas.length) return "";
          return '<div class="fgroup"><div class="fg-t">第 ' + s.step + " 章 · " + esc(s.title) + "</div>" + s.formulas.map(formulaHtml).join("") + "</div>";
        }).join("");
      });
      var nSym = {};
      c.steps.forEach(function (s) { (s.formulas || []).forEach(function (f) { (f.vars || []).forEach(function (v) { nSym[String(v.s).replace(/\s+/g, "")] = 1; }); }); });
      if (Object.keys(nSym).length) h += lazyDetails("cheat symidx", sumChev() + "全課符號總表（" + Object.keys(nSym).length + " 個符號）", function () {
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
        // .step-head 是點擊區;鍵盤 / 讀屏的按鈕只包章號與標題,「完成」勾選框在按鈕外面
        '<div class="step-head"><div class="step-hb" role="button" tabindex="0" aria-expanded="false" aria-controls="sb' + i + '"><span class="step-no">' + (done ? ico("check") : s.step) + "</span>" +
        '<span class="step-title">' + esc(s.title) + '<span class="step-meta">' + meta + "</span></span></div>" +
        '<label class="step-chk"><input type="checkbox" ' + (done ? "checked" : "") + ' data-chk="' + i + '"> 完成</label>' +
        '<span class="step-toggle" aria-hidden="true">' + ico("chev-d") + "</span></div>" +
        '<div class="step-body collapsed" id="sb' + i + '"></div></div>';
    }).join("") + "</div>";
    return h;
  }
  function galleryHtml(title, arr, gal) {
    if (!arr || !arr.length) return "";
    return '<div class="slides"><div class="sl-t">' + title + '</div><div class="thumbs">' +
      arr.map(function (im, k) {
        var cap = im.caption ? im.caption : (im.src + " p." + im.page);
        return '<div class="thumb" tabindex="0" role="button" aria-label="放大:' + attr(cap) + '" data-gal="' + gal + '" data-k="' + k + '"><img loading="lazy" src="' + im.url + '" alt=""><div class="cap">' + esc(cap) + "</div></div>";
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
    return '<details class="cheat symidx"><summary>' + sumChev() + '全課符號總表（' + order.length + ' 個符號）</summary>' +
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
    if (P.overview) h += lazyDetails("th-fold th-ovf", sumChev() + "總覽：這份論文在做什麼、這門課扮演什麼角色", function () { return '<div class="markdown-body">' + md(P.overview, true) + "</div>"; });
    var secs = P.sections || [];
    // 各節已收合成標題列,不再另列目錄
    if (secs.length) h += '<div class="th-all"><button class="btn ghost" data-thall="1">展開全部章節</button><button class="btn ghost" data-thall="0">收合全部</button></div>';
    if (P.symbolDiffs && P.symbolDiffs.length) {
      h += '<details class="cheat th-diff"><summary>' + sumChev() + ico("alert") + ' 論文寫法 ≠ 課程寫法(' + P.symbolDiffs.length + ")</summary>" +
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
      else h += '<p class="note">' + ico("info") + ' 此節不在本課範圍。</p>';
      // 細節全部收合:按了才產生內容並排版(手機上一節不再捲十幾個畫面)
      var fs = (x.formulas || []).filter(function (fr) { return findFormula(c, fr.step, fr.label); });
      if (fs.length) h += lazyDetails("th-fold", sumChev() + "用到的課程公式（" + fs.length + "）", function () {
        return fs.map(function (fr) {
          return '<div class="th-f">' + formulaHtml(findFormula(c, fr.step, fr.label)) + (fr.use ? '<div class="th-use"><b>在你的論文裡:</b>' + inl(fr.use) + "</div>" : "") + "</div>";
        }).join("");
      });
      if (x.symbols && x.symbols.length) h += lazyDetails("th-fold", sumChev() + "符號與數值（" + x.symbols.length + "）", function () {
        return '<table class="fvars th-sym"><thead><tr><th>符號</th><th>課程意思</th><th>在你的論文裡</th><th>數值</th></tr></thead><tbody>' +
          x.symbols.map(function (v) {
            return '<tr><td class="fs">' + inl(v.s) + "</td><td>" + inl(v.course || "") + "</td><td>" + inl(v.thesis || "") + inferredTag(v.inferred) +
              (v.diff ? '<div class="fnote">' + ico("alert") + " " + inl(v.diff) + "</div>" : "") + "</td><td>" + inl(v.value || "—") + (v.unit ? " " + esc(v.unit) : "") + "</td></tr>";
          }).join("") + "</tbody></table>";
      });
      if (x.physics) h += lazyDetails("th-fold th-phy", sumChev() + esc(noEmo(LB.physics || "物理意義(白話)")), function () { return '<div class="markdown-body">' + md(x.physics, true) + "</div>"; });
      if (x.check) h += lazyDetails("th-fold th-chk", sumChev() + esc(noEmo(LB.check || "數值合不合理")), function () { return '<div class="markdown-body">' + md(x.check, true) + "</div>"; });
      if (x.notes) h += lazyDetails("th-fold th-nt", sumChev() + "資料來源與推定說明", function () { return '<p class="note">' + ico("info") + " " + inl(x.notes) + "</p>"; });
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
    return lazyDetails("res-box", sumChev() + "延伸資源（" + n + "）· 外部講解與真實數據", function () {
      var h = "";
      if (R.top && R.top.length) h += '<div class="res-h">最推薦</div><ul class="res-list">' + R.top.map(resItem).join("") + "</ul>";
      if (R.data && R.data.length) h += '<div class="res-h">真實數據（可下載）</div><ul class="res-list">' + R.data.map(resData).join("") + "</ul>";
      if (R.more && R.more.length) h += lazyDetails("res-more", sumChev() + "更多資源（" + R.more.length + "）", function () {
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
    else h += '<p class="note">' + ico("info") + ' 本步驟重點見課程主筆記(見「筆記」分頁)。</p>';
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
    function setExp(i, open) { var h = cont.querySelector('.step[data-i="' + i + '"] .step-hb'); if (h) h.setAttribute("aria-expanded", open); }
    function toggle(stepEl, i) {
      var body = document.getElementById("sb" + i);
      if (body.classList.contains("collapsed")) { if (!body.innerHTML) fill(body, i); body.classList.remove("collapsed"); setExp(i, true); }
      else { body.classList.add("collapsed"); setExp(i, false); }
    }
    function fill(body, i) {
      body.innerHTML = stepBodyHtml(c, c.steps[i], i);
      bindLazyDetails(body, ".res-item", nestLazy);
      bindThumbs(body, c.steps[i]).then(function () { annotateTerms(body.querySelector(".markdown-body"), c); });
    }
    function openStep(i) {
      var st = cont.querySelector('.step[data-i="' + i + '"]'), body = document.getElementById("sb" + i); if (!st) return;
      if (!body.innerHTML) fill(body, i);
      body.classList.remove("collapsed"); setExp(i, true);
      st.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    cont.addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go) { openStep(parseInt(go.getAttribute("data-go"), 10)); return; }
      var fin = e.target.closest("[data-finish]");
      if (fin) {
        var fi = parseInt(fin.getAttribute("data-finish"), 10), box = cont.querySelector('input[data-chk="' + fi + '"]');
        if (box && !box.checked) { box.checked = true; setDone(c.id, fi, true); var se = cont.querySelector('.step[data-i="' + fi + '"]'); se.classList.add("done"); se.querySelector(".step-no").innerHTML = ico("check"); refreshProg(); }
        document.getElementById("sb" + fi).classList.add("collapsed"); setExp(fi, false);
        if (fi < c.steps.length - 1) openStep(fi + 1);
        return;
      }
      var chk = e.target.closest("input[data-chk]");
      if (chk) { var ci = parseInt(chk.getAttribute("data-chk"), 10); setDone(c.id, ci, chk.checked); var st = cont.querySelector('.step[data-i="' + ci + '"]'); st.classList.toggle("done", chk.checked); st.querySelector(".step-no").innerHTML = chk.checked ? ico("check") : c.steps[ci].step; refreshProg(); return; }
      var head = e.target.closest(".step-head");
      if (head && !e.target.closest(".step-body, .step-chk")) { var i = parseInt(head.parentNode.getAttribute("data-i"), 10); toggle(head.parentNode, i); }
    });
    cont.addEventListener("keydown", function (e) {  // 鍵盤:步驟標題 Enter / Space 展開收合
      if ((e.key !== "Enter" && e.key !== " ") || !e.target.classList.contains("step-hb")) return;
      var st = e.target.closest(".step"); e.preventDefault(); toggle(st, parseInt(st.getAttribute("data-i"), 10));
    });
    // 預設展開第一步(或指定)
    var first = openIdx || 0;
    var fb = document.getElementById("sb" + first);
    if (fb) { fill(fb, first); fb.classList.remove("collapsed"); setExp(first, true); }
    if (first > 0) setTimeout(function () { openStep(first); }, 0);  // 等 renderCourse 的 scrollTo(0,0) 之後
  }
  function bindThumbs(body, s) {
    [].forEach.call(body.querySelectorAll(".thumb"), function (el) {
      el.addEventListener("click", function () {
        var gal = el.getAttribute("data-gal"), k = parseInt(el.getAttribute("data-k"), 10);
        openLB(gal === "fig" ? s.figures : s.images, k, el);   // 關燈箱後焦點回到這張縮圖
      });
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
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
      '<label class="prob-got" title="勾起來 = 我已經會解這題"><input type="checkbox" data-got ' + (got ? "checked" : "") + '> <span class="got-t">' + ico("check") + "我會了</span></label></div>" +
      '<div class="prob-q markdown-body">' + md(p.q, true) + "</div>" +
      '<div class="prob-acts">' +
      (p.plain ? '<button class="pbtn" data-act="plain">白話<span class="bl">翻譯</span></button>' : "") +
      (hints.length ? '<button class="pbtn" data-act="hint">提示 <span class="hcnt">0/' + hints.length + "</span></button>" : "") +
      '<button class="pbtn main" data-act="sol"><span class="bl">專業</span>詳解</button>' +
      (p.img || p.pdf ? '<button class="pbtn" data-act="orig"><span class="bl">看</span>原題<span class="bl">頁</span></button>' : "") +
      // AI 三顆收成「問 AI」選單,手機一列放得下
      '<details class="pai"><summary class="pbtn pai-btn">' + ico("msg") + " 問 AI" + ico("chev-d") + "</summary>" +
      '<div class="pai-menu"><button class="pbtn" data-act="claude">問 Claude</button><button class="pbtn" data-act="chatgpt">問 ChatGPT</button>' +
      '<button class="pbtn" data-act="copy" title="複製給 AI 的提示詞">' + ico("copy") + " 複製提示詞</button>" +
      (IS_LINE ? '<p class="pai-note">' + LINE_MSG + "</p>" : "") + "</div></details></div>" +
      (p.plain ? '<div class="prob-plain hidden"></div>' : "") +
      '<ol class="prob-hints"></ol>' +
      '<div class="prob-orig hidden">' + (p.img ? '<img loading="lazy" src="' + attr(p.img) + '" alt="原題頁" tabindex="0" role="button" aria-label="放大原題頁">' : "") +
      (p.pdf ? '<a class="btn ghost" href="' + attr(p.pdf) + '" target="_blank">開啟原 PDF 該頁' + EXT + '</a>' : "") + "</div>" +
      '<div class="prob-sol hidden"></div></div>';
    return h;
  }
  // 詳解內容(點「專業詳解」才產生,減少頁面元素)
  function probSolHtml(p) {
    var h = '<div class="markdown-body">' + md(p.solution, true) + "</div>";
    if (p.answer) h += '<div class="prob-ans"><b>' + ico("check") + ' 答案</b>　' + md(p.answer).replace(/^<p>|<\/p>\s*$/g, "") + "</div>";
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
    function ok() {   // 連點:原文只在第一次記,計時器重來,不會把「已複製」記成原文
      if (!btn) return;
      if (btn._cpT) clearTimeout(btn._cpT); else btn._cpO = btn.innerHTML;
      btn.innerHTML = ico("check") + " 已複製";
      btn._cpT = setTimeout(function () { btn.innerHTML = btn._cpO; btn._cpT = 0; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fallback); else fallback();
    // 備援:textarea 固定在畫面頂端、透明、唯讀(不跳頁、不叫出鍵盤;16px 免 iOS 放大),iOS 要 setSelectionRange 才選得到
    function fallback() {
      var ta = document.createElement("textarea"), back = document.activeElement, done = false;
      ta.value = t; ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px";
      document.body.appendChild(ta);
      try { ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, t.length); done = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      if (back && back.focus) back.focus({ preventScroll: true });
      if (done) ok(); else copyBox(t, btn);
    }
  }
  function copyBox(t, from) {   // 自動複製失敗:底部卡片放唯讀文字,讓使用者長按複製
    var b = document.getElementById("copybox");
    if (!b) {
      b = document.createElement("div"); b.id = "copybox"; b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "手動複製");
      b.innerHTML = '<div class="cb-h"><b>自動複製失敗，請長按複製</b><button class="cb-x" aria-label="關閉">' + ico("x") + "</button></div><textarea readonly></textarea>";
      document.body.appendChild(b);
      b.querySelector(".cb-x").addEventListener("click", copyBoxClose);
    }
    var ta = b.querySelector("textarea");
    if (b.classList.contains("hidden") || !b._back) b._back = from || document.activeElement;   // Safari 點按鈕不會給焦點,所以直接傳按鈕
    ta.value = t; b.classList.remove("hidden");
    // 先全選(桌機直接 Ctrl+C);選取方向往回 = 游標在開頭,畫面停在第一行(下一格再拉回一次,Firefox 會捲到選取尾端)
    ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, t.length, "backward"); ta.scrollTop = 0;
    requestAnimationFrame(function () { ta.scrollTop = 0; });
  }
  function copyBoxClose() {   // ×、Esc、換頁都關;焦點還給原本的按鈕
    var b = document.getElementById("copybox"); if (!b || b.classList.contains("hidden")) return;
    b.classList.add("hidden");
    var t = b._back, d = t && t.closest && t.closest("details:not([open])");   // 按鈕在收起的「問 AI」選單裡 → 改給選單按鈕
    if (d) t = d.querySelector("summary");
    if (t && t.focus && document.contains(t)) t.focus({ preventScroll: true });
    b._back = null;
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
      var b = e.target.closest(".pbtn"); if (!b || b.tagName === "SUMMARY") return;
      var card = b.closest(".prob"), f = findProblem(c, card.dataset.pid); if (!f) return;
      var p = f.p, act = b.dataset.act;
      function tog(sel) { var el = card.querySelector(sel); if (!el) return null; el.classList.toggle("hidden"); b.classList.toggle("on", !el.classList.contains("hidden")); return el; }
      if (act === "plain") { var pl = tog(".prob-plain"); if (pl && !pl.innerHTML) { pl.innerHTML = ico("book") + " " + md(p.plain, true); typeset(pl); } }
      else if (act === "hint") {
        var ol = card.querySelector(".prob-hints"), n = ol.children.length, hs = p.hints || [];
        if (n < hs.length) { var li = document.createElement("li"); li.innerHTML = ico("bulb") + " " + (/^[\s*_]*提示/.test(hs[n]) ? "" : '<b class="cl">提示 ' + (n + 1) + "</b> ") + md(hs[n]).replace(/^<p>|<\/p>\s*$/g, ""); ol.appendChild(li); typeset(li); n++; }
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
      openLB([{ url: im.getAttribute("src"), caption: "原題頁", src: "", page: 0 }], 0, im);   // 關燈箱後焦點回到這張圖
    });
    root.addEventListener("keydown", function (e) {
      var im = e.target.closest && e.target.closest(".prob-orig img");
      if (im && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); im.click(); }
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
    if (c.glossary && c.glossary.length) h += '<details class="cheat gloss"><summary>' + sumChev() + '全課術語註釋（' + c.glossary.length + ' 條）</summary><dl>' +
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
  function bindProblemTab(c, si, k, pid) {
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
      xsScan(list);   // 原本藏起來的題卡現在才量得到寬度
    }
    ["#pf-step", "#pf-lv", "#pf-todo"].forEach(function (s) { $(s).addEventListener("change", apply); });
    var hit = pid ? findProblem(c, pid) : null;  // 搜尋結果 /probs/<題目 id>:篩到該章
    if (hit) si = hit.si;
    if (si !== null && si !== undefined && c.steps[si] && c.steps[si].problems && c.steps[si].problems.length) { $("#pf-step").value = String(si); apply(); }
    var card = hit ? [].find.call(list.querySelectorAll(".prob"), function (x) { return x.dataset.pid === pid; })
      : k != null ? list.querySelectorAll('.pgroup[data-si="' + si + '"] .prob')[k] : null;  // 舊連結 /probs/<章>/<第幾題>:照位置找
    if (card) {
      var go = function () { card.scrollIntoView({ block: "start" }); };
      setTimeout(function () { go(); card.classList.add("flash"); setTimeout(function () { card.classList.remove("flash"); }, 1600); }, 0);  // 等 renderCourse 的 scrollTo(0,0)
      setTimeout(go, 900);  // 上方題卡公式排版完高度會變,再對一次
    }
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
    var SKIP = /^(PRE|CODE|A|SCRIPT|STYLE|MJX-CONTAINER|H[1-6]|BUTTON|TEXTAREA|SELECT|DT|SUMMARY)$/;
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
  // 手機的筆記清單是橫捲:選中項在畫面外就只橫向捲過去(不動整頁)
  function noteItemShow(list, b) {
    if (!b || list.scrollWidth <= list.clientWidth) return;
    var d = b.getBoundingClientRect().left - list.getBoundingClientRect().left;
    if (d < 0 || d + b.offsetWidth > list.clientWidth) list.scrollLeft += d - 16;
  }
  function bindNotes(c) {
    var list = main.querySelector(".notelist"); if (!list) return;
    noteItemShow(list, list.querySelector(".noteitem.active"));   // #/c/<課>/notes/<i> 深連結
    list.addEventListener("click", function (e) {
      var b = e.target.closest(".noteitem"); if (!b) return;
      [].forEach.call(list.querySelectorAll(".noteitem"), function (x) { x.classList.remove("active"); });
      b.classList.add("active"); noteItemShow(list, b);
      history.replaceState(null, "", "#/c/" + encodeURIComponent(c.id) + "/notes/" + b.dataset.i);   // 重新整理、分享都停在這篇;replaceState 不觸發 hashchange
      var nb = document.getElementById("notebody");
      nb.innerHTML = md(c.notes[parseInt(b.dataset.i, 10)].content);
      typeset(nb).then(function () { annotateTerms(nb, c); });
      window.scrollTo(0, 0);
    });
  }
  // 筆記目錄的 #錨點:不交給 hashchange(會被當成路由畫回首頁),直接捲到標題
  // 比對用:只留字母與數字(錨點產生器對 emoji、標點、空白的處理不一致,兩邊都去掉才對得上)
  function anchorKey(t) { return String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
  main.addEventListener("click", function (e) {
    var a = e.target.closest('#notebody a[href^="#"]:not([href^="#/"])'); if (!a) return;
    e.preventDefault();
    var id = a.getAttribute("href").slice(1); try { id = decodeURIComponent(id); } catch (x) {}
    var nb = document.getElementById("notebody"), t = null;
    [].some.call(nb.querySelectorAll("[id]"), function (x) { if (x.id === id) { t = x; return true; } });
    if (t && !t.textContent.trim()) {   // <a id="1"></a> 這種空錨點:跳到後面的標題
      var n = t.closest("p") || t; while (n && n !== nb && !/^H[1-6]$/.test(n.tagName)) n = n.nextElementSibling;
      if (n && n !== nb) t = n;
    }
    if (!t) {
      var k = anchorKey(id), hs = [].slice.call(nb.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      t = hs.filter(function (h) { return anchorKey(h.textContent) === k; })[0];
      if (!t && k.length >= 4) {   // 標題後來補了字(「13. 紅綠燈實例 ⭐(期中/練習核心)」):只有一個標題以錨點開頭才跳
        var pre = hs.filter(function (h) { return anchorKey(h.textContent).indexOf(k) === 0; });
        if (pre.length === 1) t = pre[0];
      }
    }
    if (!t) return;
    t.scrollIntoView({ block: "start" });
    if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");   // 焦點跟著到標題,不留在目錄
    t.focus({ preventScroll: true });
  });

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
    return '<p class="note">' + ico("info") + ' 從 PI（Physik Instrumente）官網整理的技術文件，連結直接開官網原檔。也可以問右下角的 AI 助教「這章有什麼資料可以看」。</p>' +
      '<div class="lib-bar"><input class="lib-q" type="search" aria-label="搜尋 PI 資料庫(中文、日文、英文或型號)" placeholder="' + (matchMedia("(max-width:820px)").matches ? "中日英或型號" : "搜尋：中文、日文、英文或型號，例如 遲滯、ヒステリシス、hexapod、E-505") + '">' +
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
  var sidx = null, inSearch = false;
  // 摘要用純文字:去掉 markdown 連結/表格與 $;常見 LaTeX 指令換成 Unicode,不認得的整個刪掉(不留指令名),保留原文大小寫
  var TEX_U = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ",
    lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    cong: "≅", approx: "≈", simeq: "≃", sim: "~", equiv: "≡", neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫", propto: "∝",
    times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷", infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫", oint: "∮", sqrt: "√",
    to: "→", rightarrow: "→", longrightarrow: "→", xrightarrow: "→", leftarrow: "←", gets: "←", Rightarrow: "⇒", implies: "⇒", Longrightarrow: "⇒",
    Leftarrow: "⇐", Leftrightarrow: "⇔", iff: "⇔", leftrightarrow: "↔", mapsto: "↦",
    lvert: "|", rvert: "|", vert: "|", mid: "|", lVert: "‖", rVert: "‖", Vert: "‖", langle: "⟨", rangle: "⟩",
    in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", forall: "∀", exists: "∃", angle: "∠", perp: "⊥", parallel: "∥", circ: "∘", degree: "°",
    prime: "′", ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", hbar: "ℏ", ell: "ℓ", quad: " ", qquad: " ",
    dot: "\u0307", ddot: "\u0308"   // 組合字元;snipText 會把它移到字母後面(ẋ ẍ)
  };
  var TEX_FN = /^(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|max|min|sup|inf|lim|det|arg|deg|dim|ker|gcd|Re|Im|mod|bmod)$/;
  var SUPC = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "(": "⁽", ")": "⁾", T: "ᵀ", "∘": "°", "′": "′", "*": "∗" };   // * 用 ∗(stripMd 會刪 *)
  var SUBC = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ", β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", φ: "ᵩ", χ: "ᵪ" };
  var SUBK = {}; Object.keys(SUBC).forEach(function (k) { if (k !== "−") SUBK[SUBC[k]] = k; });   // 下標字 → 原字(搜尋用)
  function texName(n) { return TEX_U.hasOwnProperty(n) ? TEX_U[n] : TEX_FN.test(n) ? " " + n + " " : ""; }
  // \uE004 = 隔開用的佔位字:\frac{…}、\text{…} 拆完的結果不會黏到前面的指令(\approx\frac{f}{i} 不會變成不認得的 \approxf)
  function texCmds(s) { return s.replace(/\\([a-zA-Z]+)/g, function (m, n) { return texName(n); }).replace(/\uE004/g, ""); }
  // 整串能變上標字就變;不能的保留 ^ 與括號(e^{-ζωt} → e^(-ζωt)),不然會讀成相減;本來就有括號的不再加一層。\uE002 = ^,最後才換回
  function texSup(s) { s = texCmds(s).trim(); return !s ? "" : /^[0-9+\-−()]+$|^[T∘′*]$/.test(s) ? s.replace(/./g, function (ch) { return SUPC[ch]; }) : s.length === 1 || /^\([^()]*\)$/.test(s) ? "\uE002" + s : "\uE002(" + s + ")"; }
  // 下標同上:ωₙ、xₙ₊₁;不能的 σ_y、T_(1/2)。\uE003 = _(stripMd 會刪 _),最後才換回
  function texSub(s) {
    s = texCmds(s).trim(); if (!s) return "";
    return /^[^\s]+$/.test(s) && s.split("").every(function (ch) { return SUBC.hasOwnProperty(ch); }) ? s.replace(/./g, function (ch) { return SUBC[ch]; }) : s.length === 1 || /^\([^()]*\)$/.test(s) ? "\uE003" + s : "\uE003(" + s + ")";
  }
  var SUBS = "₀-₉₊₋₌₍₎ₐₑₒₓₕ-ₜᵢ-ᵪⱼ";
  // 分子分母:單一符號(可帶上下標)、純數字、本來就有括號或 |…| 才不加括號
  var PAR_RE = new RegExp("^(?:[0-9]+(?:\\.[0-9]+)?|[A-Za-z\\u0370-\\u03ff∞∂∇ℏℓ](?:[_\\uE003](?:[0-9A-Za-z\\u0370-\\u03ff]+|\\([^()]*\\))|[" + SUBS + "]|[\\^\\uE002]?[0-9T*¹²³⁰-⁹⁽⁾′∗ᵀ])*|√?\\([^()]*\\)(?:[\\^\\uE002]?[0-9T*¹²³⁰-⁹⁽⁾′∗ᵀ])*|\\|[^|]*\\|)$");
  function texPar(s) { s = texCmds(s).trim(); return PAR_RE.test(s) ? s : "(" + s + ")"; }
  // 筆記裡的 emoji(🔗 ⭐ ⚠️)不進摘要;↔ 這類箭頭與 © ® ™ 保留
  var EMOJI_RE; try { EMOJI_RE = new RegExp("(?![\\u00a9\\u00ae\\u2122\\u2194-\\u2199])\\p{Extended_Pictographic}|[\\ufe0f\\u200d]", "gu"); } catch (e) { EMOJI_RE = /[\ud83c-\ud83e][\udc00-\udfff]|[\u2600-\u27bf\u2b50\u2b55]|[\ufe0f\u200d]/g; }
  function snipText(t) {
    var s = String(t || "").replace(/(^|[^!])\[([^\]]*)\]\([^)]*\)/g, "$1$2").replace(/```[\w-]*/g, " ")   // 程式碼框的語言名(```text)
      .replace(/^\s*\|?[\s|:-]*-[\s|:-]*$/gm, " ")                                   // 表格分隔列 |---|---|
      .replace(/^\s*\|.*$/gm, function (l) { return l.replace(/\|/g, " "); })        // 表格列的 |(數學的 |x| 不動)
      .replace(/\\begin\s*\{([bpvBV]?matrix)\}([\s\S]*?)\\end\s*\{\1\}/g, function (m, k, b) {   // 矩陣寫成 [5 0; 0 10]
        var o = { p: "()", v: "||", B: "\uE000\uE001", V: "‖‖" }[k[0]] || "[]";   // \uE000 \uE001 = { }(最後才換回,不會被當 TeX 大括號刪掉)
        return " " + o[0] + b.split(/\\\\/).map(function (r) { return r.replace(/&/g, " ").trim(); }).filter(Boolean).join("; ") + o[1] + " ";
      })
      .replace(/\\(d?dot)(?![a-zA-Z])\s*\{\s*\\\{\s*([^{}\s\\])\s*\\\}\s*\}/g, function (m, n, a) { return "\uE000" + a + TEX_U[n] + "\uE001"; })   // \ddot{\{x\}} → {ẍ}
      .replace(/\\(d?dot)(?![a-zA-Z])\s*(?:\{\s*([^{}\s])\s*\}|([A-Za-z\u0370-\u03ff]))/g, function (m, n, a, b) { return (a || b) + TEX_U[n]; })   // 點放在字母後面
      .replace(/\\d?dot(?![a-zA-Z])/g, "")                                                // 剩下沒有對象的點:刪掉,不留孤立的點
      .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ").replace(/\\\\/g, " ").replace(/[$&]/g, " ")
      .replace(/\\\|/g, "‖").replace(/\\\{/g, "\uE000").replace(/\\\}/g, "\uE001").replace(/\\([%#_])/g, "$1").replace(/\\[,;:! ]/g, " ")   // \{ \} 先換佔位字,TeX 大括號刪完再換回
      .replace(/\\(?:color|textcolor|label|tag|hspace|vspace|phantom)\s*\{[^{}]*\}/g, "");   // 參數不是內容的指令:連參數一起刪
    s = s.replace(/\\[dt]?frac\s*([0-9A-Za-z])\s*([0-9A-Za-z])/g, "$1/$2");   // \tfrac12 這種不加大括號的寫法
    for (var k = 0, prev = ""; k < 6 && s !== prev; k++) {   // 由內往外拆大括號:上下標、分數、根號、帶參數的指令
      prev = s;
      s = s.replace(/\^\s*\{([^{}]*)\}/g, function (m, a) { return texSup(a); }).replace(/_\s*\{([^{}]*)\}/g, function (m, a) { return texSub(a); })
        .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, function (m, a, b) { return "\uE004" + texPar(a) + "/" + texPar(b); })
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, function (m, a) { return "√" + texPar(a); })
        .replace(/\\(?!(?:[dt]?frac|sqrt)(?![a-zA-Z]))([a-zA-Z]+)\s*\{([^{}]*)\}/g, function (m, n, a) { return "\uE004" + texName(n) + a; });
    }
    s = texCmds(s).replace(/\^\s*([0-9T∘′*])/g, function (m, a) { return SUPC[a]; }).replace(/\^\s*([A-Za-z\u0370-\u03ff])/g, "\uE002$1")
      // 沒大括號的下標(ω_t、x_1);前面要接著字,一般文字的 file_size 不動
      .replace(/([^\s_])_([0-9]|[A-Za-z\u0370-\u03ff](?![A-Za-z]))/g, function (m, p, a) { return p + texSub(a); });
    return stripMd(s).replace(/[{}^\\]/g, "").replace(EMOJI_RE, "").replace(/\uE000/g, "{").replace(/\uE001/g, "}").replace(/\uE002/g, "^").replace(/\uE003/g, "_").replace(/\s+/g, " ").trim();
  }
  // 搜 zeta / cong 這類指令名時也找換好的符號(只收 3 字以上、非 ASCII 的)
  var TEX_ALIAS = {};
  Object.keys(TEX_U).forEach(function (k) { var v = TEX_U[k], lk = k.toLowerCase(); if (k.length >= 3 && /[^\x00-\x7f]/.test(v) && (!TEX_ALIAS[lk] || k === lk)) TEX_ALIAS[lk] = v; });
  // 比對用的字串:轉小寫、去掉 _ 與 _( ) 的括號、下標字換回原字、∗ → *(打 σy 找得到 σ_y,ωn 找得到 ωₙ,Hpq 找得到 H_(pq),A1* 找得到 A1∗)
  function keyCh(ch) { return ch === "_" ? "" : ch === "∗" ? "*" : SUBK[ch] || ch.toLowerCase().replace(/ς/g, "σ"); }
  // m:每個 key 字元在原字串的位置(標 mark 用);noMap 時不記(建索引用)
  function keyMap(s, noMap) {
    var k = "", m = noMap ? null : [], close = -1;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "_" && s[i + 1] === "(") { var j = s.indexOf(")", i + 2), o = s.indexOf("(", i + 2); if (j > 0 && (o < 0 || o > j)) { close = j; i++; continue; } }
      if (i === close) continue;
      var t = keyCh(s[i]); k += t;
      if (m) for (var n = 0; n < t.length; n++) m.push(i);
    }
    return { k: k, m: m };
  }
  function skey(s) { return keyMap(String(s), true).k; }
  function buildIndex() {
    sidx = [];
    // 標題與內文分開存:標題命中時摘要從內文開頭取,不再重複一次標題
    function add(c, href, title, body, prob) { var ts = snipText(title), raw = snipText(body); sidx.push({ ctitle: c.title, href: href, ts: ts, tl: skey(ts), prob: prob, raw: raw, text: skey(raw) }); }
    D.courses.forEach(function (c) {
      c.notes.forEach(function (n, i) { add(c, "#/c/" + c.id + "/notes/" + i, n.title, n.content, false); });
      c.steps.forEach(function (s, si) {
        (s.problems || []).forEach(function (p) { add(c, "#/c/" + c.id + "/probs/" + encodeURIComponent(p.id), "例題 " + p.id + " " + (p.title || ""), [p.q, p.plain, p.solution].join("\n"), true); });
      });
    });
  }
  // 注音選字中(isComposing)不搜;選完字 compositionend 立刻搜,一般輸入等 150ms 停手再搜
  var searchT = 0;
  search.addEventListener("input", function (e) { clearTimeout(searchT); if (e.isComposing) return; searchT = setTimeout(doSearch, 150); });
  search.addEventListener("compositionend", function () { clearTimeout(searchT); doSearch(); });
  function doSearch() {
    var raw = search.value.trim(), q = skey(raw);   // 比對用的 key(見 keyCh)
    if (raw && sidebar.classList.contains("open")) setMenu(true, true);  // 手機:抽屜只留搜尋框;字刪光也維持,直到關閉
    if (q.length < 2) { if (inSearch) render(); return; }    // 字數不足:只還原頁面,不關抽屜
    if (!sidx) buildIndex();
    if (!inSearch) window.scrollTo(0, 0);  // 從頁面中段開始打字:捲回頂端看得到「搜尋:」標題
    inSearch = true;
    var alt = TEX_ALIAS[q] || "";
    function has(s) { return s.indexOf(q) >= 0 || (alt && s.indexOf(alt) >= 0); }
    var all = sidx.filter(function (x) { return has(x.tl) || has(x.text); });
    // 排名:標題命中 +2、例題 +1;同分維持原順序(sort 是穩定的)
    all = all.map(function (x) { return { x: x, s: (has(x.tl) ? 2 : 0) + (x.prob ? 1 : 0) }; }).sort(function (a, b) { return b.s - a.s; }).map(function (o) { return o.x; });
    var hits = all.slice(0, 40);
    // 依課程分組(各組照第一筆出現的順序),每筆不再重複課名
    var groups = [], gi = {};
    hits.forEach(function (x) { if (!gi.hasOwnProperty(x.ctitle)) { gi[x.ctitle] = groups.length; groups.push([]); } groups[gi[x.ctitle]].push(x); });
    // 找 s 裡 [from, to) 範圍內第一個命中,回傳原字串的 [起, 迄) 位置
    function hitIn(s, from, to) {
      var km = keyMap(s), i, n;
      [q, alt].some(function (w) { if (!w) return false; i = km.k.indexOf(w); n = w.length; return i >= 0; });
      if (!(i >= 0)) return null;
      var a = km.m[i], b = km.m[i + n - 1] + 1;
      return a >= from && b <= to ? [a, b] : null;
    }
    function marked(s, from, to) {
      var h = hitIn(s, from, to);
      return h ? esc(s.slice(from, h[0])) + "<mark>" + esc(s.slice(h[0], h[1])) + "</mark>" + esc(s.slice(h[1], to)) : esc(s.slice(from, to));
    }
    function card(x) {
      var a = 0, b = Math.min(x.raw.length, 100), th = has(x.tl), h = th ? null : hitIn(x.raw, 0, x.raw.length);
      if (h) { a = Math.max(0, h[0] - 40); b = Math.min(x.raw.length, h[1] + 60); }   // 命中在內文:取命中處前後
      var snip = x.raw ? '<span class="snip">' + (a ? "…" : "") + marked(x.raw, a, b) + (b < x.raw.length ? "…" : "") + "</span>" : "";
      return '<a class="result" href="' + x.href + '"><b>' + (th ? marked(x.ts, 0, x.ts.length) : esc(x.ts)) + "</b>" + snip + "</a>";
    }
    var head = '<h1>搜尋:「' + esc(raw) + '」</h1>', cnt = all.length > hits.length ? "共 " + all.length + " 筆，顯示前 " + hits.length + " 筆" : all.length + " 筆結果";
    var body = hits.length ? groups.map(function (g) { return '<h2 class="res-g">' + esc(g[0].ctitle) + '<span class="res-gn">' + g.length + " 筆</span></h2>" + '<div class="results">' + g.map(card).join("") + "</div>"; }).join("") : '<p class="empty">查無結果。</p>';
    // 搜尋中只換內容、不重建結果數那一行:aria-live 區塊要一直在,螢幕閱讀器才會念出新的筆數
    var live = document.getElementById("srch-n"), sh = document.getElementById("srch-h"), sb = document.getElementById("srch-b");
    if (!live || !sh || !sb) {
      main.innerHTML = '<header class="chead"><div id="srch-h"></div><p class="sub" id="srch-n" aria-live="polite"></p></header><div id="srch-b"></div>';
      live = document.getElementById("srch-n"); sh = document.getElementById("srch-h"); sb = document.getElementById("srch-b");
      setTimeout(function () { if (live.isConnected) live.textContent = live.dataset.n; }, 50);   // 剛插入的 live 區塊要等一下再填字才會被念
    } else live.textContent = cnt;
    live.dataset.n = cnt;
    sh.innerHTML = head; sb.innerHTML = body;
  }
  search.addEventListener("keydown", function (e) {  // 手機按 Enter:收起抽屜,結果從頂端完整顯示
    if (e.isComposing || e.keyCode === 229) return;  // 注音 / Android 選字中的 Enter
    if (e.key !== "Enter" || !matchMedia("(max-width:820px)").matches) return;
    e.preventDefault(); search.blur(); setMenu(false); window.scrollTo(0, 0);
  });
  main.addEventListener("click", function (e) { var r = e.target.closest(".result"); if (r && r.getAttribute("href") === location.hash) { search.value = ""; route(); } });  // 同頁結果不會觸發 hashchange

  // 題卡「問 AI」選單:點外面、選了 Claude / ChatGPT、或按 Esc 就收起
  document.addEventListener("click", function (e) {
    [].forEach.call(document.querySelectorAll("details.pai[open]"), function (d) {
      if (!d.contains(e.target) || e.target.closest('[data-act="claude"], [data-act="chatgpt"]')) d.open = false;
    });
  });
  // 「問 AI」選單:底部會被 AI 助教圓鈕蓋住或超出畫面時,上方放得下就往上開,否則把頁面往上捲
  function paiPlace(d) {
    var m = d.querySelector(".pai-menu"); if (!m) return;
    m.classList.remove("up");
    var tb = document.getElementById("tutor-btn"), t = tb && tb.getClientRects().length ? tb.getBoundingClientRect() : null, lim = innerHeight - 8;
    if (t) lim = Math.min(lim, t.top - 8);
    var s = d.querySelector("summary").getBoundingClientRect(), sl = t && s.right > t.left && s.left < t.right ? lim : innerHeight - 8;
    if (s.bottom > sl) window.scrollBy(0, s.bottom - sl);   // 按鈕本身被圓鈕蓋住或在畫面外:先捲上來
    var r = m.getBoundingClientRect();
    if (r.bottom <= lim) return;
    var bar = matchMedia("(max-width:820px)").matches ? document.getElementById("sidebar").getBoundingClientRect().bottom : 0;
    if (d.getBoundingClientRect().top - 4 - r.height >= bar + 8) m.classList.add("up");
    else window.scrollBy(0, r.bottom - lim);
  }
  document.addEventListener("toggle", function (e) { if (e.target.matches && e.target.matches("details.pai") && e.target.open) paiPlace(e.target); }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var cb = document.getElementById("copybox");
    if (cb && !cb.classList.contains("hidden")) { copyBoxClose(); e.stopImmediatePropagation(); return; }   // 一次只關最上層
    [].forEach.call(document.querySelectorAll("details.pai[open]"), function (d) { d.open = false; });
  });

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
    var m = location.hash.match(/^#\/c\/([^/]+)(?:\/(\w+))?(?:\/([^/]+))?/), c = m && byId(decodeURIComponent(m[1]));
    tutorBtn.classList.toggle("hidden", !c);
    if (!c) { tutorShow(false); return; }
    var a3 = m[3] ? decodeURIComponent(m[3]) : "", num = /^\d+$/.test(a3);
    var hit = m[2] === "probs" && a3 && !num ? findProblem(c, a3) : null;  // 題目 id 深連結:用該題的章
    var si = hit ? hit.si : (m[2] === "steps" || m[2] === "probs") && num ? Math.min(+a3, c.steps.length - 1) : (T.c === c ? T.si : 0);
    var own = tutorOwner();   // 登入/登出作者模式也要換面板
    if (T.c !== c || T.si !== si || T.owner !== own) { T.c = c; T.si = si; T.owner = own; T.msgs = []; if (T.open) tutorRender(); }
  }
  function tutorShow(open) {
    T.open = open; tutorBox.classList.toggle("hidden", !open); tutorBtn.classList.toggle("on", open); if (open) tutorBtn.classList.remove("away");
    if (open) { tutorRender(); if (!matchMedia("(pointer:coarse)").matches) tutorEl(".tt-in").focus(); }  // 觸控裝置不自動叫出鍵盤蓋住面板
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
    tutorNote("已開新分頁。本章完整教材已複製,對方需要時在對話框貼上" + (matchMedia("(pointer:coarse)").matches ? "" : "(Ctrl+V)") + "即可。");
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
        : '<div class="tt-acts"><button class="btn tt-ho" data-w="claude">Claude 開啟(免費)</button><button class="pbtn tt-ho" data-w="chatgpt">ChatGPT 開啟</button><button class="pbtn tt-send">自備金鑰送出</button></div>') +
      (tutorOwner()
        ? '<div class="tt-owner"><div><b>作者模式</b>:使用你自己的 Claude(金鑰只在本機 private.js,不會顯示也不會發布)。</div>' + modelSel + "</div>"
        : '<details class="tt-set"><summary>' + sumChev() + '設定:自備 Anthropic API 金鑰 ' + (key ? "(已設定 …" + esc(key.slice(-4)) + ")" : "(未設定)") + "</summary>" +
          '<input type="password" class="tt-key" placeholder="貼上 sk-ant-… 金鑰" autocomplete="off">' +
          '<label class="tt-rm"><input type="checkbox"' + (lsGet(TK) ? " checked" : "") + '> 記住在這台電腦(公用電腦請不要勾)</label>' + modelSel +
          '<div class="tt-acts"><button class="pbtn tt-save">儲存金鑰</button>' + (key ? '<button class="pbtn tt-clear">清除金鑰</button>' : "") +
          '<a class="tt-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">取得金鑰' + EXT + '</a></div>' +
          '<p class="tt-fine">金鑰只存在你自己的瀏覽器,直接傳給 Anthropic;本網站沒有伺服器,看不到你的金鑰。費用由你的 Anthropic 帳號支付。</p></details>') +
      '<p class="tt-fine">回答由 AI 產生,可能有錯,請對照筆記;即時出的題目未經驗算。</p>';
    tutorLog();
  }

  tutorBtn.addEventListener("click", function () { tutorShow(!T.open); });
  (function tutorAvoid() {
    var lastY = scrollY, mq = matchMedia("(max-width:820px)");
    addEventListener("scroll", function () {
      var y = scrollY, dy = y - lastY, end = y + innerHeight >= document.documentElement.scrollHeight - 4;
      if (Math.abs(dy) < 6 && !end) return;
      lastY = y;
      // 一次跳超過約一個畫面(深層連結、回到頂端)是程式捲動,不是手指往下滑:不收
      tutorBtn.classList.toggle("away", mq.matches && !T.open && dy > 0 && dy < innerHeight * .9 && y > 80 && !end);
    }, { passive: true });
  })();
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
  window.addEventListener("hashchange", function () { search.value = ""; copyBoxClose(); route(); });  // 換頁就離開搜尋結果、關手動複製卡
  renderNav();
  route();
})();
