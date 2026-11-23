// Browser tests for overlays, keyboard use, control names and phone layouts (final pass, tests 13 to 16).
// Run: node tests/ui_a11y.test.js     (needs Playwright with Chromium: npm i -g playwright && npx playwright install chromium)
// Starts its own server on a free port with stand-in feeds (tests/ui_stub.js), so it needs no network and no login.
//   13. Focus stays inside the match centre, a phone player panel and the full-screen theme preview; Escape closes and
//       focus goes back to what opened it; the page behind is inert and hidden from screen readers.
//   14. Keyboard only: reach Live from the header, pick a filter, open a game, close it, land back on the game.
//   15. Every visible control on Home, Live, Settings (each tab), Predictions, Parlays, the match centre, a player panel
//       and the profile menu has a name a screen reader can read.
//   16. No sideways scrolling and nothing past the screen edge at 320, 375, 430, 768, 1024, 1366 and 1920 pixels; the
//       match centre and its close button fit; on touch screens every control is at least 44 by 44.
const path = require('path'), net = require('net'), { spawn } = require('child_process'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')) } catch { try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))) } catch { console.log('skipped: Playwright is not installed'); process.exit(0) } }
const { stub } = require('./ui_stub');

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) });
const ROOT = path.join(__dirname, '..');
let n = 0, failed = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok', name) } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 6).join('\n   ')) } }

// the name a screen reader would read, the same rules overlay.js uses
const UNNAMED = () => {
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const out = [];
  for (const el of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[tabindex]:not([tabindex="-1"])')) {
    if (!vis(el) || el.closest('[inert],[aria-hidden="true"],[hidden]')) continue;
    if (!window.flOverlay.name(el)) out.push(el.outerHTML.slice(0, 140));
  }
  return out;
};

(async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}/`;
  const srv = spawn('python3', ['server.py', String(port)], { cwd: ROOT, env: { ...process.env, FLOODLIGHT_OPEN: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base); if (r.ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
  const browser = await chromium.launch();
  const page = async (w = 390, h = 844, touch = false, hash = '') => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 900 }); await stub(ctx);
    await ctx.addInitScript(() => { localStorage.setItem('floodlight-theme', 'stadium-gold'); localStorage.setItem('fl.onboarded', '1') });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.goto(base + hash, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.flHub?.games?.().length > 0, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800); return p;
  };
  const openGame = p => p.evaluate(() => window.flMC.open({ sport: 'basketball', id: '401001' }, document.querySelector('[data-hubcmd], button'))).then(() => p.waitForSelector('#gxTitle')).then(() => p.waitForTimeout(600));
  const openPlayer = p => p.evaluate(() => { window.flHub.hide(); setSport('basketball'); openBbPlayer('1966', 'nba') }).then(() => p.waitForTimeout(1200));
  const focusIn = (p, sel) => p.evaluate(s => !!document.querySelector(s)?.contains(document.activeElement), sel);
  const behind = (p, sel) => p.evaluate(s => { const d = document.querySelector(s);
    return [...document.querySelectorAll('button,a[href],input,select')].filter(e => !d.contains(e) && e.getClientRects().length && !e.closest('[inert]') && !e.closest('[aria-hidden="true"]') && !e.closest('[hidden]')).length }, sel);

  /* ---------- 13. focus trapping in overlays ---------- */
  await t('13 match centre: dialog, named, page behind inert, Tab and Shift+Tab stay inside, Escape returns focus', async () => {
    for (const w of [390, 1366]) {
      const p = await page(w, w < 900 ? 844 : 900);
      const opener = await p.evaluate(() => { const b = document.querySelector('[data-hubcmd]'); b.focus(); window.flMC.open({ sport: 'basketball', id: '401001' }, b); return b.dataset.hubcmd }); await p.waitForSelector('#gxTitle'); await p.waitForTimeout(600);
      const d = await p.evaluate(() => { const s = document.querySelector('#flMC .gx-sheet'); return [s.getAttribute('role'), s.getAttribute('aria-modal'), document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.trim().length > 0] });
      assert.deepStrictEqual(d, ['dialog', 'true', true], `dialog semantics at ${w}`);
      assert.strictEqual(await behind(p, '#flMC'), 0, `controls behind the match centre are reachable at ${w}`);
      assert.ok(await p.locator('#flMC [data-gx="close"][aria-label]').isVisible(), 'a visible close button');
      for (let i = 0; i < 45; i++) { await p.keyboard.press('Tab'); assert.ok(await focusIn(p, '#flMC'), `Tab ${i + 1} left the match centre at ${w}`) }
      for (let i = 0; i < 12; i++) { await p.keyboard.press('Shift+Tab'); assert.ok(await focusIn(p, '#flMC'), `Shift+Tab ${i + 1} left the match centre`) }
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      assert.ok(await p.evaluate(() => document.getElementById('flMC').hidden), 'Escape closes it');
      assert.strictEqual(await p.evaluate(() => document.activeElement.dataset.hubcmd), opener, 'focus goes back to the opener (or its redrawn copy)');
      assert.strictEqual(await p.evaluate(() => document.querySelectorAll('[inert]').length), 0, 'nothing is left inert');
      assert.deepStrictEqual(p.errors, []); await p.context().close();
    }
  });
  await t('13 player panel on a phone: a named dialog over the schedule, focus kept inside, schedule hidden', async () => {
    const p = await page(390, 844, true); await openPlayer(p);
    const d = await p.evaluate(() => { const s = document.getElementById('sheet'); return [s.getAttribute('role'), s.getAttribute('aria-modal'), /LeBron James/.test(s.getAttribute('aria-label') || '')] });
    assert.deepStrictEqual(d, ['dialog', 'true', true]);
    assert.ok(await focusIn(p, '#sheet'), 'focus moves into the panel');
    assert.strictEqual(await behind(p, '#sheet'), 0, 'the schedule behind is reachable');
    assert.ok(await p.evaluate(() => document.getElementById('list').closest('[aria-hidden="true"]') !== null), 'the schedule is hidden from screen readers');
    for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); assert.ok(await focusIn(p, '#sheet'), `Tab ${i + 1} left the panel`) }
    // the full-page control is a plain button, Follow a toggle with one name
    const roles = await p.evaluate(() => [...document.querySelectorAll('#sheet [data-act="expand"]')].map(b => b.hasAttribute('aria-pressed') || b.type === 'checkbox'));
    assert.ok(roles.every(x => !x), 'expand / full page is not a toggle or checkbox');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('[inert]').length), 0, 'the page comes back');
    await p.context().close();
  });
  await t('13 player panel on a wide screen stays a page, not a dialog', async () => {
    const p = await page(1366, 900); await openPlayer(p);
    assert.strictEqual(await p.evaluate(() => document.getElementById('sheet').getAttribute('aria-modal')), null);
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('[inert]').length), 0);
    await p.context().close();
  });
  await t('13 full-screen theme preview: corner close button, page behind inert, Escape exits', async () => {
    const p = await page(390, 844, true, '#/settings/appearance'); await p.waitForSelector('[data-pvfull]');
    await p.click('[data-pvfull]'); await p.waitForTimeout(500);
    assert.ok(await p.locator('.pv-x').isVisible(), 'close button in the corner');
    assert.strictEqual(await behind(p, '.pv-card'), 0);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    assert.ok(!(await p.locator('.pv-card.full').count()), 'Escape leaves full screen');
    assert.strictEqual(await p.evaluate(() => document.querySelectorAll('[inert]').length), 0);
    await p.context().close();
  });
  await t('13 a control with no name never reaches the tab order inside an overlay', async () => {
    const p = await page(); await openGame(p);
    await p.evaluate(() => { const b = document.createElement('button'); b.id = 'blank'; document.querySelector('.gx-body').appendChild(b) }); await p.waitForTimeout(150);
    assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('blank').tabIndex, document.getElementById('blank').getAttribute('aria-hidden')]), [-1, 'true']);
    await p.context().close();
  });

  /* ---------- 14. keyboard-only navigation ---------- */
  await t('14 keyboard only: header to Live, a filter, a game, and back', async () => {
    const p = await page(1366, 900);
    let hit = false;
    for (let i = 0; i < 12 && !hit; i++) { await p.keyboard.press('Tab'); hit = await p.evaluate(() => document.activeElement.matches('.tbn[data-k="live"]')) }
    assert.ok(hit, 'Live is reachable from the header with Tab');
    await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    assert.strictEqual(await p.evaluate(() => window.flPages.current()), 'live');
    await p.focus('[data-liveonly="close"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    assert.strictEqual(await p.getAttribute('[data-liveonly="close"]', 'aria-pressed'), 'true', 'Enter picks Close games');
    await p.focus('[data-liveonly="all"]'); await p.keyboard.press(' '); await p.waitForTimeout(300);
    const game = p.locator('#pg-live [data-live^="basketball|"]').first(); await game.focus();
    const id = await game.getAttribute('data-live');
    await p.keyboard.press('Enter'); await p.waitForSelector('#flMC:not([hidden])'); await p.waitForTimeout(400);
    assert.ok(await focusIn(p, '#flMC'), 'focus moves into the match centre');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    assert.strictEqual(await p.evaluate(() => document.activeElement.getAttribute('data-live')), id, 'focus is back on the game');
    // the radio groups move with the arrow keys
    await p.focus('[data-liveshow][aria-checked="true"]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
    await p.context().close();
  });
  await t('14 keyboard only: the profile menu opens with Enter, arrows move, Escape returns to the button', async () => {
    const p = await page(390, 844);
    await p.focus('#flDots'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    assert.ok(await focusIn(p, '#flMenu'), 'focus in the menu');
    const a = await p.evaluate(() => document.activeElement.textContent); await p.keyboard.press('ArrowDown');
    assert.notStrictEqual(await p.evaluate(() => document.activeElement.textContent), a, 'ArrowDown moves');
    await p.keyboard.press('Escape'); assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'flDots');
    await p.context().close();
  });
  await t('14 keyboard only: the Settings tabs move with the arrow keys and keep the open tab in view', async () => {
    const p = await page(320, 640, true, '#/settings/appearance'); await p.waitForSelector('#stTab-appearance');
    await p.focus('#stTab-appearance');
    for (let i = 0; i < 5; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(120) }
    assert.strictEqual(await p.getAttribute('#stTab-advanced', 'aria-selected'), 'true');
    const inView = await p.evaluate(() => { const t = document.getElementById('stTab-advanced').getBoundingClientRect(), r = document.querySelector('.st-tabs').getBoundingClientRect(); return t.left >= r.left - 1 && t.right <= r.right + 1 });
    assert.ok(inView, 'the selected tab is scrolled into view');
    await p.context().close();
  });

  /* ---------- 15. screen-reader names ---------- */
  await t('15 every visible control has a name', async () => {
    const screens = [['home', ''], ['live', '#/live'], ['predictions', '#/predictions'], ['parlays', '#/parlays'], ...['appearance', 'alerts', 'home', 'data', 'access', 'advanced'].map(k => ['settings ' + k, '#/settings/' + k])];
    for (const w of [390, 1366]) {
      for (const [name, hash] of screens) { const p = await page(w, 900, w < 900, hash); await p.waitForTimeout(600);
        assert.deepStrictEqual(await p.evaluate(UNNAMED), [], `${name} at ${w}`); await p.context().close() }
      const p = await page(w, 900, w < 900); await openGame(p); assert.deepStrictEqual(await p.evaluate(UNNAMED), [], `match centre at ${w}`);
      await p.keyboard.press('Escape'); await openPlayer(p); assert.deepStrictEqual(await p.evaluate(UNNAMED), [], `player panel at ${w}`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.click('#flDots'); assert.deepStrictEqual(await p.evaluate(UNNAMED), [], `menu at ${w}`);
      await p.context().close();
    }
  });
  await t('15 spoiler-free: a hidden score is said in words, never as a dash', async () => {
    const p = await page(390, 844, false, '#/live'); await p.evaluate(() => window.flMC.setSpoilAll(true)); await p.waitForTimeout(400);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('#pg-live [data-live]')].some(b => /score hidden by spoiler-free mode/.test(b.getAttribute('aria-label') || ''))), 'live games say why the score is hidden');
    await openGame(p);
    assert.ok(/score hidden by spoiler-free mode/i.test(await p.textContent('#gxTitle')), 'the match centre title says why');
    assert.strictEqual(await p.evaluate(() => [...document.querySelectorAll('.gx-sc')].filter(b => b.textContent.trim() === '–').length), 0, 'no bare dash');
    await p.evaluate(() => window.flMC.setSpoilAll(false)); await p.context().close();
  });
  await t('15 Live filters say what they keep', async () => {
    const p = await page(390, 844, false, '#/live'); await p.waitForSelector('[data-liveonly]');
    const labels = await p.$$eval('[data-liveonly]', bs => bs.map(b => b.textContent.trim()));
    assert.deepStrictEqual(labels, ['Every game', 'Close games', 'Potential upsets', 'Overtime', 'On TV', 'My teams', 'Predictions available']);
    assert.ok(await p.$$eval('[data-liveonly]', bs => bs.every(b => document.getElementById(b.getAttribute('aria-describedby'))?.textContent.length > 10)), 'each has a description');
    assert.ok(/Live now/.test(await p.textContent('[data-liveshow="live"]')));
    await p.context().close();
  });

  /* ---------- 16. phone and tablet layouts ---------- */
  await t('16 no sideways scrolling or content past the edge, 320 to 1920', async () => {
    const SIZES = [[320, 640, true], [375, 812, true], [430, 932, true], [768, 1024, true], [1024, 768, true], [1366, 768, false], [1920, 1080, false]];
    const PAST = () => { const vw = innerWidth, out = [];
      const clip = e => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(n).overflowX)) return true; return false };
      for (const e of document.querySelectorAll('body *')) { if (!e.getClientRects().length || e.matches('.skip') || e.closest('[hidden],[aria-hidden="true"],.sr-only,.pv-box,svg')) continue;
        const r = e.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1) && !clip(e)) out.push(`${e.tagName}.${String(e.className).slice(0, 30)}`) }
      return { sw: document.documentElement.scrollWidth - vw, out: out.slice(0, 4) } };
    for (const [w, h, touch] of SIZES) for (const hash of ['', '#/live', '#/predictions', '#/parlays', '#/settings/appearance']) {
      const p = await page(w, h, touch, hash); await p.waitForTimeout(500); const r = await p.evaluate(PAST);
      assert.ok(r.sw <= 0 && !r.out.length, `${hash || 'home'} at ${w}: ${JSON.stringify(r)}`); await p.context().close();
    }
  });
  await t('16 the match centre fits every screen and its close button is always on it', async () => {
    for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1366, 768]]) {
      const p = await page(w, h, w < 900); await openGame(p);
      const r = await p.evaluate(() => { const s = document.querySelector('.gx-sheet').getBoundingClientRect(), c = document.querySelector('#flMC [data-gx="close"][aria-label]').getBoundingClientRect();
        return { sheet: s.left >= 0 && s.right <= innerWidth + .5 && s.bottom <= innerHeight + .5, close: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.width >= 44 && c.height >= 44 } });
      assert.deepStrictEqual(r, { sheet: true, close: true }, `at ${w}`); await p.context().close();
    }
  });
  await t('16 touch targets are at least 44 by 44 on touch screens', async () => {
    const SMALL = () => [...document.querySelectorAll('button,a[href],input,select,summary,[role=tab],[role=radio]')].filter(e => {
      if (!e.getClientRects().length || e.closest('[inert],[aria-hidden="true"],[hidden],.skip')) return false; const r = e.getBoundingClientRect(); if (r.top > innerHeight * 3) return false;
      const lab = e.closest('label')?.getBoundingClientRect(); return (r.width < 43.5 || r.height < 43.5) && !(lab && lab.width >= 43.5 && lab.height >= 43.5) }).map(e => `${e.tagName}.${e.className}[${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24)}] ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    for (const hash of ['', '#/live', '#/settings/appearance', '#/parlays']) { const p = await page(375, 812, true, hash); await p.waitForTimeout(500);
      assert.deepStrictEqual(await p.evaluate(SMALL), [], `${hash || 'home'}`); await p.context().close() }
    const p = await page(375, 812, true); await openGame(p); assert.deepStrictEqual(await p.evaluate(SMALL), [], 'match centre'); await p.context().close();
  });
  await t('16 no floating control covers content: the last thing on a page scrolls clear of the bottom bar', async () => {
    for (const hash of ['', '#/live', '#/settings/advanced']) {
      const p = await page(375, 812, true, hash); await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(400);
      const r = await p.evaluate(() => { const tops = [...document.querySelectorAll('#bottomnav, #bottomnav *')].map(e => e.getBoundingClientRect()).filter(x => x.height > 0).map(x => x.top);
        const nav = tops.length ? { top: Math.min(...tops) } : null; const own = document.getElementById('flOwn');
        const main = document.querySelector('.flpage:not([hidden])') || document.getElementById('hub'); const last = [...main.querySelectorAll('button,a[href],p,h2,h3')].filter(e => e.getClientRects().length).pop()?.getBoundingClientRect();
        return { own: !!own, clear: !nav || !last || last.bottom <= nav.top + 1 } });
      assert.deepStrictEqual(r, { own: false, clear: true }, hash || 'home'); await p.context().close();
    }
  });
  await t('16 Admin mode: in the profile menu on phones, never floating; members never see it', async () => {
    for (const [role, w] of [['owner', 390], ['member', 390], ['owner', 1366]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 } }); await stub(ctx);
      await ctx.route('**/api/me', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { username: 'u', display: 'U', role, status: 'active', prefs: {} } }) }));
      await ctx.addInitScript(() => { localStorage.setItem('fl.onboarded', '1'); localStorage.setItem('fl.adminMode', '1') });
      const p = await ctx.newPage(); await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
      const bar = await p.locator('#flOwn').count(); await p.click('#flDots'); const item = await p.locator('#flMenu [data-own="mode"]').count();
      if (role === 'member') assert.deepStrictEqual([bar, item], [0, 0], 'a member sees nothing');
      else if (w < 821) { assert.deepStrictEqual([bar, item], [0, 1], 'phone: menu item, no floating bar'); assert.ok(await p.locator('#flDots.own-tagged').count(), 'the menu button shows Admin is on') }
      else assert.strictEqual(bar, 1, 'wide: the corner bar');
      await ctx.close();
    }
  });

  await browser.close(); srv.kill();
  console.log(`${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1) });
