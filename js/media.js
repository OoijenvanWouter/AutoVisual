// Links omzetten naar afspeelbare bronnen en elementen beheren.
const PLATFORM_RE = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|reddit\.com)$/i;
const MAX_ELEMENTS = 24;

const Media = {
  entries: new Map(),
  files: new Map(),   // file:… → blob-URL
  streams: new Map(), // live:… → MediaStream
  helper: { ok: false, ytdlp: false },
  queue: [],
  running: 0,
  onChange: () => {},

  async init() {
    if (location.protocol === 'file:') return;
    try {
      const r = await fetch('/api/health');
      if (r.ok) this.helper = await r.json();
    } catch { /* geen helper: alleen eigen bestanden en generatoren */ }
  },

  normalize(url) {
    try {
      const u = new URL(url);
      if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.searchParams.get('imgurl')) return u.searchParams.get('imgurl');
    } catch { /* geen geldige URL: laat staan */ }
    return url;
  },

  badge(url) {
    if (url.startsWith('gen:')) return 'GEN';
    if (url.startsWith('live:')) return 'LIVE';
    if (url.startsWith('file:')) return 'FILE';
    try {
      const h = new URL(url).hostname;
      if (/youtu/.test(h)) return 'YT';
      if (/instagram/.test(h)) return 'IG';
      if (/tiktok/.test(h)) return 'TT';
      if (/google|gstatic/.test(h)) return 'IMG';
    } catch { /* val door */ }
    return 'WEB';
  },

  entry(url) {
    let e = this.entries.get(url);
    if (!e) {
      e = { url, status: 'wacht', err: '', kind: null, src: null, title: '', el: null, tex: null, w: 0, h: 0, used: 0, thumb: null, lastT: -1, uploaded: false };
      this.entries.set(url, e);
      this.queue.push(e);
      this.pump();
    }
    return e;
  },

  pump() {
    while (this.running < 3 && this.queue.length) {
      const e = this.queue.shift();
      this.running++;
      this.resolve(e)
        .catch(err => this.fail(e, err.message || String(err)))
        .finally(() => { if (e.want) this.load(e); this.running--; this.pump(); this.onChange(); });
    }
  },

  fail(e, msg) { e.status = 'fout'; e.err = msg; this.onChange(); },

  async resolve(e) {
    const u = e.url;
    if (u.startsWith('gen:')) {
      if (!GENS[u.slice(4)]) throw new Error('Onbekende generator');
      e.kind = 'gen'; e.title = GENS[u.slice(4)].name; e.status = 'ready';
      return;
    }
    if (u.startsWith('live:')) {
      if (!this.streams.has(u)) throw new Error('Klik opnieuw op Scherm of Camera om dit te starten.');
      e.kind = 'video'; e.title = u === 'live:screen' ? 'Schermopname' : 'Camera'; e.status = 'geladen';
      return;
    }
    if (u.startsWith('file:')) {
      if (!this.files.has(u)) throw new Error('Lokaal bestand: voeg het opnieuw toe.');
      e.src = this.files.get(u); e.title = u.split('/').pop();
      e.kind = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(u) ? 'image' : 'video'; e.status = 'geladen';
      return;
    }
    if (this.helper.ok) {
      e.status = 'ophalen'; this.onChange();
      const r = await fetch('/api/resolve?url=' + encodeURIComponent(u));
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      Object.assign(e, { kind: j.kind, src: j.src, title: j.title || u, status: 'geladen' });
      return;
    }
    if (PLATFORM_RE.test(new URL(u).hostname)) throw new Error('Start de app via start.bat om dit soort links op te halen.');
    e.kind = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) ? 'video' : 'image';
    e.src = u; e.title = u; e.status = 'geladen';
  },

  // Maak het element pas aan als de clip echt nodig is.
  load(e) {
    if (e.el || e.status !== 'geladen') return;
    if (e.kind === 'video') {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto' });
      if (e.url.startsWith('live:')) v.srcObject = this.streams.get(e.url);
      else { v.crossOrigin = 'anonymous'; v.src = e.src; }
      v.addEventListener('loadeddata', () => { e.w = v.videoWidth; e.h = v.videoHeight; e.status = 'ready'; this.snapshot(e, v); this.onChange(); });
      v.addEventListener('error', () => this.fail(e, this.helper.ok ? 'Dit videoformaat speelt niet af.' : 'Geen toegang tot dit beeld. Start de app via start.bat.'));
      e.el = v;
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { e.w = img.naturalWidth; e.h = img.naturalHeight; e.status = 'ready'; e.uploaded = false; e.thumb = img.src; this.onChange(); };
      img.onerror = () => this.fail(e, this.helper.ok ? 'Dit is geen geldige afbeelding.' : 'Geen toegang tot dit beeld. Start de app via start.bat.');
      img.src = e.src;
      e.el = img;
    }
    this.evict();
  },

  snapshot(e, v) {
    try {
      const c = document.createElement('canvas');
      c.width = 96; c.height = 54;
      c.getContext('2d').drawImage(v, 0, 0, 96, 54);
      e.thumb = c.toDataURL('image/jpeg', .6);
    } catch { /* geen miniatuur beschikbaar */ }
  },

  evict() {
    const loaded = [...this.entries.values()].filter(e => e.el && !e.url.startsWith('live:'));
    if (loaded.length <= MAX_ELEMENTS) return;
    loaded.sort((a, b) => a.used - b.used);
    for (const e of loaded.slice(0, loaded.length - MAX_ELEMENTS)) {
      if (e.el.pause) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); }
      if (e.tex) { Engine.gl.deleteTexture(e.tex); e.tex = null; }
      e.el = null; e.status = 'geladen'; e.uploaded = false; e.lastT = -1;
    }
  },

  // Gebruik deze clip in dit frame.
  use(url, frame) {
    const e = this.entry(url);
    e.used = frame;
    this.load(e);
    return e;
  },

  sync(active, frame) {
    for (const e of this.entries.values()) {
      if (!e.el || e.kind !== 'video' || e.status !== 'ready') continue;
      if (active.has(e)) { if (e.el.paused) e.el.play().catch(() => {}); }
      else if (!e.el.paused && frame - e.used > 2) e.el.pause();
    }
  },

  // Haal alle links alvast op; alleen de beelden op de decks worden ook geladen.
  preload(project) {
    project.bin.forEach(u => this.entry(u));
    for (const s of project.scenes) for (const ch of s.channels) ch.clips.forEach(c => this.entry(c.url));
    for (const k of DECKS) for (const ch of project.decks[k].channels) {
      ch.clips.forEach((c, i) => {
        const e = this.entry(c.url);
        if (i === ch.cur) { e.want = true; this.load(e); }
      });
    }
  },

  async startLive(type) {
    const url = 'live:' + type;
    const stream = type === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    this.streams.set(url, stream);
    const old = this.entries.get(url);
    if (old) { if (old.tex) Engine.gl.deleteTexture(old.tex); this.entries.delete(url); }
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.streams.delete(url);
      const e = this.entries.get(url);
      if (e) { e.el = null; this.fail(e, 'Opname is gestopt.'); }
    });
    return url;
  },

  registerFile(file) {
    const url = `file:${uid()}/${file.name}`;
    this.files.set(url, URL.createObjectURL(file));
    return url;
  },
};
