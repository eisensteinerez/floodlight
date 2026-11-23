/* Floodlight · Invite friends (#/invite): the member's invite link and code, who joined with it, the reward, and the
   shareable pictures (weekly recap here; player cards and prediction evidence from their own Share buttons).
   The server (referrals.py) decides when a friend counts, so a reward can't be earned with made-up accounts:
   a friend counts after a verified payment, or after real use (3 different days, 5 searches or players opened, an
   account at least 2 days old) when nothing about the sign-up points back to the member's own browser or network. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => { try { return S.me } catch { return null } };
  const V = { data: null, err: '', recap: null, copied: false };
  const link = code => `${location.origin}/?ref=${encodeURIComponent(code)}`;
  const day = t => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  async function get(u) { const r = await fetch(u, { credentials: 'same-origin', cache: 'no-store' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `The server answered ${r.status}.`); return d }

  function friendRow(f) {
    const status = f.counts ? `<span class="pl solid">Counts${f.via === 'payment' ? ', paid plan' : ''}</span>`
      : f.flags.length ? `<span class="pl">Counts after a paid plan</span>` : `<span class="pl">Not yet</span>`;
    const detail = f.counts ? `Joined ${day(f.joined)}` : f.flags.length ? `Joined ${day(f.joined)}. ${esc(f.flags.join('. '))}, so only a paid plan counts.`
      : `Joined ${day(f.joined)}. Active ${f.days} of 3 days, ${f.actions} of 5 searches or players`;
    return `<li class="rw"><span class="rw-t"><b>${esc(f.name)}</b><small>${detail}</small></span>${status}</li>`;
  }
  function render(el) {
    const u = me(), d = V.data;
    if (!u) { el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Invite friends</h1></div></header><div class="card emp"><b>Sign in to get your invite link</b><p>Your link and code are tied to your account, so friends who join are counted for you.</p><button type="button" class="bt" data-rf="signin">Sign in</button></div>`; return }
    const per = d?.perReward || 3, got = d ? d.counting % per : 0;
    el.innerHTML = `<header class="pg-head"><div><h1 class="pg-title">Invite friends</h1><p class="pg-sub">Share Floodlight with people who would use it. Every 3 friends who become regulars earn you a free month of Plus.</p></div></header>
      <div class="rf-grid">
        <section class="card rf-link" aria-labelledby="rfLinkH"><h2 id="rfLinkH">Your invite link</h2>
          ${d ? `<div class="rf-copy"><label class="sr-only" for="rfUrl">Invite link</label><input class="inp" id="rfUrl" readonly value="${esc(link(d.code))}" spellcheck="false">
            <button type="button" class="bt" data-rf="copy">${V.copied ? 'Copied' : 'Copy link'}</button>${navigator.share ? '<button type="button" class="bt ghost" data-rf="share">Share</button>' : ''}</div>
            <p class="lb">Or tell them your code: <b class="rf-code" translate="no">${esc(d.code)}</b>. They can add it within two days of joining.</p>
            <p class="lb" role="status" aria-live="polite" id="rfSay"></p>`
            : `<p class="lb">${V.err ? esc(V.err) : 'Loading your link…'}</p>${V.err ? '<button type="button" class="bt sm ghost" data-rf="reload">Try again</button>' : ''}`}
        </section>
        <section class="card rf-prog" aria-labelledby="rfProgH"><h2 id="rfProgH">Your reward</h2>
          ${d ? `<p class="rf-big"><b class="fig">${got} of ${per}</b><span>friends counted toward your next free month</span></p>
            <div class="trak" role="img" aria-label="${got} of ${per} friends counted"><i style="width:${got / per * 100}%"></i></div>
            <dl class="rf-nums"><div><dt>Friends joined</dt><dd>${d.joined}</dd></div><div><dt>Counted</dt><dd>${d.counting}</dd></div><div><dt>Free months earned</dt><dd>${d.monthsEarned}</dd></div></dl>
            ${d.monthsWaiting ? `<p class="lb">${d.monthsWaiting} free month${d.monthsWaiting === 1 ? ' is' : 's are'} waiting on your account. ${u.plan_status ? 'It is used before your next payment.' : 'It is used when you move to Plus, so you won’t be charged for that month.'}</p>` : ''}` : ''}
        </section>
      </div>
      <section class="card rf-friends" aria-labelledby="rfFrH"><div class="sec-h"><h2 id="rfFrH">Friends who joined</h2></div>
        ${d ? d.friends.length ? `<ul class="rf-list">${d.friends.map(friendRow).join('')}</ul>` : '<p class="lb">No one has joined with your link yet. When someone does, they appear here with how close they are to counting.</p>' : ''}
        <details class="drw card flat rf-rules"><summary>How a friend counts</summary><div class="drw-b">
          <p>A friend counts once they pay for a plan, or once they really use Floodlight: on 3 different days, with at least 5 Lab searches or players opened, and an account at least 2 days old.</p>
          <p>To keep the reward fair, a friend who joins from your own browser or your own network, or as one of many sign-ups through your link in a single day, only counts after a paid plan. Floodlight compares a scrambled version of the network, never the address itself. You can’t use your own code.</p>
          <p>You can earn up to 12 free months a year.</p></div></details>
      </section>
      <section class="card rf-share" aria-labelledby="rfShH"><div class="sec-h"><h2 id="rfShH">Share your research</h2></div>
        <div class="rf-sh-grid">
          <div class="tile"><h3>Your week</h3>${recapLine()}<button type="button" class="bt sm" data-rf="recap"${V.recap ? '' : ' disabled'}>Make the picture</button></div>
          <div class="tile"><h3>Player cards and evidence</h3><p class="lb">Open a player in the Lab or a pick on Predictions and use Share. The picture says it is research, not a guarantee.</p><button type="button" class="bt sm ghost" data-shell="lab">Open the Lab</button></div>
          <div class="tile"><h3>Boards</h3><p class="lb">Share a saved board from the Lab as a read-only link. Friends see the lines and notes, and can’t change anything.</p><button type="button" class="bt sm ghost" data-shell="lab">Go to my boards</button></div>
        </div>
        <p class="lb">Links you share from Floodlight carry your invite code.</p>
      </section>`;
  }
  function recapLine() {
    const r = V.recap; if (!r) return '<p class="lb">Loading this week…</p>';
    const w = r.thisWeek || {}, n = (w.search || 0) + (w.player_open || 0);
    return n || r.activeDays ? `<p class="lb">${w.search || 0} searches, ${w.player_open || 0} players opened, ${w.prediction_follow || 0} predictions followed and ${r.activeDays} active day${r.activeDays === 1 ? '' : 's'} so far this week.</p>`
      : '<p class="lb">Nothing counted yet this week. Your recap fills in as you research.</p>';
  }
  async function load() {
    try { V.data = await get('/api/referrals'); V.err = ''; window.flRef?.set(V.data.code) } catch (e) { V.data = null; V.err = 'Your invite link didn’t load. ' + e.message }
    try { V.recap = await get('/api/me/recap') } catch { V.recap = { thisWeek: {}, activeDays: 0 } }
    window.flPages?.redraw('invite');
  }
  window.flPages?.add('invite', { title: 'Invite friends', render, onShow() { if (me()) load() } });
  document.addEventListener('fl:me', () => { if (me() && !V.data) get('/api/referrals').then(d => { V.data = d; window.flRef?.set(d.code) }).catch(() => {}); if (window.flPages?.current?.() === 'invite') { window.flPages.redraw('invite'); if (me()) load() } });
  const say = t => { const s = document.getElementById('rfSay'); if (s) { s.textContent = ''; setTimeout(() => { s.textContent = t }, 30) } };
  document.addEventListener('click', async ev => {
    const a = ev.target.closest?.('[data-rf]')?.dataset.rf; if (!a) return;
    if (a === 'signin') { try { S.prof.mode = 'login' } catch {} return typeof openProfile === 'function' && openProfile() }
    if (a === 'reload') { V.err = ''; window.flPages.redraw('invite'); return load() }
    if (!V.data) return;
    const url = link(V.data.code);
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(url); V.copied = true; ev.target.closest('button').textContent = 'Copied'; say('Link copied.') }
      catch { const i = document.getElementById('rfUrl'); i.focus(); i.select(); say('Press Ctrl+C or Cmd+C to copy the selected link.') }
      window.flTrack?.('invite_copy');
    }
    if (a === 'share') { try { await navigator.share({ title: 'Floodlight', text: 'Research every game in one place.', url }); window.flTrack?.('share', { kind: 'invite' }) } catch {} }
    if (a === 'recap' && window.flShare && V.recap) {
      const w = V.recap.thisWeek || {};
      window.flShare.share({ kicker: 'My week on Floodlight', title: `${(w.search || 0) + (w.player_open || 0)} research moves this week`, file: 'weekly-recap',
        stats: [['Lab searches', w.search || 0], ['Players opened', w.player_open || 0], ['Predictions followed', w.prediction_follow || 0], ['Active days', V.recap.activeDays || 0]],
        foot: `Research, not a guarantee. Join: ${url.replace(/^https?:\/\//, '')}` }, ev.target.closest('button'));
      window.flTrack?.('share', { kind: 'recap' });
    }
  });
})();
