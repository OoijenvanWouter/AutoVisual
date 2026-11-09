// Projectmodel, modulatie, decks, crossfade-automaat en generator.
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const param = (v = 0, m = []) => ({ v, m });
const norm = (q, x) => clamp01((x - q.min) / (q.max - q.min));
const denorm = (q, n) => { const v = q.min + (q.max - q.min) * n; return q.step ? Math.round(v / q.step) * q.step : v; };
const lowXHz = n => 60 * Math.pow(10, n);
const highXHz = n => 1000 * Math.pow(8, n);
const pick = a => a[Math.floor(Math.random() * a.length)];
const range = (a, b) => a + Math.random() * (b - a);
const shuffled = a => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

let P = null;
const S = () => P.decks[P.edit];   // het deck dat je nu bewerkt
const DECKS = ['a', 'b'];
const otherDeck = k => k === 'a' ? 'b' : 'a';
const onAirDeck = () => P.xf.v < .5 ? 'a' : 'b';

const Q = {
  op: { label: 'Mix', min: 0, max: 1, def: 1 },
  speed: { label: 'Snelheid', min: 0, max: 3, def: 1 },
  a: { label: 'Vorm', min: 0, max: 1, def: .5 },
  b: { label: 'Kleur', min: 0, max: 1, def: .5 },
  macro: { min: 0, max: 1, def: 0 },
  depth: { label: 'Diepte', min: 0, max: 1, def: 1 },
  rate: { label: 'Tempo', min: 0, max: 1, def: .25, fmt: n => (.02 + n * n * 8).toFixed(2) + ' Hz' },
  xf: { label: 'Crossfader', min: 0, max: 1, def: 0 },
};

const SOURCES = [
  { id: 'low', name: 'Laag', color: '#ff5f3c' }, { id: 'mid', name: 'Mid', color: '#f2c531' }, { id: 'high', name: 'Hoog', color: '#3ad4e6' },
  { id: 'level', name: 'Niveau', color: '#d9dde3' }, { id: 'beat', name: 'Beat', color: '#ff3d8b' }, { id: 'rnd', name: 'Toeval', color: '#9cf25f' },
  ...[1, 2, 3, 4].map(i => ({ id: 'lfo' + i, name: 'LFO ' + i, color: '#a68bff' })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: 'm' + i, name: 'Macro ' + i, color: '#ffab52' })),
];
const SRC = Object.fromEntries(SOURCES.map(s => [s.id, s]));
const LFO_SHAPES = ['Sinus', 'Driehoek', 'Zaag', 'Blok', 'Sample&Hold', 'Ruis'];
const LFO_DIVS = [[.25, '1/16'], [.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 maat'], [8, '2 maten'], [16, '4 maten']];
const BLENDS = ['Normaal', 'Optellen', 'Screen', 'Vermenigvuldig', 'Overlay', 'Verschil', 'Uitsluiting', 'Lichter', 'Donkerder', 'Dodge', 'Lumakey'];
const ENERGIES = [['rustig', 'Rustig'], ['midden', 'Midden'], ['heftig', 'Druk']];
const ENERGY_BUSY = { rustig: .15, midden: .5, heftig: .9 };
const energyOf = b => b < .34 ? 'rustig' : b < .67 ? 'midden' : 'heftig';
const TRANSITIONS = [['fade', 'Fade'], ['glitch', 'Glitch'], ['flash', 'Flits'], ['zoom', 'Zoom'], ['wipe', 'Lumawipe'], ['cut', 'Harde cut'], ['pixel', 'Pixels'], ['slide', 'Schuiven']];

function newFx(type, vals = {}, routes = {}) {
  const p = {};
  for (const q of FX[type].params) {
    p[q.k] = param(norm(q, vals[q.k] ?? q.def), (routes[q.k] || []).map(([s, a]) => ({ s, a })));
  }
  return { id: uid(), type, on: true, p };
}
function newClip(url, fx = []) { return { id: uid(), url, speed: param(norm(Q.speed, 1)), a: param(.5), b: param(.5), fit: 'cover', fx }; }
function newChannel(n, blend = 2) {
  return { id: uid(), name: 'Kanaal ' + n, on: true, solo: false, op: param(1), blend, clips: [], cur: 0, adv: 'off', every: 8, shuffle: false, rndStart: true, jump: false };
}
function newLfo(i) { return { shape: i % 6, rate: param(.25 + i * .08), depth: param(1), sync: false, div: 4, _ph: i * .25 }; }
function newScene(name, energy, nCh = 3) {
  return {
    id: uid(), name, energy, busy: ENERGY_BUSY[energy], channels: Array.from({ length: nCh }, (_, i) => newChannel(i + 1, i ? 2 : 0)),
    master: { op: param(1), fx: [] }, lfos: [0, 1, 2, 3].map(newLfo), macros: Array.from({ length: 8 }, () => param(0)),
  };
}

function defaultProject() {
  const a = newScene('Drijven', 'rustig', 2);
  a.channels[0].clips.push(newClip('gen:clouds', [newFx('liquid', { amt: .1, speed: .3 }, { amt: [['lfo1', .25]] })]));
  a.channels[0].clips[0].b.m.push({ s: 'lfo2', a: .4 });
  a.channels[1].op.v = .45; a.channels[1].op.m.push({ s: 'mid', a: .4 });
  a.channels[1].clips.push(newClip('gen:rings', [newFx('mirror', { mode: 4 }), newFx('blur', { amt: .2 })]));
  a.lfos[0].rate.v = .12; a.lfos[1].rate.v = .08;

  const b = newScene('Puls', 'midden', 3);
  b.channels[0].clips.push(newClip('gen:plasma', [newFx('kaleido', { seg: 6 }, { zoom: [['low', -.3]], rot: [['lfo1', .5]] }), newFx('hsv', { sat: 1.4 }, { hue: [['lfo2', .4]] })]));
  b.channels[1].blend = 5; b.channels[1].op.v = .6; b.channels[1].op.m.push({ s: 'low', a: .4 });
  b.channels[1].clips.push(newClip('gen:cells', [newFx('rgbsplit', { amt: .05 }, { amt: [['high', .5]] })]));
  b.channels[2].on = false; b.channels[2].clips.push(newClip('gen:stripes', [newFx('wave', { amt: .05 })]));
  b.lfos[0].rate.v = .15; b.lfos[1].rate.v = .2;

  const c = newScene('Storm', 'heftig', 3);
  c.channels[0].clips.push(newClip('gen:tunnel', [newFx('rgbsplit', { amt: .1 }, { amt: [['low', .6]] }), newFx('blocks', { amt: .1 }, { amt: [['beat', .5]] })]));
  c.channels[1].blend = 2; c.channels[1].op.m.push({ s: 'high', a: -.3 });
  c.channels[1].clips.push(newClip('gen:bars', [newFx('mirror', { mode: 4 }), newFx('glow', { amt: 1.2 })]));
  c.channels[2].blend = 1; c.channels[2].op.v = .7;
  c.channels[2].clips.push(newClip('gen:stars', [newFx('feedback', { zoom: 1.05, rot: .03 }, { rot: [['lfo1', .3]] })]));
  c.master.fx.push(newFx('slices', { amt: .15, prob: .1 }, { prob: [['beat', .6]], amt: [['high', .3]] }));
  c.lfos[0].shape = 4; c.lfos[0].sync = true; c.lfos[0].div = 3;

  return {
    version: 2, res: 720, scenes: [a, b, c], decks: { a: cloneFresh(b), b: cloneFresh(c) }, edit: 'a',
    xf: param(0), xfMode: 'fade', xfDur: 2, bin: [], gen: 0,
    audio: { gain: [param(.5), param(.5), param(.5)], lowX: param(.523), highX: param(.44), attack: param(.05), release: param(.2), agc: true },
    auto: {
      on: false, cooldown: 6, rules: [
        { id: uid(), on: true, src: 'level', cmp: '<', th: .2, hold: 4, from: 'any', to: 'g:.12', trans: 'fade', dur: 2 },
        { id: uid(), on: true, src: 'level', cmp: '>', th: .8, hold: 1.5, from: 'any', to: 'g:.9', trans: 'glitch', dur: .4 },
        { id: uid(), on: true, src: 'level', cmp: '>', th: .35, hold: 2, from: 'rustig', to: 'g:.5', trans: 'zoom', dur: .8 },
        { id: uid(), on: true, src: 'level', cmp: '<', th: .7, hold: 5, from: 'heftig', to: 'g:.5', trans: 'fade', dur: 1 },
        { id: uid(), on: false, src: 'always', cmp: '>', th: 0, hold: 40, from: 'any', to: 'same', trans: 'wipe', dur: 1.5 },
      ],
    },
  };
}

// Oudere sets (losse scènes zonder decks) omzetten.
function migrate(p) {
  if (p.version === 1) {
    const n = p.scenes.length;
    p.scenes.forEach(s => { s.busy = ENERGY_BUSY[s.energy] ?? .5; });
    p.decks = { a: cloneFresh(p.scenes[p.cur] || p.scenes[0]), b: cloneFresh(p.scenes[((p.cur || 0) + 1) % n]) };
    p.edit = 'a'; p.xf = param(0); p.xfMode = p.auto.mtrans || 'fade'; p.xfDur = 2; p.gen = 0;
    p.bin = [...new Set(p.scenes.flatMap(s => s.channels.flatMap(c => c.clips.map(x => x.url))).filter(u => /^https?:/.test(u)))];
    p.auto.rules.forEach(r => { if (r.to === 'randomize') r.to = 'same'; });
    p.version = 2;
  }
  return p;
}

// ── Opslaan ──────────────────────────────────────────────────────────────
const stripRuntime = (k, v) => k.startsWith('_') ? undefined : v;
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('autovisual.project', JSON.stringify(P, stripRuntime)); } catch { /* opslag vol of geblokkeerd */ }
  }, 800);
}
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem('autovisual.project'));
    if (saved && saved.version <= 2 && saved.scenes?.length) return migrate(saved);
  } catch { /* begin opnieuw */ }
  return defaultProject();
}
function cloneFresh(obj) {
  const c = JSON.parse(JSON.stringify(obj, stripRuntime));
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') { if ('id' in o) o.id = uid(); Object.values(o).forEach(walk); }
  })(c);
  return c;
}

// ── Modulatie ────────────────────────────────────────────────────────────
// Geluid is gedeeld; LFO's en macro's horen bij een deck. scene() zet de bronnen van dat deck klaar.
const Mod = {
  src: Object.fromEntries(SOURCES.map(s => [s.id, 0])),
  beatV: 0,
  edge: false,
  val(p) {
    let v = p.v;
    for (const m of p.m) v += (this.src[m.s] || 0) * m.a;
    return clamp01(v);
  },
  q(p, q) { return denorm(q, this.val(p)); },
  audio(dt) {
    const s = this.src, A = AudioIn;
    s.low = A.low; s.mid = A.mid; s.high = A.high; s.level = A.level;
    this.edge = A.beatEdge;
    if (this.edge) { this.beatV = 1; s.rnd = Math.random(); }
    else this.beatV *= Math.exp(-dt / .16);
    s.beat = this.beatV;
  },
  scene(dt, scene) {
    const s = this.src;
    scene.macros.forEach((p, i) => { s['m' + (i + 1)] = this.val(p); });
    scene.lfos.forEach((l, i) => {
      const rate = l.sync ? (AudioIn.tempo / 60) / LFO_DIVS[l.div][0] : .02 + Math.pow(this.val(l.rate), 2) * 8;
      let ph = (l._ph ?? 0) + rate * dt;
      if (ph >= 1) { ph -= Math.floor(ph); l._a = l._b ?? Math.random(); l._b = Math.random(); }
      l._ph = ph;
      const a = l._a ?? 0, b = l._b ?? 1;
      const x = [.5 + .5 * Math.sin(ph * Math.PI * 2), 1 - Math.abs(2 * ph - 1), ph, ph < .5 ? 1 : 0, b, a + (b - a) * (ph * ph * (3 - 2 * ph))][l.shape];
      s['lfo' + (i + 1)] = x * this.val(l.depth);
    });
  },
};

// ── Kanaal-afspeellogica ─────────────────────────────────────────────────
const Player = {
  next(ch) {
    const n = ch.clips.length;
    if (n < 2) return;
    let tries = n, i = ch.cur;
    do {
      i = ch.shuffle ? (i + 1 + Math.floor(Math.random() * (n - 1))) % n : (i + 1) % n;
      if (Media.entries.get(ch.clips[i].url)?.status !== 'fout') break;
    } while (--tries > 0);
    this.show(ch, i);
  },
  show(ch, i) {
    ch.cur = i;
    const clip = ch.clips[i];
    if (clip) this.seekRandom(ch, clip);
    ch._t = 0; ch._b = 0;
  },
  seekRandom(ch, clip, force) {
    if (!force && !ch.rndStart) return;
    const e = Media.entries.get(clip.url);
    if (e?.el?.duration && isFinite(e.el.duration) && e.status === 'ready') e.el.currentTime = Math.random() * e.el.duration * .9;
  },
  update(dt, scene) {
    for (const ch of scene.channels) {
      if (!ch.clips.length) continue;
      if (ch.cur >= ch.clips.length) ch.cur = 0;
      ch._t = (ch._t || 0) + dt;
      if (Mod.edge) {
        ch._b = (ch._b || 0) + 1;
        if (ch.jump) this.seekRandom(ch, ch.clips[ch.cur], true);
      }
      if ((ch.adv === 'time' && ch._t >= ch.every) || (ch.adv === 'beat' && ch._b >= ch.every)) { this.next(ch); UI.onClipChange(ch); }
    }
  },
};

// ── Crossfade ────────────────────────────────────────────────────────────
const Fade = {
  cur: null,
  ready(key) {
    return P.decks[key].channels.every(ch => {
      const c = ch.clips[ch.cur];
      if (!ch.on || !c) return true;
      const st = Media.entries.get(c.url)?.status;
      return st === 'ready' || st === 'fout';
    });
  },
  to(key, dur = P.xfDur, mode = P.xfMode) {
    const target = key === 'a' ? 0 : 1;
    if (dur <= 0 || mode === 'cut') { P.xf.v = target; this.cur = null; save(); return; }
    this.cur = { key, from: P.xf.v, target, dur, mode, t: 0, wait: 2.5 };
  },
  update(dt) {
    const c = this.cur;
    if (!c) return;
    if (c.wait > 0 && !this.ready(c.key)) { c.wait -= dt; return; }  // nieuw beeld eerst laten laden
    c.wait = 0;
    c.t += dt;
    const p = Math.min(1, c.t / c.dur);
    P.xf.v = c.from + (c.target - c.from) * p;
    if (p >= 1) { this.cur = null; save(); }
  },
};

function loadDeck(key, scene) {
  const onAir = key === onAirDeck();
  P.decks[key] = cloneFresh(scene);
  if (onAir) Engine.startTransition('fade', .5);
  Media.preload(P);
  UI.renderAll();
  save();
}
function generateDeck(key, busy) {
  const s = P.decks[key];
  if (key === onAirDeck()) Engine.startTransition('glitch', .3);
  Rnd.generate(s, busy ?? s.busy);
  Media.preload(P);
  UI.renderAll();
  save();
}

// ── Automatisch wisselen: vult het deck dat niet in beeld is en fade daarheen ──
const Auto = {
  cool: 0,
  applicable(r) {
    const s = P.decks[onAirDeck()];
    if (r.from !== 'any' && s.energy !== r.from) return false;
    if (r.to.startsWith('e:')) return r.to.slice(2) !== s.energy;
    if (r.to.startsWith('g:')) return energyOf(+r.to.slice(2)) !== s.energy;
    if (r.to === 'next' || r.to === 'random' || r.to.startsWith('s:')) return P.scenes.length > 0;
    return true;
  },
  test(r) {
    if (r.src === 'always') return true;
    const v = Mod.src[r.src] || 0;
    return r.cmp === '<' ? v < r.th : v > r.th;
  },
  fire(r) {
    const air = onAirDeck(), off = otherDeck(air), live = P.decks[air];
    this.cool = P.auto.cooldown;
    if (r.to === 'mutate') { Rnd.mutate(live); UI.renderAll(); save(); return; }
    const lib = i => { if (P.scenes[i]) P.decks[off] = cloneFresh(P.scenes[i]); };
    if (r.to.startsWith('g:')) Rnd.generate(P.decks[off], +r.to.slice(2));
    else if (r.to.startsWith('e:')) {
      const e = r.to.slice(2), list = P.scenes.filter(x => x.energy === e);
      if (list.length) lib(P.scenes.indexOf(pick(list))); else Rnd.generate(P.decks[off], ENERGY_BUSY[e]);
    }
    else if (r.to.startsWith('s:')) lib(P.scenes.findIndex(x => x.id === r.to.slice(2)));
    else if (r.to === 'same') Rnd.generate(P.decks[off], live.busy ?? .5);
    else if (r.to === 'next') { this.lib = ((this.lib ?? -1) + 1) % P.scenes.length; lib(this.lib); }
    else if (r.to === 'random') lib(Math.floor(Math.random() * P.scenes.length));
    // 'swap': het andere deck staat al klaar
    Media.preload(P);
    Fade.to(off, r.dur, r.trans);
    UI.renderAll();
    save();
  },
  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    let toFire = null;
    for (const r of P.auto.rules) {
      r._t = P.auto.on && !Fade.cur && r.on && this.test(r) && this.applicable(r) ? (r._t || 0) + dt : 0;
      if (!toFire && this.cool <= 0 && r._t >= r.hold) toFire = r;
    }
    if (toFire) { P.auto.rules.forEach(r => r._t = 0); this.fire(toFire); }
  },
};

// ── Generator: alles schaalt met 'busy' (0 = rustig, 1 = druk) ───────────
const BASS_SHARE = .6;
const CALM_FX = new Set(['hsv', 'adjust', 'duotone', 'palette', 'liquid', 'mirror', 'kaleido', 'wave', 'blur', 'glow', 'vignette', 'zoomblur', 'trails', 'transform', 'bulge', 'polar', 'huekill', 'rgbgain']);
const INTENSITY_KEYS = new Set(['amt', 'prob', 'speed', 'rate', 'gain', 'freq']);
const GEN_BY_ENERGY = { rustig: ['clouds', 'rings', 'plasma'], midden: ['plasma', 'cells', 'stripes', 'stars', 'rings'], heftig: ['tunnel', 'bars', 'stripes', 'cells', 'stars'] };
const busyOf = s => s.busy ?? .5;

const Rnd = {
  setParam(p, q, busy = .5) {
    const [a, b] = q.rnd || [q.min, q.max];
    let t = Math.random();
    if (INTENSITY_KEYS.has(q.k)) t = busy * .5 + t * .5;  // rustig blijft laag, druk gaat omhoog
    p.v = norm(q, a + t * (b - a));
  },
  fx(fx, busy) { for (const q of FX[fx.type].params) this.setParam(fx.p[q.k], q, busy); },
  randomFx(exclude, busy) {
    const allowed = Object.values(FX).filter(d => !exclude.has(d.id) && (!d.wild || Math.random() < busy * .35));
    const wantCalm = Math.random() > busy;
    const list = allowed.filter(d => CALM_FX.has(d.id) === wantCalm);
    const fx = newFx(pick(list.length ? list : allowed).id);
    this.fx(fx, busy);
    return fx;
  },
  chain(busy, n = Math.round(busy * 3 + Math.random() * (.6 + busy))) {
    const seen = new Set(), out = [];
    for (let i = 0; i < n; i++) { const f = this.randomFx(seen, busy); seen.add(f.type); out.push(f); }
    return out;
  },
  pool(busy) {
    const real = P.bin.filter(u => Media.entries.get(u)?.status !== 'fout');
    return real.length ? real : GEN_BY_ENERGY[energyOf(busy)].map(g => 'gen:' + g);
  },
  dealer(busy) {
    const list = shuffled(this.pool(busy));
    let i = 0;
    return () => list[i++ % list.length];
  },
  targets(scene) {
    const out = [];
    const addFx = list => list.forEach(f => FX[f.type].params.forEach(q => { if (!q.opts) out.push({ p: f.p[q.k] }); }));
    scene.channels.forEach(ch => { out.push({ p: ch.op }); ch.clips.forEach(c => { addFx(c.fx); out.push({ p: c.speed, noBass: true }, { p: c.a }, { p: c.b }); }); });
    addFx(scene.master.fx);
    scene.lfos.forEach(l => out.push({ p: l.rate, noBass: true }));
    return out;
  },
  routes(scene) {
    const busy = busyOf(scene), all = this.targets(scene);
    all.forEach(t => t.p.m = []);
    const n = Math.min(all.length, 1 + Math.round(busy * 12 + Math.random() * 3));
    const depth = .3 + busy * .7;
    // Minstens 60% van de koppelingen gaat naar de bas, elk op een ander doel.
    const forBass = shuffled(all.filter(t => !t.noBass)).slice(0, Math.ceil(n * BASS_SHARE));
    forBass.forEach(t => t.p.m.push({ s: 'low', a: (Math.random() < .12 ? -1 : 1) * range(.25, .6) * depth }));
    const audio = ['mid', 'high', 'beat', 'beat', 'level', 'rnd'];
    const lfos = ['lfo1', 'lfo2', 'lfo3', 'lfo4'];
    for (let i = forBass.length; i < n; i++) {
      const t = pick(all), s = pick(Math.random() < .65 ? audio : lfos);
      if (t.p.m.some(m => m.s === s)) continue;
      t.p.m.push({ s, a: (Math.random() < .25 ? -1 : 1) * range(.08, .5) * depth });
    }
  },
  lfos(scene) {
    const busy = busyOf(scene);
    scene.lfos.forEach(l => {
      l.shape = Math.floor(Math.random() * 6);
      l.rate.v = range(.05 + busy * .1, .2 + busy * .5);
      l.sync = Math.random() < busy;
      l.div = 1 + Math.floor(Math.random() * 6);
    });
  },
  blend(busy) { return pick(Math.random() > busy ? [2, 2, 7, 0] : [1, 2, 4, 5, 6, 5]); },
  channel(ch, busy) {
    ch.blend = this.blend(busy);
    ch.op.v = range(.4 + busy * .2, .75 + busy * .25);
    ch.clips.forEach(c => { c.fx = this.chain(busy); c.a.v = Math.random(); c.b.v = Math.random(); });
  },
  fxAll(scene) {
    const busy = busyOf(scene);
    scene.channels.forEach(ch => ch.clips.forEach(c => { c.fx = this.chain(busy); }));
    scene.master.fx = Math.random() < busy * .7 ? this.chain(busy, 1 + Math.round(busy)) : [];
  },
  makeClip(url, busy) {
    const c = newClip(url, this.chain(busy));
    c.speed.v = norm(Q.speed, range(.4 + busy * .4, .8 + busy * 1.4));
    c.a.v = Math.random(); c.b.v = Math.random();
    return c;
  },
  images(scene) {
    const busy = busyOf(scene), next = this.dealer(busy);
    scene.channels.forEach(ch => {
      const fx = ch.clips[ch.cur]?.fx || [];
      const n = 1 + Math.round(Math.random() * (1 + busy * 2));
      ch.clips = Array.from({ length: n }, () => { const c = newClip(next()); c.fx = cloneFresh(fx); return c; });
      ch.cur = 0;
    });
  },
  // Een compleet nieuwe scène in dit deck, op de schaal rustig → druk.
  generate(scene, busy = busyOf(scene)) {
    const next = this.dealer(busy);
    scene.busy = busy;
    scene.energy = energyOf(busy);
    P.gen = (P.gen || 0) + 1;
    scene.name = `${ENERGIES.find(e => e[0] === scene.energy)[1]} ${P.gen}`;
    const nCh = 1 + Math.round(Math.random() + busy * 2.4);
    scene.channels = Array.from({ length: nCh }, (_, i) => {
      const ch = newChannel(i + 1, i ? this.blend(busy) : 0);
      ch.op.v = i ? range(.4 + busy * .2, .75 + busy * .25) : 1;
      const nClips = 1 + Math.round(Math.random() * (1 + busy * 2));
      ch.clips = Array.from({ length: nClips }, () => this.makeClip(next(), busy));
      ch.shuffle = true;
      if (nClips > 1) {
        if (Math.random() < busy) { ch.adv = 'beat'; ch.every = pick([4, 8, 16]); }
        else { ch.adv = 'time'; ch.every = Math.round(range(10, 30)); }
      }
      ch.jump = busy > .7 && Math.random() < .4;
      return ch;
    });
    scene.master.fx = Math.random() < busy * .7 ? this.chain(busy, 1 + Math.round(busy)) : [];
    this.lfos(scene);
    this.routes(scene);
    scene._guard = { frames: 10, tries: 3 };
  },
  mutate(scene) {
    const busy = busyOf(scene), amt = .08 + busy * .25;
    const nudge = p => { p.v = clamp01(p.v + (Math.random() - .5) * amt); p.m.forEach(m => { m.a = Math.max(-1, Math.min(1, m.a + (Math.random() - .5) * amt)); }); };
    this.targets(scene).forEach(t => nudge(t.p));
    scene.channels.forEach(ch => { if (Math.random() < busy * .2) ch.blend = this.blend(busy); });
  },
};
