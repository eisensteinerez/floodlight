/* Floodlight · Account (#/account/<tab>): Profile and email, Sign-in and security, Plan and billing, Your data, and for
   owners the Business tab. Everything here talks to accounts.py and billing.py through server.py:
     profile   email (confirm, change), username, terms accepted
     security  password, two-step sign-in (authenticator app + recovery codes), signed-in devices
     billing   plan, renewal, card, receipts, cancel (with a reason), reactivate, restore, gift codes, group seats
     data      download everything, delete the account
     owner     paying members, trials, MRR, cancellations, plan limits switch, free Plus grants, email outbox
   Coming back from Stripe lands on #/account/billing?checkout=done&session=… and the page asks the server to sync. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c, cur = 'usd') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase() }).format((c || 0) / 100);
  const day = t => t ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t * 1000)) : '';
  const when = t => t ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t * 1000)) : '';
  const track = (n, p) => { try { window.flTrack?.(n, p) } catch {} };
  const TABS = [['profile', 'Profile and email'], ['security', 'Sign-in and security'], ['billing', 'Plan and billing'], ['data', 'Your data']];
  const A = { tab: 'profile', el: null, msg: {}, err: {}, bill: null, sess: null, setup: null, codes: null, owner: null, outbox: null, busy: '' };
  const me = () => window.S?.me || null;

  async function call(path, body) {
    const r = await fetch(path, body !== undefined ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.data = d; throw e }
    return d;
  }
  async function refreshMe() {
    try { const d = await call('/api/me'); if (d.user) { if (typeof adoptUser === 'function') adoptUser(d.user); else S.me = d.user } } catch {}
  }
  const say = (k, m) => { A.msg[k] = m; A.err[k] = '' };
  const oops = (k, e) => { A.err[k] = e.message || String(e); A.msg[k] = '' };
  const line = k => `<p class="ac-msg${A.err[k] ? ' bad' : ''}" role="${A.err[k] ? 'alert' : 'status'}">${A.err[k] ? esc(A.err[k]) : A.msg[k] || ''}</p>`;
  const PLAN_NAME = { free: 'Free', plus: 'Plus, monthly', plus_annual: 'Plus, yearly', group: 'Group' };
  const RSTATUS = { paid: 'Paid', open: 'Due', refunded: 'Refunded', 'partly refunded': 'Partly refunded', void: 'Void', uncollectible: 'Not paid' };

  /* ---------- tabs ---------- */
  function tabs() {
    const all = me()?.rank === 'owner' ? [...TABS, ['owner', 'Business']] : TABS;
    return `<div class="ac-tabs" role="tablist" aria-label="Account sections">${all.map(([k, l]) => `<button type="button" role="tab" id="act-${k}" aria-controls="acp" aria-selected="${A.tab === k}" tabindex="${A.tab === k ? 0 : -1}" data-ac="tab" data-v="${k}">${esc(l)}</button>`).join('')}</div>`;
  }

  /* ---------- profile and email ---------- */
  function profile(u) {
    const t = u.terms || {};
    return `<section class="card ac-sec" aria-labelledby="ac-em-h"><h2 class="ac-h" id="ac-em-h">Email</h2>
      ${u.email ? `<p class="ac-big">${esc(u.email)} ${u.email_verified ? '<span class="pl ac-ok">Confirmed</span>' : '<span class="pl ac-warn">Not confirmed</span>'}</p>
        ${u.email_verified ? '<p class="ac-help">We use it for sign-in links, password resets and receipts. Nothing else.</p>'
          : '<p class="ac-help">Confirm it so you can reset your password and buy a plan. The link is in your inbox (check spam).</p><button type="button" class="bt ghost sm" data-ac="verify">Send the link again</button>'}`
        : '<p class="ac-help">Add an email so you can get back in if you forget your password, and to receive receipts.</p>'}
      <form class="ac-form" data-form="email"><h3 class="ac-h3">${u.email ? 'Change email' : 'Add email'}</h3>
        <label class="fl-f">New email<input class="inp" name="email" type="email" autocomplete="email" spellcheck="false" required placeholder="you@example.com"></label>
        <label class="fl-f">Your password<input class="inp" name="password" type="password" autocomplete="current-password" required></label>
        <button class="bt sm" type="submit">${u.email ? 'Send confirmation to new email' : 'Add email'}</button>${line('email')}</form></section>
    <section class="card ac-sec" aria-labelledby="ac-id-h"><h2 class="ac-h" id="ac-id-h">Username</h2>
      <p class="ac-big">@${esc(u.username)}</p><p class="ac-help">You can sign in with your username or your email. Your display name and photo are on <a class="lk" href="#/profile" data-page="profile">your profile page</a>.</p></section>
    <section class="card ac-sec" aria-labelledby="ac-tm-h"><h2 class="ac-h" id="ac-tm-h">Terms</h2>
      <p class="ac-help">${t.ok ? `You accepted the current <a class="lk" href="#/legal/terms" data-page="legal" data-arg="terms">Terms of Service</a> and <a class="lk" href="#/legal/privacy" data-page="legal" data-arg="privacy">Privacy Policy</a> (version ${esc(t.version)})${t.accepted_at ? ` on ${esc(day(t.accepted_at))}` : ''}.` : 'The terms changed since you last accepted them.'}</p>
      ${(t.history || []).length > 1 ? `<p class="ac-help">Earlier: ${t.history.slice(0, -1).reverse().map(h => `version ${esc(h.version)} on ${esc(day(h.at))}`).join(', ')}.</p>` : ''}</section>`;
  }

  /* ---------- security ---------- */
  function security(u) {
    const sess = A.sess;
    const tf = u.twofa ? `<p class="ac-big">On <span class="pl ac-ok">Authenticator app</span></p><p class="ac-help">Signing in asks for a code from your app. Lost your phone? Use one of your recovery codes.</p>
        <details class="card flat drw"><summary>Turn off two-step sign-in</summary><form class="drw-b ac-form" data-form="2fa-off">
          <label class="fl-f">Password<input class="inp" name="password" type="password" autocomplete="current-password" required></label>
          <label class="fl-f">Code from your app or a recovery code<input class="inp" name="code" inputmode="numeric" autocomplete="one-time-code" spellcheck="false" required></label>
          <button class="bt danger sm" type="submit">Turn off</button></form></details>`
      : A.codes ? `<p class="ac-big">On</p><div class="tile ac-codes"><h3 class="ac-h3">Save your recovery codes</h3><p class="ac-help">Each one signs you in once if you lose your phone. This is the only time they're shown.</p>
          <ol>${A.codes.map(c => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
          <div class="cx-row"><button type="button" class="bt ghost sm" data-ac="copycodes">Copy codes</button><button type="button" class="bt sm" data-ac="donecodes">I saved them</button></div></div>`
      : A.setup ? `<ol class="ac-steps"><li>Open an authenticator app (Google Authenticator, 1Password, Authy…) and add an account.</li>
          <li>On this phone, <a class="lk" href="${esc(A.setup.uri)}">open it in your app</a>, or type this key: <code class="ac-key">${esc(A.setup.secret)}</code></li>
          <li>Enter the 6-digit code the app shows.</li></ol>
          <form class="ac-form row" data-form="2fa-on"><label class="fl-f">Code<input class="inp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required></label><button class="bt sm" type="submit">Turn on</button><button class="bt ghost sm" type="button" data-ac="2fa-cancel">Cancel</button></form>`
      : `<p class="ac-big">Off</p><p class="ac-help">Add a second step to sign-in: after your password, a code from an app on your phone. Recommended once you pay for a plan.</p><button type="button" class="bt sm" data-ac="2fa-setup">Set up two-step sign-in</button>`;
    return `<section class="card ac-sec" aria-labelledby="ac-pw-h"><h2 class="ac-h" id="ac-pw-h">Password</h2>
      <form class="ac-form" data-form="password">
        <label class="fl-f">Current password<input class="inp" name="current" type="password" autocomplete="current-password" required></label>
        <label class="fl-f">New password (8 or more characters)<input class="inp" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="ac-check"><input type="checkbox" name="others" checked> Sign out my other devices</label>
        <button class="bt sm" type="submit">Change password</button>${line('password')}</form></section>
    <section class="card ac-sec" aria-labelledby="ac-2f-h"><h2 class="ac-h" id="ac-2f-h">Two-step sign-in</h2>${tf}${line('2fa')}</section>
    <section class="card ac-sec" aria-labelledby="ac-dv-h"><div class="sec-h"><h2 class="ac-h" id="ac-dv-h">Signed-in devices</h2>${sess && sess.length > 1 ? '<button type="button" class="bt ghost sm" data-ac="signout-all">Sign out all other devices</button>' : ''}</div>
      ${!sess ? '<p class="ac-help" role="status">Loading…</p>' : `<ul class="ac-devs">${sess.map(s => `<li><div><strong>${esc(s.device)}</strong>${s.current ? ' <span class="pl ac-ok">This device</span>' : ''}<span class="ac-help">Signed in ${esc(day(s.created))} with ${esc(s.via)} · last active ${esc(when(s.seen))}</span></div>
        ${s.current ? '' : `<button type="button" class="bt ghost sm" data-ac="signout" data-id="${esc(s.id)}" aria-label="Sign out ${esc(s.device)}">Sign out</button>`}</li>`).join('')}</ul>`}${line('sess')}</section>`;
  }

  /* ---------- plan and billing ---------- */
  function status(p) {
    if (p.status === 'past_due') return '<span class="pl ac-bad">Payment failed</span>';
    if (p.cancel_at_period_end) return `<span class="pl ac-warn">Ends ${esc(day(p.renews))}</span>`;
    if (p.status === 'trial') return '<span class="pl ac-ok">Free trial</span>';
    if (p.paid) return '<span class="pl ac-ok">Active</span>';
    return '<span class="pl">Free</span>';
  }
  function card(pm) {
    if (!pm) return 'No card on file';
    const w = pm.wallet ? ` (${pm.wallet === 'apple_pay' ? 'Apple Pay' : pm.wallet === 'google_pay' ? 'Google Pay' : esc(pm.wallet)})` : '';
    return `${esc((pm.brand || 'Card').replace(/^\w/, c => c.toUpperCase()))} ending ${esc(pm.last4)}${w}${pm.exp ? `, expires ${esc(pm.exp)}` : ''}${pm.test ? ' · test card' : ''}`;
  }
  function billing(u) {
    const b = A.bill, p = (b && b.plan) || u.plan || {};
    if (!b) return '<section class="card ac-sec"><p class="ac-help" role="status">Loading your plan…</p></section>';
    const own = p.plan && p.plan !== 'free' && p.provider;
    const groupSeat = p.effective === 'group' && p.group_of;
    let what;
    if (groupSeat) what = `You're on @${esc(p.group_of)}'s Group plan, so you have Plus. They manage the billing.`;
    else if (p.comp_until && !own) what = `You have free Plus until ${esc(day(p.comp_until))}. No card needed and nothing renews.`;
    else if (!p.paid) what = esc(p.free_summary || 'Free: live scores and a taste of the Lab.');
    else if (p.status === 'trial' && !p.cancel_at_period_end) what = `Your free trial ends ${esc(day(p.trial_ends || p.renews))}. Then ${money(p.price_cents)} ${p.interval === 'year' ? 'a year' : 'a month'}, charged to ${card(p.payment_method)}.`;
    else if (p.cancel_at_period_end) what = `Cancelled. Plus stays on until ${esc(day(p.renews))}, and you won't be charged again.`;
    else what = `Renews ${esc(day(p.renews))} for ${money(p.price_cents)}${p.interval === 'year' ? ' a year' : ' a month'}.`;
    const due = p.status === 'past_due' ? `<div class="ac-alert" role="alert"><strong>Your last payment didn't go through.</strong> Plus stays on until ${esc(day(p.grace_until))} while we try again. Update your card to keep it.<button type="button" class="bt sm" data-ac="card">Update card</button></div>` : '';
    const mode = p.mode === 'test' ? '<p class="ac-note">Stripe test mode: no real charges.</p>' : p.mode === 'demo' && own ? '<p class="ac-note">Test checkout: nothing was charged.</p>' : '';
    const acts = [];
    if (own && p.cancel_at_period_end) acts.push('<button type="button" class="bt sm" data-ac="reactivate">Keep my plan</button>');
    if (own && !p.cancel_at_period_end && p.paid) {
      if (p.plan === 'plus') acts.push(`<button type="button" class="bt ghost sm" data-ac="switch" data-plan="plus_annual">Switch to yearly${p.yearly_saving_pct ? ` (save ${p.yearly_saving_pct}%)` : ''}</button>`);
      if (p.plan === 'plus_annual') acts.push('<button type="button" class="bt ghost sm" data-ac="switch" data-plan="plus">Switch to monthly</button>');
      acts.push('<button type="button" class="bt ghost sm" data-ac="card">Update card</button>');
      acts.push('<button type="button" class="bt ghost sm" data-ac="cancel">Cancel plan</button>');
    }
    if (!p.paid || (!own && !groupSeat)) acts.push('<a class="bt sm" href="#/pricing" data-page="pricing">See plans</a>');
    const group = p.plan === 'group' && own ? `<section class="card ac-sec" aria-labelledby="ac-gr-h"><h2 class="ac-h" id="ac-gr-h">Your group</h2>
        <p class="ac-help">${(p.group_members || []).length} of ${(p.group_seats || 5) - 1} seats used. Everyone you add gets Plus while your Group plan is on.</p>
        <ul class="ac-devs">${(p.group_members || []).map(m => `<li><strong>@${esc(m)}</strong><button type="button" class="bt ghost sm" data-ac="group-rm" data-who="${esc(m)}" aria-label="Remove @${esc(m)} from your group">Remove</button></li>`).join('')}</ul>
        <form class="ac-form row" data-form="group-add"><label class="fl-f">Username or confirmed email<input class="inp" name="who" autocomplete="off" spellcheck="false" required></label><button class="bt sm" type="submit">Add to group</button></form>${line('group')}</section>` : '';
    const seat = groupSeat ? `<button type="button" class="bt ghost sm" data-ac="group-leave">Leave this group</button>` : '';
    const inv = (b.invoices || []);
    return `${due}<section class="card ac-sec ac-plan" aria-labelledby="ac-pl-h">
        <div class="sec-h"><h2 class="ac-h" id="ac-pl-h">${esc(PLAN_NAME[p.effective] || p.name || 'Free')}</h2>${status(p)}</div>
        <p class="ac-big">${what}</p>${mode}
        ${own ? `<dl class="ac-dl"><div><dt>Payment method</dt><dd>${card(p.payment_method)}</dd></div>${p.renews ? `<div><dt>${p.cancel_at_period_end ? 'Ends' : p.status === 'trial' ? 'First charge' : 'Next charge'}</dt><dd>${esc(day(p.renews))}</dd></div>` : ''}</dl>` : ''}
        <div class="cx-row">${acts.join('')}${seat}</div>${line('plan')}${b.error ? `<p class="ac-msg bad">Stripe didn't answer: ${esc(b.error)}. Showing what we saved last.</p>` : ''}</section>
      ${group}
      <section class="card ac-sec" aria-labelledby="ac-rc-h"><h2 class="ac-h" id="ac-rc-h">Receipts</h2>
        ${inv.length ? `<div class="pp-tbl-wrap"><table class="pp-tbl ac-inv"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Receipt</span></th></tr></thead><tbody>
          ${inv.map(i => `<tr><td>${esc(day(i.at))}</td><td>${esc(i.what || i.number || 'Floodlight')}</td><td class="num">${money(i.amount_cents, i.currency)}</td><td>${esc(RSTATUS[i.status] || i.status)}</td>
            <td>${i.pdf ? `<a class="lk" href="${esc(i.pdf)}" target="_blank" rel="noopener">Download PDF</a>` : i.url ? `<a class="lk" href="${esc(i.url)}" target="_blank" rel="noopener">View</a>` : `<button type="button" class="lk" data-ac="receipt" data-id="${esc(i.id)}">View receipt</button>`}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="ac-help">No receipts yet. They appear here after your first charge, and are emailed to you.</p>'}</section>
      <section class="card ac-sec" aria-labelledby="ac-more-h"><h2 class="ac-h" id="ac-more-h">Codes and restoring a purchase</h2>
        <form class="ac-form row" data-form="redeem"><label class="fl-f">Gift code<input class="inp" name="code" autocomplete="off" spellcheck="false" placeholder="FL-XXXX-XXXX" required></label><button class="bt sm" type="submit">Redeem</button></form>
        ${p.ref_credit_months ? `<p class="ac-help">You've earned ${p.ref_credit_months} free month${p.ref_credit_months > 1 ? 's' : ''} of Plus from invites.</p><button type="button" class="bt ghost sm" data-ac="credit">Use a free month</button>` : ''}
        <p class="ac-help">Bought Plus before and it isn't showing? We can find it by the email it was paid with.</p><button type="button" class="bt ghost sm" data-ac="restore">Restore purchase</button>${line('more')}</section>`;
  }

  /* ---------- your data ---------- */
  function data(u) {
    return `<section class="card ac-sec" aria-labelledby="ac-ex-h"><h2 class="ac-h" id="ac-ex-h">Download your data</h2>
        <p class="ac-help">One file with your account, settings, follows, boards, parlays, votes, plan and receipts. Passwords and card numbers are never in it.</p>
        <a class="bt ghost sm" href="/api/me/export" download>Download my data (JSON)</a></section>
      <section class="card ac-sec ac-danger" aria-labelledby="ac-del-h"><h2 class="ac-h" id="ac-del-h">Delete your account</h2>
        <p class="ac-help">This deletes @${esc(u.username)}, your settings, follows, boards, parlays and photo, signs you out everywhere, and ${u.plan?.paid && !u.plan?.group_of ? '<strong>ends your plan straight away with no refund for the time left</strong>' : 'cancels any plan'}. It can't be undone. Receipts stay with Stripe because tax law requires it. <a class="lk" href="#/legal/delete-account" data-page="legal" data-arg="delete-account">How deletion works</a></p>
        <form class="ac-form" data-form="delete">
          <label class="fl-f">Password<input class="inp" name="password" type="password" autocomplete="current-password" required></label>
          ${u.twofa ? '<label class="fl-f">Code from your app<input class="inp" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>' : ''}
          <label class="ac-check"><input type="checkbox" name="sure" required> I understand this deletes my account for good</label>
          <button class="bt danger sm" type="submit">Delete my account</button>${line('delete')}</form></section>`;
  }

  /* ---------- owner: the business at a glance ---------- */
  function owner() {
    const s = A.owner;
    if (!s) return '<section class="card ac-sec"><p class="ac-help" role="status">Loading…</p></section>';
    const tile = (v, l, sub) => `<div class="tile ac-stat"><b class="num">${v}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const modeTxt = { demo: 'Built-in test checkout (no Stripe key)', test: 'Stripe test mode', live: s.live_allowed ? 'Stripe live: real charges' : 'Stripe live key, but sales are off (FLOODLIGHT_BILLING_LIVE is not 1)' }[s.mode];
    const reasons = Object.entries(s.cancel_reasons || {}).sort((a, b) => b[1] - a[1]);
    return `${s.durable ? '' : `<div class="ac-alert" role="alert"><strong>Accounts aren't stored durably yet.</strong> A deploy hands them to the new server, but a crash or manual restart loses them. Add DATABASE_URL (a free Neon Postgres) on Render before selling.</div>`}
      <section class="card ac-sec" aria-labelledby="ac-biz-h"><h2 class="ac-h" id="ac-biz-h">Members and revenue</h2>
        <div class="ac-stats">${tile(s.paying, 'Paying')}${tile(s.trials, 'On a trial')}${tile(money(s.mrr_cents), 'Monthly recurring revenue', `${money(s.arr_cents)} a year`)}${tile(s.cancels_30d, 'Cancellations, 30 days')}${tile(s.past_due, 'Past due now', s.failed_payments_30d ? `${s.failed_payments_30d} failed payment${s.failed_payments_30d === 1 ? '' : 's'} in 30 days` : '')}${tile(money(s.refunded_cents_30d || 0), 'Refunded, 30 days', `${s.refunds_30d || 0} refund${s.refunds_30d === 1 ? '' : 's'}`)}${tile(s.disputes_open || 0, 'Open disputes', s.disputes_open ? 'Answer them in the Stripe dashboard' : '')}${tile(s.comped, 'Free Plus (granted)')}</div>
        <p class="ac-help">${s.users} accounts: ${s.by_plan.free} on Free, ${s.by_plan.plus + s.by_plan.plus_annual} on Plus, ${s.by_plan.group} on Group seats. Test checkouts (${s.demo_accounts}) are left out of revenue.</p>
        ${reasons.length ? `<h3 class="ac-h3">Why people cancelled</h3><ul class="ac-bars">${reasons.map(([k, n]) => `<li><span>${esc(REASONS.find(r => r[0] === k)?.[1] || k)}</span><i style="--w:${(n / reasons[0][1] * 100).toFixed(0)}%"></i><b class="num">${n}</b></li>`).join('')}</ul>` : ''}</section>
      <section class="card ac-sec" aria-labelledby="ac-set-h"><h2 class="ac-h" id="ac-set-h">Selling</h2>
        <dl class="ac-dl"><div><dt>Checkout</dt><dd>${esc(modeTxt)}</dd></div><div><dt>Stripe webhook</dt><dd>${s.webhook ? `Set${s.webhook_at ? `, last event ${esc(when(s.webhook_at))}` : ', no events yet'}` : 'Not set'}: <code>${esc(s.webhook_url)}</code></dd></div><div><dt>Email</dt><dd>${s.mail ? 'Resend is set up' : 'Not set up: links are not emailed (see Outbox below)'}</dd></div><div><dt>Account storage</dt><dd>${s.durable ? 'Durable' : 'Not durable'}</dd></div></dl>
        <label class="ac-switch"><input type="checkbox" class="sw" data-ac="enforce" ${s.enforced ? 'checked' : ''} ${s.env_enforced ? 'disabled' : ''}><span><strong>Apply Free plan limits</strong><span class="ac-help">Off: every member keeps every feature (the beta). On: Free members get ${esc((me()?.plan?.free_summary || '').replace(/^Live scores, /, '').replace(/\.$/, '') || 'the Free limits')}. Turn on only once paid plans are on sale.</span></span></label>
        <form class="ac-form row" data-form="comp"><label class="fl-f">Give free Plus to<input class="inp" name="username" placeholder="username" autocomplete="off" spellcheck="false" required></label><label class="fl-f">Months<input class="inp" name="months" type="number" min="0" max="36" value="3" required></label><button class="bt sm" type="submit">Grant</button></form>${line('owner')}</section>
      ${A.outbox && !A.outbox.ready ? `<details class="card flat drw"><summary>Outbox: emails that weren't sent (${A.outbox.outbox.length})</summary><div class="drw-b"><p class="ac-help">No RESEND_API_KEY on the server, so these were not delivered. They contain sign-in links: never share them.</p>${A.outbox.outbox.map(m => `<div class="tile"><strong>${esc(m.subject)}</strong> to ${esc(m.to)} · ${esc(when(m.at))}<pre class="ac-pre">${esc(m.text)}</pre></div>`).join('')}</div></details>` : ''}
      <details class="card flat drw"><summary>Billing log</summary><div class="drw-b"><ul class="ac-log">${(s.log || []).map(x => `<li><span>${esc(when(x.at))}</span> ${x.user ? `@${esc(x.user)}: ` : ''}${esc(x.what)}</li>`).join('') || '<li>Nothing yet.</li>'}</ul></div></details>`;
  }

  const REASONS = [['too_expensive', 'Too expensive'], ['inaccurate_data', 'The data was wrong'], ['not_used_enough', "I didn't use it enough"], ['missing_sport', 'A sport or provider I need is missing'],
    ['hard_to_understand', 'Hard to understand'], ['technical', 'Technical problems'], ['other', 'Something else']];

  function cancelDialog() {
    const p = A.bill?.plan || me()?.plan || {};
    const d = document.createElement('dialog'); d.className = 'ac-dlg'; d.setAttribute('aria-labelledby', 'acDlgH');
    d.innerHTML = `<form method="dialog" class="ac-form" data-form="cancel"><h2 class="ac-h" id="acDlgH">Cancel your plan?</h2>
      <p class="ac-help">${p.status === 'trial' ? `Your trial ends ${esc(day(p.trial_ends || p.renews))} and you won't be charged.` : `Plus stays on until ${esc(day(p.renews))}. You won't be charged again.`} You can turn it back on before then.</p>
      <fieldset class="ac-reasons"><legend>What's the main reason? (optional, it helps us fix it)</legend>${REASONS.map(([k, l], i) => `<label class="ac-check"><input type="radio" name="reason" value="${k}" ${i === 6 ? '' : ''}> ${esc(l)}</label>`).join('')}</fieldset>
      <label class="fl-f">Anything else?<textarea class="inp" name="note" rows="2" maxlength="500"></textarea></label>
      <div class="cx-row"><button class="bt danger" type="submit" value="cancel">Cancel plan</button><button class="bt" type="submit" value="keep" autofocus>Keep Plus</button></div></form>`;
    document.body.appendChild(d);
    const from = document.activeElement;
    d.addEventListener('close', async () => {
      const f = d.querySelector('form'), reason = f.reason.value || 'other', note = f.note.value;
      const go = d.returnValue === 'cancel'; d.remove(); from?.focus?.();
      if (!go) return;
      try { const r = await call('/api/billing/cancel', { reason, note }); A.bill.plan = r.plan; say('plan', 'Your plan is cancelled. It stays on until the end of the period.');; await refreshMe() } catch (e) { oops('plan', e) }
      draw();
    });
    d.showModal();
  }

  function receipt(id) {
    const i = (A.bill?.invoices || []).find(x => x.id === id); if (!i) return;
    const u = me(), d = document.createElement('dialog'); d.className = 'ac-dlg ac-rcpt'; d.setAttribute('aria-labelledby', 'acRcH');
    d.innerHTML = `<h2 class="ac-h" id="acRcH">Receipt ${esc(i.number)}</h2>
      <dl class="ac-dl"><div><dt>Date</dt><dd>${esc(day(i.at))}</dd></div><div><dt>Billed to</dt><dd>@${esc(u.username)}${u.email ? `, ${esc(u.email)}` : ''}</dd></div><div><dt>Item</dt><dd>${esc(i.what)}</dd></div><div><dt>Amount</dt><dd>${money(i.amount_cents, i.currency)}</dd></div><div><dt>Status</dt><dd>${esc(RSTATUS[i.status] || i.status)}${i.refunded_cents ? `, ${money(i.refunded_cents, i.currency)} refunded` : ''}${i.demo ? ' (test, no money moved)' : ''}</dd></div></dl>
      <div class="cx-row"><button type="button" class="bt ghost sm" data-ac="print">Print or save as PDF</button><button type="button" class="bt sm" data-ac="close-dlg" autofocus>Close</button></div>`;
    document.body.appendChild(d);
    const from = document.activeElement;
    d.addEventListener('close', () => { d.remove(); from?.focus?.() });
    d.showModal();
  }

  /* ---------- drawing ---------- */
  function draw() {
    const el = A.el; if (!el) return;
    const u = me();
    if (!u) { el.innerHTML = `<div class="ac-wrap"><header class="pg-head"><div><h1 class="pg-title">Account</h1><p class="pg-sub">Sign in to manage your account and plan.</p></div></header><div class="card"><button type="button" class="bt" data-ac="signin">Log in or create an account</button></div></div>`; return }
    const keep = document.activeElement?.closest?.('.ac-wrap') ? (document.activeElement.name || document.activeElement.dataset?.ac || '') : '';
    const body = { profile, security, billing, data, owner }[A.tab](u);
    el.innerHTML = `<div class="ac-wrap"><header class="pg-head"><div><h1 class="pg-title">Account</h1><p class="pg-sub">@${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}</p></div></header>
      ${tabs()}<div class="ac-body" id="acp" role="tabpanel" aria-labelledby="act-${A.tab}" tabindex="-1">${body}</div></div>`;
    const tb = el.querySelector('.ac-tabs'), on = tb?.querySelector('[aria-selected="true"]');
    if (tb && on) tb.scrollLeft = Math.max(0, on.offsetLeft - (tb.clientWidth - on.offsetWidth) / 2);   // the open tab stays in view on phones
    if (keep) el.querySelector(`[name="${CSS.escape(keep)}"], [data-ac="${CSS.escape(keep)}"]`)?.focus?.();
  }

  async function open(tab) {
    if (tab) A.tab = tab;
    draw();
    if (A.tab === 'security') { try { A.sess = (await call('/api/me/sessions')).sessions } catch (e) { oops('sess', e); A.sess = [] } draw() }
    if (A.tab === 'billing') { try { A.bill = await call('/api/me/billing') } catch (e) { A.bill = { plan: me()?.plan, invoices: [], error: e.message } } draw() }
    if (A.tab === 'owner') { try { A.owner = await call('/api/admin/billing/summary'); A.outbox = await call('/api/admin/outbox') } catch (e) { oops('owner', e) } draw() }
  }

  // #/account/billing?checkout=done&session=cs_… after Stripe
  async function arrive(arg) {
    const [tab, qs] = String(arg || '').split('?');
    const q = new URLSearchParams(qs || '');
    A.tab = TABS.some(t => t[0] === tab) || tab === 'owner' ? tab : 'profile';
    if (q.get('session')) {
      let was = {}; try { was = JSON.parse(sessionStorage.getItem('fl.checkout') || '{}'); sessionStorage.removeItem('fl.checkout') } catch {}
      try {
        const d = await call('/api/billing/sync', { session: q.get('session'), gift: q.get('gift') === 'done' });
        if (q.get('checkout')) { say('plan', '<strong>Thanks. Your plan is on.</strong> A receipt is on its way to your email.'); track(was.trial ? 'trial_start' : 'subscribe', { plan: d.plan?.plan }) }
        if (q.get('card')) say('plan', 'Your new card is saved.');
        if (q.get('gift')) say('more', d.code ? `<strong>Gift code: ${esc(d.code)}</strong>. We emailed it to you as well.` : 'Thanks. Your gift code is on its way to your email.');
        await refreshMe();
      } catch (e) { oops('plan', e) }
      history.replaceState(null, '', '#/account/' + A.tab);
    }
    return open();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async ev => {
    const b = ev.target.closest?.('[data-ac]'); if (!b) return;
    if (!b.closest('.ac-wrap,.ac-dlg')) return;
    const a = b.dataset.ac;
    if (a === 'tab') { history.replaceState(null, '', '#/account/' + b.dataset.v); open(b.dataset.v); return document.getElementById('act-' + b.dataset.v)?.focus() }
    if (a === 'signin') return window.flAuth?.open?.('login');
    if (a === 'close-dlg') return b.closest('dialog')?.close();
    if (a === 'print') return window.print();
    if (a === 'receipt') return receipt(b.dataset.id);
    if (a === 'cancel') return cancelDialog();
    if (a === 'copycodes') { try { await navigator.clipboard.writeText(A.codes.join('\n')); say('2fa', 'Copied.') } catch { say('2fa', 'Select the codes and copy them.') } return draw() }
    if (a === 'donecodes') { A.codes = null; await refreshMe(); return draw() }
    if (a === 'enforce') return;   // handled on change
    try {
      if (a === 'verify') { const d = await call('/api/me/verify', {}); say('email', d.devLink ? `Email isn't set up on this server. <a class="lk" href="${esc(d.devLink)}">Open the confirmation link</a>.` : d.already ? 'Already confirmed.' : `Sent to ${esc(d.to)}. It works for 3 days.`) }
      if (a === '2fa-setup') { A.setup = await call('/api/me/2fa/setup', {}) }
      if (a === '2fa-cancel') { A.setup = null }
      if (a === 'signout') { A.sess = (await call('/api/me/sessions/revoke', { id: b.dataset.id })).sessions; say('sess', 'Signed out.') }
      if (a === 'signout-all') { A.sess = (await call('/api/me/sessions/revoke', { all: true })).sessions; say('sess', 'Every other device is signed out.') }
      if (a === 'reactivate') { A.bill.plan = (await call('/api/billing/reactivate', {})).plan; say('plan', "Your plan is back on. It renews as before.");  await refreshMe() }
      if (a === 'switch') { const d = await call('/api/billing/checkout', { plan: b.dataset.plan }); if (d.url) { location.href = d.url; return } A.bill = await call('/api/me/billing'); say('plan', `Switched to ${esc(PLAN_NAME[b.dataset.plan])}.`); await refreshMe() }
      if (a === 'card') { const d = await call('/api/billing/card', {}); if (d.url) { location.href = d.url; return } say('plan', esc(d.note || 'Card saved.')) }
      if (a === 'restore') { const d = await call('/api/billing/restore', {}); if (d.found) { A.bill = await call('/api/me/billing'); say('more', 'Found it. Your plan is linked to this account.'); await refreshMe() } else say('more', esc(d.message)) }
      if (a === 'credit') { const d = await call('/api/billing/credit', {}); A.bill.plan = d.plan; say('more', 'A free month of Plus is on.'); await refreshMe() }
      if (a === 'group-rm') { A.bill.plan = (await call('/api/billing/group', { action: 'remove', who: b.dataset.who })).plan; say('group', 'Removed.') }
      if (a === 'group-leave') { await call('/api/billing/group', { action: 'leave' }); await refreshMe(); A.bill = await call('/api/me/billing') }
    } catch (e) { oops({ verify: 'email', signout: 'sess', 'signout-all': 'sess', restore: 'more', credit: 'more', 'group-rm': 'group' }[a] || (a.startsWith('2fa') ? '2fa' : 'plan'), e) }
    draw();
  });
  document.addEventListener('change', async ev => {
    const t = ev.target; if (t.dataset?.ac !== 'enforce' || !t.closest('.ac-wrap')) return;
    try { A.owner = await call('/api/admin/billing', { action: 'enforce', on: t.checked }); say('owner', t.checked ? 'Free plan limits are on.' : 'Free plan limits are off. Everyone has every feature.'); await refreshMe() } catch (e) { oops('owner', e) }
    draw();
  });
  document.addEventListener('submit', async ev => {
    const f = ev.target.closest?.('form[data-form]'); if (!f || !f.closest('.ac-wrap')) return;
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f)), k = f.dataset.form;
    const btn = f.querySelector('[type="submit"]'); if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Working…' }
    try {
      if (k === 'email') { const d = await call('/api/me/email', { email: v.email, password: v.password }); say('email', d.devLink ? `Email isn't set up on this server. <a class="lk" href="${esc(d.devLink)}">Open the confirmation link</a>.` : d.already ? 'That is already your email.' : `Check ${esc(d.pending || d.to)} for the confirmation link. Until you click it, your old email stays on the account.`); await refreshMe() }
      if (k === 'password') { await call('/api/me/password', { current: v.current, password: v.password, others: !!v.others }); say('password', 'Password changed.' + (v.others ? ' Your other devices are signed out.' : '')) }
      if (k === '2fa-on') { const d = await call('/api/me/2fa/enable', { code: v.code }); A.setup = null; A.codes = d.recovery; say('2fa', '') }
      if (k === '2fa-off') { await call('/api/me/2fa/disable', { password: v.password, code: v.code }); say('2fa', 'Two-step sign-in is off.'); await refreshMe() }
      if (k === 'redeem') { const d = await call('/api/billing/redeem', { code: v.code }); A.bill.plan = d.plan; say('more', `Redeemed: ${d.months} month${d.months > 1 ? 's' : ''} of Plus.`); await refreshMe() }
      if (k === 'group-add') { A.bill.plan = (await call('/api/billing/group', { action: 'add', who: v.who })).plan; say('group', `Added. They have Plus now.`) }
      if (k === 'comp') { await call('/api/admin/billing', { action: 'comp', username: v.username, months: +v.months }); A.owner = await call('/api/admin/billing/summary'); say('owner', +v.months ? `@${esc(v.username)} has free Plus for ${+v.months} months.` : `Free Plus removed from @${esc(v.username)}.`) }
      if (k === 'delete') {
        if (!v.sure) throw new Error('Tick the box to confirm.');
        await call('/api/me/delete', { password: v.password, code: v.code });
        track('account_delete', {});
        location.hash = ''; location.reload(); return;
      }
    } catch (e) { oops({ '2fa-on': '2fa', '2fa-off': '2fa', redeem: 'more', 'group-add': 'group', comp: 'owner' }[k] || k, e) }
    draw();
  });
  // arrow keys move between tabs
  document.addEventListener('keydown', ev => {
    const t = ev.target.closest?.('.ac-tabs [role="tab"]'); if (!t || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key)) return;
    const all = [...t.parentElement.children], i = all.indexOf(t), n = all.length;
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : ev.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    ev.preventDefault(); all[j].click();
  });

  window.flAccount = { open: tab => window.flPages?.show('account', tab) };
  const add = () => window.flPages?.add('account', { title: 'Account', fresh: true, render(el, arg) { A.el = el; arrive(arg) } });
  if (window.flPages) add(); else document.addEventListener('DOMContentLoaded', add);
  document.addEventListener('fl:me', () => { if (A.el && document.documentElement.dataset.page === 'account' && !document.activeElement?.closest?.('.ac-wrap form')) draw() });
})();
