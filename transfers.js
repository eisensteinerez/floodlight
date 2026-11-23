/* Floodlight · Transfer window: every league's moves on one page.
   What each league's source really offers decides what its tab shows:
   - NBA and NFL: ESPN's transaction list, a team and a sentence per move ("Signed G … to a two-year contract").
     The type, the player and the other team are read out of that sentence; nothing is added to it.
   - MLB: the league's own stats API, which names the player, both teams and the kind of move.
   - Soccer: the Transfermarkt feed the site already had (the full market, with records and filters, is one tap away).
   - College basketball and football: no public list of the transfer portal exists in the sources Floodlight reads,
     so those tabs say so and show the key dates only.
   Key dates (trade deadline, free agency, portal and transfer windows) are never guessed: an admin enters them, and
   the banner works out open or closed from those. There is no rumour source, so there is no rumour card. */
(() => {
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, s) => window.flShell?.ic?.(n, s) || '';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} } };
  const get = url => fetch(url, { credentials: 'same-origin' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || String(r.status)); e.status = r.status; throw e } return d });
  const post = (url, body) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'That did not save.'); return d });
  const initials = n => esc(String(n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
  const norm = s => String(s || '').normalize('NFKD').replace(/[^\w ]/g, '').toLowerCase().trim();

  /* each league in its own words */
  const LEAGUES = [
    { k: 'nba', name: 'NBA', chip: 'basketball', status: 'NBA trade window', words: ['Trade window', 'Trade deadline', 'Free agency'], src: 'ESPN' },
    { k: 'nfl', name: 'NFL', chip: 'football', status: 'NFL trade window', words: ['Trade window', 'Trade deadline', 'Free agency'], src: 'ESPN' },
    { k: 'mlb', name: 'MLB', chip: 'baseball', status: 'MLB trade window', words: ['Trade window', 'Trade deadline', 'Free agency'], src: 'MLB' },
    { k: 'cbb', name: 'College basketball', chip: 'cbb', college: true, status: 'Transfer portal window', words: ['Transfer portal window'], src: '' },
    { k: 'cfb', name: 'College football', chip: 'cfb', college: true, status: 'Transfer portal window', words: ['Transfer portal window'], src: '' },
    { k: 'soccer', name: 'Soccer', chip: 'soccer', status: 'Transfer window', words: ['Transfer window'], src: 'Transfermarkt' }];
  const LG = Object.fromEntries(LEAGUES.map(l => [l.k, l]));
  const TYPES = { trade: 'Trades', sign: 'Signings', ext: 'Extensions', waiver: 'Waivers and releases', ir: 'Injury list', ps: 'Practice squad', other: 'Roster moves', transfer: 'Transfers', loan: 'Loans', free: 'Free transfers', left: 'Released and retired' };
  const T = { lg: LG[store.get('fl.tw.league', 'nba')] ? store.get('fl.tw.league', 'nba') : 'nba', type: 'all', team: null, data: {}, dates: null, open: new Set(), src: new Set(), reported: new Set(store.get('fl.tw.reported', [])), show: 30, msg: '', dateMsg: '',
    follows: store.get('fl.follows', []) };

  /* ---------- reading a move ---------- */
  const NAME = "[A-Z][A-Za-z.'’-]+(?:\\s+(?:[A-Z][A-Za-z.'’-]+|II|III|IV|Jr\\.|Sr\\.)){1,3}";
  const POSN = '[A-Z0-9]{1,3}(?:[/-][A-Z0-9]{1,3})?';
  const LEAD = new RegExp(`^(?:[A-Za-z-]+(?:\\s+to\\s+terms\\s+with)?)\\s+(?:free[- ]agent\\s+)?(?:(${POSN})\\s+)?(${NAME})`);
  const EVERY = new RegExp(`\\b(${POSN})\\s+(${NAME})`, 'g');
  const tidy = n => /(?:Jr|Sr|\b[A-Z])\.$/.test(n) ? n : n.replace(/[.'’-]+$/, '');   // the sentence's full stop is not part of the name
  const playersIn = text => { const out = []; for (const m of String(text).matchAll(EVERY)) if (!/^(NBA|NFL|MLB|IL|IR|A|I)$/.test(m[1]) && !/^(League|Conference|Division|Draft|Round|Team)\b/.test(m[2])) out.push({ pos: m[1], name: tidy(m[2]) }); return out };
  const kindOf = s => /\btraded?\b|\bacquired\b/i.test(s) ? 'trade' : /extension/i.test(s) ? 'ext' : /\bwaive|\breleased\b|\bclaimed\b/i.test(s) ? 'waiver' : /\b(re-)?signed\b|agreed to terms/i.test(s) ? 'sign' : 'other';
  const labelOf = (kind, s) => kind === 'trade' ? 'Trade' : kind === 'ext' ? 'Extension' : kind === 'waiver' ? (/claimed/i.test(s) ? 'Waiver claim' : /released/i.test(s) ? 'Release' : 'Waiver') : kind === 'sign' ? (/free[- ]agent/i.test(s) ? 'Free agent' : 'Signing') : 'Roster move';
  const dayOf = d => { const x = new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}` };
  const whenOf = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(s + 'T12:00:00') : new Date(s);

  // ESPN: a team and a sentence. Both sides of a trade post their own sentence, so the sentences of one trade are joined.
  function fromEspn(lg, rows) {
    const teams = new Map(); for (const r of rows) if (r.team?.id) teams.set(r.team.id, r.team);
    const names = [...teams.values()].flatMap(t => [[norm(t.name), t], [norm(t.short), t]]).filter(x => x[0].length > 3).sort((a, b) => b[0].length - a[0].length);
    const others = (r) => { const k = ' ' + norm(r.text) + ' ', seen = new Map(); for (const [n, t] of names) if (t.id !== r.team?.id && k.includes(' ' + n + ' ')) seen.set(t.id, t); return [...seen.values()] };
    const list = rows.map(r => { const kind = kindOf(r.text), m = r.text.match(LEAD), f = m ? null : playersIn(r.text)[0]; return { r, kind, when: whenOf(r.date), day: dayOf(r.date), team: r.team || {}, others: kind === 'trade' ? others(r) : [], pos: m?.[1] || f?.pos || '', name: m ? tidy(m[2]) : f?.name || '' } }).filter(x => !isNaN(x.when));
    const out = [], used = new Set();
    for (const x of list) {
      if (used.has(x)) continue;
      if (x.kind !== 'trade') { used.add(x);
        const claimed = /\bclaimed\b/i.test(x.r.text), gone = x.kind === 'waiver' && !claimed, stays = x.kind === 'ext';
        out.push({ id: `${lg}:${x.r.id}`, lg, type: x.kind, label: labelOf(x.kind, x.r.text), when: x.when, player: x.name ? { name: x.name, pos: x.pos } : null, lead: x.team,
          from: gone || stays ? x.team : null, to: gone ? null : x.team, details: x.r.text, ins: x.kind === 'sign' || claimed ? [[x.team, 1]] : [], outs: gone ? [[x.team, 1]] : [] });
        continue }
      // gather every sentence of this trade: same day, and the teams name each other
      const group = [x], ids = new Set([x.team.id, ...x.others.map(t => t.id)]); used.add(x);
      for (let grew = true; grew;) { grew = false; for (const y of list) { if (used.has(y) || y.kind !== 'trade' || y.day !== x.day) continue;
        if (ids.has(y.team.id) && (y.others.some(t => ids.has(t.id)) || x.others.some(t => t.id === y.team.id))) { group.push(y); used.add(y); ids.add(y.team.id); y.others.forEach(t => ids.add(t.id)); grew = true } } }
      const gained = group.filter(y => /\bacquired\b/i.test(y.r.text)), sent = group.filter(y => !/\bacquired\b/i.test(y.r.text));
      // what each side received; a "traded" sentence is kept only when no "acquired" sentence already covers its players
      let parts = [...gained];
      for (const y of sent) { const ps = playersIn(y.r.text), k = norm(parts.map(p => p.r.text).join(' ')), mineK = norm(y.r.text);
        if (ps.length ? ps.every(p => k.includes(norm(p.name))) : parts.length > 0) continue;   // nothing new in it
        parts = parts.filter(p => { const q = playersIn(p.r.text); return !q.length || !q.every(z => mineK.includes(norm(z.name))) });   // this sentence says all of that one, and more
        parts.push(y) }
      const lead = gained[0] || group[0], got = /\bacquired\b/i.test(lead.r.text), other = lead.others[0] || null, tms = [...new Map(group.flatMap(y => [y.team, ...y.others]).map(t => [t.id, t])).values()];
      const seenP = new Set(), people = parts.flatMap(p => playersIn(p.r.text)).filter(p => !seenP.has(norm(p.name)) && seenP.add(norm(p.name)));
      out.push({ id: `${lg}:trade:${x.day}:${[...ids].sort().join('-')}`, lg, type: 'trade', label: 'Trade', when: lead.when, player: lead.name ? { name: lead.name, pos: lead.pos } : null, lead: lead.team,
        from: got ? other : lead.team, to: got ? lead.team : other, details: tms.length > 2 ? `${tms.length}-team trade` : people.length > 1 ? `${people.length} players involved` : lead.r.text,
        parts: parts.map(p => ({ team: p.team, text: p.r.text })), people: people.length,
        ins: gained.map(y => [y.team, Math.max(1, playersIn(y.r.text).length)]), outs: sent.map(y => [y.team, Math.max(1, playersIn(y.r.text).length)]) });
    }
    return out;
  }
  // ESPN, read on the server (moves_parse.py): one event per player per sentence, the sentence kept as written.
  // A move between teams has a from and a to; a roster move inside one team (injured reserve, practice squad,
  // extension, conversion) has neither, so a team never shows as both ends of its own move.
  const MOVES = { sign: 1, two_way: 1, claim: 1, ps_sign: 1, waive: -1, release: -1, ps_release: -1 };
  const SAYS = { promote: 'Practice squad to the active roster', elevate: 'Practice squad, up for the next game', ir: 'Placed on injured reserve', ps_ir: 'Practice squad injured list',
    return_ir: 'Designated to return from injured reserve', activate: 'Back on the active roster', suspend: 'Placed on the suspended list', pup: 'Physically unable to perform list',
    ps_sign: 'Signed to the practice squad', ps_release: 'Released from the practice squad', waive: 'Waived. Other teams can put in a claim', release: 'Released, now a free agent' };
  const listOf = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  function fromEvents(lg, evs, meta) {
    const tm = t => t && (t.id || t.name) ? { id: String(t.id || ''), name: t.name || '', short: t.short || t.name || '', abbr: t.abbr || '', logo: t.logo || '', color: t.color || '' } : null;
    const src = e => ({ text: e.text, sentence: e.sentence, also: e.also || [], notes: e.notes || [], status: meta.status || 'Official', name: meta.source || 'ESPN', link: meta.link || '' });
    return (evs || []).map(e => {
      const when = whenOf(e.date); if (isNaN(when)) return null;
      const team = tm(e.team), other = tm(e.other), base = { id: e.id, lg, type: e.group || 'other', kind: e.kind, label: e.label, when, lead: team, source: src(e), conf: e.conf || 'high', checks: e.checks || [], terms: e.terms || null };
      if (e.kind === 'trade') {
        const pin = e.players_in || [], pout = e.players_out || [], ain = e.assets_in || [], aout = e.assets_out || [], side = e.side, others = (e.others || []).map(tm).filter(Boolean);
        const got = [...pin.map(p => p.name), ...ain], gave = [...pout.map(p => p.name), ...aout];
        const details = others.length > 1 ? `${others.length + 1}-team trade. ${team.short} get ${listOf(got) || 'nothing listed'}.`
          : [got.length ? `${team.short} get ${listOf(got)}` : '', gave.length ? `${got.length ? 'and send' : `${team.short} send`} ${listOf(gave)}` : ''].filter(Boolean).join(' ') + '.';
        const mover = pin[0] || pout[0] || null, incoming = !!pin.length;
        const parts = [{ team, text: e.sentence }, ...(side ? [{ team: tm(side.team), text: side.sentence }] : []), ...(e.notes || []).map(n => ({ team: null, text: n }))];
        return { ...base, player: mover, from: incoming ? other : team, to: incoming ? team : other, details, parts, people: pin.length + pout.length,
          ins: [[team, pin.length], ...(other ? [[other, pout.length]] : [])].filter(x => x[1] > 0), outs: [[team, pout.length], ...(other ? [[other, pin.length]] : [])].filter(x => x[1] > 0) };
      }
      const dir = MOVES[e.kind] || 0, internal = !dir;
      const where = e.kind === 'claim' ? (other ? `Off waivers from ${other.short}` : 'Off waivers') : e.kind === 'sign' && other ? `From the ${other.short}${/s$/.test(other.short) ? "'" : "'s"} practice squad` : '';
      return { ...base, player: e.player || null, internal, from: dir > 0 ? other : dir < 0 ? team : null, to: dir > 0 ? team : null,
        // the contract or the route in, else a plain reading of the move, else the sentence itself
        details: [where, e.contract && e.contract.toLowerCase() !== String(e.label).toLowerCase() ? e.contract : ''].filter(Boolean).join('. ') || SAYS[e.kind] || e.sentence,
        ins: dir > 0 ? [[team, 1]] : [], outs: dir < 0 ? [[team, 1]] : [] };
    }).filter(Boolean);
  }
  // MLB: the league names the player, both clubs and the kind of move. One trade is several rows, one per player.
  const MLB_KIND = { TR: 'trade', SFA: 'sign', SGN: 'sign', REL: 'waiver', CLW: 'waiver', DES: 'waiver', WA: 'waiver', OUT: 'waiver' };
  const MLB_LABEL = { TR: 'Trade', SFA: 'Free agent', SGN: 'Signing', REL: 'Release', CLW: 'Waiver claim', DES: 'Designated for assignment', WA: 'Waiver', OUT: 'Outrighted' };
  function fromMlb(rows, meta = {}) {
    const src = text => ({ text, sentence: text, status: 'Official', name: 'MLB', link: meta.link || '' });
    const logo = id => typeof bsLogo === 'function' && id ? bsLogo(id) : '', shot = id => typeof bsShot === 'function' && id ? bsShot(id) : '';
    const tm = t => t ? { id: t.id, name: t.name, short: t.name, logo: logo(t.id) } : null;
    const posOf = (text, name) => { const m = name && String(text).match(new RegExp(`\\b(${POSN})\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); return m ? m[1] : '' };
    const out = [], trades = new Map();
    for (const r of rows) { const when = whenOf(r.date); if (isNaN(when)) continue;
      const kind = MLB_KIND[r.code] || (/extension/i.test(r.text) ? 'ext' : 'other'), from = tm(r.from), to = tm(r.to), p = r.player ? { id: r.player.id, name: r.player.name, pos: posOf(r.text, r.player.name), photo: shot(r.player.id) } : null;
      if (kind === 'trade') { const k = dayOf(when) + '|' + norm(r.text); let g = trades.get(k);
        if (!g) { g = { id: `mlb:trade:${r.id}`, lg: 'mlb', type: 'trade', code: 'TR', label: 'Trade', when, player: p, lead: to || from, from, to, details: r.text, source: src(r.text), parts: [], seen: new Set(), ins: [], outs: [] }; trades.set(k, g); out.push(g) }
        if (p && !g.seen.has(p.id)) { g.seen.add(p.id); g.parts.push({ player: p, from, to }); if (to) g.ins.push([to, 1]); if (from) g.outs.push([from, 1]) }
        continue }
      const gone = kind === 'waiver' && r.code !== 'CLW';
      out.push({ id: 'mlb:' + r.id, lg: 'mlb', type: kind, code: r.code || '', terms: r.terms || null, label: MLB_LABEL[r.code] || (kind === 'ext' ? 'Extension' : r.kind || 'Roster move'), when, player: p, lead: to || from, from: gone ? (from || to) : from, to: gone ? null : to, details: r.text, source: src(r.text),
        ins: kind === 'sign' || r.code === 'CLW' ? (to ? [[to, 1]] : []) : [], outs: gone && (from || to) ? [[from || to, 1]] : [] }) }
    for (const g of out) if (g.parts) { g.people = g.parts.length; delete g.seen; const tms = new Set(g.parts.flatMap(x => [x.from?.id, x.to?.id]).filter(Boolean)); g.teams = tms.size; if (tms.size > 2) g.details = `${tms.size}-team trade` }
    return out;
  }
  const crest = id => id ? `https://img.a.transfermarkt.technology/wappen/head/${id}.png` : '';
  const NOCLUB = /^(without club|retired|career break|unknown|ban)$/i;
  // Transfermarkt writes "Without Club", "Retired", "Career break", "Unknown" or "Ban" where a club would go. Those are
  // not clubs: the move keeps only the real club, and `noclub` says what the other side was, so it can be said plainly.
  function fromSoccer(rows) {
    const club = c => c && c.name && !NOCLUB.test(c.name.trim()) ? { id: c.id, name: c.name, short: c.name, logo: c.crest || crest(c.id), soccer: true } : null;
    const none = c => c && c.name && NOCLUB.test(c.name.trim()) ? c.name.trim().toLowerCase() : '';
    return rows.map(t => { const from = club(t.from), to = club(t.to), gone = none(t.to), back = none(t.from), fee = String(t.fee || '').trim(), ret = /end of loan/i.test(fee);
      const kind = gone ? 'left' : /loan/i.test(fee) ? 'loan' : back || /free/i.test(fee) ? 'free' : 'transfer';
      const label = gone ? ({ 'without club': 'Released', retired: 'Retired', 'career break': 'Career break', ban: 'Ban' }[gone] || 'Left the club')
        : back === 'without club' ? 'Free agent signing' : ret ? 'Loan return' : kind === 'loan' ? 'Loan' : kind === 'free' ? 'Free transfer' : 'Transfer';
      return { id: 'soccer:' + t.id, lg: 'soccer', type: kind, label, when: whenOf(t.date), player: { name: t.name, pos: t.position, age: t.age, photo: t.photo, soccer: true }, lead: to || from, from, to,
        noclub: gone ? { side: 'to', what: gone, name: t.to.name.trim() } : back ? { side: 'from', what: back, name: t.from.name.trim() } : null, fee: /^[-?]?$/.test(fee) ? '' : fee,
        // Transfermarkt gives fields, not a sentence: the source is those fields as listed
        source: { status: 'Reported', name: 'Transfermarkt', fields: [['Player', t.name], ['From', t.from?.name], ['To', t.to?.name], ['Fee', t.fee], ['Market value', t.marketValue], ['Date', t.date]].filter(x => x[1]) },
        details: kind === 'transfer' && fee && !/^[-?]$/.test(fee) ? `Fee ${fee}` : t.marketValue && !/^[-?]$/.test(t.marketValue) ? `Market value ${t.marketValue}` : kind === 'transfer' ? 'Fee not given' : '', ins: to ? [[to, 1]] : [], outs: from ? [[from, 1]] : [] } }).filter(x => !isNaN(x.when));
  }

  /* ---------- saying a move in plain words ----------
     One line for what happened ("Released by Arsenal") and, when it adds something, a second ("Now a free agent").
     The table row, the player's timeline, the drawer, the report and Home's wire all use these words. */
  const theTeam = (t, lg) => !t ? '' : lg === 'soccer' ? (t.name || t.short) : `the ${t.name || t.short}`;
  const SAY = {   // ESPN kinds, said about the team that made the move
    sign: t => `Signed by ${t}`, re_sign: t => `Re-signed by ${t}`, two_way: t => `Signed to a two-way contract by ${t}`, extension: t => `Contract extended by ${t}`,
    ps_sign: t => `Signed to the practice squad by ${t}`, promote: t => `Promoted to the active roster by ${t}`, elevate: t => `Elevated from the practice squad by ${t}`,
    ps_release: t => [`Released from the practice squad by ${t}`, 'Now a free agent'], waive: t => [`Waived by ${t}`, 'Other teams can put in a claim'],
    release: t => [`Released by ${t}`, 'Now a free agent'], ir: t => `Placed on injured reserve by ${t}`,
    ps_ir: t => `Placed on the practice squad injured list by ${t}`, return_ir: t => `Designated to return from injured reserve by ${t}`, activate: t => `Activated by ${t}`,
    suspend: t => `Placed on the suspended list by ${t}`, pup: t => `Placed on the physically unable to perform list by ${t}`, convert: t => `Contract converted by ${t}`,
    guarantee: t => `Contract guaranteed by ${t}`, exemption: t => `Given a practice exemption by ${t}` };
  const MLB_SAY = { REL: t => [`Released by ${t}`, 'Now a free agent'], WA: t => [`Waived by ${t}`, 'Other teams can put in a claim'], DES: t => `Designated for assignment by ${t}`,
    OUT: t => `Outrighted off the 40-man roster by ${t}`, SFA: t => `Signed as a free agent by ${t}`, SGN: t => `Signed by ${t}` };
  const GONE = { 'without club': f => [`Released by ${f}`, 'Now a free agent'], retired: f => `Retired, last at ${f}`, 'career break': f => `Taking a career break, last at ${f}`,
    ban: f => `Serving a ban, last at ${f}`, unknown: f => [`Left ${f}`, 'Next club not known'] };
  const BACK = { 'without club': t => `Signed as a free agent by ${t}`, retired: t => `Back from retirement with ${t}`, 'career break': t => `Back from a career break with ${t}`,
    ban: t => `Back from a ban with ${t}`, unknown: t => [`Joined ${t}`, 'Previous club not known'] };
  const QUIET = new Set(Object.values(SAYS));   // the old one-line readings, now said by the line itself
  function says(it) {
    const lg = it.lg, from = theTeam(it.from, lg), to = theTeam(it.to, lg), team = theTeam(it.lead, lg), pair = x => Array.isArray(x) ? { line: x[0], sub: x[1] || '' } : { line: x, sub: '' };
    let out;
    if (it.noclub) { const n = it.noclub; out = n.side === 'to' && from ? pair((GONE[n.what] || GONE.unknown)(from)) : n.side === 'from' && to ? pair((BACK[n.what] || BACK.unknown)(to)) : pair(it.label) }
    else if (it.type === 'trade') out = pair(from && to ? `Traded from ${from} to ${to}` : to ? `Traded to ${to}` : from ? `Traded by ${from}` : 'Trade');
    else if (lg === 'soccer') out = pair(it.label === 'Loan return' && to ? `Back at ${to} after a loan${from ? ` at ${from}` : ''}` : it.type === 'loan' && to ? `On loan at ${to}${from ? ` from ${from}` : ''}` : to ? `Joined ${to}${from ? ` from ${from}` : ''}` : from ? `Left ${from}` : it.label);
    else if (lg === 'mlb') { const f = MLB_SAY[it.code], t2 = to || from; out = it.code === 'CLW' && to ? pair(`Claimed off waivers by ${to}${from ? ` from ${from}` : ''}`) : f && t2 ? pair(f(t2)) : pair(it.details || it.label) }
    else if (it.kind === 'option') out = pair(`${/^declined/i.test(it.source?.sentence || '') ? 'Option declined' : 'Option exercised'} by ${team}`);
    else if (it.kind === 'claim') out = pair(`Claimed off waivers by ${team}${it.from ? ` from ${from}` : ''}`);
    else if (SAY[it.kind] && team) out = pair(SAY[it.kind](team));
    else if (it.type === 'waiver' && from && !it.to) out = pair(/claim/i.test(it.label) ? `Claimed off waivers by ${from}` : /waiver/i.test(it.label) ? [`Waived by ${from}`, 'Other teams can put in a claim'] : [`Released by ${from}`, 'Now a free agent']);
    else out = pair(to && from ? `From ${from} to ${to}` : to ? `Joined ${to}` : from ? `Left ${from}` : it.label + (team ? ` by ${team}` : ''));
    // the second line adds what the details say beyond the line: a contract, a route in, a fee
    const det = it.details && !QUIET.has(it.details) && it.details !== out.line && it.details !== it.source?.sentence && it.details !== it.source?.text && !/^Off waivers/.test(it.details) ? it.details : '';
    const deal = it.terms?.summary && !det.toLowerCase().includes(it.terms.summary.toLowerCase()) ? it.terms.summary : '';
    return { line: out.line.charAt(0).toUpperCase() + out.line.slice(1), sub: [out.sub, deal, det].filter(Boolean).join('. ') };
  }
  const plain = it => says(it).line;

  /* ---------- loading ---------- */
  const TTL = 5 * 60000;
  function load(lg, force) {
    const cur = T.data[lg];
    if (cur && !force && (cur.promise || Date.now() - cur.at < TTL)) return cur.promise || Promise.resolve(cur);
    const req = lg === 'soccer' ? get('/api/tm/transfers/feed?kind=latest&page=1').then(d => ({ items: fromSoccer(d.transfers || []), source: 'Transfermarkt' }))
      : get('/api/transfers/moves?league=' + lg).then(d => ({ items: !d.source ? [] : lg === 'mlb' ? fromMlb(d.moves || [], d) : d.events ? fromEvents(lg, d.events, d) : fromEspn(lg, d.moves || []), source: d.source || '', link: d.link || '', status: d.status || '', note: d.error || '' }));
    const promise = req.catch(e => ({ items: cur?.items || [], source: LG[lg].src, error: e.status === 401 || e.status === 403 ? 'denied' : (e.message || 'It did not load.') }))
      .then(r => { r.items.sort((a, b) => b.when - a.when); r.at = Date.now(); T.data[lg] = r; return r });
    T.data[lg] = { ...(cur || {}), at: cur?.at || 0, promise };
    return promise;
  }
  const loadDates = force => (T.dates && !force ? Promise.resolve(T.dates) : get('/api/transfers/dates').then(d => (T.dates = d.dates || [])).catch(() => (T.dates = T.dates || [])));

  /* ---------- key dates ---------- */
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  const dDate = s => new Date(s + 'T12:00:00');
  const longDay = s => dDate(s).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  const daysTo = s => Math.round((dDate(s) - dDate(today())) / 864e5);
  const count = n => n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  function status(lg) {
    const ds = (T.dates || []).filter(d => d.league === lg), now = today(), wins = ds.filter(d => d.end), open = wins.filter(d => d.start <= now && now <= d.end).sort((a, b) => a.end.localeCompare(b.end))[0] || null;
    const ahead = [...ds.filter(d => !d.end && d.start >= now).map(d => ({ label: d.label, day: d.start })), ...wins.filter(d => d.start > now).map(d => ({ label: `${d.label} opens`, day: d.start, opens: true })),
      ...wins.filter(d => d.start <= now && d.end >= now).map(d => ({ label: `${d.label} closes`, day: d.end }))].sort((a, b) => a.day.localeCompare(b.day));
    return { set: ds.length > 0, hasWindow: wins.length > 0, open, next: ahead[0] || null, reopens: open ? null : ahead.find(x => x.opens) || null, list: ds.sort((a, b) => a.start.localeCompare(b.start)) };
  }

  /* ---------- follows: stored now, delivered when the site has a way to send alerts ---------- */
  const followKey = f => `${f.k}:${f.lg}:${f.id || ''}`;
  const follows = f => T.follows.some(x => followKey(x) === followKey(f));
  function toggleFollow(f) {
    if (window.flAccess && !window.flAccess.has('alerts')) { T.msg = 'Alerts are switched off for your account. Ask your admin for access.'; return }
    T.follows = follows(f) ? T.follows.filter(x => followKey(x) !== followKey(f)) : [...T.follows, f].slice(-200);
    store.set('fl.follows', T.follows);
    try { if (window.S?.me && typeof api === 'function') api('/api/me/prefs', { follows: T.follows }).then(d => { if (d.user) S.me = d.user }).catch(() => {}) } catch (e) {}
    T.msg = follows(f) ? `Saved. You follow ${f.name}. Floodlight cannot send alerts yet, so you will see these moves here until a way to notify you is added.` : `You no longer follow ${f.name}.`;
  }
  document.addEventListener('fl:me', () => { const mine = window.S?.me?.prefs?.follows; if (Array.isArray(mine) && mine.length) { T.follows = mine; store.set('fl.follows', mine) } });

  /* ---------- pieces ---------- */
  const admin = () => window.S?.me?.role === 'admin';
  const ago = d => { const m = (Date.now() - d) / 60000; return m < 0 ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 7 * 1440 ? `${Math.round(m / 1440)}d ago` : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) };
  const face = p => `<span class="avx">${p?.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span aria-hidden="true">${initials(p?.name)}</span></span>`;
  const teamBtn = (t, lg, small) => !t ? `<span class="avx crest av-sm tw-none" title="No club named">–</span>`
    : `<button type="button" class="tw-team${small ? ' sm' : ''}" data-twteam="${esc(JSON.stringify({ lg, id: t.id, name: t.name }))}" aria-label="${esc(t.name)}" title="${esc(t.name)}"><span class="avx crest av-sm">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span aria-hidden="true">${esc(t.abbr || initials(t.short || t.name))}</span></span>${small ? '' : `<span>${esc(t.short || t.name)}</span>`}</button>`;
  const playerBtn = (p, lg) => `<button type="button" class="tw-player" data-twplayer="${esc(JSON.stringify({ lg, id: p.id || '', name: p.name, soccer: !!p.soccer }))}">${face(p)}<span class="rw-t"><b>${esc(p.name)}</b><small>${esc([p.pos, p.age ? `${p.age}` : ''].filter(Boolean).join(' · ')) || '&nbsp;'}</small></span></button>`;
  const freeAgent = `<span class="avx crest av-sm tw-none" title="Free agent"><span aria-hidden="true">FA</span><span class="sr-only">Free agent</span></span>`;
  const noClub = n => n.what === 'without club' ? freeAgent : `<span class="avx crest av-sm tw-none" title="${esc(n.name)}"><span aria-hidden="true">${n.what === 'retired' ? 'Ret' : n.what === 'ban' ? 'Ban' : '–'}</span><span class="sr-only">${esc(n.name)}</span></span>`;
  function sourcePanel(it) {
    const s = it.source || { text: it.details, status: it.lg === 'soccer' ? 'Reported' : 'Official', name: LG[it.lg].src }, rep = T.reported.has(it.id);
    return `<div class="tw-src"><p class="tw-said"><span class="pl ${s.status === 'Official' ? 'solid' : ''}">${esc(s.status)}</span> ${esc(s.name || LG[it.lg].src)}${s.link ? ` · <a class="lk" href="${esc(s.link)}" target="_blank" rel="noopener">See the list</a>` : ''}</p>
      ${s.fields ? `<dl class="tw-fields">${s.fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : `<blockquote class="tw-quote">${esc(s.text || s.sentence || it.details)}</blockquote>`}
      ${s.text && s.sentence && s.text !== s.sentence ? `<p class="lb">The sentence about this move: “${esc(s.sentence)}”</p>` : ''}
      ${(s.also || []).length ? `<p class="lb">Listed again the same day as: ${s.also.map(x => `“${esc(x)}”`).join(', ')}. Shown once.</p>` : ''}
      ${it.conf === 'low' || (it.checks || []).length ? `<p class="lb tw-warn">${ic('info', 14)} ${esc((it.checks || []).join(' ') || 'Floodlight could not read every part of this entry, so it is shown as written.')}</p>` : ''}
      <div class="tw-rep"><button type="button" class="bt sm ghost" data-twreport="${esc(it.id)}"${rep ? ' disabled' : ''}>${rep ? 'Reported' : 'Report a mistake in this move'}</button>${T.repMsg?.id === it.id ? `<span class="lb" role="status" tabindex="-1" data-twrepmsg>${esc(T.repMsg.text)}</span>` : ''}</div></div>`;
  }
  // every part of a trade: the players with their two teams (MLB), or each team's own sentence (ESPN)
  const tradeParts = it => it.parts && (it.parts.length > 1 || (it.people || 0) > 1) ? `<ul class="tw-parts">${it.parts.map(p => p.player
      ? `<li>${playerBtn(p.player, it.lg)}<span class="tw-move">${teamBtn(p.from, it.lg, true)}<span aria-hidden="true">${ic('arrow', 16)}</span>${teamBtn(p.to, it.lg, true)}</span><span class="lb">${esc([p.from?.name, p.to?.name].filter(Boolean).join(' to '))}</span></li>`
      : `<li>${p.team ? teamBtn(p.team, it.lg) : ''}<span class="tw-said">${esc(p.text)}</span></li>`).join('')}</ul>` : '';
  function row(it) {
    const who = it.player ? playerBtn(it.player, it.lg) : it.lead ? `<span class="tw-player">${teamBtn(it.lead, it.lg, true)}<span class="rw-t"><b>${esc(it.lead.short || it.lead.name)}</b><small>Team move</small></span></span>` : '';
    const move = it.internal ? `<span class="tw-move tw-stay">${teamBtn(it.lead, it.lg, true)}<span class="lb">Roster move</span></span>`
      : `<span class="tw-move">${it.from ? teamBtn(it.from, it.lg, true) : it.noclub?.side === 'from' ? noClub(it.noclub) : teamBtn(null)}<span class="tw-arrow" aria-hidden="true">${ic('arrow', 16)}</span>${it.to ? teamBtn(it.to, it.lg, true) : it.noclub?.side === 'to' ? noClub(it.noclub) : it.type === 'waiver' ? freeAgent : teamBtn(null)}</span>`;
    const w = says(it);
    return `<tr class="tw-row"><td data-l="Player">${who}</td>
      <td data-l="Move">${move}</td>
      <td data-l="Type"><span class="pl${it.type === 'trade' || it.type === 'transfer' ? ' solid' : ''}">${esc(it.label)}</span></td>
      <td data-l="Details" class="tw-det"><button type="button" class="tw-open" data-twmove="${esc(it.id)}" aria-haspopup="dialog"><span class="tw-line">${esc(w.line)}</span>${w.sub ? `<span class="tw-sub">${esc(w.sub)}</span>` : ''}<span class="tw-cue" aria-hidden="true">Details, source and related moves ${ic('right', 14)}</span></button></td>
      <td data-l="When" class="num tw-when"><time datetime="${it.when.toISOString()}" title="${esc(it.when.toLocaleString())}">${esc(ago(it.when))}</time></td></tr>`;
  }
  // The window state and the next key date show only once an admin has entered a real date. Until then they are left
  // out altogether: no "Dates to come", no empty "Next key date".
  function banner(l, d, st) {
    const week = d?.items ? d.items.filter(x => Date.now() - x.when < 7 * 864e5 && x.when <= Date.now() + 864e5).length : null;
    const win = !st.hasWindow ? null : st.open ? ['Open', `Until ${longDay(st.open.end)}`] : ['Closed', st.reopens ? `Opens ${longDay(st.reopens.day)}` : ''];
    const f = { k: 'league', lg: l.k, name: `your ${l.name} teams` }, on = follows(f);
    const stats = [win ? `<div class="tw-stat"><span class="lb">${esc(l.status)}</span><b class="fig tw-state ${st.open ? 'open' : ''}"><i aria-hidden="true"></i>${win[0]}</b>${win[1] ? `<small class="lb">${esc(win[1])}</small>` : ''}</div>` : '',
      st.next ? `<div class="tw-stat"><span class="lb">${esc(st.next.label)}</span><b class="fig num">${count(daysTo(st.next.day))}</b><small class="lb">${esc(longDay(st.next.day))}</small></div>` : '',
      l.src ? `<div class="tw-stat"><span class="lb">Moves this week</span><b class="fig num">${week == null ? '…' : (d.error || d.note) && !d.items.length ? '–' : week}</b><small class="lb">from ${esc(d?.source || l.src)}</small></div>` : ''].filter(Boolean).join('');
    return `<section class="card feature tw-banner${stats ? '' : ' bare'}" aria-label="${esc(st.set ? l.status : `${l.name} moves`)}">${stats ? `<div class="tw-stats">${stats}</div>` : ''}
      <button type="button" class="bt tw-alert" data-twfollow="${esc(JSON.stringify(f))}" aria-pressed="${on}">${ic(on ? 'check' : 'bell', 18)}${on ? 'Following my teams' : 'Alert me on my teams'}</button>
      ${T.msg ? `<p class="tw-msg" role="status">${esc(T.msg)}</p>` : ''}</section>`;
  }
  function datesAdmin(l, st) {
    if (!admin()) return '';
    return `<details class="card tw-dates"${T.dateOpen ? ' open' : ''}><summary>Owner tools: key dates for ${esc(l.name)}${st.list.length ? '' : ' (none entered yet)'}</summary>
      <p class="lb">These dates drive the banner. For a window, enter both days. For a single day, such as a trade deadline, leave the closing day empty.</p>
      ${st.list.length ? `<ul class="tw-dlist">${st.list.map(x => `<li><span><b>${esc(x.label)}</b> ${esc(longDay(x.start))}${x.end ? ` to ${esc(longDay(x.end))}` : ''}</span><button type="button" class="bt sm ghost" data-twdrm="${esc(x.id)}" aria-label="Remove ${esc(x.label)}, ${esc(longDay(x.start))}">Remove</button></li>`).join('')}</ul>` : `<p class="lb">No dates entered for ${esc(l.name)} yet.</p>`}
      <form class="tw-dform" data-twdform><label class="fl-f"><span>What it is</span><select class="inp" name="label">${l.words.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
        <label class="fl-f"><span>Day, or opening day</span><input class="inp" type="date" name="start" required></label><label class="fl-f"><span>Closing day (windows only)</span><input class="inp" type="date" name="end"></label>
        <button class="bt" type="submit">Add date</button><p class="tw-msg" role="status">${esc(T.dateMsg)}</p></form></details>`;
  }
  function busiest(items, lg) {
    const m = new Map(); for (const it of items) { for (const [t, n] of it.ins || []) { if (!t?.id && !t?.name) continue; const k = t.id || t.name, x = m.get(k) || { t, i: 0, o: 0 }; x.i += n; m.set(k, x) } for (const [t, n] of it.outs || []) { if (!t?.id && !t?.name) continue; const k = t.id || t.name, x = m.get(k) || { t, i: 0, o: 0 }; x.o += n; m.set(k, x) } }
    const rows = [...m.values()].sort((a, b) => (b.i + b.o) - (a.i + a.o) || b.i - a.i).slice(0, 6);
    if (!rows.length) return '';
    return `<section class="card tw-busy" aria-label="Busiest teams"><div class="sec-h"><h2>Busiest teams</h2><span class="lb">Choose a team to see only its moves</span></div>
      <div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Team</th><th scope="col" class="r">In</th><th scope="col" class="r">Out</th><th scope="col" class="r">Net</th><th scope="col"><span class="sr-only">Follow</span></th></tr></thead><tbody>
      ${rows.map(x => { const net = x.i - x.o, f = { k: 'team', lg, id: String(x.t.id || x.t.name), name: x.t.name }, on = follows(f);
        return `<tr><th scope="row"><button type="button" class="tw-team" data-twonly="${esc(String(x.t.id || x.t.name))}" aria-pressed="${T.team === String(x.t.id || x.t.name)}" aria-label="Show only ${esc(x.t.name)} moves"><span class="avx crest av-sm">${x.t.logo ? `<img src="${esc(x.t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span aria-hidden="true">${esc(x.t.abbr || initials(x.t.short || x.t.name))}</span></span><span>${esc(x.t.short || x.t.name)}</span></button></th><td class="r num">${x.i}</td><td class="r num">${x.o}</td><td class="r num"><b>${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}</b></td>
          <td class="r"><button type="button" class="ib${on ? ' solid' : ''}" data-twfollow="${esc(JSON.stringify(f))}" aria-pressed="${on}" aria-label="${on ? 'Stop following' : 'Follow'} ${esc(x.t.name)}" title="${on ? 'Following' : 'Follow'}">${ic(on ? 'check' : 'bell', 18)}</button></td></tr>` }).join('')}</tbody></table></div></section>`;
  }
  const keyDateLine = st => st.next ? `Next key date: ${st.next.label}, ${longDay(st.next.day)} (${count(daysTo(st.next.day))}).` : '';
  function draw() {
    const el = $('pg-transfers'); if (!el) return;
    const l = LG[T.lg], d = T.data[T.lg], st = status(T.lg), items = d?.items || null, loading = !d || (!d.at && d.promise);
    const onTeam = x => !T.team || [x.lead, x.from, x.to, ...(x.parts || []).flatMap(p => [p.team, p.from, p.to])].some(t => t && String(t.id || t.name) === T.team);
    const kinds = items ? [...new Set(items.map(x => x.type))] : [], type = kinds.includes(T.type) ? T.type : 'all', list = items ? items.filter(x => (type === 'all' || x.type === type) && onTeam(x)) : [];
    const teamName = T.team && items ? (items.flatMap(x => [x.lead, x.from, x.to]).find(t => t && String(t.id || t.name) === T.team)?.name || '') : '';
    const chips = kinds.length > 1 ? `<div class="cx-row" role="radiogroup" aria-label="Kind of move">${[['all', 'All'], ...Object.keys(TYPES).filter(k => kinds.includes(k)).map(k => [k, TYPES[k]])].map(([k, n]) => `<button type="button" class="cx sm" role="radio" aria-checked="${type === k}" tabindex="${type === k ? 0 : -1}" data-twtype="${k}">${n}</button>`).join('')}</div>` : '';
    const empty = d?.error === 'denied' ? `<div class="emp">${ic('transfers', 28)}<b>The transfer window is switched off for you</b><p>Ask your admin for access.</p><button type="button" class="bt sm" data-page="members">Ask for access</button></div>`
      : !l.src ? `<div class="emp">${ic('transfers', 28)}<b>No moves yet</b><p>Floodlight has no source for the transfer portal, so entries and commitments cannot be listed. ${esc(keyDateLine(st))}</p></div>`
      : d?.error || d?.note ? `<div class="emp">${ic('transfers', 28)}<b>The moves list did not load</b><p>${esc(d.error || d.note)} ${esc(keyDateLine(st))}</p><button type="button" class="bt sm" data-twretry>Try again</button></div>`
      : `<div class="emp">${ic('transfers', 28)}<b>No moves yet</b><p>${esc(l.src)} lists nothing for ${esc(l.name)} right now. ${esc(keyDateLine(st))}</p></div>`;
    const moves = loading ? '<div class="skl" style="height:64px"></div>'.repeat(6) : !list.length ? empty
      : `<div class="tbx-wrap"><table class="tbx tw-moves"><thead><tr><th scope="col">Player</th><th scope="col">Move</th><th scope="col">Type</th><th scope="col">Details</th><th scope="col" class="r">When</th></tr></thead><tbody>${list.slice(0, T.show).map(row).join('')}</tbody></table></div>
        ${list.length > T.show ? `<button type="button" class="bt ghost wide tw-all" data-twmore>Show ${Math.min(30, list.length - T.show)} more of ${list.length}</button>` : ''}`;
    const side = [busiest(items || [], T.lg),
      l.college ? `<section class="card" aria-label="Top players in the portal"><div class="sec-h"><h2>Top players in the portal</h2></div><div class="emp">${ic('profile', 26)}<b>No portal list yet</b><p>Position, previous school and status (in the portal, committed, withdrawn) need a transfer-portal source. None is connected.</p></div></section>` : '',
      T.lg === 'soccer' ? `<section class="card tw-full" aria-label="The full soccer market"><div class="sec-h"><h2>The full soccer market</h2></div><p class="lb">Record fees by season, any day’s moves, and filters by position, age, fee and league.</p><button type="button" class="bt wide" data-twmarket>Open the soccer market${ic('arrow', 18)}</button></section>` : ''].filter(Boolean).join('');
    const legend = `<p class="lb tw-legend">${l.k === 'soccer' ? 'Reported by Transfermarkt.' : l.src ? `Official: each move is from the ${esc(l.src)} transaction list, one row per player.` : ''} Floodlight has no rumour source, so nothing here is a rumour.</p>`;
    const teamBar = T.team ? `<div class="tw-only" role="status"><span>${esc(teamName || 'One team')}: ${list.length} ${list.length === 1 ? 'move' : 'moves'}</span><button type="button" class="lk" data-twonly="">Show every team</button></div>` : '';
    el.innerHTML = `<header class="pg-head"><h1 class="pg-title" tabindex="-1">Transfer window</h1><p class="pg-sub">Trades, signings and the portal, league by league.</p></header>
      <div class="tw-tabs"><div class="cx-row scroll" role="radiogroup" aria-label="League">${LEAGUES.map(x => `<button type="button" class="cx" role="radio" aria-checked="${x.k === T.lg}" tabindex="${x.k === T.lg ? 0 : -1}" data-twlg="${x.k}">${esc(x.name)}</button>`).join('')}</div>
        <span class="lb">${l.college ? 'College tabs show the transfer portal' : l.src ? `Moves from ${esc(l.src)}` : ''}</span></div>
      ${banner(l, d, st)}${datesAdmin(l, st)}
      <div class="tw-cols${side ? '' : ' one'}"><section class="card tw-latest" aria-label="Latest moves"><div class="sec-h"><h2>Latest moves</h2>${chips}</div>${legend}${teamBar}${moves}</section>${side ? `<aside class="vst tw-side">${side}</aside>` : ''}</div>`;
  }
  function render(el) { el.innerHTML = ''; draw(); refresh() }
  function refresh(force) { const lg = T.lg; Promise.all([load(lg, force), loadDates(force)]).then(() => { if (T.lg === lg && window.flPages?.current?.() === 'transfers') draw() }) }

  /* ---------- opening a team or a player's own page ---------- */
  const CHIP = { nba: 'basketball', nfl: 'football', mlb: 'baseball', soccer: 'soccer' };
  function leaveTo(sport) { window.flPages?.hide?.(); window.flHub?.hide?.(); const b = document.querySelector(`.tbs[data-sport="${sport}"]`) || document.querySelector(`button[data-sport="${sport}"]`); if (window.S?.sport !== sport) { if (b) b.click(); else if (typeof setSport === 'function') setSport(sport) } }
  function openTeamOf(o) {
    const sport = CHIP[o.lg]; if (!sport) return;
    if (o.lg === 'soccer') return window.flLab?.open({ sport: 'soccer', name: o.name, team: true });
    leaveTo(sport);
    setTimeout(() => { try { if (o.lg === 'nba' && typeof openBbTeam === 'function') openBbTeam(o.id, 'nba'); else if (o.lg === 'nfl' && typeof openFbTeam === 'function') openFbTeam(o.id, 'nfl'); else if (o.lg === 'mlb' && typeof openBsTeam === 'function') openBsTeam(o.id, 'mlb') } catch (e) {} }, 60);
  }
  async function openPlayerOf(o) {
    const sport = CHIP[o.lg]; if (!sport) return;
    if (o.lg === 'soccer') { leaveTo('soccer'); return setTimeout(() => typeof openPlayerByName === 'function' && openPlayerByName(o.name), 60) }
    let id = o.id;
    if (!id) try {   // the ESPN lists name the player but give no id: look the name up in that league
      const d = await (typeof cj === 'function' ? cj : u => fetch(u).then(r => r.json()))(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(o.name)}&type=player&limit=8`);
      id = (d.items || []).find(x => (x.league || x.defaultLeagueSlug) === o.lg && norm(x.displayName) === norm(o.name))?.id || '';
    } catch (e) {}
    if (!id) return window.flLab?.open({ sport: o.lg, name: o.name });   // not found by name: the Lab can still look the player up
    leaveTo(sport);
    setTimeout(() => { try { if (o.lg === 'nba' && typeof openBbPlayer === 'function') openBbPlayer(String(id), 'nba'); else if (o.lg === 'nfl' && typeof openFbPlayer === 'function') openFbPlayer(String(id), 'nfl'); else if (o.lg === 'mlb' && typeof openBsPlayer === 'function') openBsPlayer(String(id), 'mlb') } catch (e) {} }, 60);
  }

  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-twlg],[data-twtype],[data-twreport],[data-twonly],[data-twmore],[data-twfollow],[data-twteam],[data-twplayer],[data-twretry],[data-twmarket],[data-twdrm],[data-twmove],[data-twclose],[data-twsave]'); if (!t) return;
    const d = t.dataset, keep = sel => requestAnimationFrame(() => document.querySelector(sel)?.focus());
    if (d.twmove) { ev.preventDefault(); openMove(d.twmove, t.closest('.twd') ? undefined : t); return }
    if ('twclose' in d) return closeMove();
    if ('twsave' in d) { const it = findMove(D.id); if (it) window.flBoards?.offer(itemOf(it), t); return }
    if ((d.twteam || d.twplayer) && t.closest('.twd')) closeMove(true);   // leaving for a team or player page: the drawer goes first
    if (d.twonly != null) { T.team = d.twonly || null; T.show = 30; draw(); return keep(d.twonly ? `[data-twonly="${CSS.escape(d.twonly)}"]` : '.tw-latest h2') }
    if (d.twreport) { const it = findMove(d.twreport); if (!it) return; report(it); return }
    if (d.twlg) { T.team = null; T.lg = d.twlg; T.type = 'all'; T.show = 30; T.msg = ''; T.dateMsg = ''; store.set('fl.tw.league', T.lg); draw(); refresh(); return keep(`[data-twlg="${T.lg}"]`) }
    if (d.twtype) { T.type = d.twtype; T.show = 30; draw(); return keep(`[data-twtype="${T.type}"]`) }
    if ('twmore' in d) { T.show += 30; return draw() }
    if ('twretry' in d) { T.data[T.lg] = null; draw(); return refresh(true) }
    if ('twmarket' in d) { leaveTo('soccer'); return setTimeout(() => typeof openMarket === 'function' && openMarket(), 60) }
    if (d.twfollow) { let f; try { f = JSON.parse(d.twfollow) } catch (e) { return } toggleFollow(f); if (window.flPages?.current?.() === 'transfers') { draw(); keep(`[data-twfollow='${CSS.escape(d.twfollow)}']`) } return }
    if (d.twteam) { try { openTeamOf(JSON.parse(d.twteam)) } catch (e) {} return }
    if (d.twplayer) { try { openPlayerOf(JSON.parse(d.twplayer)) } catch (e) {} return }
    if (d.twdrm) { T.dateOpen = true; post('/api/admin/transfers/dates', { op: 'remove', id: d.twdrm }).then(r => { T.dates = r.dates || []; T.dateMsg = 'Removed.' }).catch(e => { T.dateMsg = e.message }).then(draw) }
  });
  // a mistake in a move goes to the owners' feedback list (Members page), with the sentence it came from
  function report(it) {
    const s = it.source || {};
    const text = `Transfer move looks wrong (${LG[it.lg].name}, ${it.when.toLocaleDateString()}): ${it.player?.name || it.lead?.name || ''} · ${it.label} · ${plain(it)}. Source: “${s.sentence || s.text || (s.fields || []).map(f => f.join(': ')).join(', ') || it.details}”`;
    fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, page: 'transfers:' + it.id }) })
      .then(r => { if (r.status === 401) throw new Error('signin'); if (!r.ok) throw new Error('fail'); T.reported.add(it.id); store.set('fl.tw.reported', [...T.reported].slice(-200)); T.repMsg = { id: it.id, text: 'Sent. The owners will check this move against the source.' } })
      .catch(e => { T.repMsg = { id: it.id, text: e.message === 'signin' ? 'Sign in to report a move, so the owners know who to ask.' : 'The report did not send. Try again in a moment.' } })
      .then(() => { if (D.id === it.id) { paintDrawer(); drawer().querySelector('[data-twrepmsg]')?.focus() } });
  }

  /* ---------- the move drawer ----------
     Opened from any move (a table row, a step on a player's timeline, a related move inside the drawer). A side panel
     on wide screens, a bottom sheet on a phone. Focus goes to its title, Escape and Close shut it, and focus goes back
     to the button that opened it. On the Transfer window page the address follows it (#/transfers/move=<id>), so a
     move can be linked to and reopened. */
  const D = { id: null, from: null, origin: null };
  let dHost = null;
  function drawer() {
    if (dHost) return dHost;
    dHost = document.createElement('div'); dHost.className = 'twd'; dHost.hidden = true;
    dHost.innerHTML = `<div class="twd-scrim" data-twclose></div><section class="twd-panel" role="dialog" aria-modal="true" aria-labelledby="twd-title"></section>`;
    document.body.appendChild(dHost);
    const panel = dHost.querySelector('.twd-panel');
    panel.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return closeMove() }
      if (ev.key !== 'Tab') return;   // keep the keyboard inside while it is open
      const f = [...panel.querySelectorAll('button:not([disabled]),[href],input,select,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (ev.shiftKey && (at === first || !f.includes(at))) { ev.preventDefault(); last.focus() } else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus() }
    });
    return dHost;
  }
  const findMove = id => { const lg = String(id || '').split(':')[0]; return (T.data[lg]?.items || []).find(x => x.id === id) || null };
  const onPage = () => window.flPages?.current?.() === 'transfers';
  const moveHash = id => '#/transfers' + (id ? '/' + encodeURIComponent('move=' + id) : '');
  const whoOf = it => it.player?.name || it.lead?.name || 'Team move';
  // what Home's "Continue researching" and the boards keep for a move
  const itemOf = it => ({ kind: it.player ? 'player' : 'team', key: 'move:' + it.id, label: `${whoOf(it)}: ${plain(it)}`, sub: longDate(it.when), ...(it.player?.photo ? { photo: it.player.photo } : {}), open: { page: 'transfers', move: it.id } });
  function openMove(id, from) {
    const lg = String(id || '').split(':')[0]; if (!LG[lg]) return false;
    const it = findMove(id);
    if (!it) {   // not loaded yet (a link, or a profile opened before the list): load the league, then open if it is there
      if (T.data[lg]?.at && !T.data[lg].promise) { T.msg = 'That move is no longer in the latest list.'; if (onPage()) draw(); return false }
      load(lg).then(r => { if ((r.items || []).some(x => x.id === id)) openMove(id, from); else if (onPage()) { T.msg = 'That move is no longer in the latest list.'; draw() } });
      return true;
    }
    if (from !== undefined || !D.id) { D.from = from || null; D.origin = id }   // a related move opened inside keeps the first opener
    D.id = id; paintDrawer();
    const host = drawer(); host.hidden = false; root.classList.add('twd-on');
    requestAnimationFrame(() => host.querySelector('#twd-title')?.focus({ preventScroll: true }));
    host.querySelector('.twd-body')?.scrollTo?.(0, 0);
    if (onPage() && location.hash !== moveHash(id)) history.replaceState(history.state, '', moveHash(id));
    window.flRecent?.note(itemOf(it));
    impact(it);
    return true;
  }
  function closeMove(quiet) {
    if (!dHost || dHost.hidden) return;
    dHost.hidden = true; root.classList.remove('twd-on');
    if (onPage() && location.hash.startsWith('#/transfers/')) history.replaceState(history.state, '', moveHash(null));
    const f = D.from, o = D.origin; D.id = D.from = D.origin = null;
    if (quiet) return;
    const back = f && document.contains(f) ? f : o && document.querySelector(`[data-twmove="${CSS.escape(o)}"]:not(.twd [data-twmove])`);
    back?.focus({ preventScroll: true });
  }
  document.addEventListener('fl:page', ev => { if (ev.detail?.name !== 'transfers') closeMove(true) });   // another page, or back to the sports

  // Previous team and new team, said plainly; a roster move inside one team has one team
  function teamsOf(it) {
    const lg = it.lg, cell = t => teamBtn(t, lg), n = it.noclub, gone = /^waive$|^WA$/.test(it.kind || it.code || '') || it.label === 'Waived';
    if (it.internal || (it.lg !== 'soccer' && it.type !== 'trade' && !it.from && !it.to && it.lead)) return [['Team', `${cell(it.lead)}<span class="lb">No change of team</span>`]];
    const prev = it.from ? cell(it.from) : n?.side === 'from' ? `<span>${esc(n.what === 'without club' ? 'None. A free agent' : n.name)}</span>` : '<span class="lb">Not named in this entry</span>';
    const next = it.to ? cell(it.to) : n?.side === 'to' ? `<span>${esc({ 'without club': 'None. Now a free agent', retired: 'None. Retired', 'career break': 'None. Taking a career break', ban: 'None. Serving a ban' }[n.what] || 'Not known')}</span>`
      : `<span>${gone ? 'None yet. Other teams can put in a claim' : it.code === 'DES' ? 'None yet. Designated for assignment' : it.code === 'OUT' ? 'Off the 40-man roster, see the source' : 'None. Now a free agent'}</span>`;
    return [['Previous team', prev], ['New team', next]];
  }
  // the contract, only as the source states it
  const dealOf = it => it.terms?.summary || '';
  // moves that belong with this one: the same player within 60 days, the other side of a trade, the same team that day
  function related(it) {
    const items = T.data[it.lg]?.items || [], out = [], day = dayOf(it.when), key = t => t && String(t.id || t.name);
    const add = (x, why) => { if (x.id !== it.id && !out.some(o => o.x.id === x.id)) out.push({ x, why }) };
    if (it.type === 'trade') { const mineT = new Set([it.lead, it.from, it.to].map(key).filter(Boolean));
      for (const x of items) if (x.type === 'trade' && Math.abs(x.when - it.when) <= 864e5 && [x.lead, x.from, x.to].map(key).filter(k => k && mineT.has(k)).length >= 2) add(x, 'Other side of this trade') }
    if (it.player?.name) for (const x of items) if (Math.abs(x.when - it.when) <= 60 * 864e5 && mine(x, it.player.name, it.player.id)) add(x, 'Same player');
    const team = key(it.lead); if (team) for (const x of items) if (dayOf(x.when) === day && key(x.lead) === team) add(x, `${it.lead.short || it.lead.name}, same day`);
    return out.sort((a, b) => b.x.when - a.x.when).slice(0, 10);
  }
  function paintDrawer() {
    const it = findMove(D.id); if (!it) return;
    const panel = drawer().querySelector('.twd-panel'), w = says(it), l = LG[it.lg], s = it.source || {}, deal = dealOf(it), rel = related(it), parts = tradeParts(it);
    const fact = (k, v) => `<div class="twd-f"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const facts = [['Date', `<time datetime="${it.when.toISOString()}">${esc(longDate(it.when))}</time>`], ...teamsOf(it),
      ...(deal ? [['Contract', esc(deal)]] : []), ...(it.lg === 'soccer' && it.fee ? [['Fee', esc(it.fee)]] : [])];
    const readTo = it.to?.name || (it.noclub?.side === 'to' ? `${it.noclub.name}, read as: ${w.line.replace(/^./, c => c.toLowerCase())}` : '') || (it.internal ? 'Stays on the roster' : 'No team named');
    const readFrom = it.from?.name || (it.noclub?.side === 'from' ? `${it.noclub.name}, read as: no club` : '') || (it.internal ? (it.lead?.name || '') : 'No team named');
    const read = [['Type', it.label], ['Player', it.player ? [it.player.name, it.player.pos].filter(Boolean).join(', ') : 'None named'], ['From', readFrom], ['To', readTo],
      ...(it.conf === 'low' ? [['Confidence', 'Low. Check it against the source']] : [])];
    const sec = (id, title, body) => `<section class="twd-s" aria-labelledby="twd-${id}"><h3 id="twd-${id}">${title}</h3>${body}</section>`;
    panel.innerHTML = `<header class="twd-head">
        <div class="twd-bar"><span class="twd-k"><span class="pl solid">${esc(stepOf(it))}</span><span class="lb">${esc(l.name)}</span></span>
          <span class="twd-tools">${window.flBoards ? `<button type="button" class="bt sm ghost" data-twsave>${ic('save', 16)}Save to board</button>` : ''}<button type="button" class="ib" data-twclose aria-label="Close the move">${ic('x', 18) || '×'}</button></span></div>
        <h2 class="twd-title" id="twd-title" tabindex="-1">${esc(whoOf(it))}</h2>
        <p class="twd-line">${esc(w.line)}</p>${w.sub ? `<p class="twd-sub">${esc(w.sub)}</p>` : ''}</header>
      <div class="twd-body">
        <dl class="twd-facts">${facts.map(([k, v]) => fact(k, v)).join('')}</dl>
        <div class="twd-impact" data-twimpact aria-live="polite"></div>
        ${parts ? sec('trade', 'The full trade', parts) : ''}
        ${sec('src', 'Full source text', sourcePanel(it))}
        ${sec('read', 'How Floodlight read it', `<dl class="twd-read">${read.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`)}
        ${rel.length ? sec('rel', 'Related moves', `<ul class="twd-rel">${rel.map(({ x, why }) => `<li><button type="button" class="twd-rb" data-twmove="${esc(x.id)}"><span class="twt-k">${esc(stepOf(x))} · ${esc(why)}</span><b>${esc(whoOf(x))}</b><small>${esc(plain(x))}</small><time class="num" datetime="${x.when.toISOString()}">${esc(x.when.toLocaleDateString([], { day: 'numeric', month: 'short' }))}</time></button></li>`).join('')}</ul>`) : ''}
        ${it.player && !it.player.soccer && onPage() ? `<p class="twd-go"><button type="button" class="bt sm ghost" data-twplayer="${esc(JSON.stringify({ lg: it.lg, id: it.player.id || '', name: it.player.name }))}">Open ${esc(it.player.name)}’s page${ic('arrow', 16)}</button></p>` : ''}
      </div>`;
    if (T.impact?.[it.id]) fillImpact(it);
  }
  function impact() {}
  function fillImpact() {}
  document.addEventListener('submit', ev => { const f = ev.target.closest('[data-twdform]'); if (!f) return; ev.preventDefault(); T.dateOpen = true;
    post('/api/admin/transfers/dates', { op: 'add', league: T.lg, label: f.label.value, start: f.start.value, end: f.end.value }).then(r => { T.dates = r.dates || []; T.dateMsg = 'Saved.' }).catch(e => { T.dateMsg = e.message }).then(draw) });

  /* ---------- for Home and the player profile ---------- */
  // the newest moves across the leagues given, already read: [{ lg, league, name, text, when, from, to }]
  async function latest(leagues, n = 3) {
    const res = await Promise.all((leagues && leagues.length ? leagues : ['nba', 'nfl', 'mlb', 'soccer']).filter(k => LG[k]?.src).map(k => load(k)));
    const denied = res.length > 0 && res.every(r => r.error === 'denied'), failed = res.length > 0 && res.every(r => ((r.error && r.error !== 'denied') || r.note) && !(r.items || []).length);
    // Home shows moves between teams; injured reserve, practice squad and other roster moves stay on this page
    // each row keeps its usual fields (a club that is "Without Club" is no longer a `to`); `says` adds the plain words,
    // { line: "Released by Arsenal", sub: "Now a free agent" }, for whoever shows the row
    return { denied, failed, rows: res.flatMap(r => r.items || []).filter(x => x.type !== 'other' && !x.internal).sort((a, b) => b.when - a.when).slice(0, n).map(x => ({ ...x, league: LG[x.lg].name, says: says(x) })) };
  }
  // a player's own moves, from the same lists (matched by name where the list gives no id), as a timeline, newest first.
  // Each step has one plain type, so a season reads down the card: Signed, Waived, Claimed, Practice squad, Activated…
  const STEP = { sign: 'Signed', re_sign: 'Signed', two_way: 'Signed', claim: 'Claimed', waive: 'Waived', release: 'Released', ps_release: 'Released',
    ps_sign: 'Practice squad', promote: 'Practice squad', elevate: 'Practice squad', activate: 'Activated', ir: 'Injured reserve', ps_ir: 'Injured reserve',
    return_ir: 'Injured reserve', pup: 'Reserve list', suspend: 'Suspended', trade: 'Traded', extension: 'Contract extension', convert: 'Contract', option: 'Contract',
    guarantee: 'Contract', exemption: 'Roster move', other: 'Roster move' };
  const MLB_STEP = { TR: 'Traded', SFA: 'Signed', SGN: 'Signed', REL: 'Released', CLW: 'Claimed', WA: 'Waived', DES: 'Designated for assignment', OUT: 'Outrighted' };
  function stepOf(it) {
    if (it.lg === 'soccer') return it.type === 'loan' ? 'Loan' : it.type === 'left' ? it.label : it.noclub?.side === 'from' && it.noclub.what === 'without club' ? 'Signed' : 'Transfer';
    if (it.lg === 'mlb') { const t = it.source?.text || it.details || ''; return MLB_STEP[it.code] || (/injured list/i.test(t) && /\bplaced|transferred\b/i.test(t) ? 'Injured list' : /\bactivated|reinstated\b/i.test(t) ? 'Activated' : /extension/i.test(t) ? 'Contract extension' : it.label || 'Roster move') }
    if (it.kind) return STEP[it.kind] || 'Roster move';
    return { trade: 'Traded', sign: 'Signed', ext: 'Contract extension', waiver: /claim/i.test(it.label) ? 'Claimed' : /waiver/i.test(it.label) ? 'Waived' : 'Released' }[it.type] || it.label || 'Roster move';
  }
  // a step that moves the player between teams gets a filled dot; one inside a roster (injured reserve, practice squad) a ring
  const between = it => it.type === 'trade' || (!it.internal && !!(it.from || it.to || it.noclub));
  const longDate = d => d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  function movesCard(sport, name, id) {
    const lg = { nba: 'nba', nfl: 'nfl', mlb: 'mlb' }[sport]; if (!lg || !name) return '';
    const d = T.data[lg];
    if (!d?.at) { load(lg).then(r => { if ((r.items || []).some(x => mine(x, name, id)) && typeof renderSheet === 'function' && window.S?.stack?.length) renderSheet() }); return '' }
    const rows = (d.items || []).filter(x => mine(x, name, id)).sort((a, b) => b.when - a.when).slice(0, 12); if (!rows.length) return '';
    return `<section class="card pfa tw-pm" aria-labelledby="twpm-h"><div class="sec-h"><h2 id="twpm-h">Moves</h2><span class="lb">From ${esc(d.source || LG[lg].src)}, newest first</span></div>
      <ol class="twt">${rows.map(x => { const w = says(x), step = stepOf(x);
        return `<li class="twt-i${between(x) ? ' go' : ''}"><button type="button" class="twt-b" data-twmove="${esc(x.id)}" aria-haspopup="dialog" aria-label="${esc(`${step}, ${longDate(x.when)}. ${w.line}. Open the details`)}">
          <span class="twt-dot" aria-hidden="true"></span><span class="twt-k">${esc(step)}</span><span class="twt-t"><b>${esc(w.line)}</b>${w.sub ? `<small>${esc(w.sub)}</small>` : ''}</span>
          <time class="twt-d num" datetime="${x.when.toISOString()}">${esc(x.when.toLocaleDateString([], { day: 'numeric', month: 'short' }))}</time></button></li>` }).join('')}</ol></section>`;
  }
  const mine = (x, name, id) => { const k = norm(name); return (id && x.player?.id && String(x.player.id) === String(id)) || norm(x.player?.name) === k || (x.parts || []).some(p => (p.player && (norm(p.player.name) === k || (id && String(p.player.id) === String(id)))) || (p.text && norm(p.text).includes(k))) };

  // #/transfers/move=<id> opens the page on that move's league with the move's drawer open
  function onShow(el, arg) {
    const want = /^move=(.+)$/.exec(arg || '')?.[1], lg = want ? want.split(':')[0] : '';
    if (LG[lg] && T.lg !== lg) { T.lg = lg; T.team = null; T.type = 'all'; T.show = 30; draw() }
    if (Date.now() - (T.data[T.lg]?.at || 0) > TTL) refresh();
    if (want) openMove(want, null);
  }
  window.flPages?.add('transfers', { title: 'Transfer window', render, onShow });
  // openMove(id): the drawer over whatever is showing; showMove(id): the Transfer window page with that move open
  const showMove = id => window.flPages?.show('transfers', 'move=' + id);
  window.flTransfers = { latest, movesCard, openMove, showMove, LEAGUES, status, _read: { fromEspn, fromEvents, fromMlb, fromSoccer } };
})();
