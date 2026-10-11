/* 互動式 3D 晶體結構學習平台 — NANOMATERIALS 教學用
   功能:選晶系、調晶格參數(a,b,c,α,β,γ)、編輯 Motif 基元、3D 視覺化、內建預設結構。
   僅依賴 three.min.js(本地)。 */
"use strict";

/* ---------- 元素資料(顏色 / 顯示半徑 Å / 名稱)---------- */
var ELEMENTS = {
  C:  { color: 0x383838, r: 0.75, name: "碳 C" },
  O:  { color: 0xff3025, r: 0.66, name: "氧 O" },
  Sr: { color: 0x22d36b, r: 1.60, name: "鍶 Sr" },
  Ca: { color: 0x55e000, r: 1.50, name: "鈣 Ca" },
  Ti: { color: 0x9aa3ad, r: 1.20, name: "鈦 Ti" },
  U:  { color: 0x45a0ff, r: 1.40, name: "鈾 U" },
  Cu: { color: 0xc87533, r: 1.20, name: "銅 Cu" },
  Fe: { color: 0xd98a52, r: 1.20, name: "鐵 Fe" },
  Na: { color: 0xab5cf2, r: 1.20, name: "鈉 Na" },
  Cl: { color: 0x3bd23b, r: 1.00, name: "氯 Cl" }
};
function hashColor(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffff; return h || 0x8899aa; }
function elem(sym) { return ELEMENTS[sym] || { color: hashColor(sym), r: 1.1, name: sym }; }

/* ---------- 七大晶系(可編輯參數 + 由對稱推導全部)---------- */
var SYSTEMS = {
  cubic:        { label: "立方 Cubic (a=b=c, 90°)",            edit: ["a"],                   d: function (p) { return { a: p.a, b: p.a, c: p.a, al: 90, be: 90, ga: 90 }; } },
  tetragonal:   { label: "正方 Tetragonal (a=b≠c, 90°)",       edit: ["a", "c"],              d: function (p) { return { a: p.a, b: p.a, c: p.c, al: 90, be: 90, ga: 90 }; } },
  orthorhombic: { label: "正交 Orthorhombic (a≠b≠c, 90°)",     edit: ["a", "b", "c"],         d: function (p) { return { a: p.a, b: p.b, c: p.c, al: 90, be: 90, ga: 90 }; } },
  hexagonal:    { label: "六方 Hexagonal (a=b, γ=120°)",       edit: ["a", "c"],              d: function (p) { return { a: p.a, b: p.a, c: p.c, al: 90, be: 90, ga: 120 }; } },
  trigonal:     { label: "三方/菱面 Trigonal (a=b=c, α=β=γ)",  edit: ["a", "al"],             d: function (p) { return { a: p.a, b: p.a, c: p.a, al: p.al, be: p.al, ga: p.al }; } },
  monoclinic:   { label: "單斜 Monoclinic (β≠90°)",            edit: ["a", "b", "c", "be"],   d: function (p) { return { a: p.a, b: p.b, c: p.c, al: 90, be: p.be, ga: 90 }; } },
  triclinic:    { label: "三斜 Triclinic (全可變)",            edit: ["a", "b", "c", "al", "be", "ga"], d: function (p) { return { a: p.a, b: p.b, c: p.c, al: p.al, be: p.be, ga: p.ga }; } }
};

/* ---------- 預設結構 ---------- */
var PRESETS = {
  graphite:   { name: "石墨 Graphite", system: "hexagonal", p: { a: 2.46, c: 6.70 }, bond: 1.6,
                motif: [["C", 0, 0, 0], ["C", 0, 0, 0.5], ["C", 1 / 3, 2 / 3, 0], ["C", 2 / 3, 1 / 3, 0.5]] },
  perovskite: { name: "鈣鈦礦 Perovskite (SrTiO₃)", system: "cubic", p: { a: 3.905 }, bond: 2.1,
                motif: [["Sr", 0, 0, 0], ["Ti", 0.5, 0.5, 0.5], ["O", 0.5, 0.5, 0], ["O", 0.5, 0, 0.5], ["O", 0, 0.5, 0.5]] },
  uranium:    { name: "α-鈾 Uranium (α-U, Cmcm)", system: "orthorhombic", p: { a: 2.854, b: 5.869, c: 4.955 }, bond: 3.0,
                motif: [["U", 0, 0.1025, 0.25], ["U", 0, 0.8975, 0.75], ["U", 0.5, 0.6025, 0.25], ["U", 0.5, 0.3975, 0.75]] },
  fcc:        { name: "FCC 面心立方 (Cu)", system: "cubic", p: { a: 3.615 }, bond: 2.7,
                motif: [["Cu", 0, 0, 0], ["Cu", 0.5, 0.5, 0], ["Cu", 0.5, 0, 0.5], ["Cu", 0, 0.5, 0.5]] },
  bcc:        { name: "BCC 體心立方 (Fe)", system: "cubic", p: { a: 2.866 }, bond: 2.6,
                motif: [["Fe", 0, 0, 0], ["Fe", 0.5, 0.5, 0.5]] },
  nacl:       { name: "岩鹽 NaCl", system: "cubic", p: { a: 5.64 }, bond: 2.9,
                motif: [["Na", 0, 0, 0], ["Na", 0.5, 0.5, 0], ["Na", 0.5, 0, 0.5], ["Na", 0, 0.5, 0.5],
                        ["Cl", 0.5, 0, 0], ["Cl", 0, 0.5, 0], ["Cl", 0, 0, 0.5], ["Cl", 0.5, 0.5, 0.5]] },
  diamond:    { name: "鑽石 Diamond (C)", system: "cubic", p: { a: 3.567 }, bond: 1.7,
                motif: [["C", 0, 0, 0], ["C", 0.5, 0.5, 0], ["C", 0.5, 0, 0.5], ["C", 0, 0.5, 0.5],
                        ["C", 0.25, 0.25, 0.25], ["C", 0.75, 0.75, 0.25], ["C", 0.75, 0.25, 0.75], ["C", 0.25, 0.75, 0.75]] }
};

/* ---------- 晶格向量:由 a,b,c,α,β,γ 轉卡氏 ---------- */
function latticeVectors(L) {
  var d2r = Math.PI / 180;
  var al = L.al * d2r, be = L.be * d2r, ga = L.ga * d2r;
  var va = new THREE.Vector3(L.a, 0, 0);
  var vb = new THREE.Vector3(L.b * Math.cos(ga), L.b * Math.sin(ga), 0);
  var cx = L.c * Math.cos(be);
  var cy = L.c * (Math.cos(al) - Math.cos(be) * Math.cos(ga)) / Math.sin(ga);
  var cz2 = L.c * L.c - cx * cx - cy * cy;
  var cz = Math.sqrt(Math.max(cz2, 1e-9));
  var vc = new THREE.Vector3(cx, cy, cz);
  return [va, vb, vc];
}
function fracToCart(f, V) {
  return new THREE.Vector3()
    .addScaledVector(V[0], f[0]).addScaledVector(V[1], f[1]).addScaledVector(V[2], f[2]);
}

/* ---------- 展開原子(含邊界補齊 + 超晶胞)---------- */
function expandAtoms(motif, nx, ny, nz, fill) {
  var tol = 1e-4, out = [], m, i, j, k, fx, fy, fz;
  var upX = fill ? nx : nx - 1, upY = fill ? ny : ny - 1, upZ = fill ? nz : nz - 1;
  for (m = 0; m < motif.length; m++) {
    var el = motif[m][0], u = motif[m][1], v = motif[m][2], w = motif[m][3];
    for (i = 0; i <= upX; i++) for (j = 0; j <= upY; j++) for (k = 0; k <= upZ; k++) {
      fx = u + i; fy = v + j; fz = w + k;
      if (fx > nx + tol || fy > ny + tol || fz > nz + tol) continue;
      out.push({ el: el, f: [fx, fy, fz] });
    }
  }
  return out;
}

/* ================= Three.js 場景 ================= */
var canvas = document.getElementById("gl");
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
var root = new THREE.Group(); scene.add(root);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
var dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(5, 8, 6); scene.add(dl);
var dl2 = new THREE.DirectionalLight(0x88aaff, 0.35); dl2.position.set(-6, -3, -4); scene.add(dl2);

/* 自製 orbit:球座標繞 target */
var orbit = { theta: 0.9, phi: 1.1, radius: 20, target: new THREE.Vector3(0, 0, 0) };
function updateCamera() {
  var r = orbit.radius, p = orbit.phi, t = orbit.theta;
  camera.position.set(
    orbit.target.x + r * Math.sin(p) * Math.sin(t),
    orbit.target.y + r * Math.cos(p),
    orbit.target.z + r * Math.sin(p) * Math.cos(t)
  );
  camera.lookAt(orbit.target);
}
(function bindControls() {
  var dragging = 0, lx = 0, ly = 0;
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  canvas.addEventListener("pointerdown", function (e) { dragging = e.button === 2 ? 2 : 1; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", function (e) { dragging = 0; });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    if (dragging === 1) {
      orbit.theta -= dx * 0.01;
      orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi - dy * 0.01));
    } else {
      var k = orbit.radius * 0.0016;
      var right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(camera.position, orbit.target)).normalize();
      var up = new THREE.Vector3(0, 1, 0);
      orbit.target.addScaledVector(right, dx * k).addScaledVector(up, dy * k);
    }
  });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    orbit.radius = Math.max(1, Math.min(2000, orbit.radius * (1 + e.deltaY * 0.0012)));
  }, { passive: false });
})();

function resize() {
  var w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
function loop() { resize(); updateCamera(); renderer.render(scene, camera); requestAnimationFrame(loop); }

/* 幾何快取 */
var sphereGeo = new THREE.SphereGeometry(1, 28, 20);
var matCache = {};
function atomMat(color) { if (!matCache[color]) matCache[color] = new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.15 }); return matCache[color]; }
var bondMat = new THREE.MeshStandardMaterial({ color: 0xbfc6d0, roughness: 0.5, metalness: 0.1 });
var cellMat = new THREE.LineBasicMaterial({ color: 0x8fb7ff });

function clearRoot() { for (var i = root.children.length - 1; i >= 0; i--) { var o = root.children[i]; root.remove(o); if (o.geometry && o.geometry !== sphereGeo) o.geometry.dispose(); } }

function addBond(p1, p2) {
  var dir = new THREE.Vector3().subVectors(p2, p1), len = dir.length();
  var geo = new THREE.CylinderGeometry(0.09, 0.09, len, 8);
  var mesh = new THREE.Mesh(geo, bondMat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  root.add(mesh);
}

/* ================= 建構 ================= */
function buildStructure(opts, doFit) {
  clearRoot();
  var V = latticeVectors(opts.L);
  var atoms = expandAtoms(opts.motif, opts.nx, opts.ny, opts.nz, opts.fill);
  var carts = atoms.map(function (a) { return { el: a.el, pos: fracToCart(a.f, V) }; });

  // 原子球
  var counts = {};
  carts.forEach(function (a) {
    var E = elem(a.el);
    var m = new THREE.Mesh(sphereGeo, atomMat(E.color));
    var s = E.r * 0.5; m.scale.set(s, s, s); m.position.copy(a.pos); root.add(m);
    counts[a.el] = (counts[a.el] || 0) + 1;
  });

  // 鍵結
  if (opts.showBonds) {
    var cut = opts.bondCut, cut2 = cut * cut, i, j;
    for (i = 0; i < carts.length; i++) for (j = i + 1; j < carts.length; j++) {
      if (carts[i].pos.distanceToSquared(carts[j].pos) <= cut2) addBond(carts[i].pos, carts[j].pos);
    }
  }

  // 晶胞框(每個單位晶胞 12 邊)
  if (opts.showCell) {
    var pts = [], a, b, c;
    for (a = 0; a < opts.nx; a++) for (b = 0; b < opts.ny; b++) for (c = 0; c < opts.nz; c++) {
      var o = new THREE.Vector3().addScaledVector(V[0], a).addScaledVector(V[1], b).addScaledVector(V[2], c);
      var corner = function (di, dj, dk) { return new THREE.Vector3().copy(o).addScaledVector(V[0], di).addScaledVector(V[1], dj).addScaledVector(V[2], dk); };
      var C000 = corner(0, 0, 0), C100 = corner(1, 0, 0), C010 = corner(0, 1, 0), C001 = corner(0, 0, 1),
          C110 = corner(1, 1, 0), C101 = corner(1, 0, 1), C011 = corner(0, 1, 1), C111 = corner(1, 1, 1);
      var edges = [[C000, C100], [C000, C010], [C000, C001], [C100, C110], [C100, C101], [C010, C110], [C010, C011], [C001, C101], [C001, C011], [C110, C111], [C101, C111], [C011, C111]];
      edges.forEach(function (e) { pts.push(e[0].x, e[0].y, e[0].z, e[1].x, e[1].y, e[1].z); });
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.LineSegments(g, cellMat));
  }

  // a/b/c 軸
  if (opts.showAxes) {
    var cols = [0xff5555, 0x55ff77, 0x6699ff];
    for (var ax = 0; ax < 3; ax++) {
      var len = V[ax].length();
      root.add(new THREE.ArrowHelper(V[ax].clone().normalize(), new THREE.Vector3(0, 0, 0), len, cols[ax], len * 0.12, len * 0.07));
    }
  }

  // 置中
  var center = new THREE.Vector3().addScaledVector(V[0], opts.nx / 2).addScaledVector(V[1], opts.ny / 2).addScaledVector(V[2], opts.nz / 2);
  root.position.copy(center).multiplyScalar(-1);

  if (doFit) {
    var diag = new THREE.Vector3().addScaledVector(V[0], opts.nx).addScaledVector(V[1], opts.ny).addScaledVector(V[2], opts.nz).length();
    orbit.radius = diag * 1.6 + 3; orbit.target.set(0, 0, 0);
  }

  updateInfo(opts, counts);
  updateLegend(counts);
}

/* ================= UI ================= */
var $ = function (id) { return document.getElementById(id); };
var PARAM_IDS = ["a", "b", "c", "al", "be", "ga"];

function fillSystemSelect() {
  var sel = $("system"), html = "";
  for (var k in SYSTEMS) html += '<option value="' + k + '">' + SYSTEMS[k].label + "</option>";
  sel.innerHTML = html;
}
function applySystemConstraints() {
  var sys = SYSTEMS[$("system").value];
  PARAM_IDS.forEach(function (id) { $(id).disabled = sys.edit.indexOf(id) < 0; });
}
function readParams() {
  var sys = SYSTEMS[$("system").value];
  var p = {};
  PARAM_IDS.forEach(function (id) { p[id] = parseFloat($(id).value) || 0; });
  return sys.d(p); // 推導出完整 a,b,c,al,be,ga
}
function writeParams(L) { PARAM_IDS.forEach(function (id) { $(id).value = +(L[id].toFixed(4)); }); }

function motifRows() {
  var rows = $("motif").querySelector("tbody").querySelectorAll("tr"), out = [], i;
  for (i = 0; i < rows.length; i++) {
    var inp = rows[i].querySelectorAll("input");
    var el = rows[i].querySelector(".el").value.trim() || "C";
    out.push([el, parseFloat(inp[0].value) || 0, parseFloat(inp[1].value) || 0, parseFloat(inp[2].value) || 0]);
  }
  return out;
}
function addMotifRow(el, x, y, z) {
  var tb = $("motif").querySelector("tbody");
  var tr = document.createElement("tr");
  tr.innerHTML =
    '<td><input class="el" value="' + (el || "C") + '" maxlength="2"></td>' +
    '<td><input type="number" step="0.0001" value="' + (x || 0) + '"></td>' +
    '<td><input type="number" step="0.0001" value="' + (y || 0) + '"></td>' +
    '<td><input type="number" step="0.0001" value="' + (z || 0) + '"></td>' +
    '<td><button class="delrow">✕</button></td>';
  tr.querySelector(".delrow").addEventListener("click", function () { tr.remove(); });
  tb.appendChild(tr);
}
function setMotif(motif) {
  $("motif").querySelector("tbody").innerHTML = "";
  motif.forEach(function (m) { addMotifRow(m[0], +m[1].toFixed(4), +m[2].toFixed(4), +m[3].toFixed(4)); });
}

function currentOpts(doFit) {
  return {
    L: readParams(),
    motif: motifRows(),
    nx: Math.max(1, parseInt($("nx").value) || 1),
    ny: Math.max(1, parseInt($("ny").value) || 1),
    nz: Math.max(1, parseInt($("nz").value) || 1),
    fill: $("fill").checked, showCell: $("showCell").checked,
    showAxes: $("showAxes").checked, showBonds: $("showBonds").checked,
    bondCut: parseFloat($("bondCut").value) || 2.0
  };
}
function rebuild(doFit) { buildStructure(currentOpts(doFit), doFit); }

function updateInfo(opts, counts) {
  var L = opts.L, formula = "", total = 0, k;
  for (k in counts) { formula += k + (counts[k] > 1 ? counts[k] : "") + " "; total += counts[k]; }
  $("info").innerHTML =
    "<b>晶系</b> " + SYSTEMS[$("system").value].label + "<br>" +
    "<b>參數</b> a=" + L.a.toFixed(3) + " b=" + L.b.toFixed(3) + " c=" + L.c.toFixed(3) + " Å<br>" +
    "　　　 α=" + L.al.toFixed(1) + "° β=" + L.be.toFixed(1) + "° γ=" + L.ga.toFixed(1) + "°<br>" +
    "<b>基元數</b> " + opts.motif.length + " 個 / 單位晶胞　<b>顯示</b> " + total + " 原子<br>" +
    "<b>組成</b> " + (formula || "—");
}
function updateLegend(counts) {
  var html = '<div class="lt">元素 Legend</div>', k;
  for (k in counts) {
    var c = "#" + ("000000" + elem(k).color.toString(16)).slice(-6);
    html += '<div class="le"><span class="sw" style="background:' + c + '"></span>' + elem(k).name + " × " + counts[k] + "</div>";
  }
  $("legend").innerHTML = html;
}

function loadPreset(key) {
  if (!key) return;
  var P = PRESETS[key];
  $("system").value = P.system;
  applySystemConstraints();
  // 填入可編輯參數的預設,其餘由晶系補;先放進對應欄位再推導
  var sys = SYSTEMS[P.system];
  // 預設已給的 p 覆蓋;未給的給合理值
  var base = { a: P.p.a || 4, b: P.p.b || P.p.a || 4, c: P.p.c || P.p.a || 4, al: P.p.al || 90, be: P.p.be || 90, ga: P.p.ga || (P.system === "hexagonal" ? 120 : 90) };
  PARAM_IDS.forEach(function (id) { $(id).value = base[id]; });
  writeParams(sys.d(base));
  setMotif(P.motif);
  if ($("showBonds").checked || P.bond) $("bondCut").value = P.bond || 2.0;
  rebuild(true);
}

/* ---------- 綁定 ---------- */
fillSystemSelect();
$("system").addEventListener("change", function () { applySystemConstraints(); rebuild(false); });
$("preset").addEventListener("change", function () { loadPreset(this.value); });
$("addAtom").addEventListener("click", function () { addMotifRow("C", 0, 0, 0); });
$("rebuild").addEventListener("click", function () { rebuild(false); });
$("reset").addEventListener("click", function () { orbit.theta = 0.9; orbit.phi = 1.1; rebuild(true); });
["nx", "ny", "nz", "fill", "showCell", "showAxes", "showBonds", "bondCut"].forEach(function (id) {
  $(id).addEventListener("change", function () { rebuild(false); });
});
PARAM_IDS.forEach(function (id) { $(id).addEventListener("change", function () { rebuild(false); }); });

/* 初始:載入石墨 */
loop();
$("preset").value = "graphite";
loadPreset("graphite");
