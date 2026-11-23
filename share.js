/* Floodlight · share a pick, its evidence or a game as a picture.
   The picture is drawn here, on a canvas, in the theme you are using (its own colours and type, read from the page),
   with the Floodlight mark in the corner. Nothing is uploaded anywhere: the phone's share sheet gets the file where the
   browser offers one (navigator.share with files); everywhere else the PNG downloads.
   Picks are labelled as research on the picture itself, the same as on the site. */
(() => {
  const W = 1200, H = 630, PAD = 64;
  const css = (n, el = document.documentElement) => getComputedStyle(el).getPropertyValue(n).trim();
  // a colour token can be a gradient in some themes: take its first colour, or the fallback
  const solid = (v, fb) => { if (!v) return fb; if (!/gradient|url\(/.test(v)) return v; const m = v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i); return m ? m[0] : fb };

  function theme() {
    const brand = document.querySelector('.tb-brand b'), bs = brand ? getComputedStyle(brand) : null;
    return {
      bg: solid(css('--bg'), '#0A0D12'), panel: solid(css('--surface'), '#121821'), text: solid(css('--text'), '#F2EFE8'), text2: solid(css('--text-2'), '#C9CED8'),
      muted: solid(css('--muted'), '#A9B1BF'), accent: solid(css('--accent'), '#F5C451'), fill: solid(css('--accent-fill'), '#F5C451'), live: solid(css('--live'), '#FF6B57'),
      border: solid(css('--border-2'), 'rgba(255,255,255,.2)'), good: solid(css('--good'), '#7FCB5A'), bad: solid(css('--bad'), '#FF8FAB'),
      // whole family lists, so a face that has not loaded falls back to the theme's own generic family, never to a serif
      display: css('--font-display') || 'sans-serif', body: css('--font-body') || 'sans-serif', dw: css('--display-weight') || '800',
      brandFont: bs ? `${bs.fontStyle === 'italic' ? 'italic ' : ''}${bs.fontWeight} 34px ${bs.fontFamily}` : `800 34px ${css('--font-display') || 'sans-serif'}`,
      brandUpper: bs?.textTransform === 'uppercase', name: window.flTheme?.name?.() || '',
    };
  }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w } }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l.trimEnd() + '…' }
    return lines;
  }
  // the largest size (down to a floor) at which a line fits the width
  function fit(ctx, text, font, size, min, maxW) { let s = size; ctx.font = font(s); while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = font(s) } return s }

  /* o: { kicker, title, sub, stats: [[label, value, tone]], score: { a, b, sa, sb, status }, notes: [text], foot } */
  async function draw(o) {
    const T = theme();
    try { await Promise.all([`700 40px ${T.display}`, `600 20px ${T.body}`, T.brandFont].map(f => document.fonts.load(f))) } catch (e) {}
    const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext('2d'); ctx.scale(2, 2); ctx.textBaseline = 'alphabetic';
    // ground, one lamp of the theme's accent from the top left, and a panel
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(140, -40, 10, 140, -40, 620); g.addColorStop(0, T.accent + ''); g.addColorStop(1, 'transparent');
    ctx.globalAlpha = .18; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    ctx.strokeStyle = T.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect?.(24, 24, W - 48, H - 48, 28); ctx.roundRect ? ctx.stroke() : ctx.strokeRect(24, 24, W - 48, H - 48);
    // the mark: the lamp dot and the wordmark, as the header draws them
    ctx.fillStyle = T.fill; ctx.beginPath(); ctx.arc(PAD + 8, PAD + 14, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.text; ctx.font = T.brandFont; ctx.fillText(T.brandUpper ? 'FLOODLIGHT' : 'Floodlight', PAD + 26, PAD + 26);
    if (o.kicker) { ctx.font = `600 20px ${T.body}`; ctx.fillStyle = T.text2; ctx.textAlign = 'right'; ctx.fillText(o.kicker, W - PAD, PAD + 24); ctx.textAlign = 'left' }
    let y = PAD + 120;
    if (o.score) {
      // a game: the two names either side, the score in the middle
      const s = o.score, mid = W / 2;
      ctx.font = `${T.dw} 96px ${T.display}`; ctx.fillStyle = T.text; ctx.textAlign = 'center';
      ctx.fillText(s.sa != null && s.sb != null ? `${s.sa}  –  ${s.sb}` : 'v', mid, y + 70);
      const nameFont = n => `${T.dw} ${n}px ${T.display}`, nw = 330;
      for (const [nm, x, al] of [[s.a, PAD, 'left'], [s.b, W - PAD, 'right']]) { ctx.textAlign = al; const sz = fit(ctx, nm, nameFont, 40, 22, nw); ctx.font = nameFont(sz); ctx.fillText(nm, x, y + 54) }
      ctx.textAlign = 'center'; ctx.font = `600 24px ${T.body}`; ctx.fillStyle = s.live ? T.live : T.text2; ctx.fillText(s.status || '', mid, y + 116); ctx.textAlign = 'left';
      y += 170;
    }
    if (o.title) {
      const tf = n => `${T.dw} ${n}px ${T.display}`; let sz = 64; ctx.font = tf(sz);
      let lines = wrap(ctx, o.title, W - PAD * 2, 2); while (sz > 40 && lines.some(l => ctx.measureText(l).width > W - PAD * 2)) { sz -= 4; ctx.font = tf(sz); lines = wrap(ctx, o.title, W - PAD * 2, 2) }
      ctx.fillStyle = T.text; for (const l of lines) { ctx.fillText(l, PAD, y); y += sz * 1.08 }
      y += 4;
    }
    if (o.sub) { ctx.font = `500 24px ${T.body}`; ctx.fillStyle = T.text2; for (const l of wrap(ctx, o.sub, W - PAD * 2, 2)) { ctx.fillText(l, PAD, y); y += 32 } }
    // stat tiles along one row
    const stats = (o.stats || []).filter(s => s && s[1] != null).slice(0, 4);
    if (stats.length) {
      y = Math.max(y + 24, H - PAD - 178); const gap = 18, tw = (W - PAD * 2 - gap * (stats.length - 1)) / stats.length;
      stats.forEach(([label, value, tone], i) => { const x = PAD + i * (tw + gap);
        ctx.fillStyle = T.panel; ctx.beginPath(); ctx.roundRect ? (ctx.roundRect(x, y, tw, 118, 18), ctx.fill()) : ctx.fillRect(x, y, tw, 118);
        ctx.font = `600 18px ${T.body}`; ctx.fillStyle = T.muted; ctx.fillText(label, x + 22, y + 34);
        const vf = n => `${T.dw} ${n}px ${T.display}`; ctx.font = vf(fit(ctx, String(value), vf, 54, 26, tw - 44));
        ctx.fillStyle = tone === 'good' ? T.good : tone === 'bad' ? T.bad : tone === 'accent' ? T.accent : T.text; ctx.fillText(String(value), x + 22, y + 94) });
    } else if (o.notes?.length) {
      ctx.font = `500 24px ${T.body}`; ctx.fillStyle = T.text2; y += 10; for (const n of o.notes.slice(0, 3)) for (const l of wrap(ctx, '• ' + n, W - PAD * 2, 1)) { ctx.fillText(l, PAD, y); y += 34 }
    }
    // the foot: research, not a guarantee, and when it was drawn
    ctx.font = `500 18px ${T.body}`; ctx.fillStyle = T.muted;
    ctx.fillText(o.foot || 'Research, not a guarantee.', PAD, H - 44);
    ctx.textAlign = 'right'; ctx.fillText(new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }), W - PAD, H - 44); ctx.textAlign = 'left';
    return new Promise(r => c.toBlob(b => r(b), 'image/png'));
  }

  /* draw it, then hand it to the share sheet or download it; says what happened in the page's status line */
  async function share(o, btn) {
    const say = t => { const a = document.getElementById('announce') || document.getElementById('toasts'); if (a) { a.textContent = ''; setTimeout(() => { a.textContent = t }, 30) } };
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true') }
    try {
      const blob = await draw(o); if (!blob) throw new Error('no picture');
      const name = 'floodlight-' + String(o.file || o.title || 'share').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: o.title || 'Floodlight' }); return } catch (e) { if (e.name === 'AbortError') return }
      }
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); say(`Saved ${name} to your downloads.`);
    } catch (e) { say('The picture could not be made in this browser.') }
    finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy') } }
  }
  const ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  window.flShare = { draw, share, ICON };
})();
