/* Floodlight · broadcast: where a game can be watched, said plainly and sorted honestly.
   ESPN lists each game's US channels with two facts we can trust: the market (National, or Home and Away for a team's
   own region) and the kind (TV or Streaming). Those decide the group; the name lists below only fill in when a feed
   leaves them out. A regional network or a team's own app is never called national.
   Groups: National TV, Local TV (a team's regional network or local station), Streaming.
   Access: free (an over-the-air network or local station, or a free streaming service) or a subscription; anything
   we cannot place is left as unknown rather than guessed.
   Names are written out in full: USA Network, not USA Net. Nothing here is fetched. */
(() => {
  // the feed's short names, written out
  const NAMES = {
    'usa net': 'USA Network', 'usa': 'USA Network', 'tele': 'Telemundo', 'telemundo': 'Telemundo', 'nbatv': 'NBA TV', 'nba tv': 'NBA TV',
    'espn dep': 'ESPN Deportes', 'espn deportes': 'ESPN Deportes', 'espnd': 'ESPN Deportes', 'nfl net': 'NFL Network', 'nfln': 'NFL Network',
    'nhl net': 'NHL Network', 'nhln': 'NHL Network', 'mlb net': 'MLB Network', 'mlbn': 'MLB Network', 'cbssn': 'CBS Sports Network',
    'cbs sn': 'CBS Sports Network', 'secn': 'SEC Network', 'secn+': 'SEC Network+', 'accn': 'ACC Network', 'accnx': 'ACC Network Extra',
    'btn': 'Big Ten Network', 'b1g+': 'B1G+', 'fox': 'FOX', 'fs1': 'FS1', 'fs2': 'FS2', 'universo': 'Universo', 'unimas': 'UniMás', 'unimás': 'UniMás',
    'univision': 'Univision', 'tudn': 'TUDN', 'galavision': 'Galavisión', 'fox dep': 'FOX Deportes', 'fox deportes': 'FOX Deportes',
    'espn+': 'ESPN+', 'peacock': 'Peacock', 'prime video': 'Prime Video', 'amazon prime video': 'Prime Video', 'apple tv': 'Apple TV', 'apple tv+': 'Apple TV',
    'paramount+': 'Paramount+', 'max': 'Max', 'trutv': 'truTV', 'tnt': 'TNT', 'tbs': 'TBS', 'cw': 'The CW', 'the cw': 'The CW',
    'bein': 'beIN SPORTS', 'bein sports': 'beIN SPORTS', 'golf': 'Golf Channel', 'tennis': 'Tennis Channel', 'nbcs': 'NBC Sports',
    'mnmt': 'Monumental Sports Network', 'chsn': 'Chicago Sports Network', 'sny': 'SNY', 'yes': 'YES Network', 'nesn': 'NESN',
    'msg': 'MSG Network', 'msgsn': 'MSG Sportsnet', 'nbcs-ba': 'NBC Sports Bay Area', 'nbcsba': 'NBC Sports Bay Area', 'nbcs-ca': 'NBC Sports California',
    'nbcs-ph': 'NBC Sports Philadelphia', 'nbcs-phl': 'NBC Sports Philadelphia', 'nbcs-bos': 'NBC Sports Boston', 'nbcs-chi': 'NBC Sports Chicago',
    'snla': 'Spectrum SportsNet LA', 'spectrum sn': 'Spectrum SportsNet', 'kjzz-tv': 'KJZZ-TV', 'kfaa-tv': 'KFAA-TV',
  };
  // real US national TV networks (a channel the whole country gets on one listing)
  const NATIONAL = new Set(['ABC', 'CBS', 'NBC', 'FOX', 'FS1', 'FS2', 'ESPN', 'ESPN2', 'ESPNU', 'ESPNEWS', 'ESPN Deportes', 'TNT', 'TBS', 'truTV', 'NBA TV',
    'NFL Network', 'NHL Network', 'MLB Network', 'USA Network', 'CBS Sports Network', 'Big Ten Network', 'SEC Network', 'ACC Network', 'Telemundo',
    'Universo', 'Univision', 'UniMás', 'TUDN', 'Galavisión', 'FOX Deportes', 'The CW', 'beIN SPORTS', 'Golf Channel', 'Tennis Channel', 'NBC Sports']);
  // streaming services (national ones and the rest)
  const STREAM = /^(ESPN\+|Peacock|Prime Video|Apple TV|Paramount\+|Max|Netflix|DAZN\b.*|Fubo.*|B1G\+|SEC Network\+|ACC Network Extra|NBA League Pass|MLS Season Pass|YouTube.*|Tubi|Pluto TV|Victory\+|Roku Channel|.*\bApp|.*\+|.* Live|.*Vision|Prime Video \(Local\))$/i;
  // free to watch: the over-the-air networks, a local station (US call letters), and free streaming services
  const FREE = new Set(['ABC', 'CBS', 'NBC', 'FOX', 'The CW', 'Telemundo', 'Univision', 'UniMás', 'PBS', 'Tubi', 'Pluto TV', 'Roku Channel', 'Victory+']);
  const STATION = /^[KW][A-Z]{2,3}(-(TV|DT|CD|LD))?$/;
  // known subscription channels: every national cable network and every streaming service not in FREE
  // (a team's own app is left unknown: some are free with a cable login, some are sold on their own)
  const PAID_STREAM = /^(ESPN\+|Peacock|Prime Video.*|Apple TV|Paramount\+|Max|Netflix|DAZN\b.*|Fubo.*|B1G\+|SEC Network\+|ACC Network Extra|NBA League Pass|MLS Season Pass|Suns Live|BlazerVision|.+\+)$/i;
  const PAID = n => (NATIONAL.has(n) && !FREE.has(n)) || (PAID_STREAM.test(n) && !FREE.has(n)) || /^(FanDuel Sports Network|NBC Sports |Spectrum SportsNet|MSG|SNY|YES Network|NESN|Monumental|Chicago Sports Network|Bally|Root Sports|Marquee|Space City|Altitude|Kraken|Rangers Sports|SportsNet Pittsburgh|Victory)/i.test(n);

  function name(n) {
    const s = String(n || '').trim(); if (!s) return '';
    const k = s.toLowerCase(); if (NAMES[k]) return NAMES[k];
    const fd = /^(?:FDSN|FanDuel SN|Bally Sports|BSN?)\s+(.+)$/i.exec(s); if (fd) return `FanDuel Sports Network ${fd[1]}`;
    return s;
  }
  const isNational = n => NATIONAL.has(name(n));
  const access = n => { const c = name(n); return FREE.has(c) || STATION.test(c) ? 'free' : PAID(c) ? 'paid' : '' };

  /* One game's channels, from an ESPN scoreboard or summary competition: { all, national, local, streaming, other,
     free, paid, unknown, best }. `best` is the one name to print on a card: national TV first, then local TV, then a
     stream. */
  function of(c) {
    const rows = [];
    for (const g of c?.geoBroadcasts || []) rows.push({ n: g.media?.shortName || g.media?.name, type: g.type?.shortName || '', market: g.market?.type || '' });
    if (!rows.length) for (const b of c?.broadcasts || []) {
      if (b.media) rows.push({ n: b.media.name || b.media.shortName, type: b.type?.shortName || '', market: b.market?.type || (b.isNational ? 'National' : '') });
      else for (const n of b.names || []) rows.push({ n, type: '', market: b.market || '' });
    }
    return sort(rows);
  }
  // the same from bare names (a feed that gives nothing else)
  const ofNames = names => sort((names || []).map(n => ({ n, type: '', market: '' })));
  function sort(rows) {
    const out = { all: [], national: [], local: [], streaming: [], other: [], free: false, paid: false, unknown: false, best: '' };
    const seen = new Set();
    for (const r of rows) {
      if (/radio/i.test(r.type)) continue;
      const n = name(r.n); if (!n || seen.has(n)) continue; seen.add(n); out.all.push(n);
      const mk = String(r.market).toLowerCase(), local = mk === 'home' || mk === 'away', nat = mk === 'national';
      const stream = /stream/i.test(r.type) || (!/^tv$/i.test(r.type) && STREAM.test(n) && !NATIONAL.has(n));
      if (stream) out.streaming.push(n);
      else if (local) out.local.push(n);
      else if (NATIONAL.has(n) || (nat && /^tv$/i.test(r.type))) out.national.push(n);
      else if (STATION.test(n)) out.local.push(n);
      else out.other.push(n);
      const a = access(n); if (a === 'free') out.free = true; else if (a === 'paid') out.paid = true;
    }
    out.unknown = !out.all.length || (!out.national.length && !out.local.length && !out.streaming.length);
    out.best = out.national[0] || out.local[0] || out.streaming[0] || out.other[0] || '';
    return out;
  }
  /* The Live page's filters, each a test on a game's `watch`. "Subscription" means every channel listed needs one. */
  const FILTERS = [['any', 'Any'], ['national', 'National TV'], ['local', 'Local TV'], ['streaming', 'Streaming'], ['free', 'Free to watch'], ['paid', 'Subscription required'], ['unknown', 'Unknown availability']];
  const test = (k, w) => { w = w || sort([]);
    return k === 'national' ? !!w.national.length : k === 'local' ? !!w.local.length : k === 'streaming' ? !!w.streaming.length
      : k === 'free' ? w.free : k === 'paid' ? !w.free && w.paid : k === 'unknown' ? w.unknown || (!w.free && !w.paid) : true };

  window.flTV = { name, isNational, access, of, ofNames, FILTERS, test };
})();
