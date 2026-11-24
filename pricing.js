/* Floodlight · the pricing page (#/pricing, also /pricing and /upgrade). Plans come from GET /api/plans (billing.py), so
   prices live in one place. Starting a plan posts /api/billing/checkout: with Stripe it opens Stripe Checkout, with the
   built-in test checkout it finishes at once. Signed out, the buttons open the sign-up card and come back here.
   window.flPricing.render(el, {standalone}) draws the page anywhere (the signed-out front page uses it too). */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const day = t => new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(t));
  const track = (n, p) => { try { window.flTrack?.(n, p) } catch {} };
  const P = { cycle: 'month', plans: null, busy: '', err: '', note: '', el: null, standalone: false };
  const me = () => window.S?.me || null;

  async function load() {
    try { const r = await fetch('/api/plans', { credentials: 'same-origin' }); P.plans = await r.json() } catch { P.plans = { plans: [], error: true } }
  }
  const plan = id => P.plans?.plans?.find(p => p.id === id);

  const rows = () => P.plans?.compare || [];   // the Free-vs-Plus rows, from plans.json
  const cell = v => v == null ? '<span class="pp-no"><span aria-hidden="true">–</span><span class="sr-only">Not included</span></span>' : esc(v);

  const FAQ = () => { const c = P.plans || {}, others = (c.group_seats || 5) - 1, refund = c.refund_days ?? 14; return [
    ['Can I cancel any time?', 'Yes. Go to Account, then Plan and billing, then Cancel plan. You keep Plus until the end of the period you paid for (or the end of your trial) and are not charged again. No email or call needed.'],
    ['What happens when the free trial ends?', 'On the date shown before you start, your card is charged the plan price and a receipt is emailed to you. Cancel before that date and you pay nothing.'],
    ['Do you give refunds?', `If you are charged for a renewal you meant to cancel and have not used Plus since, ask within ${refund} days for a full refund. The Refund Policy has the details.`],
    ['Will your predictions make me money?', "No one can promise that, and we don't. Floodlight shows the evidence behind each line and publishes every graded pick, misses included, in Pick History. Past hit rates don't guarantee future results."],
    ['Is Floodlight a sportsbook?', "No. Floodlight doesn't take bets, hold money or pay out prizes. It's a research tool. Only bet where it's legal for you, and only what you can afford to lose."],
    ['How do I pay?', 'Visa, Mastercard, American Express and Discover cards, plus Apple Pay and Google Pay where your device supports them. Payments are processed by Stripe; Floodlight never sees or stores your card number.'],
    ['Can I switch between monthly and yearly?', 'Yes, from Plan and billing. The change is prorated: you are credited for unused time on the old plan.'],
    ['How does Group work?', `The person who buys Group adds up to ${others} other Floodlight accounts by username or email. Everyone gets Plus, and your group can run private prediction competitions for points. No real money changes hands.`],
    ['I have a promotion or gift code.', 'Promotion codes go in the box on the checkout page. Gift codes (they start with FL-) are redeemed under Account, then Plan and billing.'],
  ]; };

  // the one memorable piece: the price, set large, with the exact renewal sentence under it
  function renewal(p, trial) {
    const every = p.interval === 'year' ? 'every year' : 'every month';
    if (trial && p.trial_days) {
      const on = day(Date.now() + p.trial_days * 864e5);
      return `Free for ${p.trial_days} days, then ${money(p.price_cents)} ${every}, starting ${on}. Cancel before ${on} and you pay nothing.`;
    }
    return `${money(p.price_cents)} today, then ${money(p.price_cents)} ${every} until you cancel.`;
  }

  // on the member's own plan, what actually happens next (not the offer a new buyer would get)
  function yours(p) {
    const c = me()?.plan || {}, every = p.interval === 'year' ? 'a year' : 'a month', at = t => t ? day(t * 1000) : '';
    if (c.cancel_at_period_end) return `Cancelled. Plus stays on until ${at(c.renews)}, and you won't be charged again.`;
    if (c.status === 'trial') return `Free trial until ${at(c.trial_ends || c.renews)}, then ${money(c.price_cents ?? p.price_cents)} ${every}.`;
    if (c.status === 'past_due') return `Your last payment didn't go through. Update your card in Plan and billing.`;
    return c.renews ? `Renews ${at(c.renews)} for ${money(c.price_cents ?? p.price_cents)}.` : `${money(p.price_cents)} ${every}.`;
  }

  function planCard(p, trial, current) {
    const free = p.id === 'free', feat = p.id === 'plus' || p.id === 'plus_annual';
    const per = p.interval === 'year' ? '/year' : p.interval === 'month' ? '/month' : '';
    const eff = p.interval === 'year' ? `<p class="pp-eff">${money(Math.round(p.price_cents / 12))} a month, billed yearly. Saves ${money(plan('plus').price_cents * 12 - p.price_cents)} a year.</p>` : '';
    const mine = current === p.id;
    const badge = mine && me() ? '<span class="pp-badge mine">Your plan</span>' : p.recommended && !free && !current?.startsWith?.('plus') ? '<span class="pp-badge">Recommended</span>' : '';
    let cta;
    if (free) cta = mine || !me() ? '<p class="pp-cur">No card needed</p>' : '<p class="pp-cur">Included with every account</p>';
    else if (mine) cta = `<a class="bt ghost wide" href="#/account/billing" data-page="account" data-arg="billing">Manage your plan</a>`;
    else cta = `<button type="button" class="bt wide${feat ? '' : ' ghost'}" data-pr="buy" data-plan="${p.id}" ${P.busy ? 'disabled' : ''}>${P.busy === p.id ? 'Opening checkout…' : trial ? 'Start free trial' : `Choose ${esc(p.name)}`}</button>`;
    return `<article class="pp-plan${feat ? ' pp-feat' : ''}${mine && me() ? ' pp-mine' : ''}" aria-labelledby="pp-${p.id}">
      <div class="pp-top"><h2 class="pp-name" id="pp-${p.id}">${esc(p.id === 'plus_annual' ? 'Plus' : p.name)}</h2>${badge}</div>
      <p class="pp-blurb">${esc(p.blurb || '')}</p>
      <p class="pp-price"><span class="pp-num">${free ? '$0' : money(p.price_cents)}</span><span class="pp-per">${per || 'forever'}</span></p>
      ${eff}
      ${free ? '' : `<p class="pp-renew">${esc(mine && me() ? yours(p) : renewal(p, trial))}</p>`}
      ${cta}
      <ul class="pp-list">${(p.features || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    </article>`;
  }

  // a drawn example (no live data): what a Lab card shows on Free and on Plus
  function example() {
    const bars = [31, 22, 29, 18, 27, 33, 24, 26, 21, 28], line = 25.5, top = 36;
    const chart = `<div class="pp-bars" role="img" aria-label="Example: 6 of the last 10 games over 25.5">${bars.map(v => `<i class="${v > line ? 'ov' : ''}" style="--h:${(v / top * 100).toFixed(0)}%"></i>`).join('')}<b style="--at:${(line / top * 100).toFixed(0)}%"></b></div>`;
    const rate = (lbl, val, locked) => `<div class="pp-rate${locked ? ' locked' : ''}"><b>${locked ? '<span aria-hidden="true">••</span><span class="sr-only">Plus only</span>' : val}</b><span>${lbl}</span></div>`;
    const side = (title, locked) => `<figure class="pp-ex"><figcaption>${title}</figcaption>
        <div class="pp-ex-top"><strong>Example player · Points</strong><span>Over 25.5</span></div>${chart}
        <div class="pp-rates">${rate('Last 5', '60%', locked)}${rate('Last 10', '60%', false)}${rate('Last 20', '55%', locked)}${rate('Season', '58%', locked)}</div>
        <div class="pp-rates two">${rate('Home / away', '64% / 52%', locked)}${rate('Line moved', '+1.0 today', locked)}</div></figure>`;
    return `<section class="pp-sec" aria-labelledby="pp-ex-h"><h2 class="pp-h2" id="pp-ex-h">What changes with Plus</h2>
      <p class="pp-lead">An example card from the Lab. The numbers are made up for this picture, not a live line.</p>
      <div class="pp-ex-row">${side('Free', true)}${side('Plus', false)}</div></section>`;
  }

  function banner() {
    const m = P.plans?.mode, u = me()?.plan;
    if (u && !u.checkout?.ok) return `<div class="pp-note" role="note"><strong>Paid plans aren't on sale yet.</strong> ${esc(u.checkout.why.replace(/^Paid plans aren't on sale yet\. ?/, ''))}</div>`;
    if (m === 'test') return '<div class="pp-note" role="note"><strong>Test mode.</strong> Stripe is in test mode, so no real money moves. Pay with the test card 4242 4242 4242 4242, any future date and any three digits.</div>';
    if (m === 'demo') return `<div class="pp-note" role="note"><strong>Test checkout.</strong> Payments aren't connected yet, so starting a plan here charges nothing and uses a test card.</div>`;
    return '';
  }

  function render(el, opts = {}) {
    P.el = el; P.standalone = !!opts.standalone;
    if (!P.plans) { el.innerHTML = '<div class="pp-wrap"><p class="pp-lead" role="status">Loading plans…</p></div>'; load().then(() => P.el === el && render(el, opts)); return }
    if (P.plans.error || !P.plans.plans?.length) { el.innerHTML = '<div class="pp-wrap"><div class="card"><h1 class="pg-title">Plans</h1><p>The plans didn\'t load. Check your connection and <button type="button" class="lk" data-pr="retry">try again</button>.</p></div></div>'; return }
    const u = me(), cur = u?.plan, trial = !u || cur?.trial_available !== false;
    if (!P.cycleSet && cur?.paid) { P.cycleSet = true; if (cur.plan === 'plus_annual') P.cycle = 'year' }   // open on the member's own billing period
    const current = cur ? (cur.paid ? cur.plan : 'free') : null;
    const plus = plan(P.cycle === 'year' ? 'plus_annual' : 'plus');
    el.innerHTML = `<div class="pp-wrap">
      <header class="pg-head"><div><h1 class="pg-title">Plans</h1><p class="pg-sub">Start free. Upgrade when the Lab earns it. ${P.plans.trial_days}-day free trial on every paid plan, cancel any time.</p></div></header>
      ${banner()}
      <div class="pp-cycle"><div class="seg" role="radiogroup" aria-label="Billing period">
        <button type="button" role="radio" aria-checked="${P.cycle === 'month'}" data-pr="cycle" data-v="month">Monthly</button>
        <button type="button" role="radio" aria-checked="${P.cycle === 'year'}" data-pr="cycle" data-v="year">Yearly, save ${Math.round((1 - plan('plus_annual').price_cents / (plan('plus').price_cents * 12)) * 100)}%</button></div></div>
      <div class="pp-err" role="alert">${P.err ? esc(P.err) : ''}${P.note ? P.note : ''}</div>
      <div class="pp-plans">${planCard(plan('free'), false, current)}${planCard(plus, trial, current)}${planCard(plan('group'), trial, current)}</div>
      <p class="pp-pay">Pay with a card, Apple Pay or Google Pay. Promotion codes go in at checkout. Processed by Stripe.</p>
      <section class="pp-sec" aria-labelledby="pp-cmp-h"><h2 class="pp-h2" id="pp-cmp-h">Free and Plus, side by side</h2>
        <div class="pp-tbl-wrap"><table class="pp-tbl"><thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Plus</th></tr></thead>
        <tbody>${rows().map(([f, a, b]) => `<tr><th scope="row">${esc(f)}</th><td>${cell(a)}</td><td>${cell(b)}</td></tr>`).join('')}</tbody></table></div></section>
      ${example()}
      <section class="pp-sec pp-pol" aria-labelledby="pp-pol-h"><h2 class="pp-h2" id="pp-pol-h">Cancelling and refunds</h2>
        <div class="pp-pol-grid"><div class="tile"><h3>Cancel in two clicks</h3><p>Account, Plan and billing, Cancel plan. Plus stays on until the end of what you paid for. You can turn it back on before then.</p></div>
        <div class="tile"><h3>Refunds</h3><p>Charged for a renewal you meant to cancel and haven't used since? Ask within ${P.plans.refund_days} days for a full refund.</p></div>
        <div class="tile"><h3>Failed payment</h3><p>If a renewal doesn't go through, Plus stays on for ${P.plans.grace_days} days while you update your card.</p></div></div>
        <p class="pp-legal">Read the full <a href="#/legal/subscription" data-page="legal" data-arg="subscription">Subscription Terms</a>, <a href="#/legal/refunds" data-page="legal" data-arg="refunds">Refund Policy</a> and <a href="#/legal/terms" data-page="legal" data-arg="terms">Terms of Service</a>.</p></section>
      <section class="pp-sec" aria-labelledby="pp-gift-h"><h2 class="pp-h2" id="pp-gift-h">Give Plus</h2>
        <p class="pp-lead">A gift code for someone else. They redeem it from their account; it never renews.</p>
        <div class="cx-row">${(P.plans.gifts || []).map(g => `<button type="button" class="bt ghost" data-pr="gift" data-gift="${g.id}" ${P.busy ? 'disabled' : ''}>Gift ${g.months} month${g.months > 1 ? 's' : ''} · ${money(g.price_cents)}</button>`).join('')}</div></section>
      <section class="pp-sec" aria-labelledby="pp-faq-h"><h2 class="pp-h2" id="pp-faq-h">Questions</h2>
        <div class="pp-faq">${FAQ().map(([q, a]) => `<details class="card flat drw"><summary>${esc(q)}</summary><div class="drw-b"><p>${esc(a)}</p></div></details>`).join('')}</div></section>
      <p class="pp-foot">Floodlight is a research tool, not a sportsbook. Hit rates and predictions describe past results and our estimates; they are never a guarantee. 18+ (21+ where required). If gambling stops being fun, call 1-800-GAMBLER.</p>
    </div>`;
    if (opts.standalone && !P.viewed) { P.viewed = true; track('upgrade_view', { signedIn: !!u }) }   // inside the app, analytics.js counts it on fl:page
  }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.data = d; throw e }
    return d;
  }
  async function refreshMe() {
    try { const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }); const d = await r.json(); if (d.user && typeof adoptUser === 'function') adoptUser(d.user); else if (d.user && window.S) S.me = d.user } catch {}
  }
  function needAccount() {
    try { sessionStorage.setItem('fl.after', '#/pricing') } catch {}
    if (window.flAuth?.open) return window.flAuth.open('signup');
    location.hash = '#/pricing';
  }
  function fail(e) {
    P.busy = ''; P.err = e.message; P.note = '';
    if (e.data?.need === 'verify') P.note = ' <button type="button" class="lk" data-pr="verify">Send the confirmation link again</button>';
    if (e.data?.need === 'email') P.note = ' <a class="lk" href="#/account/profile" data-page="account" data-arg="profile">Add your email</a>';
    render(P.el, { standalone: P.standalone });
    P.el.querySelector('.pp-err')?.focus?.();
  }

  document.addEventListener('click', async ev => {
    const b = ev.target.closest?.('[data-pr]'); if (!b || !P.el?.contains(b)) return;
    const a = b.dataset.pr;
    if (a === 'retry') { P.plans = null; return render(P.el, { standalone: P.standalone }) }
    if (a === 'cycle') { P.cycle = b.dataset.v; P.cycleSet = true; render(P.el, { standalone: P.standalone }); return P.el.querySelector(`[data-pr="cycle"][data-v="${P.cycle}"]`)?.focus() }
    if (a === 'verify') { try { const d = await post('/api/me/verify'); P.err = ''; P.note = d.devLink ? `Confirmation link (shown because email isn't set up here): <a class="lk" href="${esc(d.devLink)}">confirm</a>` : `Sent to ${esc(d.to || 'your email')}. Open the link, then come back.` } catch (e) { P.err = e.message } return render(P.el, { standalone: P.standalone }) }
    if (a === 'buy' || a === 'gift') {
      if (!me()) return needAccount();
      P.busy = b.dataset.plan || b.dataset.gift; P.err = ''; P.note = ''; render(P.el, { standalone: P.standalone });
      try {
        const d = a === 'buy' ? await post('/api/billing/checkout', { plan: b.dataset.plan }) : await post('/api/billing/gift', { gift: b.dataset.gift });
        if (d.url) { try { sessionStorage.setItem('fl.checkout', JSON.stringify({ plan: b.dataset.plan || '', gift: b.dataset.gift || '', trial: !!d.trial })) } catch {} location.href = d.url; return }
        P.busy = '';
        if (a === 'buy') {
          track(d.trial ? 'trial_start' : 'subscribe', { plan: b.dataset.plan });
          await refreshMe();
          P.note = `<strong>${d.trial ? 'Your free trial has started.' : "You're on " + esc(plan(b.dataset.plan)?.name || 'Plus') + '.'}</strong> <a class="lk" href="#/account/billing" data-page="account" data-arg="billing">See your plan</a>`;
        } else P.note = `<strong>Gift code: ${esc(d.code)}</strong>. We also emailed it to you. Send it to whoever it's for.`;
        render(P.el, { standalone: P.standalone });
      } catch (e) { fail(e) }
    }
  });

  window.flPricing = { render, reload: () => { P.plans = null }, config: () => P.plans, load: () => P.plans ? Promise.resolve(P.plans) : load().then(() => P.plans) };
  const add = () => window.flPages?.add('pricing', { title: 'Plans', fresh: true, render: el => render(el) });
  if (window.flPages) add(); else document.addEventListener('DOMContentLoaded', add);
  document.addEventListener('fl:plan', () => { if (P.el && !P.el.closest('[hidden]') && document.documentElement.dataset.page === 'pricing') render(P.el, { standalone: P.standalone }) });
})();
