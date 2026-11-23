/* Floodlight · the shared number words, so every page says a rank and a percentile the same way.
   flFmt.ord(83)        "83rd"   (1st 2nd 3rd 4th … 11th 12th 13th … 21st 22nd 23rd … 101st 111th)
   flFmt.pct(83)        { line: "83rd percentile · Top 17%", head: "83rd percentile", tail: "Top 17%" }
   flFmt.pct(43)        { line: "43rd percentile · Bottom 43%", … }
   flFmt.pct(87, { low: { good: 'ball security', noun: 'turnovers' } })
                        { line: "87th percentile for ball security", tail: "Fewer turnovers than 87% of qualified players" }
   A percentile is always "100 is best": for a stat where fewer is better the caller has already turned it round, so
   the words say which way round it is instead of printing "13th percentile" for a player who rarely turns it over. */
(() => {
  const ord = n => {
    n = Math.round(+n); if (!isFinite(n)) return '';
    const v = Math.abs(n) % 100, s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[v % 10] || 'th';
    return n + s;
  };
  function pct(pc, o = {}) {
    pc = Math.max(0, Math.min(100, Math.round(+pc))); if (!isFinite(pc)) return { line: '', head: '', tail: '' };
    const peers = o.peers || 'qualified players';
    if (o.low) {
      const head = `${ord(pc)} percentile for ${o.low.good || 'this stat'}`;
      const tail = o.low.noun ? `Fewer ${o.low.noun} than ${pc}% of ${peers}` : `Lower than ${pc}% of ${peers}`;
      return { line: head, head, tail, aria: `${head}. ${tail}` };
    }
    const head = `${ord(pc)} percentile`, tail = pc >= 50 ? `Top ${Math.max(1, 100 - pc)}%` : `Bottom ${Math.max(1, pc)}%`;
    return { line: `${head} · ${tail}`, head, tail, aria: `${head}, ${tail.toLowerCase()} of ${peers}` };
  }
  // "66th of 384 · 83rd percentile": the one line under a headline number
  const rankLine = (rank, n, pc) => [rank ? `${ord(rank)} of ${n}` : '', pc != null && isFinite(pc) ? `${ord(pc)} percentile` : ''].filter(Boolean).join(' · ');
  window.flFmt = { ord, pct, rankLine };
})();
