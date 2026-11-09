/* Floodlight · prediction filters
   One filter bar for every Predictions page (soccer, football, basketball, baseball, hockey): category, league,
   confidence, start time, value against the market, my teams, and sort order. Each sport turns its predictions into
   items { e, id, lg, lgName, cat, date, live, conf, top, edge, fav } and calls PFX.apply / PFX.bar.
   Loaded after the main app script and before the sport files. */
const PFX = {
  hooks: {},
  base: () => ({ cat: 'all', lg: 'all', conf: 'all', when: 'all', value: false, fav: false, sort: 'conf' }),
  get(sport){ return this.cur?.[sport] || ((this.cur ||= {})[sport] = { ...this.base(), ...store.get('fl.pf.' + sport, {}) }) },
  set(sport, k, v){ const f = this.get(sport); f[k] = v; if (k === 'cat') f.lg = 'all'; store.set('fl.pf.' + sport, f) },
  reset(sport){ this.cur[sport] = this.base(); store.set('fl.pf.' + sport, this.cur[sport]) },
  on(sport, fn){ this.hooks[sport] = fn },
  active(f){ return f.cat !== 'all' || f.lg !== 'all' || f.conf !== 'all' || f.when !== 'all' || f.value || f.fav },
  whenOk(it, w){
    if (w === 'all') return true;
    if (w === 'live') return it.live;
    const t = +it.date, now = Date.now(), d = new Date(); d.setHours(0, 0, 0, 0);
    const day0 = +d, day1 = day0 + 864e5, day2 = day1 + 864e5;
    if (w === '3h') return !it.live && t >= now - 6e5 && t <= now + 3 * 36e5;
    if (w === 'today') return t >= day0 && t < day1;
    if (w === 'tomorrow') return t >= day1 && t < day2;
    if (w === 'later') return t >= day2;
    return true;
  },
  // every filter except `skip`, so each chip can show how many it would leave
  pass(it, f, skip){
    return (skip === 'cat' || f.cat === 'all' || it.cat === f.cat) && (skip === 'cat' || skip === 'lg' || f.lg === 'all' || it.lg === f.lg)
      && (skip === 'conf' || f.conf === 'all' || it.conf === f.conf) && (skip === 'when' || this.whenOk(it, f.when))
      && (skip === 'value' || !f.value || (it.edge != null && Math.abs(it.edge) >= .05)) && (skip === 'fav' || !f.fav || it.fav);
  },
  apply(sport, items){
    const f = this.get(sport);
    const out = items.filter(it => this.pass(it, f));
    if (f.sort === 'time') out.sort((a, b) => (b.live - a.live) || a.date - b.date);
    else if (f.sort === 'edge') out.sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0) || b.top - a.top);
    else if (f.sort === 'league') out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.lgName).localeCompare(String(b.lgName)) || a.date - b.date);
    else out.sort((a, b) => b.top - a.top);
    return out;
  },
  // cats: [[key, label]] in display order; only categories with games show up
  bar(sport, items, cats){
    if (!items.length && !this.active(this.get(sport))) return '';
    const f = this.get(sport), n = skip => it => this.pass(it, f, skip);
    const chip = (k, v, label, count, on) => `<button class="qf" data-pfx="${sport}" data-k="${k}" data-v="${esc(String(v))}" aria-pressed="${on}">${label}${count != null ? ` <small class="pfx-n">${count}</small>` : ''}</button>`;
    const byCat = items.filter(n('cat'));
    const catChips = (cats || []).map(([k, l]) => [k, l, byCat.filter(it => it.cat === k).length]).filter(([k, , c]) => c || f.cat === k);
    const inCat = items.filter(it => f.cat === 'all' || it.cat === f.cat).filter(n('lg'));
    const lgs = [...new Map(inCat.map(it => [it.lg, it.lgName])).entries()].map(([k, l]) => [k, l, inCat.filter(it => it.lg === k).length]);
    const confs = [['Strong', 'Strong'], ['Lean', 'Lean'], ['Toss-up', 'Toss-up']].map(([k, l]) => [k, l, items.filter(n('conf')).filter(it => it.conf === k).length]);
    const whens = [['live', 'Live'], ['3h', 'Next 3 hours'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['later', 'Later']].map(([k, l]) => [k, l, items.filter(n('when')).filter(it => this.whenOk(it, k)).length]).filter(([k, , c]) => c || f.when === k);
    const valueN = items.filter(n('value')).filter(it => it.edge != null && Math.abs(it.edge) >= .05).length, hasMarket = items.some(it => it.edge != null);
    const favN = items.filter(n('fav')).filter(it => it.fav).length, hasFav = items.some(it => it.fav) || f.fav;
    const shown = items.filter(it => this.pass(it, f)).length;
    return `<div class="pfx" role="group" aria-label="Filter predictions">
      ${catChips.length > 1 || f.cat !== 'all' ? `<div class="quick pfx-row">${chip('cat', 'all', 'All', byCat.length, f.cat === 'all')}${catChips.map(([k, l, c]) => chip('cat', k, esc(l), c, f.cat === k)).join('')}</div>` : ''}
      <div class="pfx-grid">
        <div class="pfx-seg"><span class="pfx-lab">Confidence</span>${chip('conf', 'all', 'All', null, f.conf === 'all')}${confs.map(([k, l, c]) => chip('conf', k, l, c, f.conf === k)).join('')}</div>
        ${whens.length ? `<div class="pfx-seg"><span class="pfx-lab">When</span>${chip('when', 'all', 'Any time', null, f.when === 'all')}${whens.map(([k, l, c]) => chip('when', k, l, c, f.when === k)).join('')}</div>` : ''}
        <div class="pfx-seg">${lgs.length > 1 || f.lg !== 'all' ? `<label class="pfx-sel"><span class="pfx-lab">League</span><select data-pfxsel="${sport}" data-k="lg"><option value="all">All ${lgs.length} leagues</option>${lgs.sort((a, b) => b[2] - a[2]).map(([k, l, c]) => `<option value="${esc(k)}" ${f.lg === k ? 'selected' : ''}>${esc(l)} (${c})</option>`).join('')}</select></label>` : ''}
          ${hasMarket ? chip('value', !f.value, 'Value vs market', valueN, f.value) : ''}${hasFav ? chip('fav', !f.fav, '★ My teams', favN, f.fav) : ''}
          <label class="pfx-sel"><span class="pfx-lab">Sort</span><select data-pfxsel="${sport}" data-k="sort">${[['conf', 'Most confident'], ['time', 'Start time'], ['edge', 'Biggest model vs market gap'], ['league', 'League']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      </div>
      <div class="pfx-foot"><span>Showing <b>${shown}</b> of ${items.length}</span>${this.active(f) ? `<button class="linkbtn" data-pfx="${sport}" data-k="_reset" data-v="1">Clear filters</button>` : ''}${f.value ? `<span class="pfx-hint">Games where our model and the market disagree by 5 points or more.</span>` : ''}</div></div>`;
  },
  empty(sport, total){ return total && this.active(this.get(sport)) ? `<div class="empty-state"><strong>No predictions match these filters</strong><button class="btn ghost" data-pfx="${sport}" data-k="_reset" data-v="1" style="margin-top:10px">Clear filters</button></div>` : '' },
  confOf: top => top >= .72 ? 'Strong' : top >= .6 ? 'Lean' : 'Toss-up',
};
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-pfx]'); if (!t) return;
  ev.stopPropagation();
  const sp = t.dataset.pfx, k = t.dataset.k, raw = t.dataset.v;
  if (k === '_reset') PFX.reset(sp); else PFX.set(sp, k, raw === 'true' ? true : raw === 'false' ? false : raw);
  PFX.hooks[sp]?.();
}, true);
document.addEventListener('change', ev => {
  const t = ev.target.closest('[data-pfxsel]'); if (!t) return;
  PFX.set(t.dataset.pfxsel, t.dataset.k, t.value); PFX.hooks[t.dataset.pfxsel]?.();
});
document.head.insertAdjacentHTML('beforeend', `<style>
.pfx{border:1px solid var(--line);border-radius:14px;padding:10px 12px 8px;margin:0 0 14px;background:var(--surface)}
.pfx .pfx-row{margin:0 0 8px}
.pfx .qf{min-height:30px;padding:0 11px;font-size:12.5px}
.pfx-n{font:600 10.5px/1 var(--f-mono);opacity:.65;margin-left:2px}
.pfx-grid{display:flex;flex-direction:column;gap:6px}
.pfx-seg{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.pfx-lab{font:600 10.5px/1 var(--f-body);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-right:2px}
.pfx-sel{display:inline-flex;align-items:center;gap:6px}
.pfx-sel select{min-height:30px;padding:0 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:600 12.5px/1 var(--f-body);max-width:220px}
.pfx-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:8px;font-size:12px;color:var(--muted)}
.pfx-foot b{color:var(--fg)}
.pfx-hint{width:100%}
.pred-card .pfx-lg{display:block;font:600 10px/1.2 var(--f-body);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfx-edge{font:600 10.5px/1 var(--f-mono);color:var(--accent);margin-top:3px}
@media (max-width:620px){ .pfx{padding:8px 10px} .pfx-seg{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none} .pfx-seg::-webkit-scrollbar{display:none} .pfx .qf,.pfx-sel{flex:none} }
</style>`);
PFX.on('soccer', () => { if (typeof renderPicks === 'function') renderPicks() });
