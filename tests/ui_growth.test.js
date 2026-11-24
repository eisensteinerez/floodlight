// Browser tests for onboarding, the weekly recap, sharing, the Trust and data page, the owner dashboard and the
// signed-out pages (landing, plans, help), at every width Erez listed.
// Run: node tests/ui_growth.test.js [--shots DIR]   (needs Playwright with Chromium; stand-in feeds from tests/ui_stub.js)
//   1. Onboarding: a dialog with a name, focus inside, Tab stays inside, Escape closes and focus goes back.
//   2. Onboarding step 6 explains one real open line from the verified feed (player, matchup, provider, verified time,
//      hit rate, supported edge, evidence grade). With no open line it says so and uses a marked example.
//   3. Finishing onboarding counts "onboarding_done" for the owner's funnel; skipping counts "onboarding_skip".
//   4. Your week: the recap in plain sentences, a Share picture button, and the First followed prediction milestone.
//   5. Trust and data: evidence quality and known limitations are explained.
//   6. Owner dashboard: conversion rates, plan mix, revenue per active member and Plus features Free members tried.
//   7. Every screen at 320, 375, 390, 430, 768, 1024, 1366 and 1920: no sideways scrolling, every control named,
//      headings in order, tables with headers; on touch screens every control is at least 44 by 44.
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net'), { spawn } = require('child_process'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')) } catch { try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))) } catch { console.log('skipped: Playwright is not installed'); process.exit(0) } }
const { stub } = require('./ui_stub');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) });
const ROOT = path.join(__dirname, '..');
let n = 0, failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok', name) } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 30).join('\n   ')) } }

// stand-in lines: one NBA player in the upcoming Timberwolves v Grizzlies game (the same shape the Lab tests use)
const now = Date.now(), H = 36e5, D = 864e5;
const log = vals => vals.map((v, i) => [v, i % 2 === 0, 34 - (i % 3), i % 4 === 0 ? 'Grizzlies' : 'Lakers', i % 4 === 0 ? 'MEM' : 'LAL', new Date(now - (i + 1) * 2 * D).toISOString().slice(0, 10)]);
const NBA = { at: Math.round(now / 1000) - 60, checked: 40, rows: [{ player: 'Anthony Edwards', team: 'MIN', opp: 'MEM', teamName: 'Timberwolves', k: 'pts', label: 'Points', line: 25.5, side: 'over',
  start: new Date(now + 2 * H).toISOString(), photo: '', books: ['prizepicks', 'sleeper'], offers: [{ book: 'prizepicks', line: 25.5 }, { book: 'sleeper', line: 25.5, pOver: .48 }],
  games: log([31, 28, 22, 30, 27, 33, 24, 29, 26, 35, 30, 28, 27, 31, 22, 25, 29, 30]), l10: 0, teamOk: true,
  // what the verified market service adds to a line it has checked (markets.py)
  mid: 'nba:401002:edwards:pts:over', eventId: '401002', status: 'open', eventStatus: 'scheduled', verifiedAt: Math.round(now / 1000) - 60, oppName: 'Grizzlies' }] };
const EMPTY = { rows: [], at: Math.round(now / 1000) };

const WIDTHS = [[320, 640, true], [375, 812, true], [390, 844, true], [430, 932, true], [768, 1024, true], [1024, 768, true], [1366, 768, false], [1920, 1080, false]];
const AUDIT = () => {
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[aria-hidden="true"],[hidden]');
  const out = { unnamed: [], tables: [], skips: [], past: [] };
  for (const el of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox]'))
    if (vis(el) && !window.flOverlay.name(el)) out.unnamed.push(el.outerHTML.slice(0, 120));
  for (const tb of document.querySelectorAll('table')) if (vis(tb) && !tb.querySelector('th')) out.tables.push(tb.className);
  const scope = document.querySelector('.obd-card') || document.querySelector('.flpage:not([hidden])') || document.getElementById('flGate') || document.getElementById('hub');
  let last = +(scope?.querySelector('h1,h2')?.tagName[1] || 1);
  for (const h of scope?.querySelectorAll('h1,h2,h3,h4,h5,h6') || []) { if (!vis(h) && !h.closest('.sr-only')) continue; const l = +h.tagName[1]; if (l > last + 1) out.skips.push(`${h.tagName} "${h.textContent.trim().slice(0, 30)}" after h${last}`); last = l }
  const vw = innerWidth, clip = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false };
  for (const e of document.querySelectorAll('body *')) { if (!e.getClientRects().length || e.matches('.skip') || e.closest('[hidden],[aria-hidden="true"],.sr-only,svg')) continue;
    const r = e.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1) && !clip(e)) out.past.push(`${e.tagName}.${String(e.className).slice(0, 30)}`) }
  out.past = out.past.slice(0, 4); out.sw = document.documentElement.scrollWidth - vw;
  return out;
};
const SMALL = () => [...document.querySelectorAll(':is(.obd-card, .flpage:not([hidden]), #flGate) :is(button,a[href],input,select,summary,[role=tab],[role=radio])')].filter(e => {
  if (!e.getClientRects().length || e.closest('[inert],[aria-hidden="true"],[hidden],.skip') || e.matches('input[type=checkbox]:not([role=switch]),input[type=radio]')) return false;
  const r = e.getBoundingClientRect(); if (r.top > innerHeight * 4 || r.width === 0) return false;
  // a link inside running text is exempt (WCAG 2.5.8); a control inside a label or row that is itself big enough counts as that
  if (e.matches('a') && e.closest('p,li small,.lb') && getComputedStyle(e).display === 'inline') return false;
  const lab = (e.matches('.sw') && e.closest('label') || e.closest('label,td'))?.getBoundingClientRect(); return (r.width < 43.5 || r.height < 43.5) && !(lab && lab.width >= 43.5 && lab.height >= 43.5) })
  .map(e => `${e.tagName}.${String(e.className).slice(0, 24)}[${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24)}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);

(async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}/`, data = fs.mkdtempSync(path.join(os.tmpdir(), 'flgrowth-'));
  const srv = spawn('python3', ['server.py', String(port)], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, FLOODLIGHT_OPEN: '', FLOODLIGHT_DATA_DIR: data, FLOODLIGHT_ADMIN: 'owner', FLOODLIGHT_ADMIN_PASSWORD: 'stand-in-pass-123', DATABASE_URL: '' } });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base); if (r.ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
  const browser = await chromium.launch();
  // o: { w, h, touch, hash, lines (the NBA board or EMPTY), signedIn, onboarded, seed }
  const page = async (o = {}) => {
    const { w = 390, h = 844, touch = w < 1100, hash = '', lines = NBA, signedIn = true, onboarded = true, seed = null } = o;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 900 }); await stub(ctx);
    await ctx.route(/\/api\/lab\/board\?sport=/, r => { const sp = new URL(r.request().url()).searchParams.get('sport'); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sp === 'nba' ? lines : EMPTY) }) });
    ctx.sent = []; await ctx.route(/\/api\/t$/, r => { try { ctx.sent.push(...JSON.parse(r.request().postData() || '{}').events.map(e => e.e)) } catch {} r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) });
    await ctx.addInitScript(([ob, seed]) => { localStorage.setItem('floodlight-theme', 'stadium-gold'); if (ob) localStorage.setItem('fl.onboarded', '1');
      if (seed && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)) } }, [onboarded, seed]);
    if (signedIn) {
      const r = await ctx.request.post(base + 'api/auth/login', { data: { username: 'owner', password: 'stand-in-pass-123' } }); assert.ok(r.ok(), 'the stand-in owner can sign in');
      const me = await (await ctx.request.get(base + 'api/me')).json(); await ctx.request.post(base + 'api/me/terms', { data: { version: me.terms } });   // the Terms, accepted once
    } else await ctx.route(/\/api\/me$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, gated: true, terms: '' }) }));   // the hosted site, signed out
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); p.ctx = ctx;
    await p.goto(base + hash, { waitUntil: 'domcontentloaded' });
    return p;
  };
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }) };
  const openOnboarding = async p => { await p.waitForFunction(() => window.flOnboard && window.S?.me, null, { timeout: 15000 }); await p.evaluate(() => window.flOnboard.open()); await p.waitForSelector('.obd-card [role="dialog"], .obd-card'); };
  const toStep = async (p, k) => { for (let i = 0; i < k; i++) { const force = p.locator('.obd [data-ob="force"]'); await p.click('.obd [data-ob="next"]'); if (await force.count()) await force.click() } };

  /* ---------- 1. onboarding is a proper dialog ---------- */
  await t('1 onboarding: named modal dialog, focus inside, Tab stays inside, Escape closes and returns focus', async () => {
    const p = await page({ w: 390, h: 844 });
    await p.waitForFunction(() => window.flOnboard && window.S?.me, null, { timeout: 15000 });
    await p.evaluate(() => { const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'Set up Home again'; b.dataset.obagain = ''; document.body.appendChild(b); b.focus(); b.click() });
    const dlg = p.locator('.obd-card');
    assert.strictEqual(await dlg.getAttribute('role'), 'dialog'); assert.strictEqual(await dlg.getAttribute('aria-modal'), 'true');
    assert.ok(await p.evaluate(() => !!document.getElementById(document.querySelector('.obd-card').getAttribute('aria-labelledby'))?.textContent.trim()), 'the dialog has a name');
    assert.ok(await p.evaluate(() => document.querySelector('.obd-card').contains(document.activeElement)), 'focus starts inside');
    for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); assert.ok(await p.evaluate(() => document.querySelector('.obd-card').contains(document.activeElement)), `Tab ${i + 1} left the dialog`) }
    for (let i = 0; i < 5; i++) await p.keyboard.press('Shift+Tab');
    assert.ok(await p.evaluate(() => document.querySelector('.obd-card').contains(document.activeElement)), 'Shift+Tab left the dialog');
    await p.keyboard.press('Escape');
    assert.strictEqual(await p.locator('.obd').count(), 0, 'Escape closes it');
    assert.strictEqual(await p.evaluate(() => document.activeElement?.id), 'opener', 'focus goes back to the button that opened it');
    assert.deepStrictEqual(p.errors, []);
    await p.ctx.close();
  });

  /* ---------- 2. the tour shows a real verified line ---------- */
  await t('2 onboarding step 6: one real open line from the verified feed, explained', async () => {
    const p = await page({ w: 1366, h: 900, touch: false });
    await openOnboarding(p); await toStep(p, 5);
    await p.waitForSelector('.obd-live', { timeout: 10000 });
    const txt = await p.locator('.obd-card').innerText();
    for (const want of ['Anthony Edwards', 'Points', 'Over 25.5', 'Timberwolves', 'PrizePicks', 'verified', 'Hit rate', 'Supported edge', 'Evidence grade', 'Follow', 'Save to a board', 'Prediction Card'])
      assert.ok(txt.includes(want), `the tour should say "${want}"`);
    assert.ok(/Over in \d+ of the last 10/.test(txt), 'the hit rate is the real count from the game log');
    assert.ok(/This one is [ABCD]/.test(txt), 'the evidence grade is the line’s own');
    assert.ok(!/made-up/.test(txt), 'a real line is not called an example');
    await shot(p, 'onboarding-tour-1366');
    assert.deepStrictEqual(p.errors, []);
    await p.ctx.close();
  });
  await t('2b onboarding step 6 with no open line: says so and marks the example', async () => {
    const p = await page({ w: 390, h: 844, lines: EMPTY });
    await openOnboarding(p); await toStep(p, 5);
    await p.waitForFunction(() => /made-up numbers/.test(document.querySelector('.obd-card')?.innerText || ''), null, { timeout: 12000 });
    const txt = await p.locator('.obd-card').innerText();
    assert.ok(/No verified line is open right now/.test(txt) && /example uses made-up numbers/.test(txt));
    assert.strictEqual(await p.locator('.obd-live').count(), 0);
    await p.ctx.close();
  });

  /* ---------- 3. the funnel hears about it ---------- */
  await t('3 finishing onboarding counts onboarding_done; skipping counts onboarding_skip', async () => {
    const p = await page({ w: 390, h: 844 });
    await openOnboarding(p); await toStep(p, 6);
    await p.waitForSelector('.obd [data-ob="finish"]'); await p.click('.obd [data-ob="finish"]');
    await openOnboarding(p); await p.click('.obd [data-ob="skip"]');
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); dispatchEvent(new Event('pagehide')) });
    await p.waitForTimeout(800);
    assert.ok(p.ctx.sent.includes('onboarding_done'), `sent: ${p.ctx.sent.join(', ')}`);
    assert.ok(p.ctx.sent.includes('onboarding_skip'), `sent: ${p.ctx.sent.join(', ')}`);
    await p.ctx.close();
  });

  /* ---------- 4. the weekly recap ---------- */
  const day = k => { const x = new Date(); x.setDate(x.getDate() - k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` };
  const SEED = { 'fl.activity': { [day(0)]: { p: ['LeBron James', 'Jalen Brunson'], s: ['nba'], f: 1, m: 1, n: 3 }, [day(1)]: { p: ['Connor McDavid'], s: ['nhl', 'nba'], f: 0, m: 0, n: 1 } },
    'fl.pdFollow': [{ k: 'a1', id: 'prop:nba:LeBron James:pts:24.5', name: 'LeBron James', text: 'Over 24.5 points', sport: 'nba', start: now + H, edge: 9, at: now - H }] };
  await t('4 Your week: plain sentences, Share picture, First followed prediction milestone', async () => {
    const p = await page({ w: 390, h: 844, hash: '#/recap', seed: SEED });
    await p.waitForSelector('#rcpBody .rcp-line', { timeout: 15000 });
    const line = await p.locator('.rcp-line').innerText();
    assert.ok(line.includes('You researched 3 players.') && line.includes('You followed 1 prediction.') && line.includes('One saved line moved.') && line.includes('Your most researched sport was NBA.'), line);
    assert.ok(await p.locator('[data-rcpshare]').isVisible(), 'a Share picture button');
    const ach = await p.locator('.rcp-ach').innerText();
    assert.ok(/First followed prediction[\s\S]*Reached/.test(ach), ach);
    await shot(p, 'recap-390');
    assert.deepStrictEqual(p.errors, []);
    await p.ctx.close();
  });

  /* ---------- 5. Trust and data ---------- */
  await t('5 Trust and data: evidence quality and known limitations', async () => {
    const p = await page({ w: 1366, h: 900, touch: false, hash: '#/status' });
    await p.waitForSelector('#dsMeth', { timeout: 15000 });
    const txt = await p.locator('#pg-status, .flpage:not([hidden])').first().innerText();
    assert.ok(/Evidence quality/.test(txt) && /Known limitations/.test(txt), 'both methods are listed');
    await p.locator('summary', { hasText: 'Known limitations' }).click();
    assert.ok(/PrizePicks and Sleeper/.test(await p.locator('.ds-m[open]').innerText()));
    await p.ctx.close();
  });

  /* ---------- 6. Owner dashboard ---------- */
  await t('6 owner dashboard: conversion rates, plan mix, revenue per active member, Plus features Free members tried', async () => {
    const p = await page({ w: 1366, h: 900, touch: false, hash: '#/owner' });
    await p.waitForSelector('#owJH', { timeout: 15000 });
    const txt = await p.locator('.flpage:not([hidden])').innerText();
    for (const want of ['Landing page to account', 'Sign-up completion', 'Upgrade page to trial or paid', 'Plus features Free members tried', 'Which Plus features Free members tried', 'Opened sign-up'])
      assert.ok(txt.includes(want), `the dashboard should show "${want}"`);
    await shot(p, 'owner-1366');
    const a = await p.evaluate(AUDIT); assert.deepStrictEqual({ unnamed: a.unnamed, tables: a.tables, skips: a.skips }, { unnamed: [], tables: [], skips: [] });
    assert.deepStrictEqual(p.errors, []);
    await p.ctx.close();
  });

  /* ---------- 7. every width ---------- */
  const SCREENS = [['landing', '', false], ['help', '#/help', true], ['invite', '#/invite', true], ['groups', '#/groups', true], ['trust', '#/status', true], ['owner', '#/owner', true],
    ['pricing', '#/pricing', true], ['account', '#/account', true], ['recap', '#/recap', true], ['onboarding', '', true]];
  for (const [w, h, touch] of WIDTHS) {
    await t(`7 ${w}px: no sideways scroll, names, headings${touch ? ', 44px targets' : ''}`, async () => {
      const bad = [];
      for (const [name, hash, signedIn] of SCREENS) {
        const p = await page({ w, h, touch, hash, signedIn, seed: SEED });
        if (name === 'landing') await p.waitForSelector('#lpH1', { timeout: 15000 });
        else if (name === 'onboarding') { await openOnboarding(p); await toStep(p, 5); await p.waitForTimeout(400) }
        else { await p.waitForSelector('.flpage:not([hidden]) h1', { timeout: 15000 }); await p.waitForTimeout(700) }
        const a = await p.evaluate(AUDIT), small = touch ? await p.evaluate(SMALL) : [];
        if (a.sw > 1 || a.past.length) bad.push(`${name}: ${a.sw}px sideways scroll ${a.past.join(' ')}`);
        if (a.unnamed.length) bad.push(`${name}: unnamed ${a.unnamed.slice(0, 3).join(' | ')}`);
        if (a.tables.length) bad.push(`${name}: table without headers ${a.tables.join(' ')}`);
        if (a.skips.length) bad.push(`${name}: heading skips ${a.skips.join(' | ')}`);
        if (small.length) bad.push(`${name}: small targets ${small.slice(0, 5).join(' | ')}`);
        if (p.errors.length) bad.push(`${name}: page errors ${p.errors.join(' | ')}`);
        if ((w === 320 || w === 1920) && SHOTS) await shot(p, `${name}-${w}`);
        await p.ctx.close();
      }
      assert.deepStrictEqual(bad, []);
    });
  }

  await browser.close(); srv.kill(); fs.rmSync(data, { recursive: true, force: true });
  console.log(`${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
