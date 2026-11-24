/* Floodlight · what the member's plan allows. entitlements.py on the server decides (plans and limits come from
   plans.json); this only reads the answers in /api/me's plan block, so the browser never decides plan rules itself.
   window.flEntitlements  the same named checks as entitlements.py: canUseUnlimitedLab(), canUseAdvancedFilters(),
                          canCreateUnlimitedBoards(), canUseAdvancedAlerts(), canViewProviderComparison(),
                          canViewLineHistory(), canViewFullHistory(), canViewFullPredictions(), canUseFullSplits(),
                          canShareCards(), canFollowUnlimited(), canCreateGroup()
   window.flPlan
     can(feature)        true when the member may use a Plus feature. Always true while the owner has plan limits off.
     limit(name)         a Free limit (lab_search 5 a day, boards 1, followed_players 3, predictions 3) or null for none
     left(name)          what's left of a daily limit today, or null
     use(what, item)     count one Free use on the server: await flPlan.use('lab_search', 'nba:1966') -> {ok, left}
                         The same item twice in a day counts once. Never throws; offline counts as ok.
     upsell(feature, el) draws a small "Plus feature" note in el (or returns its HTML when el is omitted)
     paid(), info()      is the member on a paid plan right now; the whole plan block
   Feature keys: lab_unlimited, boards_unlimited, advanced_filters, splits_full, provider_compare, line_history,
   advanced_alerts, pick_history_full, share_cards, predictions_full, follows_unlimited.
   Fires "fl:plan" on document when the plan changes (after sign-in, checkout, cancel). */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const info = () => (window.S && S.me && S.me.plan) || null;
  const names = () => info()?.names || {};   // feature names come from plans.json through the server
  const enforced = () => !!info()?.enforced;
  const can = f => { const p = info(); if (!p || !p.enforced) return true; return p.features ? p.features[f] !== false : true };
  const limit = n => { const p = info(); return p && p.enforced ? (p.limits?.[n] ?? null) : null };
  const left = n => { const l = limit(n); if (l == null) return null; return Math.max(0, l - (info()?.used?.[n] || 0)) };
  async function use(what = 'lab_search', item = '') {
    const p = info();
    if (!p || !p.enforced || p.paid) return { ok: true, left: null };
    try {
      const r = await fetch('/api/plan/use', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what, item: String(item || '') }) });
      const d = await r.json().catch(() => ({}));
      if (p.used) p.used[what] = d.ok ? (limit(what) ?? 0) - (d.left ?? 0) : limit(what);
      document.dispatchEvent(new CustomEvent('fl:plan'));
      return { ok: !!d.ok, left: d.left ?? null, error: d.error };
    } catch { return { ok: true, left: null } }
  }
  function upsell(feature, el) {
    const name = names()[feature] || 'This';
    const html = `<div class="plan-up" role="note"><span class="plan-up-tag">Plus</span><p><strong>${esc(name)}</strong> ${feature === 'lab_unlimited' ? "is part of Plus. You've used today's free searches; they reset at midnight." : 'is part of Plus.'}</p>
      <a class="bt sm" href="#/pricing" data-page="pricing">See Plus</a></div>`;
    if (el) el.innerHTML = html;
    return html;
  }
  window.flPlan = { can, limit, left, use, upsell, enforced, info, paid: () => !!info()?.paid, get names() { return names() } };
  // one function per named check; signed out or before /api/me arrives they answer like the server would with limits off
  const CHECKS = { canUseUnlimitedLab: 'lab_unlimited', canUseAdvancedFilters: 'advanced_filters', canCreateUnlimitedBoards: 'boards_unlimited',
    canUseAdvancedAlerts: 'advanced_alerts', canViewProviderComparison: 'provider_compare', canViewLineHistory: 'line_history',
    canViewFullHistory: 'pick_history_full', canViewFullPredictions: 'predictions_full', canUseFullSplits: 'splits_full',
    canShareCards: 'share_cards', canFollowUnlimited: 'follows_unlimited' };
  window.flEntitlements = Object.fromEntries(Object.entries(CHECKS).map(([fn, f]) => [fn, () => { const c = info()?.can; return c && fn in c ? !!c[fn] : can(f) }]));
  window.flEntitlements.canCreateGroup = () => !!info()?.can?.canCreateGroup;   // a real Group plan, whatever the limits switch says
  // a 402 from the server means a Free limit: show the upgrade note as a toast where the page has no place for it
  document.addEventListener('fl:me', () => document.dispatchEvent(new CustomEvent('fl:plan')));
})();
