/* Floodlight · morph: redraw a panel without throwing its elements away.
   A live panel (the match centre, a match sheet, the Live page) redraws every few seconds while the score moves. Setting
   innerHTML each time deletes every button, heading and switch and builds new ones, so a screen reader loses its place,
   names can read as blank for a moment, and anything holding on to an element (focus, a tool's reference) is cut loose.
   flMorph(el, html) instead walks the new markup beside the old and changes only what differs: a text, an attribute, a
   row added or removed. Elements are matched by id, then by a data key (data-gxk, data-gxplay, data-live, data-ev,
   data-tab), then by tag in order. Nothing here knows about sports. */
(() => {
  const KEYS = ['data-gxk', 'data-gxplay', 'data-live', 'data-ev', 'data-tab', 'data-lvsec', 'data-key'];
  const keyOf = n => { if (n.nodeType !== 1) return ''; if (n.id) return '#' + n.id; for (const k of KEYS) { const v = n.getAttribute(k); if (v != null) return k + '=' + v } return '' };
  const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;
  function attrs(a, b) {
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
    for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    // form state lives in properties, not attributes: keep them in step with the markup, but never under the reader's cursor
    if (a.nodeName === 'INPUT') {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (a !== document.activeElement) a.value = b.getAttribute('value') ?? '';
    }
  }
  function patch(a, b) {
    if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return }
    if (a.nodeType !== 1) return;
    attrs(a, b);
    if (a.nodeName === 'TEXTAREA') { if (a !== document.activeElement) a.value = b.textContent; return }
    kids(a, b);
    if (a.nodeName === 'SELECT') { const o = b.querySelector('option[selected]'); a.value = o ? o.value : (a.options[0]?.value ?? '') }
  }
  function kids(a, b) {
    const news = [...b.childNodes], byKey = new Map();
    for (const n of a.childNodes) { const k = keyOf(n); if (k && !byKey.has(k)) byKey.set(k, n) }
    let cur = a.firstChild;
    for (const nb of news) {
      const k = keyOf(nb); let m = null;
      if (k) { m = byKey.get(k) || null; if (m && !sameKind(m, nb)) m = null; if (m) byKey.delete(k) }
      else if (cur && !keyOf(cur) && sameKind(cur, nb)) m = cur;
      if (m) { if (m === cur) cur = cur.nextSibling; else a.insertBefore(m, cur); patch(m, nb) }
      else a.insertBefore(nb, cur);   // a node the old panel did not have: move it in from the new markup
    }
    while (cur) { const n = cur.nextSibling; a.removeChild(cur); cur = n }
  }
  // Morph el's contents into html. Returns el.
  function flMorph(el, html) {
    if (!el) return el;
    if (!el.firstChild) { el.innerHTML = html; return el }
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    kids(el, tpl.content);
    return el;
  }
  // Morph one element into the single element html describes (same tag), keeping it in place.
  flMorph.one = (el, html) => {
    const tpl = document.createElement('template'); tpl.innerHTML = html.trim();
    const nb = tpl.content.firstElementChild; if (!el || !nb) return el;
    if (!sameKind(el, nb)) { el.replaceWith(nb); return nb }
    patch(el, nb); return el;
  };
  window.flMorph = flMorph;
})();
