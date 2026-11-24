// Browser tests for the Lab: tools as tabs, Prop Explorer and the research panel, and saved boards.
// Run: node tests/ui_lab.test.js [--shots DIR]   (needs Playwright with Chromium, like tests/ui_a11y.test.js)
// Starts its own server with stand-in feeds (tests/ui_stub.js) and stand-in player lines for /api/lab/board.
const path = require('path'), fs = require('fs'), net = require('net'), { spawn } = require('child_process'), assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')) } catch { try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))) } catch { console.log('skipped: Playwright is not installed'); process.exit(0) } }
const { stub } = require('./ui_stub');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) });
const ROOT = path.join(__dirname, '..');
let n = 0, failed = 0;
async function t(name, fn) { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; try { await fn(); n++; console.log('ok', name) } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 6).join('\n   '), process.env.ONLY ? e.stack.split('\n').find(l => l.includes('ui_lab.test')) : '') } }

// stand-in lines: three NBA players in the upcoming Timberwolves v Grizzlies game, one NFL player
const now = Date.now(), H = 36e5, D = 864e5;
const log = (vals, home0 = true, opp = 'Grizzlies', abbr = 'MEM') => vals.map((v, i) => [v, (i % 2 === 0) === home0, 34 - (i % 3), i % 4 === 0 ? opp : 'Lakers', i % 4 === 0 ? abbr : 'LAL', new Date(now - (i + 1) * 2 * D).toISOString().slice(0, 10)]);
const row = (o) => ({ player: o.player, team: o.team, opp: o.opp, k: o.k, label: o.label, line: o.line, side: o.side || 'over', start: new Date(o.start).toISOString(), photo: '', books: o.books || ['prizepicks', 'sleeper'],
  offers: o.offers || [{ book: 'prizepicks', line: o.line }, { book: 'sleeper', line: o.line, pOver: o.pOver ?? .5 }], games: log(o.vals), l10: 0, teamOk: true, teamName: o.teamName || '' });
const NBA = { at: Math.round(now / 1000) - 60, checked: 40, rows: [
  row({ player: 'Anthony Edwards', team: 'MIN', opp: 'MEM', teamName: 'Timberwolves', k: 'pts', label: 'Points', line: 25.5, start: now + 2 * H, vals: [31, 28, 22, 30, 27, 33, 24, 29, 26, 35, 30, 28, 27, 31, 22, 25, 29, 30], pOver: .48 }),
  row({ player: 'Rudy Gobert', team: 'MIN', opp: 'MEM', teamName: 'Timberwolves', k: 'reb', label: 'Rebounds', line: 11.5, side: 'under', start: now + 2 * H, vals: [9, 10, 13, 8, 11, 12, 10, 9, 14, 10, 11, 9], pOver: .55 }),
  row({ player: 'Ja Morant', team: 'MEM', opp: 'MIN', teamName: 'Grizzlies', k: 'ast', label: 'Assists', line: 7.5, start: now + 2 * H, vals: [8, 9, 6, 10], books: ['prizepicks'], offers: [{ book: 'prizepicks', line: 7.5 }] }),
] };
const NFL = { at: Math.round(now / 1000) - 120, checked: 20, rows: [
  row({ player: 'Jalen Hurts', team: 'PHI', opp: 'LV', teamName: 'Eagles', k: 'pyds', label: 'Passing yards', line: 215.5, start: now + 3 * H, vals: [240, 198, 260, 221, 230, 190, 250, 205, 233, 260], pOver: .5,
    offers: [{ book: 'prizepicks', line: 215.5 }, { book: 'sleeper', line: 224.5, pOver: .5 }] }),
] };

(async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}/`;
  const srv = spawn('python3', ['server.py', String(port)], { cwd: ROOT, env: { ...process.env, FLOODLIGHT_OPEN: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base); if (r.ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
  const browser = await chromium.launch();
  const page = async (w = 1440, h = 900, theme = 'stadium-gold') => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 }); await stub(ctx);
    await ctx.route(/\/api\/lab\/board\?sport=/, r => { const sp = new URL(r.request().url()).searchParams.get('sport'); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sp === 'nba' ? NBA : sp === 'nfl' ? NFL : { rows: [], at: Math.round(now / 1000) }) }) });
    await ctx.addInitScript(t => { localStorage.setItem('floodlight-theme', t); localStorage.setItem('fl.onboarded', '1'); localStorage.removeItem('fl.px') }, theme);
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.goto(base + '#/lab', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#labAsk', { timeout: 15000 }); await p.waitForTimeout(600); return p;
  };
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }) };
  const explorer = async p => { await p.click('[data-labtool="props"]'); await p.waitForSelector('.px-t tbody tr', { timeout: 20000 }); await p.waitForTimeout(300) };

  await t('Lab tools are a tablist: tabs with aria-selected, never pressed toggles, arrow keys move and open', async () => {
    const p = await page();
    const roles = await p.$$eval('.lab-tool', bs => bs.map(b => [b.getAttribute('role'), b.getAttribute('aria-selected'), b.hasAttribute('aria-pressed')]));
    assert.deepStrictEqual(roles, Array(4).fill(['tab', 'false', false]));
    assert.strictEqual(await p.getAttribute('.lab-tools', 'role'), 'tablist');
    await explorer(p);
    assert.strictEqual(await p.getAttribute('#labTab-props', 'aria-selected'), 'true');
    assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('labWs').getAttribute('role'), document.getElementById('labWs').getAttribute('aria-labelledby')]), ['tabpanel', 'labTab-props']);
    await p.focus('#labTab-props'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'labTab-compare');
    assert.strictEqual(await p.getAttribute('#labTab-compare', 'aria-selected'), 'true');
    assert.deepStrictEqual(p.errors, []);
  });

  await t('Prop Explorer lists every open line from the feed, with L5/L10/L20, supported edge and an evidence letter', async () => {
    const p = await page(); await explorer(p); await shot(p, 'explorer-1440');
    const names = await p.$$eval('.px-t tbody .px-open .px-nm', bs => bs.map(b => b.textContent));
    assert.deepStrictEqual(names.slice().sort(), ['Anthony Edwards', 'Ja Morant', 'Jalen Hurts', 'Rudy Gobert']);
    const g = await p.$$eval('.px-g b', bs => bs.map(b => b.textContent)); assert.ok(g.every(x => /^[ABCD]$/.test(x)), g.join());
    // the count beside each rate, so colour is never the only signal
    assert.ok(await p.$$eval('td[data-k="Last 10"] small', s => s.length > 0 && s.every(x => /^\d+\/\d+$/.test(x.textContent))));
    assert.match(await p.textContent('.px-sum'), /4 open lines across 2 sports/);
    assert.deepStrictEqual(p.errors, []);
  });

  await t('filters: sport chips, player search, a filter chip that removes itself, and an empty state that clears', async () => {
    const p = await page(); await explorer(p);
    await p.click('[data-pxsport="nfl"]'); await p.waitForTimeout(200);
    assert.deepStrictEqual(await p.$$eval('.px-t tbody .px-open .px-nm', bs => bs.map(b => b.textContent)), ['Jalen Hurts']);
    await p.click('[data-pxsport="all"]'); await p.fill('#pxQ', 'gob'); await p.waitForTimeout(400);
    assert.deepStrictEqual(await p.$$eval('.px-t tbody .px-open .px-nm', bs => bs.map(b => b.textContent)), ['Rudy Gobert']);
    await p.click('[data-pxdrop="q"]'); await p.waitForTimeout(200);
    assert.strictEqual(await p.$$eval('.px-t tbody tr', r => r.length), 4);
    await p.click('[data-px="filters"]'); await p.selectOption('#pxSide', { label: 'Under only' }); await p.waitForTimeout(200);
    assert.deepStrictEqual(await p.$$eval('.px-t tbody .px-open .px-nm', bs => bs.map(b => b.textContent)), ['Rudy Gobert']);
    await p.selectOption('#pxL5', { label: '100%' }); await p.waitForTimeout(200); await shot(p, 'explorer-empty-1440');
    assert.ok(await p.isVisible('text=No lines match these filters'));
    await p.click('.emp [data-px="clear"]'); await p.waitForTimeout(200);
    assert.strictEqual(await p.$$eval('.px-t tbody tr', r => r.length), 4);
  });

  await t('sorts: starting soon puts the NBA game first; highest hit rate leads with a 100% or the best rate', async () => {
    const p = await page(); await explorer(p);
    await p.selectOption('#pxSort', 'soon'); await p.waitForTimeout(200);
    assert.notStrictEqual(await p.textContent('.px-t tbody tr:first-child .px-open .px-nm'), 'Jalen Hurts');
    await p.selectOption('#pxSort', 'hit'); await p.waitForTimeout(200);
    const rates = await p.$$eval('td[data-k="Last 10"] b', bs => bs.map(b => parseInt(b.textContent)));
    assert.deepStrictEqual(rates, rates.slice().sort((a, b) => b - a));
  });

  await t('research panel: a named dialog with the numbers, breakdown, grade, splits, chart summary and game log; Escape returns focus', async () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const p = await page(w, h); await explorer(p);
      const btn = p.locator('[data-pxopen]').filter({ hasText: 'Anthony Edwards' }); await btn.focus(); await btn.click(); await p.waitForSelector('#rpT'); await p.waitForTimeout(400);
      await shot(p, `panel-${w}`);
      const d = await p.evaluate(() => { const s = document.querySelector('.rp-sheet'); return [s.getAttribute('role'), s.getAttribute('aria-modal'), document.getElementById('rpT').textContent] });
      assert.deepStrictEqual(d, ['dialog', 'true', 'Anthony Edwards']);
      const txt = await p.textContent('.rp-sheet');
      for (const s of ['Floodlight chance', 'Supported edge', 'Evidence quality', 'Sample', 'Raw edge', ...(await p.evaluate(() => !!window.flMarkets) ? ['Sample-size adjustment', 'Availability adjustment', 'Data-quality adjustment'] : []), 'Last 5', 'Last 20', 'This season', 'Home', 'Away', 'Average', 'Median', 'Every provider', 'Line history', 'Add to Prediction Card', 'Follow', 'Save to board', 'Share'])
        assert.ok(txt.includes(s), `panel at ${w} is missing “${s}”`);
      assert.match(await p.textContent('#rpChT'), /^Over 25\.5 in \d+ of \d+/);
      // the breakdown adds up to the supported edge shown
      const eb = await p.$$eval('.rp-eb td', ts => ts.map(t => +t.textContent.replace('−', '-').replace('+', '')));
      if (await p.evaluate(() => !!window.flMarkets)) assert.strictEqual(eb.slice(0, -1).reduce((a, b) => a + b, 0), eb[eb.length - 1]);
      else assert.ok(eb.length === 2 && eb[1] <= eb[0], 'without per-reason factors only raw and supported are shown');
      await p.click('[data-rptab="log"]'); assert.ok(await p.isVisible('.rp-log')); assert.strictEqual(await p.getAttribute('[data-rptab="log"]', 'aria-selected'), 'true');
      for (let i = 0; i < 30; i++) { await p.keyboard.press('Tab'); assert.ok(await p.evaluate(() => !!document.querySelector('#flRP')?.contains(document.activeElement)), `Tab ${i + 1} left the panel at ${w}`) }
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      assert.ok(!(await p.$('#flRP')), 'the panel closes on Escape');
      assert.match(await p.evaluate(() => document.activeElement?.textContent || ''), /Anthony Edwards/);
      assert.deepStrictEqual(p.errors, []);
    }
  });

  await t('Line Lens: the slider and a drag recount the games, provider lines are snap points, the posted line comes back', async () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const p = await page(w, h); await explorer(p);
      await p.locator('[data-pxopen]').filter({ hasText: 'Jalen Hurts' }).click(); await p.waitForSelector('#llR'); await p.waitForTimeout(300);
      // two open lines, each a snap point with its provider and when it was verified; the posted one is pressed
      const chips = await p.$$eval('[data-llsnap]', bs => bs.map(b => [b.dataset.llsnap, b.getAttribute('aria-pressed'), b.textContent]));
      assert.deepStrictEqual(chips.map(c => c[0]), ['215.5', '224.5']); assert.strictEqual(chips[0][1], 'true');
      assert.match(chips[0][2], /PrizePicks/); assert.match(chips[1][2], /Sleeper/); assert.ok(chips.every(c => /verified|unknown/.test(c[2])));
      assert.match(await p.textContent('#llOut'), /^Over 215\.5 in 7 of the last 10/);
      // the slider: the line moves and the counts follow, in the table and in the words read out
      await p.focus('#llR'); for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowRight');
      assert.strictEqual(await p.inputValue('#llR'), '225.5'); assert.match(await p.textContent('#llOut'), /^Over 225\.5 in 6 of the last 10/);
      assert.match(await p.getAttribute('#llR', 'aria-valuetext'), /225\.5/);
      assert.ok(await p.isVisible('[data-ll="reset"]'));
      // a snap chip jumps to the provider's line
      await p.click('[data-llsnap="224.5"]'); assert.strictEqual(await p.inputValue('#llR'), '224.5');
      assert.strictEqual(await p.getAttribute('[data-llsnap="224.5"]', 'aria-pressed'), 'true');
      // a drag that ends next to a provider line snaps onto it
      await p.locator('[data-llchart]').scrollIntoViewIfNeeded();
      const box = await p.locator('[data-llchart]').boundingBox(), top = +(await p.getAttribute('[data-llchart]', 'data-top'));
      const yAt = v => box.y + box.height * (1 - v / top * 56 / 60);
      await p.mouse.move(box.x + box.width / 2, yAt(250)); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, yAt(215.6), { steps: 6 }); await p.mouse.up();
      assert.strictEqual(await p.inputValue('#llR'), '215.5', 'a drag that ends next to 215.5 snaps onto it');
      // the curve: a rate at every line, with a table version
      assert.ok(await p.$('.ll-cvs path.ll-path')); assert.ok((await p.$$('.ll-tbl tbody tr')).length > 5);
      await p.click('[data-llwin="l5"]'); assert.strictEqual(await p.getAttribute('[data-llwin="l5"]', 'aria-checked'), 'true');
      // the chance and edge above stay on the posted line
      await p.fill('#llR', '200');
      assert.match(await p.textContent('.rp-line .rp-lt'), /215\.5/);
      await p.click('[data-ll="reset"]'); assert.strictEqual(await p.inputValue('#llR'), '215.5'); assert.ok(!(await p.isVisible('[data-ll="reset"]')));
      await p.evaluate(() => document.getElementById('llH').scrollIntoView()); await p.waitForTimeout(150); await shot(p, `linelens-${w}`);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 0, 'no sideways scroll');
      assert.deepStrictEqual(p.errors, []);
    }
  });

  await t('Compare, one player: two lines, two stats, home and away, recent and season, two providers from the open feed', async () => {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const p = await page(w, h);
      // stand-in game log for Jalen Hurts: passing and rushing yards, alternating home and away
      const vals = [240, 198, 260, 221, 230, 190, 250, 205, 233, 260, 212, 244];
      const games = vals.map((v, i) => ({ id: String(900 + i), date: new Date(now - (i + 1) * 7 * D).toISOString(), opp: 'Cowboys', oppAbbr: 'DAL', home: i % 2 === 0, min: null, v: { pyds: v, ryds: 20 + i * 3 } }));
      await p.context().route(/\/api\/lab\/player\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sport: 'nfl', name: 'Jalen Hurts', team: 'Eagles', photo: '', pos: 'QB',
        seasonStart: new Date(now - 200 * D).toISOString(), stats: [{ k: 'pyds', l: 'Passing yards', n: 12 }, { k: 'ryds', l: 'Rushing yards', n: 12 }], games, lines: [{ k: 'pyds', line: 215.5, book: 'prizepicks', kind: 'standard' }], at: Math.round(now / 1000) }) }));
      await explorer(p);   // loads the verified feed, where Hurts has PrizePicks 215.5 and Sleeper 224.5 open
      await p.locator('[data-pxopen]').filter({ hasText: 'Jalen Hurts' }).click(); await p.waitForSelector('[data-rp="compare"]');
      await p.click('[data-rp="compare"]'); await p.waitForSelector('[data-cmpone]', { timeout: 15000 }); await p.waitForTimeout(300);
      assert.strictEqual(await p.getAttribute('[data-cmpwho="one"]', 'aria-checked'), 'true');
      // two lines: the posted line and the next open one
      assert.deepStrictEqual(await p.$$eval('[data-cmpline]', xs => xs.map(x => x.value)), ['215.5', '224.5']);
      assert.match(await p.textContent('.lc-lead'), /From 215\.5 to 224\.5, the overs go from 7 to \d of 10/);
      // two providers: each lane is a provider's open line, with when it was verified
      await p.click('[data-cmpone="books"]'); await p.waitForTimeout(150);
      const lead = await p.textContent('.lc-lead'); assert.match(lead, /over is easier on PrizePicks \(215\.5\)/); assert.match(lead, /under on Sleeper \(224\.5\)/);
      assert.match(await p.textContent('.lc-sum'), /verified/);
      // home and away, recent and season, two stats
      await p.click('[data-cmpone="venue"]'); assert.match(await p.textContent('.lc-cols'), /Home[\s\S]*Away/);
      await p.click('[data-cmpone="form"]'); assert.match(await p.textContent('.lc-cols'), /Last 10[\s\S]*This season/);
      await p.click('[data-cmpone="stats"]'); assert.match(await p.textContent('.lc-cols'), /Passing yards[\s\S]*Rushing yards/);
      // the radio groups move with the arrow keys
      await p.focus('[data-cmpone="stats"]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(50); assert.strictEqual(await p.getAttribute('[data-cmpone="venue"]', 'aria-checked'), 'true');
      assert.ok(await p.evaluate(() => document.activeElement?.dataset.cmpone === 'venue'));
      // back to two players keeps the first one
      await p.click('[data-cmpone="lines"]'); await shot(p, `compare-one-${w}`);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 0, 'no sideways scroll');
      await p.click('[data-cmpwho="two"]'); assert.ok(await p.$('#lc-b'), 'the second slot is back');
      assert.deepStrictEqual(p.errors, []);
    }
  });

  await t('Predictions: Prop Explorer’s player filters narrow the same markets, a line-movement sort, and Clear brings everything back', async () => {
    const p = await page(); await explorer(p);
    await p.evaluate(() => window.flPages.show('predictions')); await p.waitForSelector('#pg-predictions article[data-pk]', { timeout: 20000 });
    await p.selectOption('[data-pdsel="when"]', 'week'); await p.waitForTimeout(200);
    const names = () => p.$$eval('#pg-predictions #pdBoard article[data-pk]', as => [...new Set(as.map(a => a.querySelector('h3, .pd-name, b')?.textContent.trim()))]);
    assert.ok((await p.$$eval('[data-pdsel="sort"] option', os => os.map(o => o.textContent))).includes('Biggest line movement'));
    await p.click('[data-pd="more"]'); await p.waitForSelector('[data-pdpf="stat"]');
    const opts = await p.$$eval('[data-pdpf="stat"] option', os => os.map(o => o.textContent)); assert.ok(opts.includes('Rebounds') && opts.includes('Points'), opts.join());
    for (const k of ['game', 'team', 'provider', 'side', 'grade', 'when', 'injury', 'lineup', 'games']) assert.ok(await p.$(`[data-pdpf="${k}"]`), `no ${k} filter`);
    await p.selectOption('[data-pdpf="stat"]', { label: 'Rebounds' }); await p.waitForTimeout(250);
    const only = await p.textContent('#pdBoard'); assert.ok(only.includes('Rudy Gobert') && !only.includes('Anthony Edwards') && !only.includes('Jalen Hurts'), 'only the rebounds line is left');
    assert.strictEqual(await p.getAttribute('[data-pd="more"]', 'aria-expanded'), 'true');
    // the same filter in Prop Explorer finds the same market
    const lab = await p.evaluate(() => { const K = window.flLabCore; return K.filter(window.flMarkets.open(), { ...K.defaults(), stat: 'reb' }, { now: Date.now() }).map(m => m.name) });
    assert.deepStrictEqual(lab, ['Rudy Gobert']);
    // kept in this browser, and offered back through Continue researching
    assert.strictEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('fl.pdPf'))).stat, 'reb');
    assert.ok(await p.evaluate(() => window.flRecent.list().some(x => x.key === 'filters:predictions' && x.open.filters.pf.stat === 'reb')));
    await p.fill('[data-pdpf="q"]', 'zzz'); await p.waitForTimeout(450); assert.ok(!(await p.textContent('#pdBoard')).includes('Rudy Gobert'));
    await p.click('[data-pd="clear"]'); await p.waitForTimeout(250);
    const back = await p.textContent('#pdBoard'); assert.ok(back.includes('Rudy Gobert') && back.includes('Anthony Edwards'), 'Clear brings every pick back');
    await p.selectOption('[data-pdsel="sort"]', 'move'); await p.waitForTimeout(150); assert.ok((await p.textContent('#pdBoard')).includes('Anthony Edwards'));
    await p.evaluate(() => document.getElementById('pdMore')?.scrollIntoView({ block: 'center' })); await shot(p, 'predictions-filters-1440');
    assert.deepStrictEqual(p.errors, []);
  });

  await t('Add to Prediction Card puts the line on the Predictions slip', async () => {
    const p = await page(); await explorer(p);
    await p.locator('[data-pxopen]').filter({ hasText: 'Rudy Gobert' }).click(); await p.waitForSelector('#rpT');
    await p.click('[data-rp="card"]'); await p.waitForTimeout(200);
    assert.strictEqual(await p.getAttribute('[data-rp="card"]', 'aria-pressed'), 'true');
    assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('fl.slip') || '[]').some(l => l.name === 'Rudy Gobert')));
  });

  await t('Prediction Card: average evidence, the weakest pick, a countdown to the first start, a moved line, and no promise', async () => {
    const p = await page(); await explorer(p);
    await p.evaluate(() => { for (const r of window.flPropX.rows().slice(0, 2)) window.flPredictions.slip.toggle(r.p);
      const s = JSON.parse(localStorage.getItem('fl.slip')); s[0].line0 = s[0].line - 1; localStorage.setItem('fl.slip', JSON.stringify(s)) });
    await p.evaluate(() => window.flPages.show('predictions')); await p.waitForSelector('.pd-slip.has', { timeout: 20000 }); await p.waitForTimeout(500);
    const txt = await p.textContent('.pd-slip');
    for (const s of ['Your Prediction Card', 'Average evidence quality', 'Weakest pick', 'Closes in', 'Share', 'Save card', 'don’t guarantee']) assert.ok(txt.includes(s), `the card is missing “${s}”`);
    await p.evaluate(() => document.querySelector('.pd-slip').scrollIntoView()); await p.waitForTimeout(200); await shot(p, 'prediction-card-1440');
    assert.deepStrictEqual(p.errors, []);
  });

  await t('saved boards: a line flags its move, boards reorder, duplicate, archive, share a read-only link and save as an image', async () => {
    const p = await page(); const shared = {};
    await p.context().route(/\/api\/boards\/(share|unshare)$/, r => { const b = JSON.parse(r.request().postData() || '{}'); if (r.request().url().endsWith('/unshare')) { delete shared[b.id]; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) }
      shared.abc12345 = { by: 'erez', name: b.board.name, items: b.board.items.filter(i => i.kind !== 'note'), notes: b.board.items.filter(i => i.kind === 'note').map(i => i.label), at: Math.round(Date.now() / 1000) }; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'abc12345', at: 1 }) }) });
    await p.context().route(/\/api\/boards\/shared\?/, r => { const id = new URL(r.request().url()).searchParams.get('id'); r.fulfill({ status: shared[id] ? 200 : 404, contentType: 'application/json', body: JSON.stringify(shared[id] || { error: 'This board is no longer shared.' }) }) });
    await p.evaluate(() => { window.S && (S.me = { username: 'erez', prefs: {} }) });
    // save Edwards over 24.5 (the feed now has 25.5: the line moved against the over) and Hurts with a game that has started
    await p.evaluate(now => { window.flBoards.add({ kind: 'player', key: 'player:nba:Anthony Edwards:pts', label: 'Anthony Edwards', sub: 'Points', sport: 'nba', name: 'Anthony Edwards', k: 'pts', line: 24.5, side: 'over', start: now + 7200e3 }, 'Tonight’s NBA');
      window.flBoards.add({ kind: 'player', key: 'player:nfl:Jalen Hurts:pyds', label: 'Jalen Hurts', sub: 'Passing yards', sport: 'nfl', name: 'Jalen Hurts', k: 'pyds', line: 215.5, side: 'over', start: now - 60e3 }, 'Weekend NFL');
      window.flBoards.make('My research') }, now);
    await p.evaluate(() => window.flPages.show('boards')); await p.waitForSelector('.bd-card'); await p.waitForTimeout(1500);
    const txt = await p.textContent('#pg-boards');
    assert.match(txt, /Line moved from 24\.5 to 25\.5\. The over is now harder to hit/);
    assert.match(txt, /This market is no longer available\. Game started/);
    assert.match(txt, /Starts in \d+ h/, 'an open line counts down to its game');
    for (const s of ['Favorite players', 'Best unders', 'Fantasy roster', 'Injury watch']) assert.ok(txt.includes(s), `missing the ready-made name ${s}`);
    const names = () => p.$$eval('#pg-boards .bd > .bd-list > .bd-card h2', hs => hs.map(h => h.textContent));
    assert.deepStrictEqual(await names(), ['My research', 'Weekend NFL', 'Tonight’s NBA']);
    // reorder from the More menu, keyboard focus stays on the moved board's control
    const more = async id => { await p.focus(`[data-bdmore="${id}"]`); await p.keyboard.press('Enter'); await p.waitForSelector(`[data-bdmore="${id}"]:is(details[open] > *)`) };   // the More menu, opened from the keyboard
    await more(await p.evaluate(() => window.flBoards.list()[0].id));
    await p.click('.bd-more[open] [data-bd="down"]'); await p.waitForTimeout(150);
    assert.deepStrictEqual(await names(), ['Weekend NFL', 'My research', 'Tonight’s NBA']);
    assert.match(await p.evaluate(() => document.activeElement.textContent), /Move (down|up)/);
    await p.keyboard.press('Escape');
    assert.strictEqual(await p.$$eval('.bd-more[open]', d => d.length), 0, 'Escape closes the More menu');
    assert.match(await p.evaluate(() => document.activeElement.textContent), /^More/);
    // duplicate and archive
    const nba = await p.evaluate(() => window.flBoards.list().find(b => b.name === 'Tonight’s NBA').id);
    await more(nba); await p.click(`.bd-more[open] [data-bd="dup"]`); await p.waitForTimeout(150);
    assert.ok((await names()).includes('Tonight’s NBA (copy)'));
    const dup = await p.evaluate(() => window.flBoards.list().find(b => b.name === 'Tonight’s NBA (copy)').id);
    await more(dup); await p.click(`.bd-more[open] [data-bd="archive"]`); await p.waitForTimeout(150);
    assert.ok(!(await names()).includes('Tonight’s NBA (copy)'));
    assert.match(await p.textContent('.bd-archd summary'), /Archived boards \(1\)/);
    // save as image downloads a PNG
    await more(nba);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click(`.bd-more[open] [data-bd="image"]`)]);
    assert.match(dl.suggestedFilename(), /^tonight-s-nba\.png$/);
    // share: a read-only link, then the link opens the copy
    await p.click(`[data-bd="share"][data-id="${nba}"]`); await p.waitForSelector(`#bdl-${nba}`);
    const link = await p.inputValue(`#bdl-${nba}`); assert.match(link, /#\/board\/abc12345$/);
    await shot(p, 'boards-1440');
    await p.evaluate(() => window.flPages.show('board', 'abc12345')); await p.waitForSelector('#pg-board .bd-it'); await p.waitForTimeout(300);
    const sh = await p.textContent('#pg-board');
    assert.match(sh, /Shared board · read-only/); assert.match(sh, /Tonight’s NBA/); assert.match(sh, /Shared by erez/); assert.match(sh, /Line moved from 24\.5 to 25\.5/);
    assert.ok(!(await p.$('#pg-board [data-bdrm], #pg-board [data-bd]')), 'a shared board has no edit controls');
    await shot(p, 'shared-board-1440');
    // stop sharing: the link no longer opens
    await p.evaluate(() => window.flPages.show('boards')); await p.waitForSelector(`[data-bd="unshare"][data-id="${nba}"]`).catch(() => p.click(`[data-bd="share"][data-id="${nba}"]`));
    if (!(await p.$(`[data-bd="unshare"][data-id="${nba}"]`))) await p.click(`[data-bd="share"][data-id="${nba}"]`);
    await p.click(`[data-bd="unshare"][data-id="${nba}"]`); await p.waitForTimeout(200);
    assert.deepStrictEqual(shared, {});
    assert.deepStrictEqual(p.errors, []);
  });

  await t('saved boards: a Prop Explorer view keeps its filters and sort, and reopens exactly as it was', async () => {
    const p = await page(); await explorer(p);
    await p.click('[data-pxsport="nba"]'); await p.selectOption('#pxSort', 'soon'); await p.click('[data-px="filters"]'); await p.selectOption('#pxSide', { label: 'Under only' }); await p.waitForTimeout(200);
    await p.click('[data-px="saveview"]'); await p.waitForSelector('[data-boform], [data-bo]');
    await p.fill('#boN', 'Best unders'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const saved = await p.evaluate(() => window.flBoards.all().find(b => b.name === 'Best unders').items[0]);
    assert.strictEqual(saved.kind, 'props'); assert.strictEqual(saved.open.lab.filters.side, 'under'); assert.strictEqual(saved.open.lab.sort, 'soon'); assert.strictEqual(saved.open.lab.filters.sport, 'nba');
    // change everything, then open the saved view: the filters and sort come back
    await p.evaluate(() => { localStorage.setItem('fl.px', '{}'); localStorage.setItem('fl.pxSort', '"edge"') });
    await p.evaluate(it => window.flRecent.open(it), saved); await p.waitForSelector('.px-t tbody tr, .px-cards', { timeout: 15000 }); await p.waitForTimeout(300);
    assert.strictEqual(await p.inputValue('#pxSort'), 'soon');
    const rows = await p.$$eval('[data-pxopen]', bs => bs.map(b => b.textContent));
    assert.ok(rows.length && rows.every(r => /Rudy Gobert/.test(r)), 'only the NBA under is left: ' + rows.join(' | '));
    assert.deepStrictEqual(p.errors, []);
  });

  await t('saved boards: the free plan keeps one board and says how to get more', async () => {
    const p = await page();
    await p.evaluate(() => { window.flPlan = { can: f => f !== 'boards_unlimited' }; window.flBoards.make('Favorite players') });
    assert.strictEqual(await p.evaluate(() => window.flBoards.make('Best unders')), null);
    await p.evaluate(() => window.flPages.show('boards')); await p.waitForSelector('.bd-lim');
    assert.match(await p.textContent('.bd-lim'), /The free plan keeps one board/);
    assert.ok(!(await p.$('#bdNew')), 'no way to start a second board on the free plan');
    assert.deepStrictEqual(p.errors, []);
  });

  await t('phone: the explorer folds into cards, nothing runs off the screen', async () => {
    for (const w of [320, 390]) {
      const p = await page(w, 800); await explorer(p); await p.evaluate(() => document.querySelector('.px-sum').scrollIntoView()); await shot(p, `explorer-${w}`);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, `${over}px of sideways scroll at ${w}`);
    }
  });

  await browser.close(); srv.kill();
  console.log(`\n${n} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
