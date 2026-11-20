/* Floodlight · the heat reading, for pages outside the Lab.
   This is the Lab's own estimate (judge() in lab.html), copied line for line so Home and Predictions show the same
   number the Lab shows for the same player, stat and line. If the Lab's version changes, change this one with it.
   games: newest first, each { v, home, min, opp, oppAbbr }. opts: { line, side: 'over'|'under', yes (a yes/no stat), team (a team, not a
   player), stat, opp (the next opponent, as the posted line names it), nextHome }. */
(() => {
  const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + .3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x)) };
  const Phi = z => .5 * (1 + erf(z / Math.SQRT2));
  const poisCdf = (k, lam) => { if (k < 0) return 0; let s = 0, t = Math.exp(-lam); for (let i = 0; i <= k; i++) { s += t; t *= lam / (i + 1) } return Math.min(1, s) };
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const norm = s => String(s || '').normalize('NFKD').replace(/[^\w ]/g, '').toLowerCase().trim();
  const sameOpp = (g, key) => { const k = norm(key); if (!k) return false; const o = norm(g.opp), a = norm(g.oppAbbr); return o === k || a === k || (k.length > 3 && (o.includes(k) || k.includes(o))) };
  function judge(games, o = {}) {
    const line = o.line, over = (o.side || 'over') === 'over', use = games.filter(g => g.v != null).slice(0, 60), vs = use.map(g => g.v), n = vs.length; if (n < 3) return null;
    const w = vs.map((_, i) => Math.pow(.5, i / 10)), W = w.reduce((a, b) => a + b, 0), neff = W * W / w.reduce((a, b) => a + b * b, 0);
    const wm = (xs, ws) => { const t = ws.reduce((a, b) => a + b, 0); return t ? xs.reduce((a, v, i) => a + v * ws[i], 0) / t : null };
    let ho = 0, hd = 0; vs.forEach((v, i) => { if (v === line) return; hd += w[i]; if (v > line) ho += w[i] });
    const emp = (ho + 1.5) / (hd + 3);
    if (o.yes) { const p = over ? emp : 1 - emp; return { p, emp: p, model: p, mu: wm(vs, w), sd: 0, n, neff, conf: n >= 15 ? 'High' : n >= 8 ? 'Medium' : 'Low' } }
    const base = wm(vs, w); let mu = base;
    const nh = o.nextHome == null ? null : o.nextHome;
    if (nh != null) { const ix = use.map((g, i) => g.home === nh ? i : -1).filter(i => i >= 0); if (ix.length >= 5) { const m = wm(ix.map(i => vs[i]), ix.map(i => w[i])); mu += .35 * (m - base) } }
    // the next opponent, read the way the Lab reads it: matched against every game loaded, then against the 60 in use
    const opp = o.opp ? (games.find(g => sameOpp(g, o.opp))?.opp || o.opp) : '';
    if (opp) { const ix = use.map((g, i) => sameOpp(g, opp) ? i : -1).filter(i => i >= 0); if (ix.length >= 2) { const m = avg(ix.map(i => vs[i])); mu += Math.min(.3, ix.length * .08) * (m - base) } }
    const mins = use.map(g => g.min), haveMin = o.stat !== 'min' && !o.team && mins.filter(m => m != null).length >= 10;
    if (haveMin) { const m5 = avg(mins.slice(0, 5).filter(m => m != null)), mAll = wm(mins.map(m => m ?? 0), w.map((x, i) => mins[i] == null ? 0 : x)); if (m5 && mAll) { const d = .5 * (m5 / mAll - 1) * base; if (Math.abs(m5 / mAll - 1) >= .06) mu += d } }
    const varr = wm(vs.map(v => (v - base) ** 2), w) * (neff > 1.5 ? neff / (neff - 1) : 1), sd = Math.sqrt(varr * (1 + 1 / neff)) || .5;
    const ints = vs.every(Number.isInteger), lowCount = ints && Math.min(...vs) >= 0 && base < 6 && varr <= Math.max(base, .2) * 1.6;
    const model = lowCount ? 1 - poisCdf(Math.floor(line), Math.max(.05, mu)) : 1 - Phi((line - mu) / sd);
    const wE = n >= 20 ? .5 : n >= 10 ? .42 : .3, pOver = Math.max(.02, Math.min(.98, wE * emp + (1 - wE) * model));
    return { p: over ? pOver : 1 - pOver, emp: over ? emp : 1 - emp, model: over ? model : 1 - model, mu, base, sd, n, neff, conf: n >= 20 && neff >= 10 ? 'High' : n >= 10 ? 'Medium' : 'Low' };
  }
  window.flMeter = { judge, heat: (games, o) => { const j = judge(games, o); return j ? Math.round(j.p * 100) : null } };
})();
