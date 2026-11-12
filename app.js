/* app.js - plan B: no server. Polls encrypted JSON (state/chart/activity/agents/audit/account, coin/{mint}) and decrypts with WebCrypto.
   Every FOMO link in this app comes from the data files (made by links.py on the desk). Nothing is built here. */
(function () {
  "use strict";
  const CFG = window.DESK_CFG, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const AG = ["scanner", "auditor", "analyst", "executor", "risk", "watcher"], AGN = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", watcher: "Watcher", watch: "Watch" };
  const AGC = { scanner: "#64d2ff", auditor: "#fff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a", watcher: "#bf5af2" };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };

  /* ---------- fragment: #d=DATA_PATH.KEY [&b=localBase] [&r=/route] [&g=publicReadToken] ---------- */
  let PATH = null, KEY = null, BASE = null, GTOK = null, startRoute = null;
  (function parseHash() {
    const h = location.hash.replace(/^#/, "");
    if (h.indexOf("d=") >= 0) {
      const p = {}; h.split("&").forEach(x => { const i = x.indexOf("="); if (i > 0) p[x.slice(0, i)] = x.slice(i + 1); });
      if (p.d && p.d.indexOf(".") > 0) ls.set("desk_d", p.d);
      if (p.b) ls.set("desk_b", decodeURIComponent(p.b)); if (p.g) ls.set("desk_g", p.g); if (p.r) startRoute = decodeURIComponent(p.r);
      history.replaceState(null, "", location.pathname + location.search + (startRoute ? "#" + startRoute : ""));
    }
    const d = ls.get("desk_d"); if (d) { PATH = d.split(".")[0]; KEY = d.split(".")[1]; }
    BASE = ls.get("desk_b"); GTOK = ls.get("desk_g");
  })();
  const b64 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  let cryptoKey = null;
  async function decrypt(doc) {
    if (!cryptoKey) cryptoKey = await crypto.subtle.importKey("raw", b64(KEY), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(doc.iv) }, cryptoKey, b64(doc.ct)); return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ---------- data layer ---------- */
  const D = {}; let lastOk = 0, errMsg = null, nextTry = 0, sha = null, lastSha = null, lastPing = 0, apiBlockedUntil = 0, syncing = false, firstTry = false;
  const FILES = ["state", "chart", "activity", "agents", "audit", "account"];
  async function getSha() {
    if (BASE) return null;
    if (Date.now() < apiBlockedUntil) return sha;
    if (sha && Date.now() - lastPing < 65000) return sha;          // 60 unauthenticated API calls/hour: ping the branch ref about once a minute
    try {
      const h = {}; if (GTOK) h.Authorization = "Bearer " + GTOK;
      const r = await fetch("https://api.github.com/repos/" + CFG.repo + "/git/ref/heads/" + CFG.branch, { cache: "no-cache", headers: h });
      lastPing = Date.now();
      if (r.status === 403 || r.status === 429) { apiBlockedUntil = Date.now() + 5 * 60000; return sha; }
      if (!r.ok) return sha; sha = (await r.json()).object.sha;
    } catch (e) { lastPing = Date.now(); }
    return sha;
  }
  function url(name, s) {
    if (BASE) return BASE + "/" + name;
    return "https://raw.githubusercontent.com/" + CFG.repo + "/" + (s || CFG.branch) + "/d/" + PATH + "/" + name;
  }
  async function load(name, s) {
    const r = await fetch(url(name, s) + (BASE ? "?t=" + Date.now() : ""), { cache: "no-store" });
    if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
    return decrypt(await r.json());
  }
  async function sync(force) {
    if (syncing || !PATH) return; syncing = true;
    try {
      const s = await getSha(); const unchanged = s && s === lastSha && D.state && !force && !route.screen;
      if (!unchanged) {
        const names = FILES.map(f => f + ".json"); if (route.screen && route.mint) names.push("coin/" + route.mint + ".json");
        const res = await Promise.allSettled(names.map(n => load(n, s)));
        if (res[0].status === "rejected") throw res[0].reason;
        res.forEach((x, i) => { if (x.status === "fulfilled") { const k = names[i].replace(/\.json$/, ""); D[k] = x.value; } else if (names[i].startsWith("coin/")) D[names[i].replace(/\.json$/, "")] = null; });
        lastSha = s;
      }
      lastOk = Date.now(); errMsg = null;
    } catch (e) { errMsg = "offline"; }
    syncing = false; nextTry = Date.now() + 15000; firstTry = true; render();
  }
  const stale = () => D.state && D.state.t && Date.now() / 1000 - D.state.t > 660;

  /* ---------- formatting ---------- */
  const usd = (v, d) => v == null ? "n/a" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const money = v => (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = v => v == null ? "n/a" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);
  function price(p) { if (p == null) return "n/a"; if (p >= 1) return "$" + p.toFixed(p >= 100 ? 2 : 4); const z = Math.max(0, -Math.floor(Math.log10(p)) - 1); return "$" + p.toFixed(Math.min(12, z + 4)); }
  const hm = t => { const d = new Date(t * 1000); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); };
  const hms = t => new Date(t).toLocaleTimeString([], { hour12: false });
  const age = t => { if (!t) return "new"; const m = Math.max(0, (Date.now() / 1000 - t) / 60); return m < 60 ? Math.round(m) + "m old" : m < 1440 ? Math.floor(m / 60) + "h old" : Math.floor(m / 1440) + "d old"; };
  const left = s => { if (s <= 0) return "due"; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h + "h " + String(m).padStart(2, "0") + "m"; };
  const toast = t => { const e = document.createElement("div"); e.className = "toast"; e.textContent = t; document.body.appendChild(e); setTimeout(() => e.remove(), 1800); };
  const sk = (h, mt) => '<div class="sk" style="height:' + h + 'px;margin-top:' + (mt || 12) + 'px"></div>';
  const badge = () => D.state && D.state.mode === "PAPER" ? '<span class="badge">PAPER</span>' : "";

  /* ---------- odometer ---------- */
  function Odo(el) { this.el = el; this.s = ""; this.cols = []; }
  Odo.prototype.set = function (str) {
    const same = str.length === this.s.length && [...str].every((c, i) => (/\d/.test(c)) === (/\d/.test(this.s[i])));
    if (!same) {
      this.el.innerHTML = ""; this.cols = [];
      [...str].forEach(c => { if (/\d/.test(c)) { const d = document.createElement("span"); d.className = "d"; const st = document.createElement("span"); st.className = "strip";
          for (let i = 0; i < 10; i++) { const n = document.createElement("span"); n.textContent = i; st.appendChild(n); } d.appendChild(st); this.el.appendChild(d); this.cols.push(st); st.style.transition = "none"; st.style.transform = "translateY(" + (-70 * c) + "px)"; }
        else { const s = document.createElement("span"); s.className = "s"; s.textContent = c; this.el.appendChild(s); this.cols.push(null); } });
      void this.el.offsetWidth; this.cols.forEach(c => { if (c) c.style.transition = ""; });
    } else {
      const n = str.length;
      [...str].forEach((c, i) => { if (c !== this.s[i] && this.cols[i]) { const st = this.cols[i];
          st.style.transition = reduce() ? "none" : "transform 600ms cubic-bezier(.2,.7,.2,1) " + ((n - 1 - i) * 30) + "ms"; st.style.transform = "translateY(" + (-70 * c) + "px)"; } });
    }
    this.s = str;
  };

  /* ---------- router ---------- */
  const route = { tab: "home", screen: null, mint: null };
  function parseRoute() {
    const h = location.hash.replace(/^#/, ""); const m = h.match(/^\/(coin|audit)\/(.+)$/);
    if (m) { route.screen = m[1]; route.mint = m[2]; } else { route.screen = null; route.mint = null; const t = h.replace(/^\//, ""); if (["home", "agents", "activity", "account"].includes(t)) route.tab = t; }
  }
  function go(h) { if (location.hash !== "#" + h) history.pushState(null, "", "#" + h); parseRoute(); mountAll(); sync(true); }
  window.addEventListener("popstate", () => { parseRoute(); mountAll(); });

  /* ---------- views ---------- */
  const app = $("#app"), tabs = $("#tabs"); let odo = null, homeBuilt = false, rangeSel = "1D", seenFill = ls.get("desk_fill") || "", lastCardsJson = {};
  function mountAll() {
    $$(".screen,.search").forEach(e => e.remove());
    tabs.hidden = !PATH; $$(".tab", tabs).forEach(t => t.classList.toggle("on", t.dataset.tab === route.tab));
    if (!PATH) { app.innerHTML = '<div class="setup"><div class="h1">Grok Bot desk</div><p class="mut">Open the link from your desk once. It keeps this phone signed in.</p></div>'; return; }
    homeBuilt = false; app.innerHTML = ""; lastCardsJson = {}; render(true);
  }
  tabs.addEventListener("click", e => { const b = e.target.closest(".tab"); if (!b) return; route.tab = b.dataset.tab; go("/" + b.dataset.tab); window.scrollTo(0, 0); });

  function render(force) {
    if (!PATH) return;
    // banner
    const b = $("#banner"); const bad = errMsg || stale();
    if (bad) { const n = Math.max(0, Math.ceil((nextTry - Date.now()) / 1000)); b.hidden = false; b.textContent = "Desk offline · retrying in " + n + "s · last update " + (lastOk ? hms(lastOk) : (D.state ? hms(D.state.t * 1000) : "never")); } else b.hidden = true;
    if (route.screen === "coin") return renderCoin(); if (route.screen === "audit") return renderAudit();
    ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount }[route.tab])(force);
  }
  setInterval(() => { if (!PATH) return; if (Date.now() >= nextTry && !syncing) sync(); else { const b = $("#banner"); if (!b.hidden) render(); } }, 1000);

  /* ----- HOME ----- */
  function navbar(initial) {
    const dot = D.activity && D.activity.lastId > Number(ls.get("desk_seen") || 0) ? '<i class="dot"></i>' : "";
    return '<div class="nav"><button class="ib" id="avatar" aria-label="Account"><span class="avatar">' + esc(initial || "G") + '</span></button><div class="title">Grok Bot <span class="mut">›</span></div>' +
      '<button class="ib" id="srch" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>' +
      '<button class="ib" id="bell" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/></svg>' + dot + '</button></div>';
  }
  function bindNav() {
    const a = $("#avatar"), s = $("#srch"), bl = $("#bell"); if (a) a.onclick = () => { route.tab = "account"; go("/account"); };
    if (s) s.onclick = openSearch; if (bl) bl.onclick = () => { if (D.activity) ls.set("desk_seen", D.activity.lastId); route.tab = "activity"; go("/activity"); };
  }
  function renderHome(force) {
    const st = D.state;
    if (!homeBuilt) {
      app.innerHTML = navbar(D.account && D.account.fomo_handle ? D.account.fomo_handle[0].toUpperCase() : "G") + '<div class="view"><div class="balrow"><div class="odo" id="odo"></div><span id="pbadge"></span></div>' +
        '<div class="sub"><span id="pct" class="mut">–</span><span id="mult" class="pill g" style="display:none"></span></div>' +
        '<div class="chartwrap"><canvas id="hc"></canvas><div class="chartempty" id="hce" style="display:none">Waiting for the first trade</div></div>' +
        '<div class="ranges">' + ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => '<button data-r="' + r + '" class="' + (r === rangeSel ? "on" : "") + '">' + r + '</button>').join("") + '</div>' +
        '<div class="sec"><h2 id="agh">Agents</h2></div><div class="carousel" id="car"></div>' +
        '<div class="sec"><h2>Activity</h2><button class="more" id="seeall">See all</button></div><div id="hact"></div></div>';
      odo = new Odo($("#odo")); homeBuilt = true; bindNav();
      $(".ranges").onclick = e => { const r = e.target.closest("button"); if (!r) return; rangeSel = r.dataset.r; $$(".ranges button").forEach(x => x.classList.toggle("on", x === r)); drawHome(); };
      $("#seeall").onclick = () => { route.tab = "activity"; go("/activity"); };
      $("#car").innerHTML = AG.map(a => '<div class="acard" data-a="' + a + '"><div class="sk" style="position:absolute;inset:0;border-radius:inherit"></div></div>').join("");
      $("#hact").innerHTML = sk(56) + sk(56, 8) + sk(56, 8);
    }
    if (!st) return;
    $("#pbadge").innerHTML = badge(); odo.set(usd(st.balance));
    const p = $("#pct"); p.textContent = (st.todayPct >= 0 ? "+" : "") + st.todayPct.toFixed(2) + "%"; p.className = st.todayPct >= 0 ? "up" : "dn";
    const m = $("#mult"); m.style.display = ""; m.textContent = st.multiplier.toFixed(2) + "×"; m.className = "pill " + (st.multiplier >= 1 ? "g" : "r");
    $("#agh").textContent = "Agents · " + (5 - (st.paused || []).filter(x => AG.includes(x)).length) + " running";
    drawHome(); renderCards(); $("#hact").innerHTML = actRows((D.activity ? D.activity.rows : []).slice(0, 5), true);
    bindActRows($("#hact")); const nb = $(".nav"); if (nb && D.activity) { const d = nb.querySelector(".dot"); const unread = D.activity.lastId > Number(ls.get("desk_seen") || 0); if (unread && !d) $("#bell").insertAdjacentHTML("beforeend", '<i class="dot"></i>'); if (!unread && d) d.remove(); }
  }
  function drawHome() {
    const cv = $("#hc"); if (!cv || !D.chart) return; const c = D.chart, now = c.points.length ? c.points[c.points.length - 1][0] : Date.now() / 1000;
    const span = { LIVE: 900, "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800, ALL: 1e12 }[rangeSel], from = now - span;
    let pts = c.points.filter(p => p[0] >= from); if (pts.length > 400) { const k = Math.ceil(pts.length / 400); pts = pts.filter((_, i) => i % k === 0 || i === pts.length - 1); }
    const empty = !(c.marks || []).some(m => m.kind === "bought") && pts.length < 2;
    $("#hce").style.display = empty ? "" : "none";
    DeskChart.line(cv, { points: empty ? [] : pts, start: c.start, marks: empty ? [] : c.marks, range: rangeSel });
  }
  function cardHTML(a) {
    const st = D.state, cd = st.agents[a], aud = D.audit || { live: [], recent: [] }; const dis = (st.paused || []).includes(a);
    const head = '<div class="h"><span class="sdot ' + (dis ? "off" : "") + '"></span><span style="color:' + AGC[a] + '">' + AGN[a] + '</span></div>';
    if (a === "scanner") { const feed = (D.agents ? D.agents.scannerFeed : []);
      return head + '<div class="big" style="color:#64d2ff">' + esc(cd.label) + '</div>' + (feed.length ? '<div class="feed">' + feed.slice(0, 5).map(f => f.verdict === "pass" ? '<div class="r"><span class="n">' + esc(f.name) + ' · liq ' + compact(f.liq) + '</span><span class="up">→ auditor</span></div>' : '<div class="r k"><span class="n">' + esc(f.name) + '</span><span class="dn">' + esc(f.reason) + '</span></div>').join("") + '</div>' : '<div class="cap">Listening for graduations</div>'); }
    if (a === "auditor") { const cur = aud.live && aud.live.length ? aud.live[aud.live.length - 1] : null; const last = cur || (aud.recent[0] ? { layers: aud.recent[0].layers, running: false, result: aud.recent[0] } : null);
      const strips = [0, 1, 2, 3, 4, 5, 6, 7].map(i => { const l = last && last.layers && last.layers[i]; const cl = !l ? "" : l.pass === true ? "ok" : l.pass === false ? "bad" : (last.running && i === last.layers.length ? "run" : ""); return '<div class="strip8 ' + cl + '">' + (i + 1) + '</div>'; }).join("");
      let msg = "No coin taken apart yet"; if (last) { if (last.running) msg = "taking apart..."; else { const r = last.result || last; msg = r.passed ? "8/8 → Executor" : r.reason; } }
      return head + '<div class="big">' + esc(cd.label) + '</div><div class="strips">' + strips + '</div><div class="cap" style="margin-top:10px;color:' + (last && !last.running && (last.result || last).passed ? "var(--green)" : "var(--t2)") + '">' + esc(msg) + '</div><div class="cap">' + cd.rejected + ' rejected</div>'; }
    if (a === "analyst") return head + '<div class="big" style="color:#ffd60a">' + esc(cd.label) + '</div><div class="ringwrap"><canvas data-ring="' + (cd.last ? cd.last.score : "") + '"></canvas></div><div class="cap" style="text-align:center">' + (cd.mode === "rules" ? "rules mode" : "Jev") + '</div>';
    if (a === "executor") { const l = cd.last; const bought = l && l.status === "bought";
      return head + '<div class="big" style="color:#00d35a">' + esc(cd.label) + '</div>' + (l && l.sizeUsd ? '<div class="cap">' + usd(l.sizeUsd) + ' · ' + l.stackPct + '% of stack</div><div class="bar"><i></i></div><div class="cap" id="exlab" style="margin-top:8px">' + (bought ? "✓ Filled" : esc(l.status)) + '</div>' : '<div class="cap">' + (l ? esc(l.reason || l.status) : "Waiting for a coin") + '</div>'); }
    if (a === "risk") { const lab = cd.label; return head + '<div class="big" style="color:#ff6b9a">' + esc(lab) + '</div><div class="cap">' + (cd.open ? cd.open + " open" : "nothing open") + '</div><div class="pills"><span class="pill r">stop -' + st.stopPct + '%</span><span class="pill g">trail ' + st.trailPct + '%</span></div>'; }
    if (a === "watcher") { return head + '<div class="big" style="color:#bf5af2">' + esc(cd && cd.label || "0 watching") + '</div><div class="cap">' + (cd && cd.last ? "last ping · " + esc((cd.last.label || "") + " " + (cd.last.mint || "").slice(0, 4)) : "picks from wallets you add in Telegram") + '</div>'; }
  }
  function renderCards() {
    AG.forEach(a => { const el = $('.acard[data-a="' + a + '"]'); if (!el) return; const h = cardHTML(a); if (lastCardsJson[a] === h) return; lastCardsJson[a] = h; el.innerHTML = h;
      const cv = $("canvas[data-ring]", el); if (cv) { const v = cv.dataset.ring; DeskChart.ring(cv, v === "" ? null : Number(v)); }
      if (a === "executor") execAnim(el); });
  }
  function execAnim(el) {
    const l = D.state.agents.executor.last, i = $(".bar i", el); if (!l || !i || l.status !== "bought") return; const key = l.mint + ":" + l.signalPrice;
    if (key === seenFill) { i.style.transition = "none"; i.style.width = "100%"; return; }
    seenFill = key; ls.set("desk_fill", key); const lab = $("#exlab", el);
    if (reduce()) { i.style.width = "100%"; lab.textContent = "✓ Filled"; return; }
    const t0 = performance.now(); i.style.transition = "none"; i.style.width = "0"; void i.offsetWidth; i.style.transition = "width 1.2s linear"; i.style.width = "100%";
    (function f(n) { const p = Math.min(100, Math.round((n - t0) / 12)); lab.textContent = p < 100 ? "Executing... " + p + "%" : "✓ Filled"; if (p < 100) requestAnimationFrame(f); })(t0);
  }

  /* ----- ACTIVITY ----- */
  function actRows(rows, home) {
    if (!D.activity) return sk(56) + sk(56, 8);
    if (!rows.length) return '<div class="list"><div class="empty">Nothing yet tonight</div></div>';
    return '<div class="list">' + rows.map(r => { const col = /^\+/.test(r.amount) ? "up" : /^-/.test(r.amount) ? "dn" : (r.amount === "Skipped" ? "mut" : "");
      return '<button class="row" data-k="' + r.kind + '" data-m="' + esc(r.mint) + '"><div class="l"><div class="t">' + esc(r.title) + '</div><div class="s">' + esc(r.sub) + '</div></div><div class="v ' + col + '">' + esc(r.amount) + '</div></button>'; }).join("") + '</div>';
  }
  function bindActRows(root) { $$(".row", root).forEach(r => r.onclick = () => go("/" + (r.dataset.k === "rejected" ? "audit" : "coin") + "/" + r.dataset.m)); }
  let actPage = 1;
  function renderActivity(force) {
    const rows = D.activity ? D.activity.rows : []; if (D.activity) ls.set("desk_seen", D.activity.lastId);
    const sc = window.scrollY; app.innerHTML = navbar() + '<div class="view"><div class="h1" style="margin:6px 0 12px">Activity</div>' + actRows(rows.slice(0, 30 * actPage)) + (rows.length > 30 * actPage ? '<button class="btn sec2" id="more">Load more</button>' : "") + '</div>';
    bindNav(); bindActRows(app); const m = $("#more"); if (m) m.onclick = () => { actPage++; renderActivity(); }; window.scrollTo(0, sc);
  }

  /* ----- AGENTS TAB ----- */
  function renderAgents() {
    const st = D.state; if (!st) { app.innerHTML = navbar() + '<div class="view">' + sk(260) + sk(260) + '</div>'; bindNav(); return; }
    const sc = window.scrollY, dec = D.agents ? D.agents.decisions : {}, cnt = D.agents ? D.agents.counts : {};
    app.innerHTML = navbar() + '<div class="view"><div class="h1" style="margin:6px 0 4px">Agents</div>' + AG.map(a => { const paused = (st.paused || []).includes(a), locked = a === "risk" && st.open.length > 0;
      const rows = (dec[a] || []).map(d => '<div class="row" style="min-height:44px"><div class="l"><div class="t" style="font-weight:500">' + (d.link ? '<a href="' + esc(d.link) + '" target="_blank" rel="noopener">' + esc(d.name) + '</a>' : esc(d.name)) + '</div><div class="s">' + hm(d.t) + ' · ' + esc(d.verdict) + '</div></div><div class="v mut" style="font-weight:500;max-width:48%;white-space:normal;font-size:13px">' + esc(d.reason) + '</div></div>').join("");
      return '<div class="card" id="ag-' + a + '"><div style="display:flex;align-items:center;gap:10px"><span class="sdot ' + (paused ? "off" : "") + '"></span><div style="flex:1"><div style="font-weight:700;font-size:20px;color:' + AGC[a] + '">' + AGN[a] + '</div><div class="mut" style="font-size:13px">' + (cnt[a] || 0) + ' today · ' + (paused ? "paused" : "running") + '</div></div>' +
        '<div class="sw ' + (paused ? "" : "on") + '" title="Change from Telegram"><i></i></div></div>' +
        '<div class="note">' + (locked ? "Locked while a position is open. " : "") + 'Pause or resume from Telegram: ' + (paused ? "resume " : "pause ") + AGN[a] + '</div>' +
        '<div class="list" style="background:#000;margin-top:4px">' + (rows || '<div class="empty">No decisions yet</div>') + '</div><button class="btn sec2" data-set="' + a + '" style="min-height:44px">Settings</button></div>'; }).join("") + '</div>';
    bindNav(); $$("[data-set]").forEach(b => b.onclick = () => { route.tab = "account"; go("/account"); setTimeout(() => { const e = $("#set-" + b.dataset.set); if (e) e.scrollIntoView(); }, 300); }); window.scrollTo(0, sc);
  }

  /* ----- ACCOUNT ----- */
  function renderAccount() {
    const ac = D.account; if (!ac) { app.innerHTML = navbar() + '<div class="view">' + sk(80) + sk(200) + '</div>'; bindNav(); return; }
    const sc = window.scrollY, R = ac.ranges || {};
    const grp = Object.keys(ac.settings).map(a => '<div class="sec" style="margin:16px 0 8px" id="set-' + a + '"><h2 style="font-size:17px">' + (AGN[a] || "Desk") + '</h2></div><div class="list">' + Object.keys(ac.settings[a]).map(k => { const v = ac.settings[a][k], rg = R[a + "." + k];
      const num = typeof v === "number" && Array.isArray(rg) && rg.length === 2 && typeof rg[0] === "number";
      return '<div class="set"><div class="top"><span class="nm">' + esc(k) + '</span><input type="text" readonly value="' + esc(v) + '" aria-label="' + esc(k) + '"></div>' + (num ? '<input type="range" disabled min="' + rg[0] + '" max="' + rg[1] + '" step="any" value="' + v + '">' : "") + '</div>'; }).join("") + '</div>').join("");
    app.innerHTML = navbar() + '<div class="view"><div class="h1" style="margin:6px 0 12px">Account</div>' +
      '<div class="list"><div class="row"><div class="l"><div class="t">Mode</div><div class="s">Switch from Telegram: paper | live</div></div><div class="v">' + esc(ac.mode) + '</div></div>' +
      '<div class="row"><div class="l"><div class="t">Stack</div><div class="s">' + (ac.mode === "PAPER" ? "Simulated balance" : "LIVE stack you set") + '</div></div><div class="v">' + usd(ac.stack) + '</div></div></div>' +
      '<div class="list" style="margin-top:14px"><a class="row" href="' + esc(ac.profile_url) + '" target="_blank" rel="noopener"><div class="l"><div class="t">Your FOMO profile</div><div class="s">@' + esc(ac.fomo_handle) + '</div></div><span class="mut">›</span></a>' +
      '<button class="row" id="invite"><div class="l"><div class="t">Invite a friend</div><div class="s">Share your signup link</div></div><span class="mut">›</span></button></div>' +
      '<div class="list" style="margin-top:14px"><div class="row"><div class="l"><div class="t">Telegram</div><div class="s">' + (ac.telegram ? "Connected" : "Not connected") + '</div></div><span class="sdot ' + (ac.telegram ? "" : "off") + '"></span></div>' +
      '<div class="row"><div class="l"><div class="t">Send test push</div><div class="s">Send "status" to your bot instead (no server behind this page)</div></div></div>' +
      '<div class="row"><div class="l"><div class="t">Enable notifications</div><div class="s">' + esc(ac.web_push) + '</div></div></div>' +
      '<div class="row"><div class="l"><div class="t">Analyst</div><div class="s">' + esc(ac.analyst_mode) + ' mode</div></div></div></div>' +
      '<div class="note">Settings are read-only here. Change them from Telegram, for example: set stop to -8%</div>' + grp +
      '<button class="btn sec2" id="forget">Forget this phone</button></div>';
    bindNav(); $("#invite").onclick = async () => { try { if (navigator.share) await navigator.share({ title: "FOMO", text: "Join me on FOMO", url: ac.signup_url }); else throw 0; } catch (e) { try { await navigator.clipboard.writeText(ac.signup_url); toast("Link copied"); } catch (e2) { toast("Link copied"); } } };
    $("#forget").onclick = () => { ["desk_d", "desk_b", "desk_g", "desk_seen", "desk_fill"].forEach(ls.del); location.hash = ""; location.reload(); }; window.scrollTo(0, sc);
  }

  /* ----- COIN SCREEN ----- */
  function screenShell(inner) { let s = $(".screen"); if (!s) { s = document.createElement("div"); s.className = "screen"; document.body.appendChild(s); } const sc = s.scrollTop; s.innerHTML = inner; s.scrollTop = sc; $(".back", s).onclick = () => history.length > 1 ? history.back() : go("/home"); return s; }
  function renderCoin() {
    const c = D["coin/" + route.mint], aud = c && c.audit, nm = c && c.name || "";
    if (c === undefined) { screenShell('<button class="back">‹ Back</button><div class="view">' + sk(36) + sk(60) + sk(240) + sk(100) + '</div>'); return; }
    if (c === null || c === undefined) { screenShell('<button class="back">‹ Back</button><div class="view"><div class="empty" style="margin-top:80px">No data on this coin yet</div></div>'); return; }
    const pos = c.position, pr = c.prices || [], last = pr.length ? pr[pr.length - 1][1] : (c.stats && c.stats.price), first = pr.length ? pr[0][1] : last;
    const ref = pos ? pos.entry : first, chg = last && ref ? (last / ref - 1) * 100 : null, shield = aud ? aud.layers.filter(l => l.pass).length : null;
    const live = pos && (pos.status === "open" || pos.status === "exiting");
    const st = c.stats || {};
    const html = '<button class="back">‹ Back</button><div class="view"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div class="h1">' + esc(nm) + '</div>' + badge() + '</div>' +
      '<div class="mut" style="margin-top:2px;display:flex;gap:8px;align-items:center">' + esc(c.symbol || "") + ' · Solana · ' + age(c.bornAt) + (shield != null ? ' <span class="chip ' + (shield === 8 ? "" : "bad") + '">' + shield + '/8</span>' : "") + '</div>' +
      '<div class="price">' + price(last) + '</div><div class="' + (chg != null && chg >= 0 ? "up" : "dn") + '">' + (chg == null ? "" : (chg >= 0 ? "▲ " : "▼ ") + Math.abs(chg).toFixed(2) + "% " + (pos ? "since entry" : "since first seen")) + '</div>' +
      '<div class="chartwrap" style="height:260px;margin-top:10px"><canvas id="cc"></canvas>' + (pr.length < 2 ? '<div class="chartempty">Collecting the first candles</div>' : "") + '</div>' +
      '<div class="stats"><div class="stat"><div class="k">Market cap</div><div class="v">' + compact(st.marketCap) + '</div></div><div class="stat"><div class="k">Liquidity</div><div class="v">' + compact(st.liquidity) + '</div></div>' +
      '<div class="stat"><div class="k">24h volume</div><div class="v">' + compact(st.volume24h) + '</div></div><div class="stat"><div class="k">Holders</div><div class="v">' + (st.holders != null ? Number(st.holders).toLocaleString("en-US") : "n/a") + '</div></div></div>' +
      (pos ? '<div class="card"><h3>Your position</h3><div class="kv"><span class="mut">In</span><span>' + usd(pos.size) + ' · Executor</span></div><div class="kv"><span class="mut">Entry</span><span>' + price(pos.entry) + '</span></div>' +
        (live ? '<div class="kv"><span class="mut">Stop line</span><span class="dn">' + price(pos.stopLine) + ' (-' + pos.stopPct + '%)</span></div><div class="kv"><span class="mut">Trail line</span><span class="up">' + (pos.trailLine ? price(pos.trailLine) + ' (' + pos.trailPct + '%)' : 'starts at +20%') + '</span></div><div class="kv"><span class="mut">Time left to timeout</span><span>' + left(pos.timeoutAt - Date.now() / 1000) + '</span></div>'
          : '<div class="kv"><span class="mut">Closed</span><span class="' + (pos.exit && pos.exit.pnlUsd >= 0 ? "up" : "dn") + '">' + (pos.exit ? money(pos.exit.pnlUsd) + " · " + esc(pos.exit.reason) : "") + '</span></div>') + '</div>' : "") +
      '<a class="btn ' + (live ? "r" : "g") + '" href="' + esc(c.link) + '" target="_blank" rel="noopener">' + (live ? "Sell on FOMO" : "Buy on FOMO") + '</a>' +
      (aud ? '<button class="btn sec2" id="toaud">Take apart report</button>' : "") + '</div>';
    screenShell(html); const cv = $("#cc"); if (cv && pr.length >= 2) DeskChart.candles(cv, { candles: DeskChart.candlesFrom(pr).slice(-90), line: live ? pos.exitLine : null, fmt: price });
    const t = $("#toaud"); if (t) t.onclick = () => go("/audit/" + route.mint);
  }

  /* ----- AUDITOR SCREEN: discs + cyan beam, 350ms per layer then 150ms to green/red; waits on a layer the server hasn't sent ----- */
  let beamRun = 0;
  function layersFor(mint) {
    const lv = D.audit && D.audit.live.find(x => x.mint === mint); if (lv) return { layers: lv.layers, running: lv.running, result: lv.result };
    const c = D["coin/" + mint]; if (c && c.audit) return { layers: c.audit.layers, running: false, result: c.audit };
    const r = D.audit && D.audit.recent.find(x => x.mint === mint); return r ? { layers: r.layers, running: false, result: r } : null;
  }
  function renderAudit() {
    const mint = route.mint, c = D["coin/" + mint]; const info = layersFor(mint); const nm = (c && c.name) || ((D.agents && D.agents.coins.find(x => x.mint === mint)) || {}).name || mint.slice(0, 6);
    if (!info) { screenShell('<button class="back">‹ Back</button><div class="view"><div class="h1">' + esc(nm) + '</div><div class="empty" style="margin-top:80px">No coin taken apart yet</div></div>'); beamRun++; return; }
    if ($(".discs")) return;                                  // sequence already running on this screen
    const run = ++beamRun, L = info.layers, names = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundled wallets", "Delegations"];
    const link = (c && c.link) || "";
    screenShell('<button class="back">‹ Back</button><div class="view"><div class="h1">' + esc(nm) + '</div><div class="mut" id="astatus" style="margin-top:2px">taking apart...</div>' +
      '<div class="discs">' + names.map((n, i) => '<div class="disc" id="dc' + i + '" style="top:' + (i * 36) + 'px">' + (i + 1) + ' · ' + n + '</div>').join("") + '<div class="beam" id="beam"></div></div>' +
      '<div class="list" id="arows"></div><div id="averdict"></div>' +
      '<div class="card" style="display:flex;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:600">Take apart before buying</div><div class="mut" style="font-size:13px">Change it from Telegram: set auditor enabled to false</div></div><div class="sw ' + (D.audit.enabled ? "on" : "") + '"><i></i></div></div>' +
      (link ? '<a class="btn" href="' + esc(link) + '" target="_blank" rel="noopener">Open on FOMO</a>' : "") + '</div>');
    (async function seq() {
      const beam = $("#beam"); const wait = ms => new Promise(r => setTimeout(r, reduce() ? 0 : ms));
      for (let i = 0; i < 8; i++) {
        if (run !== beamRun) return; let cur = layersFor(mint);
        beam.style.opacity = 1; beam.style.top = (i * 36 + 14) + "px"; await wait(350); if (run !== beamRun) return;
        while (!(cur = layersFor(mint)) || !cur.layers[i]) { if (run !== beamRun) return; await new Promise(r => setTimeout(r, 400)); }   // beam waits on that layer
        const l = cur.layers[i]; await wait(150); if (run !== beamRun) return;
        const d = $("#dc" + i); if (!d) return; d.classList.add(l.pass === true ? "ok" : l.pass === false ? "bad" : ""); if (l.pass != null) d.textContent = (i + 1) + " · " + names[i] + (l.pass ? " ✓" : " ✕");
        $("#arows").insertAdjacentHTML("beforeend", '<div class="row" style="min-height:48px"><div class="l"><div class="t" style="font-weight:500">' + names[i] + '</div></div><div class="v ' + (l.pass === true ? "" : l.pass === false ? "dn" : "ter") + '">' + esc(l.value) + '</div></div>');
      }
      beam.style.opacity = 0; const cur = layersFor(mint), r = cur.result;
      if (cur.running || !r) { $("#astatus").textContent = "taking apart..."; return; }
      const ex = D.audit.executor && D.audit.executor[mint], anaRej = c && c.status === "rejected" && c.reason && /^Analyst/.test(c.reason);
      $("#astatus").innerHTML = r.passed ? '<span class="up">Cleared · 8/8 parts</span>' : '<span class="dn">Rejected · ' + esc(r.reason) + '</span>';
      $("#averdict").innerHTML = r.passed ? '<div class="card"><div style="font-weight:600">' + (ex && ex.size ? "Sent to Executor · " + usd(ex.size) : "Sent to Executor") + '</div>' + (anaRej ? '<div class="mut" style="margin-top:4px">' + esc(c.reason) + '</div>' : "") + '</div>' : '<div class="card"><div style="font-weight:600">Grok Bot won\'t buy ' + esc(nm) + '</div></div>';
    })();
  }

  /* ----- SEARCH ----- */
  function openSearch() {
    const s = document.createElement("div"); s.className = "search"; s.innerHTML = '<div style="display:flex;gap:10px;align-items:center"><input id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off"><button class="ib" id="qx" style="width:auto;padding:0 6px;color:var(--blue)">Cancel</button></div><div id="qr" style="margin-top:12px"></div>';
    document.body.appendChild(s); const q = $("#q", s), out = $("#qr", s); q.focus(); $("#qx", s).onclick = () => s.remove();
    q.oninput = () => { const v = q.value.trim().toLowerCase(); if (!v) { out.innerHTML = ""; return; } const hits = ((D.agents && D.agents.coins) || []).filter(c => (c.name || "").toLowerCase().includes(v) || (c.symbol || "").toLowerCase().includes(v) || c.mint.toLowerCase().startsWith(v)).slice(-12).reverse();
      out.innerHTML = hits.length ? '<div class="list">' + hits.map(h => '<button class="row" data-m="' + esc(h.mint) + '"><div class="l"><div class="t">' + esc(h.name) + '</div><div class="s">' + esc(h.symbol) + ' · ' + esc(h.status) + '</div></div></button>').join("") + '</div>' : '<div class="empty">No match. Paste a full mint to open it.</div>';
      $$(".row", out).forEach(r => r.onclick = () => { s.remove(); go("/coin/" + r.dataset.m); }); };
    q.onkeydown = e => { if (e.key === "Enter" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.value.trim())) { s.remove(); go("/coin/" + q.value.trim()); } };
  }

  /* ---------- boot ---------- */
  parseRoute(); if (startRoute) { history.replaceState(null, "", "#" + startRoute); parseRoute(); }
  mountAll(); if (PATH) sync(true);
  window.__desk = { D, sync, go };
})();
