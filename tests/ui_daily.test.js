// Browser tests for Home's briefing, Your day, Your week, competitions, the alerts inbox and Settings › Alerts.
// Run: node tests/ui_daily.test.js     (needs Playwright with Chromium; uses the stand-in feeds in tests/ui_stub.js)
//   1. Speed: Home's main content shows within 2 seconds; no skeleton stays up; nothing shifts once drawn.
//   2. Every new screen at 320, 375, 390, 430, 768 (portrait), 1024 (landscape), 1366 and 1920: no sideways scrolling,
//      every control has a name, every table has headers, every chart has a text summary, headings never skip a level.
//   3. Touch screens: every control on the new screens is at least 44 by 44.
//   4. Alerts: a test notification lands in the inbox and the bell counts it; previews are never kept; a notification
//      link (#/open/...) opens the right screen; Back returns to the same scroll position.
//   5. Navigation: Transfers is in the menu and the More sheet, not the main bar; the new screens are one tap away.
const path = require('path'), net = require('net'), { spawn } = require('child_process'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')) } catch { try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))) } catch { console.log('skipped: Playwright is not installed'); process.exit(0) } }
const { stub } = require('./ui_stub');

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) });
const ROOT = path.join(__dirname, '..');
let n = 0, failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok', name) } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 40).join('\n   ')) } }

const SCREENS = ['', '#/today', '#/recap', '#/inbox', '#/groups', '#/settings/alerts'];
// what a screen reader needs and what the eye needs, checked in the page
const AUDIT = () => {
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[aria-hidden="true"],[hidden]');
  const out = { unnamed: [], tables: [], charts: [], skips: [], past: [] };
  for (const el of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox]'))
    if (vis(el) && !window.flOverlay.name(el)) out.unnamed.push(el.outerHTML.slice(0, 120));
  for (const tb of document.querySelectorAll('table')) if (vis(tb) && !tb.querySelector('th')) out.tables.push(tb.className);
  for (const f of document.querySelectorAll('.rcp-chart,figure')) if (vis(f) && !(f.querySelector('figcaption')?.textContent.trim())) out.charts.push(f.className);
  const scope = document.querySelector('.flpage:not([hidden])') || document.getElementById('hub');
  let last = 1; for (const h of scope?.querySelectorAll('h1,h2,h3,h4,h5,h6') || []) { if (!vis(h) && !h.closest('.sr-only')) continue; const l = +h.tagName[1]; if (l > last + 1) out.skips.push(`${h.tagName} "${h.textContent.trim().slice(0, 30)}" after h${last}`); last = l }
  const vw = innerWidth, clip = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false };
  for (const e of document.querySelectorAll('body *')) { if (!e.getClientRects().length || e.matches('.skip') || e.closest('[hidden],[aria-hidden="true"],.sr-only,svg')) continue;
    const r = e.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1) && !clip(e)) out.past.push(`${e.tagName}.${String(e.className).slice(0, 30)}`) }
  out.past = out.past.slice(0, 4); out.sw = document.documentElement.scrollWidth - vw;
  return out;
};
const SMALL = () => [...document.querySelectorAll('.flpage:not([hidden]) :is(button,a[href],input,select,summary,[role=tab],[role=radio]), #hub :is(button,a[href],input,select,summary)')].filter(e => {
  if (!e.getClientRects().length || e.closest('[inert],[aria-hidden="true"],[hidden],.skip')) return false; const r = e.getBoundingClientRect(); if (r.top > innerHeight * 4) return false;
  const lab = (e.matches('.sw:only-child') && e.closest('.st-row') || e.closest('label,td'))?.getBoundingClientRect(); return (r.width < 43.5 || r.height < 43.5) && !(lab && lab.width >= 43.5 && lab.height >= 43.5) }).map(e => `${e.tagName}.${e.className}[${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24)}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);

(async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}/`;
  const srv = spawn('python3', ['server.py', String(port)], { cwd: ROOT, env: { ...process.env, FLOODLIGHT_OPEN: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base); if (r.ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
  const browser = await chromium.launch();
  const page = async (w = 390, h = 844, touch = false, hash = '', seed = true) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 900 }); await stub(ctx);
    await ctx.addInitScript(s => { localStorage.setItem('floodlight-theme', 'night-match'); localStorage.setItem('fl.onboarded', '1');
      if (s && !localStorage.getItem('fl.seeded')) { localStorage.setItem('fl.seeded', '1');
        // a returning member: a followed player, a followed pick, some history and an alert
        localStorage.setItem('fl.follows', JSON.stringify([{ k: 'player', lg: 'nba', id: '1966', name: 'LeBron James' }]));
        localStorage.setItem('fl.pdFollow', JSON.stringify([{ k: 'a1', id: 'prop:nba:LeBron James:pts:24.5', name: 'LeBron James', text: 'Over 24.5 points', sport: 'nba', start: Date.now() + 3600e3, edge: 9, at: Date.now() - 3600e3 }]));
        const d = new Date(), day = k => { const x = new Date(d); x.setDate(d.getDate() - k); return x.toISOString().slice(0, 10) };
        localStorage.setItem('fl.activity', JSON.stringify({ [day(0)]: { p: ['LeBron James', 'Jalen Brunson'], s: ['nba'], f: 1, m: 0, n: 3 }, [day(2)]: { p: ['Connor McDavid'], s: ['nhl'], f: 0, m: 1, n: 1 } })) } }, seed);
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    p.t0 = Date.now(); await p.goto(base + hash, { waitUntil: 'domcontentloaded' });
    return p;
  };
  const settle = p => p.waitForFunction(() => window.flHub?.games?.().length > 0, null, { timeout: 15000 }).catch(() => {}).then(() => p.waitForTimeout(900));

  /* ---------- 1. speed ---------- */
  await t('1 Home: main content within 2 seconds, greeting first, no skeleton left, no layout shift after it settles', async () => {
    const p = await page(390, 844);
    await p.waitForSelector('#hub .hm-brief, #hub .hm-greet', { timeout: 5000 });
    const ms = await p.evaluate(() => performance.now());
    assert.ok(ms < 2000, `main content took ${Math.round(ms)} ms`);
    await settle(p);
    assert.ok(await p.locator('#hmGreetH').isVisible(), 'the greeting shows');
    await p.evaluate(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: false }) });
    await p.waitForTimeout(3000);
    const cls = await p.evaluate(() => window.__cls);
    assert.ok(cls < 0.1, `layout shift after load ${cls}`);
    const skl = await p.evaluate(() => [...document.querySelectorAll('#hub .skl, #hub [aria-busy="true"]')].filter(e => e.getClientRects().length).length);
    assert.strictEqual(skl, 0, 'a skeleton is still showing on Home');
    assert.deepStrictEqual(p.errors, []);
    await p.context().close();
  });
  await t('1 every Home summary opens a filtered screen', async () => {
    const p = await page(1366, 900); await settle(p);
    const cmds = await p.evaluate(() => [...new Set([...document.querySelectorAll('#hub [data-hubcmd]')].map(b => b.dataset.hubcmd))]);
    assert.ok(cmds.length >= 3, `summaries: ${cmds}`);
    for (const c of cmds) {
      await p.evaluate(() => { window.flPages?.hide?.(); window.flHub.show() }); await p.waitForTimeout(300);
      const before = await p.evaluate(() => location.hash);
      await p.evaluate(c => document.querySelector(`#hub [data-hubcmd="${c}"]`)?.click(), c); await p.waitForTimeout(400);
      const after = await p.evaluate(() => ({ hash: location.hash, page: window.flPages?.current?.() }));
      assert.ok(after.page || after.hash !== before, `${c} did not open anything`);
    }
    assert.deepStrictEqual(p.errors, []); await p.context().close();
  });

  /* ---------- 2. every screen, every width ---------- */
  await t('2 new screens at 320 to 1920: no sideways scroll, named controls, table headers, chart text, no heading skips', async () => {
    const SIZES = [[320, 640, true], [375, 812, true], [390, 844, true], [430, 932, true], [768, 1024, true], [1024, 768, true], [1366, 768, false], [1920, 1080, false]];
    const bad = [];
    for (const [w, h, touch] of SIZES) {
      const p = await page(w, h, touch); await settle(p);
      for (const hash of SCREENS) {
        await p.evaluate(h => { if (h) location.hash = h; else { window.flPages?.hide?.(); window.flHub.show() } }, hash); await p.waitForTimeout(700);
        if (hash === '#/settings/alerts') { await p.evaluate(() => { document.querySelectorAll('#stAlerts details').forEach(d => d.open = true); document.querySelector('[data-al-rule="new"]')?.click() }); await p.waitForTimeout(300) }
        const r = await p.evaluate(AUDIT);
        for (const k of ['unnamed', 'tables', 'charts', 'skips', 'past']) if (r[k].length) bad.push(`${hash || 'home'} @${w} ${k}: ${r[k].slice(0, 3).join(' | ')}`);
        if (r.sw > 0) bad.push(`${hash || 'home'} @${w} scrolls sideways by ${r.sw}px`);
      }
      if (p.errors.length) bad.push(`@${w} errors: ${p.errors.slice(0, 2).join(' | ')}`);
      await p.context().close();
    }
    assert.deepStrictEqual(bad, []);
  });

  /* ---------- 3. touch targets ---------- */
  await t('3 touch targets on the new screens are at least 44 by 44', async () => {
    const p = await page(375, 812, true); await settle(p); const bad = [];
    for (const hash of SCREENS) {
      await p.evaluate(h => { if (h) location.hash = h; else { window.flPages?.hide?.(); window.flHub.show() } }, hash); await p.waitForTimeout(700);
      if (hash === '#/settings/alerts') await p.evaluate(() => document.querySelectorAll('#stAlerts details').forEach(d => d.open = true));
      const s = await p.evaluate(SMALL); if (s.length) bad.push(`${hash || 'home'}: ${s.slice(0, 4).join(' | ')}`);
    }
    assert.deepStrictEqual(bad, []); await p.context().close();
  });

  /* ---------- 4. alerts ---------- */
  await t('4 a test notification is kept in the inbox and counted on the bell; a preview is not kept', async () => {
    const p = await page(1366, 900, false, '#/settings/alerts'); await settle(p);
    await p.selectOption('#alPv', 'summary'); await p.click('[data-al-prev]'); await p.waitForTimeout(200);
    assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('fl.inbox') || '[]').length), 0, 'a preview was kept');
    await p.click('[data-al-test]'); await p.waitForTimeout(300);
    assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('fl.inbox') || '[]').length), 1);
    assert.strictEqual((await p.textContent('#tbBellN')).trim(), '1');
    assert.match(await p.getAttribute('#tbBell', 'aria-label'), /1 unread/);
    await p.click('#tbBell'); await p.waitForSelector('.ibx-open');
    await p.click('.ibx-open'); await p.waitForTimeout(300);
    assert.ok(await p.locator('#tbBellN').isHidden(), 'opening the alert marks it read');
    assert.deepStrictEqual(p.errors, []); await p.context().close();
  });
  await t('4 a notification link opens the right screen and leaves a clean address', async () => {
    const p = await page(390, 844, false, '#/open/' + encodeURIComponent(JSON.stringify({ page: 'recap' }))); await settle(p);
    assert.strictEqual(await p.evaluate(() => window.flPages.current()), 'recap');
    assert.ok(!(await p.evaluate(() => location.hash)).startsWith('#/open/'));
    assert.deepStrictEqual(p.errors, []); await p.context().close();
  });
  await t('4 Back returns to the same scroll position', async () => {
    const p = await page(390, 844, false, '#/settings/alerts'); await settle(p);
    await p.evaluate(() => document.querySelectorAll('#stAlerts details').forEach(d => d.open = true));
    await p.evaluate(() => scrollTo(0, 700)); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('#stAlerts [data-page="inbox"]').click()); await p.waitForTimeout(500);
    assert.strictEqual(await p.evaluate(() => window.flPages.current()), 'inbox');
    await p.goBack(); await p.waitForTimeout(900);
    const y = await p.evaluate(() => scrollY);
    assert.ok(Math.abs(y - 700) < 30, `scrolled to ${y}`);
    await p.context().close();
  });
  await t('4 a line alert can be set up from the feed and is listed with a delete button', async () => {
    const p = await page(1366, 900, false, '#/settings/alerts'); await settle(p);
    await p.waitForFunction(() => (window.flFeed?.now?.() || []).length > 0, null, { timeout: 15000 }).catch(() => {});
    const m = await p.evaluate(() => { const m = window.flFeed.now()[0]; return m && { name: m.name } });
    if (!m) return console.log('   (no stand-in lines in this run; skipped)');
    await p.click('[data-al-rule="new"]'); await p.fill('#alRp', m.name); await p.dispatchEvent('#alRp', 'change'); await p.waitForTimeout(200);
    await p.click('.al-rule [type="submit"]'); await p.waitForTimeout(200);
    const rules = await p.evaluate(() => window.flAlerts.settings().rules.length);
    assert.strictEqual(rules, 1); assert.ok(await p.locator('.al-rules [data-al-rule^="del:"]').isVisible());
    assert.deepStrictEqual(p.errors, []); await p.context().close();
  });

  /* ---------- 5. navigation ---------- */
  await t('5 Transfers is in the menu and the More sheet, not the main bar; new screens are one tap away', async () => {
    const p = await page(1366, 900); await settle(p);
    assert.strictEqual(await p.locator('#tbNav [data-shell="transfers"]').count(), 0);
    await p.click('#flDots');
    for (const s of ['[data-shell="transfers"]', '[data-page="today"]', '[data-page="recap"]', '[data-page="inbox"]', '[data-page="groups"]']) assert.ok(await p.locator(`#flMenu ${s}`).isVisible(), s);
    await p.context().close();
    const q = await page(390, 844, true); await settle(q);
    for (const s of ['[data-shell="transfers"]', '[data-page="today"]', '[data-page="inbox"]', '[data-page="groups"]']) assert.strictEqual(await q.locator(`#flSheet ${s}`).count(), 1, s);
    await q.context().close();
  });

  await browser.close(); srv.kill();
  console.log(`${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
