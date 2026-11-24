/* Floodlight · Owner dashboard (#/owner): how the business and the product are doing, and the support inbox.
   GET /api/admin/owner (owner only, ownerstats.py) gives users, money (once paid plans keep plan fields on accounts),
   usage, the customer journey, retention and cancellation reasons. GET /api/admin/support (owners and admins) is the
   inbox. GET /api/admin/monitor (the verified market feed's data checks) is shown when the server has it.
   Admins who aren't owners see the inbox only. Every chart here has its numbers written beside it. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => { try { return S.me } catch { return null } };
  const isOwner = () => { const u = me(); return !!u && (u.rank === 'owner') || (!u && window.FL_GATED === false) };
  const isStaff = () => { const u = me(); return isOwner() || (!!u && (u.role === 'admin' || u.rank === 'admin')) };
  const O = { days: 30, d: null, err: '', sup: null, supErr: '', mon: undefined, filter: 'open', open: new Set(), busy: false };
  const n = v => v == null ? '–' : new Intl.NumberFormat().format(v);
  const pc = v => v == null ? '–' : `${v}%`;
  const usd = v => v == null ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);
  const when = t => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function get(u) { const r = await fetch(u, { credentials: 'same-origin', cache: 'no-store' }); const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.error || `The server answered ${r.status}.`); e.status = r.status; throw e } return d }
  async function post(u, body) { const r = await fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `The server answered ${r.status}.`); return d }

  const tile = (label, value, sub = '') => `<div class="tile ow-t"><span class="lb">${label}</span><b class="fig num">${value}</b>${sub ? `<small class="lb">${sub}</small>` : ''}</div>`;
  // a ranked list drawn as bars: one series in the accent, the number written at the end of each bar
  const bars = (rows, label) => rows.length ? `<ol class="ow-bars" aria-label="${esc(label)}">${rows.map(([k, v], i, a) => { const max = Math.max(...a.map(r => r[1]), 1); return `<li><span class="ow-bk">${esc(k)}</span><span class="ow-bt"><i style="width:${Math.max(2, v / max * 100).toFixed(1)}%"></i></span><b class="num">${n(v)}</b></li>` }).join('')}</ol>` : '<p class="lb">Nothing counted yet in this window.</p>';

  function business(b, names = {}) {
    const u = b.users, m = b.money, pn = k => { const t = /_trial$/.test(k), id = k.replace(/_trial$/, ''); return `${names.plans?.[id] || id}${t ? ', on trial' : ''}` };
    return `<section class="ow-sec" aria-labelledby="owBizH"><h2 id="owBizH">People</h2>
      <div class="ow-tiles">${tile('Total accounts', n(u.total))}${tile('Active in 30 days', n(u.mau), `${n(u.wau)} this week, ${n(u.dau)} today`)}${tile('New in 30 days', n(u.new30), `${n(u.new7)} in the last 7 days`)}</div></section>
      <section class="ow-sec" aria-labelledby="owMoneyH"><h2 id="owMoneyH">Revenue</h2>
      ${m ? `<div class="ow-tiles">${tile('Monthly recurring revenue', usd(m.mrr))}${tile('Annual recurring revenue', usd(m.arr))}${tile('Paying members', n(m.paid), m.pastDue ? `${n(m.pastDue)} with a failed payment` : '')}${tile('On a free trial', n(m.trial))}
          ${tile('Conversion to paid', pc(m.conversion), 'Paying members out of all accounts')}${tile('Trial to paid', pc(m.trialToPaid), 'Finished trials that became paid')}${tile('Churn, 30 days', pc(m.churn), `${n(m.cancellations30)} cancellations`)}${tile('Revenue per paying member', usd(m.arppu), 'A month')}${tile('Revenue per active member', usd(m.arpu), 'A month, across accounts active in 30 days')}
          ${tile('Failed payments, 30 days', n(m.failedPayments30 || 0), m.pastDue ? `${n(m.pastDue)} still in the grace period` : '')}${tile('Refunds, 30 days', usd(m.refunded30 || 0), `${n(m.refunds30 || 0)} refund${m.refunds30 === 1 ? '' : 's'}`)}${tile('Open disputes', n(m.disputesOpen || 0), m.disputesOpen ? 'Answer them in the Stripe dashboard' : '')}</div>
        <div class="card flat ow-mix"><h3>Plan mix</h3>${(m.byPlan || []).length ? bars(m.byPlan.map(([k, v]) => [pn(k), v]), 'Members on each plan') : '<p class="lb">No one is on a paid plan or a trial yet.</p>'}</div>`
        : `<div class="card flat ow-wait"><b>Paid plans aren’t switched on yet</b><p class="lb">Monthly and annual recurring revenue, paying members, trials, conversion, trial-to-paid, churn, revenue per member and the plan mix fill in here as soon as checkout records its first plan. Until then they are left out rather than shown as zeros.</p></div>`}</section>`;
  }
  function journey(g) {
    const f = g.funnel, top = Math.max(f.steps[0]?.count || 0, ...f.steps.map(s => s.count), 1), r = g.retention;
    return `<section class="ow-sec" aria-labelledby="owJH"><h2 id="owJH">Customer journey</h2>
      <p class="lb">${n(f.journeys)} ${f.journeys === 1 ? 'journey' : 'journeys'} started in the last ${f.days} days. A journey is an account, joined with what its browser did before signing up, or a visitor who never made one.</p>
      <ol class="ow-fun">${f.steps.map(s => `<li><span class="ow-fk">${esc(s.label)}</span><span class="ow-bt"><i style="width:${(s.count ? Math.max(1, s.count / top * 100) : 0).toFixed(1)}%"></i></span><b class="num">${n(s.count)}</b><small class="lb num">${f.journeys ? `${Math.round(s.count / f.journeys * 100)}% of journeys` : ''}</small></li>`).join('')}</ol>
      <div class="ow-tiles">${['d1', 'd7', 'd30'].map((k, i) => tile(['Day 1 retention', 'Day 7 retention', 'Day 30 retention'][i], pc(r[k].rate), r[k].cohort ? `${n(r[k].returned)} of ${n(r[k].cohort)} came back${i ? ` in days ${[0, 7, 30][i]} to ${[0, 13, 36][i]}` : ' the next day'}` : 'No accounts old enough yet')).join('')}
        ${(r2 => [['landing', 'Landing page to account', 'saw the landing page'], ['signup', 'Sign-up completion', 'opened the sign-up form'], ['upgrade', 'Upgrade page to trial or paid', 'saw the upgrade page']].map(([k, l, what]) => { const x = r2[k]; return x ? tile(l, pc(x.rate), x.of ? `${n(x.n)} of ${n(x.of)} who ${what}` : `No one ${what} yet`) : '' }).join(''))(f.rates || {})}
        ${tile('Onboarding finished', pc(g.onboarding.rate), `${n(g.onboarding.finished)} of ${n(g.onboarding.signedUp)} new accounts`)}
        ${tile('Time to first useful action', g.firstUseful == null ? '–' : g.firstUseful < 60 ? `${g.firstUseful} min` : `${Math.round(g.firstUseful / 6) / 10} h`, 'Median, from sign-up to a first search, player, follow or board')}</div></section>`;
  }
  function usage(p, g, names = {}) {
    const u = p.usage, s = p.saved, max = Math.max(1, ...u.series.map(x => x.searches));
    const emptyRate = u.searches ? Math.round(u.searchEmpty / u.searches * 100) : null;
    return `<section class="ow-sec" aria-labelledby="owUH"><h2 id="owUH">Product use</h2>
      <div class="ow-tiles">${tile('Lab searches', n(u.searches), `${n(u.searchEmpty)} empty${emptyRate != null ? ` (${emptyRate}%)` : ''}, ${n(u.searchFailed)} failed`)}${tile('Players opened', n(u.playersOpened))}${tile('Boards saved', n(u.boardsSaved), `${n(s.boards)} boards kept now`)}
        ${tile('Predictions followed', n(u.predictionsFollowed), `${n(s.follows)} follows kept now`)}${tile('Alerts created', n(u.alertsCreated))}${tile('Prediction cards', n(u.cardsCreated), `${n(s.cards)} parlays kept now`)}${tile('Upgrade page views', n(u.upgradeViews))}${tile('Plus features Free members tried', n(u.gates || 0), 'Each feature counted once per visit')}${tile('Support tickets', n(u.tickets))}</div>
      <figure class="card flat ow-chart"><figcaption><b>Lab searches a day</b><span class="lb">Last ${u.series.length} days, most recent on the right. Peak ${n(max === 1 && !u.searches ? 0 : max)}.</span></figcaption>
        <div class="ow-cols" role="img" aria-label="Lab searches a day: ${esc(u.series.map(x => `${x.day} ${x.searches}`).join(', '))}">${u.series.map(x => `<span class="ow-col" title="${esc(x.day)}: ${x.searches} searches, ${x.players} players opened"><i style="height:${(x.searches / max * 100).toFixed(1)}%"></i></span>`).join('')}</div></figure>
      <div class="ow-two">
        <div class="card flat"><h3>Most viewed players</h3>${bars(u.topPlayers.map(([k, v]) => [(m => m ? `${m[2]} (${m[1].toUpperCase()})` : k)(/^([a-z]+):(.+)$/.exec(k)), v]), 'Most viewed players')}</div>
        <div class="card flat"><h3>Most used sports</h3>${bars(u.topSports.map(([k, v]) => [k.toUpperCase(), v]), 'Most used sports')}</div>
        <div class="card flat"><h3>Which Plus features Free members tried</h3>${(u.topGates || []).length ? bars(u.topGates.map(([k, v]) => [names.features?.[k] || k, v]), 'Which Plus features Free members tried') : '<p class="lb">None yet. This counts only while Free plan limits are on.</p>'}</div>
        <div class="card flat"><h3>Most used paid feature</h3>${g.paidFeature.length ? bars(g.paidFeature, 'Most used paid feature') : '<p class="lb">Shows once members are on a paid plan.</p>'}</div>
        <div class="card flat"><h3>Slow pages</h3>${u.slowPages.length ? `<table class="tbx"><thead><tr><th scope="col">Page</th><th scope="col">Device</th><th scope="col" class="r">Slow loads</th></tr></thead><tbody>${u.slowPages.map(r => `<tr><td>${esc(r.page)}</td><td>${esc(r.device)}</td><td class="r num">${n(r.count)}</td></tr>`).join('')}</tbody></table><p class="lb">A slow load is main content taking over 2.5 seconds to appear.</p>` : '<p class="lb">No page took longer than 2.5 seconds to show its main content.</p>'}</div>
      </div></section>`;
  }
  function cancels(c) {
    return `<section class="ow-sec" aria-labelledby="owCH"><h2 id="owCH">Why people cancel</h2>
      ${c.total ? `<p class="lb">${n(c.total)} cancellation${c.total === 1 ? '' : 's'} in the last ${c.days} days.</p>${bars(c.reasons.filter(r => r.count).map(r => [r.label, r.count]), 'Cancellation reasons')}
        ${c.notes.length ? `<ul class="ow-notes">${c.notes.map(x => `<li><b>${esc(x.label)}</b><span>${esc(x.note)}</span><small class="lb">${when(x.at)}</small></li>`).join('')}</ul>` : ''}`
        : '<p class="lb">No cancellations recorded yet. When members cancel, the reason they pick shows here: too expensive, data was inaccurate, didn’t use it enough, missing sport or provider, hard to understand, technical problems, or other.</p>'}</section>`;
  }
  function monitor() {
    const m = O.mon;
    if (m === undefined) return '';
    if (!m) return `<section class="ow-sec" aria-labelledby="owMH"><h2 id="owMH">Data checks</h2><p class="lb">The market data checks (stale markets, missing event IDs, player and team mismatches, grading failures, source delays, time zones, duplicates, unresolved corrections) appear here once the verified market feed is live. Trust and data has the source health meanwhile.</p><button type="button" class="bt sm ghost" data-page="status">Open Trust and data</button></section>`;
    const bad = (m.checks || []).filter(c => c.n > 0);
    return `<section class="ow-sec" aria-labelledby="owMH"><h2 id="owMH">Data checks</h2>
      <p class="lb">${bad.length ? `${bad.length} check${bad.length === 1 ? '' : 's'} need a look.` : 'Every check passed.'}${m.at ? ` Checked ${when(m.at > 1e12 ? m.at / 1000 : m.at)}.` : ''}</p>
      <ul class="ow-checks">${(m.checks || []).map(c => `<li class="${c.n > 0 ? 'bad' : 'ok'}"><span class="ow-ck" aria-hidden="true">${c.n > 0 ? '!' : '✓'}</span><span>${esc(c.label)}</span><b class="num">${c.n > 0 ? `${n(c.n)} found` : 'None'}</b></li>`).join('')}</ul></section>`;
  }
  function referrals(r) {
    return `<section class="ow-sec" aria-labelledby="owRH"><h2 id="owRH">Referrals</h2>
      <div class="ow-tiles">${tile('Members with a link', n(r.codes))}${tile('Friends joined', n(r.joined))}${tile('Friends counted', n(r.counting))}${tile('Held back as suspicious', n(r.flagged), 'Same browser, same network or a burst of sign-ups')}</div></section>`;
  }
  /* ---------- the support inbox ---------- */
  function inbox() {
    const s = O.sup;
    if (!s) return `<section class="ow-sec" aria-labelledby="owSH"><h2 id="owSH">Support inbox</h2><p class="lb">${O.supErr ? esc(O.supErr) : 'Loading tickets…'}</p></section>`;
    const list = s.tickets.filter(t => O.filter === 'all' || t.status === O.filter);
    return `<section class="ow-sec" aria-labelledby="owSH"><div class="sec-h"><h2 id="owSH">Support inbox</h2></div>
      <p class="lb">${n(s.counts.open)} waiting for an answer${s.overdue ? `, ${n(s.overdue)} past the promised reply time` : ''}. Data reports and billing are promised within 1 business day, questions and bugs within 2.</p>
      <div class="cx-row" role="radiogroup" aria-label="Show tickets">${[['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button type="button" class="cx sm" role="radio" aria-checked="${O.filter === k}" data-ow-filter="${k}">${l} ${k === 'all' ? '' : `<span class="num">${n(s.counts[k])}</span>`}</button>`).join('')}</div>
      ${list.length ? `<ul class="ow-inbox">${list.map(t => { const open = O.open.has(t.id); return `<li><button type="button" class="rw" data-ow-t="${esc(t.id)}" aria-expanded="${open}" aria-controls="owt-${esc(t.id)}">
          <span class="rw-t"><b>${esc(t.subject)}</b><small>${esc(t.id)}, ${esc(t.kindLabel)}, ${esc(t.display || t.user || t.email || 'signed out')}, ${when(t.created)}</small></span><span class="pl${t.status === 'open' ? ' solid' : ''}">${t.status === 'open' ? 'Waiting' : t.status === 'answered' ? 'Answered' : 'Closed'}</span></button>
        <div class="ow-tk" id="owt-${esc(t.id)}"${open ? '' : ' hidden'}>
          ${t.email ? `<p class="lb">Reply by email to <a href="mailto:${esc(t.email)}?subject=${encodeURIComponent(`Floodlight support ${t.id}`)}">${esc(t.email)}</a>${t.user ? ', or here (the member sees it under Your tickets).' : '. This person isn’t signed in, so a reply here won’t reach them.'}</p>` : ''}
          ${t.messages.map(m => `<div class="hc-m ${m.by === 'staff' ? 'staff' : ''}"><b>${esc(m.by === 'staff' ? m.name : (t.display || t.user || 'Visitor'))}</b><small>${when(m.at)}</small><p>${esc(m.text)}</p></div>`).join('')}
          ${Object.keys(t.context || {}).length ? `<dl class="hc-ctx">${Object.entries(t.context).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          <form class="hc-reply" data-ow-reply="${esc(t.id)}"><label class="fl-f">Answer<textarea class="inp" name="text" rows="3" maxlength="4000" required></textarea></label>
            <div class="cx-row"><button class="bt sm" type="submit">Send answer</button>${t.status !== 'closed' ? `<button type="button" class="bt sm ghost" data-ow-status="closed" data-id="${esc(t.id)}">Close ticket</button>` : `<button type="button" class="bt sm ghost" data-ow-status="open" data-id="${esc(t.id)}">Reopen</button>`}</div></form>
        </div></li>` }).join('')}</ul>` : '<p class="lb">No tickets here.</p>'}</section>`;
  }

  function render(el) {
    if (!isStaff()) { el.innerHTML = `<div class="card emp"><b>Owners only</b><p>This dashboard is for the people who run Floodlight.</p><button type="button" class="bt" data-shell="home">Go to Home</button></div>`; return }
    const d = O.d;
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Owner dashboard</h1><p class="pg-sub">${isOwner() ? 'How Floodlight is doing, and what members are asking.' : 'Support tickets from members and visitors.'}</p></div>
        ${isOwner() ? `<div class="pg-acts"><div class="seg" role="radiogroup" aria-label="Time window">${[7, 30, 90].map(k => `<button type="button" role="radio" aria-checked="${O.days === k}" data-ow-days="${k}">${k} days</button>`).join('')}</div><button type="button" class="bt ghost sm" data-ow="refresh">Refresh</button></div>` : ''}</header>
      ${isOwner() ? (d ? `<p class="lb ow-at" role="status">Updated ${when(d.at)}. Usage counts are kept on Floodlight’s own server: no cookies, no IP addresses, and nothing from browsers that ask not to be tracked.</p>
          ${business(d.business, d.names)}${journey(d.growth)}${usage(d.product, d.growth, d.names)}${cancels(d.growth.cancel)}${monitor()}${referrals(d.referrals)}`
        : `<p class="lb">${O.err ? esc(O.err) : 'Loading the numbers…'}</p>${O.err ? '<button type="button" class="bt ghost sm" data-ow="refresh">Try again</button>' : ''}`) : ''}
      <div id="owInbox">${inbox()}</div>`;
  }
  const redraw = () => window.flPages?.redraw('owner');
  async function load() {
    if (isOwner()) {
      try { O.d = await get('/api/admin/owner?days=' + O.days); O.err = '' } catch (e) { O.d = null; O.err = 'The numbers didn’t load. ' + e.message }
      try { O.mon = await get('/api/admin/monitor') } catch (e) { O.mon = null }
    }
    await loadInbox(); redraw();
  }
  async function loadInbox() { try { O.sup = await get('/api/admin/support'); O.supErr = '' } catch (e) { O.sup = null; O.supErr = 'The inbox didn’t load. ' + e.message } }
  window.flPages?.add('owner', { title: 'Owner dashboard', render, onShow() { load() } });

  window.flAdmin && (() => { const m = window.flAdmin.menu; window.flAdmin.menu = mi => { const h = m(mi); return isStaff() && h ? h.replace('<div class="flm-g flm-own" role="group" aria-label="Owner">', `<div class="flm-g flm-own" role="group" aria-label="Owner">${mi('trend', 'Owner dashboard', 'data-page="owner"')}`) : h } })();
  document.addEventListener('fl:me', () => { if (window.flPages?.current?.() === 'owner') load() });
  document.addEventListener('click', async ev => {
    const days = ev.target.closest?.('[data-ow-days]'); if (days) { O.days = +days.dataset.owDays; O.d = null; redraw(); document.querySelector(`[data-ow-days="${O.days}"]`)?.focus(); return load() }
    if (ev.target.closest?.('[data-ow="refresh"]')) { O.err = ''; return load() }
    const f = ev.target.closest?.('[data-ow-filter]'); if (f) { O.filter = f.dataset.owFilter; document.getElementById('owInbox').innerHTML = inbox(); return document.querySelector(`[data-ow-filter="${O.filter}"]`)?.focus() }
    const t = ev.target.closest?.('[data-ow-t]'); if (t) { const id = t.dataset.owT; O.open.has(id) ? O.open.delete(id) : O.open.add(id); t.setAttribute('aria-expanded', O.open.has(id)); document.getElementById('owt-' + id).hidden = !O.open.has(id); return }
    const st = ev.target.closest?.('[data-ow-status]');
    if (st) { st.disabled = true; try { await post('/api/admin/support', { id: st.dataset.id, action: 'status', status: st.dataset.owStatus }); await loadInbox(); document.getElementById('owInbox').innerHTML = inbox(); document.querySelector(`[data-ow-t="${CSS.escape(st.dataset.id)}"]`)?.focus() } catch (e) { st.disabled = false; window.flAdmin?.say?.(e.message) } }
  });
  document.addEventListener('submit', async ev => {
    const f = ev.target; if (!f.dataset?.owReply) return; ev.preventDefault();
    const text = f.text.value.trim(); if (text.length < 2) return f.text.focus();
    const b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Sending…';
    try { await post('/api/admin/support', { id: f.dataset.owReply, action: 'reply', text }); await loadInbox(); O.open.add(f.dataset.owReply); document.getElementById('owInbox').innerHTML = inbox(); document.querySelector(`[data-ow-t="${CSS.escape(f.dataset.owReply)}"]`)?.focus() }
    catch (e) { b.disabled = false; b.textContent = 'Send answer'; f.querySelector('textarea').setAttribute('aria-invalid', 'true'); window.toast?.(e.message) }
  });
})();
