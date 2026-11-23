/* Floodlight · what you looked at last, so Home's "Continue researching" can take you back to it.
   Pages call flRecent.note(item) when someone settles on a view: a player or team in the Lab, two players in Compare,
   a trend, a prediction's evidence, a parlay draft, a game, a set of filters. An item says what it is and how to reopen it:
     { kind: 'player'|'team'|'compare'|'trend'|'pred'|'parlay'|'game'|'filters'|'props'|'note',
       key: one string per exact view, label, sub, photo, photo2,
       open: { lab } | { compare } | { trend } | { game: { sport, lg, id } } | { parlay: true } | { page, ...args } }
   The same key replaces the older entry. Pinned items stay at the top and are never pushed out. History is kept in this
   browser only (40 items) and can be cleared from Home. flRecent.open(item) is also how saved boards reopen things. */
(() => {
  const KEY = 'fl.recentItems', MAX = 40;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} } };
  const KINDS = ['player', 'team', 'compare', 'trend', 'pred', 'parlay', 'game', 'filters', 'props', 'note'];
  const ok = x => x && typeof x === 'object' && KINDS.includes(x.kind) && typeof x.key === 'string' && x.key && typeof x.label === 'string' && x.label;
  let R = (store.get(KEY, []) || []).filter(ok);
  const save = () => { store.set(KEY, R); document.dispatchEvent(new CustomEvent('fl:recent')) };
  let quiet = 0;
  function note(item) {
    if (!ok(item) || store.get('fl.recentOff', false)) return;
    const old = R.find(x => x.key === item.key), clean = { kind: item.kind, key: item.key.slice(0, 200), label: item.label.slice(0, 120), sub: String(item.sub || '').slice(0, 140),
      photo: item.photo || '', photo2: item.photo2 || '', open: item.open || null, at: Date.now(), ...(old?.pinned ? { pinned: true } : {}) };
    // a parlay draft, a set of filters: one of each kind is enough
    const single = ['parlay', 'filters'].includes(item.kind) ? x => x.kind === item.kind && x.key.split(':')[0] === item.key.split(':')[0] : () => false;
    R = [clean, ...R.filter(x => x.key !== item.key && !single(x))];
    const pinned = R.filter(x => x.pinned), rest = R.filter(x => !x.pinned).slice(0, Math.max(0, MAX - pinned.length));
    R = R.filter(x => x.pinned || rest.includes(x));
    clearTimeout(quiet); quiet = setTimeout(save, 150);   // a view that settles in steps (two players loading) is written once
  }
  const drop = key => { if (!R.some(x => x.key === key)) return; R = R.filter(x => x.key !== key); save() };
  const pin = (key, on) => { const x = R.find(y => y.key === key); if (!x) return; if (on ?? !x.pinned) x.pinned = true; else delete x.pinned; save(); return !!x.pinned };
  const clear = () => { R = R.filter(x => x.pinned); save() };
  const list = () => [...R].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at);

  // the words a card leads with, by kind
  const verb = x => ({ compare: 'Continue comparing', trend: 'Reopen', pred: 'Reopen', parlay: '', game: 'Back to', player: 'Back to', team: 'Back to', filters: 'Reapply', props: 'Back to', note: '' })[x.kind] || 'Reopen';

  /* reopening anything an item describes */
  const wait = async (sel, ms = 6000) => { for (let t = 0; t < ms; t += 150) { const el = document.querySelector(sel); if (el) return el; await new Promise(r => setTimeout(r, 150)) } return null };
  async function open(item) {
    const o = item?.open || {};
    window.flHub?.hide?.();
    if (o.lab) return window.flLab?.open?.(o.lab);
    if (o.compare) return window.flLab?.compare?.(o.compare);
    if (o.trend) return window.flLab?.open?.({ ...o.trend, kind: 'player', mode: 'trend' });
    if (o.parlay) { if (window.flParlays?.openDraft) return window.flParlays.openDraft(); return window.flPages?.show?.('parlays') }
    if (o.game) {   // a game: the hub's opener knows every sport's page
      window.flHub?.show?.(); const g = o.game;
      const b = document.createElement('button'); b.hidden = true; b.dataset.hub = `${g.sport}|${g.lg || ''}|${g.id}`; document.getElementById('hub')?.appendChild(b); b.click(); b.remove(); return }
    if (o.page) {
      window.flPages?.show?.(o.page);
      if (o.page === 'predictions' && o.pick) { const c = await wait(`#pg-predictions [data-pdk="${CSS.escape(o.pick)}"]`); if (c) { if (!c.querySelector('.pd-ev')) c.querySelector('.pd-open')?.click(); c.scrollIntoView({ block: 'center' }); c.querySelector('.pd-open')?.focus({ preventScroll: true }) } else window.toast?.('That pick is no longer on the board.') }
      if (o.page === 'predictions' && o.filters?.sport) (await wait(`#pg-predictions [data-pdsport="${CSS.escape(o.filters.sport)}"]`))?.click();
      if (o.page === 'transfers' && o.move) window.flTransfers?.openMove?.(o.move);
      return;
    }
  }
  window.flRecent = { note, drop, pin, clear, list, open, verb, KINDS };

  // the older lists Home and the Lab kept are folded in once, so the first visit after this change isn't empty
  if (!store.get('fl.recentMoved', false)) {
    try {
      for (const r of (store.get('fl.labRecent', []) || []).slice(0, 6).reverse()) { const a = r.args || {}; if (!r.label) continue;
        R.unshift({ kind: a.team ? 'team' : 'player', key: `${a.team ? 'team' : 'player'}:${a.sport || ''}:${r.label}`, label: r.label, sub: 'In the Lab', open: { lab: { sport: a.sport, name: a.name || r.label, kind: a.team ? 'team' : 'player' } }, at: r.at || Date.now() }) }
      for (const g of (store.get('fl.recentGames', []) || []).slice(0, 4).reverse()) if (g.key && g.a) R.unshift({ kind: 'game', key: 'game:' + g.key, label: `${g.a} v ${g.b}`, sub: '', open: { game: { sport: g.sport, lg: '', id: g.id } }, at: g.at || Date.now() });
      R = R.filter(ok).sort((a, b) => b.at - a.at).slice(0, MAX); store.set(KEY, R);
    } catch (e) {}
    store.set('fl.recentMoved', true);
  }
})();
