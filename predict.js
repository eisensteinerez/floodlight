/* Floodlight · the prediction panel. One layout shared by every sport:
   the verdict with a confidence ring, a win-probability bar in the two team colours, the predicted score as a scoreboard,
   your own pick with what everyone else picked, and the key factors as cards.
   A sport hands over plain facts and gets the markup back. The <fl-pred> element plays the entrance once per game,
   counts the numbers up and fills in the community split. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = p => Math.round((p || 0) * 100);
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches || document.documentElement.dataset.motion === 'reduce';
  const ICO = {
    table: '<path d="M4 6h16M4 12h16M4 18h10"/>', goals: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 3-1.500 4.500h-5L8 10.500z"/>', form: '<path d="M3 17l5-5 4 3 8-9"/><path d="M15 6h5v5"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', squad: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.6-3.600 3-5.500 6-5.500s5.400 1.900 6 5.500M16 5.200a3 3 0 0 1 0 5.600M21 20c-.3-2.600-1.500-4.300-3.300-5"/>',
    market: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', rest: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', star: '<path d="M12 3l2.700 5.800 6.300.800-4.600 4.300 1.200 6.100L12 17l-5.600 3 1.200-6.100L3 9.600l6.300-.8z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>' };
  const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k] || ICO.info}</svg>`;
  const CHECK = '<svg class="pr-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>';

  /* ---------- what everyone picked ---------- */
  const splits = new Map();                // key -> { home, draw, away, n }
  const asked = new Map();
  let off = false;                         // no server behind the page (or not signed in): leave the split out quietly
  function load(key) {
    if (off || !key || Date.now() - (asked.get(key) || 0) < 30000) return; asked.set(key, Date.now());
    fetch('/api/picks/split?keys=' + encodeURIComponent(key), { credentials: 'same-origin' }).then(r => { if (!r.ok) throw r.status; return r.json() })
      .then(d => { if (d.splits?.[key]) { splits.set(key, d.splits[key]); paint(key) } }).catch(() => { off = true });
  }
  function vote(key, pick) {
    if (off || !key) return;
    fetch('/api/picks/vote', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, pick }) })
      .then(r => { if (!r.ok) throw r.status; return r.json() }).then(d => { if (d.split) { splits.set(key, d.split); paint(key) } }).catch(() => {});
  }
  function splitHTML(key, sides) {
    const s = splits.get(key); if (!s || !s.n) return '';
    return `<div class="pr-split-h"><span>Community</span><small class="num">${s.n} pick${s.n === 1 ? '' : 's'}</small></div>
      <div class="pr-split-bar">${sides.map(([k, , col]) => s[k] ? `<i style="flex:${s[k]};background:${col}"></i>` : '').join('')}</div>
      <div class="pr-split-l">${sides.map(([k, nm]) => `<span><b class="num">${pc(s[k] / s.n)}%</b> ${esc(nm)}</span>`).join('')}</div>`;
  }
  function paint(key) { document.querySelectorAll('fl-pred').forEach(el => { if (el.dataset.k === key) { const box = el.querySelector('.pr-split'); if (box) box.innerHTML = splitHTML(key, el._sides || []) } }) }

  /* a tap on a pick button also counts as a vote; the sport's own handler still saves the pick as before */
  let justPicked = null;
  document.addEventListener('click', ev => { const b = ev.target.closest?.('.pr-pick[data-vote]'); if (!b) return;
    const on = b.getAttribute('aria-pressed') === 'true'; justPicked = on ? null : b.dataset.vote + '|' + b.dataset.side; vote(b.dataset.vote, on ? '' : b.dataset.side) }, true);

  /* ---------- markup ---------- */
  /* o = { key, home:{name,short,logo,col}, away:{…}, probs:{home,draw?,away}, pick:'home'|'draw'|'away', pickLabel, line, conf:'Strong'|'Lean'|'Toss-up', tag,
           score:[h,a], scoreNote, extra:[{v,l}], factors:[{ico,title,text,side}], my, final:{actual, text}, pickAttr: side => 'data-…', hint } */
  window.flPred = function (o) {
    const three = o.probs.draw != null, sides = [['home', o.home.short || o.home.name, o.home.col || 'var(--muted)']].concat(three ? [['draw', 'Draw', 'var(--line-2)']] : [], [['away', o.away.short || o.away.name, o.away.col || 'var(--muted)']]);
    const top = o.probs[o.pick] || 0, C = 2 * Math.PI * 34, post = !!o.final;
    const lvl = o.conf === 'Strong' ? 'hi' : o.conf === 'Lean' ? 'mid' : 'lo';
    const crest = t => t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '';
    const bar = `<div class="pr-prob"><div class="pr-prob-l">${sides.map(([k, nm]) => `<span class="${k}${o.pick === k ? ' on' : ''}">${k === 'draw' ? '' : crest(o[k])}<small>${esc(nm)}</small><b class="num"><i data-n="${pc(o.probs[k])}">${pc(o.probs[k])}</i>%</b></span>`).join('')}</div>
      <div class="pr-prob-bar" role="img" aria-label="${esc(sides.map(([k, nm]) => `${nm} ${pc(o.probs[k])} percent`).join(', '))}"><span class="pr-prob-in">${sides.map(([k, , col]) => `<i class="${k}" style="flex:${Math.max(.02, o.probs[k])};background:${col}"></i>`).join('')}</span></div></div>`;
    const board = o.score ? `<div class="pr-card pr-score"><small class="pr-k">${post ? 'We predicted' : 'Predicted score'}</small>
        <div class="pr-sb"><span>${crest(o.home)}<em>${esc(o.home.short || o.home.name)}</em></span><b class="num"><i data-n="${+o.score[0]}">${esc(o.score[0])}</i><u>:</u><i data-n="${+o.score[1]}">${esc(o.score[1])}</i></b><span>${crest(o.away)}<em>${esc(o.away.short || o.away.name)}</em></span></div>
        ${o.scoreNote ? `<p class="pr-note">${esc(o.scoreNote)}</p>` : ''}${o.extra?.length ? `<div class="pr-x">${o.extra.map(x => `<span><b class="num">${esc(x.v)}</b>${esc(x.l)}</span>`).join('')}</div>` : ''}</div>` : '';
    const picks = `<div class="pr-card pr-you"><small class="pr-k">${post ? 'Your pick' : 'Make your pick'}</small>
        <div class="pr-picks${three ? ' three' : ''}">${sides.map(([k, nm, col]) => { const mine = o.my === k, hit = post && o.final.actual === k;
          const inner = `${k === 'draw' ? '<u>=</u>' : crest(o[k])}<span>${esc(nm)}</span>${mine ? CHECK : ''}`;
          return post ? `<div class="pr-pick${mine ? ' mine' : ''}${hit ? ' hit' : ''}" data-side="${k}" style="--c:${col}">${inner}</div>`
            : `<button class="pr-pick${mine ? ' mine' : ''}" style="--c:${col}" ${o.pickAttr ? o.pickAttr(k) : ''} data-vote="${esc(o.key || '')}" data-side="${k}" aria-pressed="${mine}" aria-label="${esc(`Pick ${k === 'draw' ? 'a draw' : nm}`)}">${inner}</button>` }).join('')}</div>
        <p class="pr-note">${esc(post ? (o.my ? (o.my === o.final.actual ? 'You called it.' : 'Not this time.') : 'You did not pick this one.') : o.my ? 'Saved. Tap it again to remove.' : o.hint || 'Tap a side to save your pick and track it in your profile.')}</p>
        <div class="pr-split">${splitHTML(o.key, sides)}</div></div>`;
    const factors = o.factors?.length ? `<div class="pr-fh"><h5>Key factors</h5><small>What moved the prediction</small></div>
      <div class="pr-factors">${o.factors.map((f, i) => `<div class="pr-f${f.side ? ' ' + f.side : ''}" style="--i:${i};--c:${f.side === 'home' ? o.home.col : f.side === 'away' ? o.away.col : 'var(--line-2)'}"><span class="pr-fi">${ico(f.ico)}</span><div><b>${esc(f.title)}</b><p>${esc(f.text)}</p></div></div>`).join('')}</div>` : '';
    return `<fl-pred class="pr" data-k="${esc(o.key || '')}" style="--hc:${o.home.col || 'var(--muted)'};--ac:${o.away.col || 'var(--muted)'}">
      <div class="pr-card pr-verdict"><div class="pr-v"><small class="pr-k">${esc(post ? 'Pre-game prediction' : 'Floodlight prediction')}${o.tag || ''}</small>
          <h4>${esc(o.pickLabel)}</h4>${o.line ? `<p>${esc(o.line)}</p>` : ''}${post ? `<span class="pr-out ${o.final.actual === o.pick ? 'ok' : 'miss'}">${o.final.actual === o.pick ? 'Called it' : 'Missed'}${o.final.text ? ' · ' + esc(o.final.text) : ''}</span>` : ''}</div>
        <div class="pr-ring ${lvl}" title="How likely the predicted result is. ${esc(o.conf)} means ${o.conf === 'Strong' ? 'it stands well clear' : o.conf === 'Lean' ? 'a modest edge' : 'it could go any way'}.">
          <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"/><circle class="pr-arc" cx="40" cy="40" r="34" stroke-dasharray="${(top * C).toFixed(1)} ${C.toFixed(1)}" style="--len:${(top * C).toFixed(1)}" transform="rotate(-90 40 40)"/></svg>
          <b class="num"><i data-n="${pc(top)}">${pc(top)}</i><u>%</u></b><span>${esc(o.conf === 'Toss-up' ? 'Toss-up' : o.conf + ' confidence')}</span></div>${bar}</div>
      <div class="pr-row">${board}${picks}</div>${factors}</fl-pred>`;
  };
  window.flPred.ico = ico;

  /* ---------- the element ---------- */
  const played = new Set();
  customElements.define('fl-pred', class extends HTMLElement {
    connectedCallback() {
      const k = this.dataset.k || '';
      this._sides = [...this.querySelectorAll('.pr-pick')].map(b => [b.dataset.side, b.querySelector('span')?.textContent || '', b.style.getPropertyValue('--c')]).filter(s => s[0]);
      if (justPicked && justPicked.startsWith(k + '|')) { this.querySelector(`.pr-pick[data-side="${justPicked.slice(k.length + 1)}"]`)?.classList.add('now'); justPicked = null }
      load(k);
      if (played.has(k) || still()) return; played.add(k);
      this.classList.add('fresh'); setTimeout(() => this.classList.remove('fresh'), 1600);
      // count the numbers up alongside the bar
      const els = [...this.querySelectorAll('[data-n]')], t0 = performance.now(), D = 800;
      const step = t => { const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3); for (const el of els) el.textContent = Math.round(+el.dataset.n * e); if (p < 1 && this.isConnected) requestAnimationFrame(step); else for (const el of els) el.textContent = el.dataset.n };
      requestAnimationFrame(step);
    }
  });
})();
