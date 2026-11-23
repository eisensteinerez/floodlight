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
  const TYPES = { trade: 'Trades', sign: 'Signings', ext: 'Extensions', waiver: 'Waivers and releases', other: 'Roster moves', transfer: 'Transfers', loan: 'Loans', free: 'Free transfers' };
  const T = { lg: LG[store.get('fl.tw.league', 'nba')] ? store.get('fl.tw.league', 'nba') : 'nba', type: 'all', data: {}, dates: null, open: new Set(), show: 30, msg: '', dateMsg: '',
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
  // MLB: the league names the player, both clubs and the kind of move. One trade is several rows, one per player.
  const MLB_KIND = { TR: 'trade', SFA: 'sign', SGN: 'sign', REL: 'waiver', CLW: 'waiver', DES: 'waiver', WA: 'waiver', OUT: 'waiver' };
  const MLB_LABEL = { TR: 'Trade', SFA: 'Free agent', SGN: 'Signing', REL: 'Release', CLW: 'Waiver claim', DES: 'Designated for assignment', WA: 'Waiver', OUT: 'Outrighted' };
  function fromMlb(rows) {
    const logo = id => typeof bsLogo === 'function' && id ? bsLogo(id) : '', shot = id => typeof bsShot === 'function' && id ? bsShot(id) : '';
    const tm = t => t ? { id: t.id, name: t.name, short: t.name, logo: logo(t.id) } : null;
    const posOf = (text, name) => { const m = name && String(text).match(new RegExp(`\\b(${POSN})\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); return m ? m[1] : '' };
    const out = [], trades = new Map();
    for (const r of rows) { const when = whenOf(r.date); if (isNaN(when)) continue;
      const kind = MLB_KIND[r.code] || (/extension/i.test(r.text) ? 'ext' : 'other'), from = tm(r.from), to = tm(r.to), p = r.player ? { id: r.player.id, name: r.player.name, pos: posOf(r.text, r.player.name), photo: shot(r.player.id) } : null;
      if (kind === 'trade') { const k = dayOf(when) + '|' + norm(r.text); let g = trades.get(k);
        if (!g) { g = { id: `mlb:trade:${r.id}`, lg: 'mlb', type: 'trade', label: 'Trade', when, player: p, lead: to || from, from, to, details: r.text, parts: [], seen: new Set(), ins: [], outs: [] }; trades.set(k, g); out.push(g) }
        if (p && !g.seen.has(p.id)) { g.seen.add(p.id); g.parts.push({ player: p, from, to }); if (to) g.ins.push([to, 1]); if (from) g.outs.push([from, 1]) }
        continue }
      const gone = kind === 'waiver' && r.code !== 'CLW';
      out.push({ id: 'mlb:' + r.id, lg: 'mlb', type: kind, label: MLB_LABEL[r.code] || (kind === 'ext' ? 'Extension' : r.kind || 'Roster move'), when, player: p, lead: to || from, from: gone ? (from || to) : from, to: gone ? null : to, details: r.text,
        ins: kind === 'sign' || r.code === 'CLW' ? (to ? [[to, 1]] : []) : [], outs: gone && (from || to) ? [[from || to, 1]] : [] }) }
    for (const g of out) if (g.parts) { g.people = g.parts.length; delete g.seen; const tms = new Set(g.parts.flatMap(x => [x.from?.id, x.to?.id]).filter(Boolean)); g.teams = tms.size; if (tms.size > 2) g.details = `${tms.size}-team trade` }
    return out;
  }
  const crest = id => id ? `https://img.a.transfermarkt.technology/wappen/head/${id}.png` : '';
  const NOCLUB = /^(without club|retired|career break|unknown|ban)$/i;
  function fromSoccer(rows) {
    const club = c => c && c.name ? { id: c.id, name: c.name, short: c.name, logo: c.crest || crest(c.id), soccer: true } : null;
    return rows.map(t => { const kind = /loan/i.test(t.fee) ? 'loan' : /free/i.test(t.fee) ? 'free' : 'transfer', from = club(t.from), to = club(t.to);
      return { id: 'soccer:' + t.id, lg: 'soccer', type: kind, label: kind === 'loan' ? 'Loan' : kind === 'free' ? 'Free transfer' : 'Transfer', when: whenOf(t.date), player: { name: t.name, pos: t.position, age: t.age, photo: t.photo, soccer: true }, lead: to || from, from, to,
        details: kind === 'transfer' && t.fee && !/^[-?]$/.test(t.fee) ? `Fee ${t.fee}` : t.marketValue && !/^[-?]$/.test(t.marketValue) ? `Market value ${t.marketValue}` : kind === 'transfer' ? 'Fee not given' : '', ins: to && !NOCLUB.test(to.name) ? [[to, 1]] : [], outs: from && !NOCLUB.test(from.name) ? [[from, 1]] : [] } }).filter(x => !isNaN(x.when));
  }

  /* ---------- loading ---------- */
  const TTL = 5 * 60000;
  function load(lg, force) {
    const cur = T.data[lg];
    if (cur && !force && (cur.promise || Date.now() - cur.at < TTL)) return cur.promise || Promise.resolve(cur);
    const req = lg === 'soccer' ? get('/api/tm/transfers/feed?kind=latest&page=1').then(d => ({ items: fromSoccer(d.transfers || []), source: 'Transfermarkt' }))
      : get('/api/transfers/moves?league=' + lg).then(d => ({ items: !d.source ? [] : lg === 'mlb' ? fromMlb(d.moves || []) : fromEspn(lg, d.moves || []), source: d.source || '', note: d.error || '' }));
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
  function row(it) {
    const open = T.open.has(it.id), many = it.parts && (it.parts.length > 1 || (it.people || 0) > 1);
    const who = it.player ? playerBtn(it.player, it.lg) : it.lead ? `<span class="tw-player">${teamBtn(it.lead, it.lg, true)}<span class="rw-t"><b>${esc(it.lead.short || it.lead.name)}</b><small>Team move</small></span></span>` : '';
    const more = !many ? '' : `<tr class="tw-more"${open ? '' : ' hidden'} id="twm-${esc(it.id)}"><td colspan="5"><ul class="tw-parts">${it.parts.map(p => p.player
        ? `<li>${playerBtn(p.player, it.lg)}<span class="tw-move">${teamBtn(p.from, it.lg, true)}${ic('arrow', 16)}${teamBtn(p.to, it.lg, true)}</span><span class="lb">${esc([p.from?.name, p.to?.name].filter(Boolean).join(' to '))}</span></li>`
        : `<li>${teamBtn(p.team, it.lg)}<span class="tw-said">${esc(p.text)}</span></li>`).join('')}</ul></td></tr>`;
    return `<tr class="tw-row"><td data-l="Player">${who}</td>
      <td data-l="Move"><span class="tw-move">${teamBtn(it.from, it.lg, true)}<span class="tw-arrow" aria-label="to">${ic('arrow', 16)}</span>${teamBtn(it.to, it.lg, true)}</span></td>
      <td data-l="Type"><span class="pl${it.type === 'trade' || it.type === 'transfer' ? ' solid' : ''}">${esc(it.label)}</span></td>
      <td data-l="Details" class="tw-det">${esc(it.details)}${many ? `<button type="button" class="lk tw-exp" data-twopen="${esc(it.id)}" aria-expanded="${open}" aria-controls="twm-${esc(it.id)}">${open ? 'Hide the full trade' : 'Show the full trade'}</button>` : ''}</td>
      <td data-l="When" class="num tw-when"><time datetime="${it.when.toISOString()}" title="${esc(it.when.toLocaleString())}">${esc(ago(it.when))}</time></td></tr>${more}`;
  }
  function banner(l, d, st) {
    const week = d?.items ? d.items.filter(x => Date.now() - x.when < 7 * 864e5 && x.when <= Date.now() + 864e5).length : null;
    const state = !st.hasWindow ? ['Dates to come', admin() ? 'No dates entered yet. Add them under Key dates below.' : (week ? `${week} ${week === 1 ? 'move' : 'moves'} listed this week, below` : 'The latest moves are listed below as they are announced')] : st.open ? ['Open', `Until ${longDay(st.open.end)}`] : ['Closed', st.reopens ? `Opens ${longDay(st.reopens.day)}` : (admin() ? 'No opening date entered yet' : 'Opening date to come')];
    const f = { k: 'league', lg: l.k, name: `your ${l.name} teams` }, on = follows(f);
    return `<section class="card feature tw-banner" aria-label="${esc(l.status)}"><div class="tw-stats">
        <div class="tw-stat"><span class="lb">${esc(l.status)}</span><b class="fig tw-state ${st.open ? 'open' : ''}"><i aria-hidden="true"></i>${state[0]}</b><small class="lb">${esc(state[1])}</small></div>
        <div class="tw-stat"><span class="lb">${st.next ? esc(st.next.label) : 'Next key date'}</span><b class="fig num">${st.next ? count(daysTo(st.next.day)) : '–'}</b><small class="lb">${st.next ? esc(longDay(st.next.day)) : (admin() ? 'None entered yet' : 'No date listed yet')}</small></div>
        <div class="tw-stat"><span class="lb">Moves this week</span><b class="fig num">${!l.src ? '–' : week == null ? '…' : (d.error || d.note) && !d.items.length ? '–' : week}</b><small class="lb">${d?.source ? `from ${esc(d.source)}` : l.src ? `from ${esc(l.src)}` : 'no source yet'}</small></div></div>
      <button type="button" class="bt tw-alert" data-twfollow="${esc(JSON.stringify(f))}" aria-pressed="${on}">${ic(on ? 'check' : 'bell', 18)}${on ? 'Following my teams' : 'Alert me on my teams'}</button>
      ${T.msg ? `<p class="tw-msg" role="status">${esc(T.msg)}</p>` : ''}</section>`;
  }
  function datesAdmin(l, st) {
    if (!admin()) return '';
    return `<details class="card tw-dates"${T.dateOpen ? ' open' : ''}><summary>Key dates for ${esc(l.name)} (admins)</summary>
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
    return `<section class="card tw-busy" aria-label="Busiest teams"><div class="sec-h"><h2>Busiest teams</h2><span class="lb">from the moves listed</span></div>
      <div class="tbx-wrap"><table class="tbx"><thead><tr><th scope="col">Team</th><th scope="col" class="r">In</th><th scope="col" class="r">Out</th><th scope="col" class="r">Net</th><th scope="col"><span class="sr-only">Follow</span></th></tr></thead><tbody>
      ${rows.map(x => { const net = x.i - x.o, f = { k: 'team', lg, id: String(x.t.id || x.t.name), name: x.t.name }, on = follows(f);
        return `<tr><th scope="row">${teamBtn(x.t, lg)}</th><td class="r num">${x.i}</td><td class="r num">${x.o}</td><td class="r num"><b>${net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net)}</b></td>
          <td class="r"><button type="button" class="ib${on ? ' solid' : ''}" data-twfollow="${esc(JSON.stringify(f))}" aria-pressed="${on}" aria-label="${on ? 'Stop following' : 'Follow'} ${esc(x.t.name)}" title="${on ? 'Following' : 'Follow'}">${ic(on ? 'check' : 'bell', 18)}</button></td></tr>` }).join('')}</tbody></table></div></section>`;
  }
  const keyDateLine = st => st.next ? `Next key date: ${st.next.label}, ${longDay(st.next.day)} (${count(daysTo(st.next.day))}).` : 'No key dates have been entered for this league yet.';
  function draw() {
    const el = $('pg-transfers'); if (!el) return;
    const l = LG[T.lg], d = T.data[T.lg], st = status(T.lg), items = d?.items || null, loading = !d || (!d.at && d.promise);
    const kinds = items ? [...new Set(items.map(x => x.type))] : [], type = kinds.includes(T.type) ? T.type : 'all', list = items ? items.filter(x => type === 'all' || x.type === type) : [];
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
    el.innerHTML = `<header class="pg-head"><h1 class="pg-title" tabindex="-1">Transfer window</h1><p class="pg-sub">Trades, signings and the portal, league by league.</p></header>
      <div class="tw-tabs"><div class="cx-row scroll" role="radiogroup" aria-label="League">${LEAGUES.map(x => `<button type="button" class="cx" role="radio" aria-checked="${x.k === T.lg}" tabindex="${x.k === T.lg ? 0 : -1}" data-twlg="${x.k}">${esc(x.name)}</button>`).join('')}</div>
        <span class="lb">${l.college ? 'College tabs show the transfer portal' : l.src ? `Moves from ${esc(l.src)}` : ''}</span></div>
      ${banner(l, d, st)}${datesAdmin(l, st)}
      <div class="tw-cols${side ? '' : ' one'}"><section class="card tw-latest" aria-label="Latest moves"><div class="sec-h"><h2>Latest moves</h2>${chips}</div>${moves}</section>${side ? `<aside class="vst tw-side">${side}</aside>` : ''}</div>`;
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
    const t = ev.target.closest('[data-twlg],[data-twtype],[data-twopen],[data-twmore],[data-twfollow],[data-twteam],[data-twplayer],[data-twretry],[data-twmarket],[data-twdrm]'); if (!t) return;
    const d = t.dataset, keep = sel => requestAnimationFrame(() => document.querySelector(sel)?.focus());
    if (d.twlg) { T.lg = d.twlg; T.type = 'all'; T.show = 30; T.msg = ''; T.dateMsg = ''; store.set('fl.tw.league', T.lg); draw(); refresh(); return keep(`[data-twlg="${T.lg}"]`) }
    if (d.twtype) { T.type = d.twtype; T.show = 30; draw(); return keep(`[data-twtype="${T.type}"]`) }
    if (d.twopen) { T.open.has(d.twopen) ? T.open.delete(d.twopen) : T.open.add(d.twopen); draw(); return keep(`[data-twopen="${CSS.escape(d.twopen)}"]`) }
    if ('twmore' in d) { T.show += 30; return draw() }
    if ('twretry' in d) { T.data[T.lg] = null; draw(); return refresh(true) }
    if ('twmarket' in d) { leaveTo('soccer'); return setTimeout(() => typeof openMarket === 'function' && openMarket(), 60) }
    if (d.twfollow) { let f; try { f = JSON.parse(d.twfollow) } catch (e) { return } toggleFollow(f); if (window.flPages?.current?.() === 'transfers') { draw(); keep(`[data-twfollow='${CSS.escape(d.twfollow)}']`) } return }
    if (d.twteam) { try { openTeamOf(JSON.parse(d.twteam)) } catch (e) {} return }
    if (d.twplayer) { try { openPlayerOf(JSON.parse(d.twplayer)) } catch (e) {} return }
    if (d.twdrm) { T.dateOpen = true; post('/api/admin/transfers/dates', { op: 'remove', id: d.twdrm }).then(r => { T.dates = r.dates || []; T.dateMsg = 'Removed.' }).catch(e => { T.dateMsg = e.message }).then(draw) }
  });
  document.addEventListener('submit', ev => { const f = ev.target.closest('[data-twdform]'); if (!f) return; ev.preventDefault(); T.dateOpen = true;
    post('/api/admin/transfers/dates', { op: 'add', league: T.lg, label: f.label.value, start: f.start.value, end: f.end.value }).then(r => { T.dates = r.dates || []; T.dateMsg = 'Saved.' }).catch(e => { T.dateMsg = e.message }).then(draw) });

  /* ---------- for Home and the player profile ---------- */
  // the newest moves across the leagues given, already read: [{ lg, league, name, text, when, from, to }]
  async function latest(leagues, n = 3) {
    const res = await Promise.all((leagues && leagues.length ? leagues : ['nba', 'nfl', 'mlb', 'soccer']).filter(k => LG[k]?.src).map(k => load(k)));
    const denied = res.length > 0 && res.every(r => r.error === 'denied');
    return { denied, rows: res.flatMap(r => r.items || []).filter(x => x.type !== 'other').sort((a, b) => b.when - a.when).slice(0, n).map(x => ({ ...x, league: LG[x.lg].name })) };
  }
  // a player's own moves, from the same lists (matched by name where the list gives no id)
  function movesCard(sport, name, id) {
    const lg = { nba: 'nba', nfl: 'nfl', mlb: 'mlb' }[sport]; if (!lg || !name) return '';
    const d = T.data[lg];
    if (!d || (!d.at && !d.promise)) { load(lg).then(r => { if ((r.items || []).some(x => mine(x, name, id)) && typeof renderSheet === 'function' && window.S?.stack?.length) renderSheet() }); return '' }
    const rows = (d.items || []).filter(x => mine(x, name, id)).slice(0, 8); if (!rows.length) return '';
    return `<section class="card pfa tw-pm" aria-label="Moves"><div class="sec-h"><h2>Moves</h2><span class="lb">from ${esc(d.source || LG[lg].src)}, recent weeks</span></div><ol class="tw-tl">${rows.map(x => `<li><span class="pl${x.type === 'trade' ? ' solid' : ''}">${esc(x.label)}</span><span class="rw-t"><b>${esc(x.parts && !x.parts[0]?.player ? x.parts.map(p => p.text).join(' ') : x.details)}</b><small>${esc(x.when.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }))}</small></span></li>`).join('')}</ol></section>`;
  }
  const mine = (x, name, id) => { const k = norm(name); return (id && x.player?.id && String(x.player.id) === String(id)) || norm(x.player?.name) === k || (x.parts || []).some(p => (p.player && (norm(p.player.name) === k || (id && String(p.player.id) === String(id)))) || (p.text && norm(p.text).includes(k))) };

  window.flPages?.add('transfers', { title: 'Transfer window', render, onShow() { if (Date.now() - (T.data[T.lg]?.at || 0) > TTL) refresh() } });
  window.flTransfers = { latest, movesCard, LEAGUES, status, _read: { fromEspn, fromMlb, fromSoccer } };
})();
