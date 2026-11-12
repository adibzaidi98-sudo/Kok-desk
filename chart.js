/* chart.js - hand drawn canvas charts. No library. devicePixelRatio aware. */
(function () {
  const G = "#00d35a", R = "#ff453a", B = "#0a84ff", O = "#ff9f0a", T2 = "rgba(235,235,245,0.6)", SEP = "rgba(84,84,88,0.55)";
  const reduce = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return { c, w, h };
  }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  const state = new WeakMap();

  /* Home line: points [[t,v]...], start value (dashed), marks [{t,kind,text}] above the line, later mark moves up a row */
  function line(cv, o) {
    const { c, w, h } = setup(cv); const pts = o.points || [], padT = 62, padB = 22, padX = 16;
    const prev = state.get(cv) || { n: 0, key: "" }; const key = o.range + "|" + (pts[0] ? pts[0][0] : 0);
    const grew = prev.key === key && pts.length > prev.n && prev.n > 0;
    state.set(cv, { n: pts.length, key });
    const marksKey = (o.marks || []).length; const newMarks = marksKey > (prev.m || 0) && prev.key === key; state.get(cv).m = marksKey;
    const run = (p, mp) => draw(p, mp);
    function draw(slide, markA) {
      c.clearRect(0, 0, w, h);
      const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1, span = Math.max(1, t1 - t0);
      let vs = pts.map(p => p[1]).concat([o.start]); const lo0 = Math.min(...vs), hi = Math.max(...vs), rng = Math.max(hi - lo0, Math.abs(o.start) * 0.002, 0.01), lo = lo0 - (rng - (hi - lo0)) / 2;
      const X = t => padX + (t - t0) / span * (w - 2 * padX), Y = v => padT + (1 - (v - lo) / rng) * (h - padT - padB);
      c.strokeStyle = SEP; c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(0, Y(o.start)); c.lineTo(w, Y(o.start)); c.stroke(); c.setLineDash([]);
      if (pts.length < 2) return;
      let xy = pts.map(p => [X(p[0]), Y(p[1])]);
      if (slide < 1 && xy.length > 2) { const a = xy[xy.length - 2], b = xy[xy.length - 1]; xy[xy.length - 1] = [a[0] + (b[0] - a[0]) * slide, a[1] + (b[1] - a[1]) * slide]; }
      const g = c.createLinearGradient(0, padT, 0, h); g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
      c.beginPath(); xy.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.lineTo(xy[xy.length - 1][0], h - padB + 6); c.lineTo(xy[0][0], h - padB + 6); c.closePath(); c.fillStyle = g; c.fill();
      c.beginPath(); xy.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.strokeStyle = G; c.lineWidth = 2.2; c.lineJoin = "round"; c.stroke();
      // marks: never overlap; a later mark moves up a row
      c.font = "600 11px -apple-system, system-ui, sans-serif"; const placed = [];
      (o.marks || []).forEach((m, idx) => {
        if (m.t < t0 || m.t > t1) return;
        const txt = m.text, tw = c.measureText(txt).width + 12, x = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, X(m.t)));
        let row = 0; for (;;) { const hit = placed.some(p => p.row === row && Math.abs(p.x - x) < (p.w + tw) / 2 + 3); if (!hit) break; row++; if (row > 3) break; }
        placed.push({ x, w: tw, row });
        const col = m.kind === "bought" ? B : (m.kind === "stopped" || /^-/.test(txt) ? R : G), y = 8 + row * 20, a = (idx === (o.marks.length - 1) && markA < 1) ? markA : 1;
        c.globalAlpha = a; c.fillStyle = col; const rx = x - tw / 2; c.beginPath(); c.roundRect ? c.roundRect(rx, y, tw, 17, 8.5) : c.rect(rx, y, tw, 17); c.fill();
        c.fillStyle = m.kind === "sold" ? "#000" : "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, x, y + 9); c.globalAlpha = 1;
        c.strokeStyle = col; c.globalAlpha = a * .5; c.lineWidth = 1; c.beginPath(); c.moveTo(X(m.t), y + 17); c.lineTo(X(m.t), Y(interp(m.t))); c.stroke(); c.globalAlpha = 1;
      });
      function interp(t) { for (let i = 1; i < pts.length; i++) if (pts[i][0] >= t) return pts[i][1]; return pts[pts.length - 1][1]; }
    }
    if (reduce() || (!grew && !newMarks)) { draw(1, 1); return; }
    const s = performance.now(); (function f(now) { const t = Math.min(1, (now - s) / 250), u = Math.min(1, (now - s) / 200); draw(grew ? ease(t) : 1, newMarks ? u : 1); if (t < 1 || u < 1) requestAnimationFrame(f); })(s);
  }

  /* Coin candles: 1-minute OHLC from [[t,price,vol_m5]...]; volume = change of volume.m5; orange dashed exit line */
  function candlesFrom(prices) {
    const by = new Map(); let lastVol = null;
    prices.forEach(p => { const m = Math.floor(p[0] / 60) * 60; let b = by.get(m);
      const dv = (lastVol != null && p[2] != null) ? Math.max(0, p[2] - lastVol) : 0; lastVol = p[2];
      if (!b) by.set(m, { t: m, o: p[1], h: p[1], l: p[1], c: p[1], v: dv }); else { b.h = Math.max(b.h, p[1]); b.l = Math.min(b.l, p[1]); b.c = p[1]; b.v += dv; } });
    return [...by.values()].sort((a, b) => a.t - b.t);
  }
  function candles(cv, o) {
    const { c, w, h } = setup(cv); const cs = o.candles || [], padL = 8, padR = 52, vh = 44, top = 10, bot = h - vh - 12;
    if (!cs.length) return;
    let lo = Math.min(...cs.map(x => x.l)), hi = Math.max(...cs.map(x => x.h)); if (o.line) { lo = Math.min(lo, o.line); hi = Math.max(hi, o.line); }
    if (hi === lo) { hi *= 1.01; lo *= 0.99; } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const n = Math.max(cs.length, 30), cw = (w - padL - padR) / n, Y = v => top + (1 - (v - lo) / (hi - lo)) * (bot - top), vm = Math.max(1e-9, ...cs.map(x => x.v));
    c.strokeStyle = SEP; c.lineWidth = 1; for (let i = 0; i < 4; i++) { const y = top + i * (bot - top) / 3; c.globalAlpha = .4; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.globalAlpha = 1; }
    cs.forEach((k, i) => { const x = padL + (i + (n - cs.length)) * cw + cw / 2, up = k.c >= k.o, col = up ? G : R;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(k.h)); c.lineTo(x, Y(k.l)); c.stroke();
      const y1 = Y(k.o), y2 = Y(k.c); c.fillRect(x - cw * .32, Math.min(y1, y2), cw * .64, Math.max(1, Math.abs(y2 - y1)));
      const vhh = k.v / vm * (vh - 4); c.globalAlpha = .45; c.fillRect(x - cw * .32, h - 6 - vhh, cw * .64, vhh); c.globalAlpha = 1; });
    if (o.line) { const y = Y(o.line); c.strokeStyle = O; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]);
      c.font = "600 11px -apple-system, system-ui, sans-serif"; c.fillStyle = O; c.textAlign = "left"; c.fillText("Risk trailing stop", 10, y - 5); }
    c.fillStyle = T2; c.font = "11px ui-monospace, Menlo, monospace"; c.textAlign = "right"; c.fillText(o.fmt(hi), w - 4, top + 8); c.fillText(o.fmt(lo), w - 4, bot - 2);
  }

  /* Analyst score ring 0-100, green from 70 */
  function ring(cv, score, thr) {
    const { c, w, h } = setup(cv), r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2; thr = thr || 70;
    c.lineWidth = 9; c.lineCap = "round"; c.strokeStyle = "#2c2c2e"; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
    if (score != null) { c.strokeStyle = score >= thr ? G : "#ffd60a"; c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); c.stroke(); }
    c.fillStyle = "#fff"; c.font = "600 30px -apple-system, system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(score == null ? "–" : String(score), cx, cy + 1);
  }
  window.DeskChart = { line, candles, candlesFrom, ring };
})();
