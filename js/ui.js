// Interface: knoppen, mixer, inspector, scènes, regels en modulatie.
const $ = s => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (k in e && !k.includes('-')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
function sel(options, value, onchange, attrs = {}) {
  const e = h('select', { ...attrs, onchange: () => onchange(e.value) }, options.map(([v, t]) => h('option', { value: v }, t)));
  e.value = value;
  return e;
}
const stop = fn => ev => { ev.stopPropagation(); fn(ev); };

function routeFor(p, src, create) {
  let r = p.m.find(m => m.s === src);
  if (!r && create) { r = { s: src, a: 0 }; p.m.push(r); }
  return r;
}
function fmtVal(q, n) {
  if (q.fmt) return q.fmt(n);
  const v = denorm(q, n);
  if (q.opts) return q.opts[v] ?? '';
  if (q.step) return String(v);
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function bindDrag(el, p, q, o, axis) {
  el.addEventListener('pointerdown', ev => {
    if (ev.button) return;
    ev.preventDefault();
    ev.stopPropagation();
    el.setPointerCapture(ev.pointerId);
    const armed = UI.arm && !o.noMod && UI.arm !== o.self ? UI.arm : null;
    const route = armed ? routeFor(p, armed, true) : null;
    const from = route ? route.a : p.v;
    const x0 = ev.clientX, y0 = ev.clientY;
    const span = axis === 'x' ? (el.clientWidth || 140) : 150;
    const move = e => {
      const d = (axis === 'x' ? e.clientX - x0 : y0 - e.clientY) / (e.shiftKey ? span * 5 : span);
      if (route) route.a = Math.max(-1, Math.min(1, from + d));
      else { p.v = clamp01(from + d); o.onInput?.(); }
      el._paint(true);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (route && Math.abs(route.a) < .01) p.m.splice(p.m.indexOf(route), 1);
      el._dots();
      save();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('click', ev => ev.stopPropagation());
  el.addEventListener('dblclick', ev => {
    ev.stopPropagation();
    if (UI.arm) { const r = routeFor(p, UI.arm); if (r) p.m.splice(p.m.indexOf(r), 1); }
    else { p.v = q.def !== undefined ? norm(q, q.def) : p.v; o.onInput?.(); }
    el._paint(true); el._dots(); save();
  });
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); if (!o.noMod) UI.modMenu(p, q, ev.clientX, ev.clientY, el, o.self); });
  el.addEventListener('keydown', ev => {
    const d = { ArrowUp: .02, ArrowRight: .02, ArrowDown: -.02, ArrowLeft: -.02 }[ev.key];
    if (d === undefined) return;
    ev.preventDefault(); ev.stopPropagation();
    p.v = clamp01(p.v + d); o.onInput?.(); el._paint(true); save();
  });
  el._dots = () => {
    const box = el.querySelector('.k-dots');
    box.replaceChildren(...p.m.map(m => h('i', { style: `background:${SRC[m.s]?.color || '#888'}` })));
    el.title = p.m.length ? p.m.map(m => `${SRC[m.s]?.name}: ${Math.round(m.a * 100)}%`).join('\n') : 'Rechtermuisknop: koppelen aan modulatie';
  };
  el._dots();
  el._p = p;
  UI.controls.add(el);
}

function knob(p, q, o = {}) {
  const label = o.label ?? q.label ?? '';
  const el = h('div', { class: 'knob' + (o.noMod ? ' nomod' : ''), tabIndex: 0, role: 'slider', 'aria-label': label || 'waarde' });
  el.innerHTML = `<svg viewBox="0 0 36 36"><circle class="k-t" cx="18" cy="18" r="14" pathLength="100" stroke-dasharray="75 100" transform="rotate(135 18 18)"/><circle class="k-v" cx="18" cy="18" r="14" pathLength="100" transform="rotate(135 18 18)"/><circle class="k-m" cx="18" cy="18" r="14" pathLength="100" transform="rotate(135 18 18)"/><line class="k-p" x1="18" y1="14" x2="18" y2="5"/></svg><div class="k-dots"></div><span class="k-val"></span><span class="k-lab"></span>`;
  el.querySelector('.k-lab').textContent = label;
  const [v, m, ptr, txt] = ['.k-v', '.k-m', '.k-p', '.k-val'].map(s => el.querySelector(s));
  let lastB = -1, lastC = -1;
  el._paint = force => {
    const b = p.v, c = Mod.val(p);
    if (!force && Math.abs(b - lastB) + Math.abs(c - lastC) < .002) return;
    lastB = b; lastC = c;
    v.setAttribute('stroke-dasharray', `${b * 75} 100`);
    const a = Math.min(b, c), len = Math.abs(c - b);
    m.setAttribute('stroke-dasharray', `${len * 75} 100`);
    m.setAttribute('stroke-dashoffset', -a * 75);
    ptr.setAttribute('transform', `rotate(${-135 + c * 270} 18 18)`);
    txt.textContent = fmtVal(q, c);
    el.setAttribute('aria-valuetext', txt.textContent);
  };
  bindDrag(el, p, q, o, 'y');
  el._paint(true);
  return el;
}

function fader(p, q, o = {}) {
  const el = h('div', { class: 'fader', tabIndex: 0, role: 'slider', 'aria-label': o.label ?? q.label });
  const fill = h('div', { class: 'fd-fill' }), mk = h('div', { class: 'fd-mod' }), val = h('span', { class: 'fd-val' });
  el.append(fill, mk, h('div', { class: 'k-dots' }), val);
  el._paint = () => {
    const c = Mod.val(p);
    fill.style.width = p.v * 100 + '%';
    mk.style.left = `calc(${c * 100}% - 1px)`;
    val.textContent = Math.round(c * 100);
  };
  bindDrag(el, p, q, o, 'x');
  el._paint();
  return el;
}

const UI = {
  sel: { ch: 0, view: 'clip' }, arm: null, controls: new Set(), chips: [], output: null,
  toastTimer: 0, audioValue: 'none',

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  },

  renderAll() {
    this.sel.ch = Math.min(this.sel.ch, S().channels.length - 1);
    this.renderBand(); this.renderTabs(); this.renderMixer(); this.renderInspector(); this.renderMod();
  },

  setEdit(key) {
    if (P.edit === key) return;
    P.edit = key;
    this.sel = { ch: 0, view: 'clip' };
    $('#masterBtn').classList.remove('on');
    this.renderBand(); this.renderMixer(); this.renderInspector(); this.renderMod();
    save();
  },

  // ── Decks A/B en crossfader ───────────────────────────────────────────
  renderBand() {
    for (const key of DECKS) {
      const s = P.decks[key], K = key.toUpperCase();
      $('#card' + K).classList.toggle('edit', key === P.edit);
      const busy = h('input', { type: 'range', min: 0, max: 1, step: .01, value: s.busy ?? .5, 'aria-label': `Rustig tot druk, deck ${K}`, oninput: e => { s.busy = +e.target.value; save(); } });
      $('#ctl' + K).replaceChildren(
        h('div', { class: 'rowf' },
          h('button', { class: 'dk-key' + (key === P.edit ? ' on' : ''), title: 'Dit deck bewerken', onclick: () => this.setEdit(key) }, K),
          h('input', { type: 'text', class: 'dk-name', value: s.name, 'aria-label': `Naam deck ${K}`, onchange: e => { s.name = e.target.value; save(); } })),
        h('label', { class: 'busy' }, h('span', {}, 'Rustig'), busy, h('span', {}, 'Druk')),
        h('div', { class: 'rowf' },
          h('button', { class: 'gen', onclick: () => generateDeck(key) }, 'Genereer'),
          sel([['', 'Laden…'], ...P.scenes.map((x, i) => [i, x.name])], '', v => { if (v !== '') loadDeck(key, P.scenes[+v]); }, { 'aria-label': `Scène laden in deck ${K}` }),
          h('button', { title: 'Bewaar dit deck in de bibliotheek', onclick: () => this.saveDeck(key) }, 'Bewaar')));
    }
    $('#xfSlot').replaceChildren(fader(P.xf, Q.xf, { label: 'Crossfader', onInput: () => { Fade.cur = null; } }));
    Engine.previews.a = $('#pvA').getContext('2d');
    Engine.previews.b = $('#pvB').getContext('2d');
    $('#mixTitle').textContent = `Kanalen · deck ${P.edit.toUpperCase()}`;
  },
  saveDeck(key) {
    const c = cloneFresh(P.decks[key]);
    P.scenes.push(c);
    this.toast(`"${c.name}" bewaard in de bibliotheek.`);
    this.renderBand(); this.renderTabs(); save();
  },

  // ── Beeldbank, bibliotheek, regels ────────────────────────────────────
  tab: 'bank',
  renderTabs() {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    document.querySelectorAll('.tabview').forEach(v => { v.hidden = v.id !== 'tab-' + this.tab; });
    if (this.tab === 'bank') this.renderBank();
    if (this.tab === 'lib') this.renderLibrary();
    if (this.tab === 'auto') this.renderRules(); else this.ruleEls = [];
  },
  addToBin(urls) {
    const fresh = [...new Set(urls)].filter(u => /^(https?|file):/.test(u) && !P.bin.includes(u));
    P.bin.push(...fresh);
    fresh.forEach(u => Media.entry(u));
    return fresh.length;
  },
  renderBank() {
    if (this.tab !== 'bank') return;
    const label = { wacht: 'in wachtrij', ophalen: 'ophalen…', geladen: 'klaar', fout: 'FOUT', ready: 'klaar' };
    const failed = P.bin.filter(u => Media.entries.get(u)?.status === 'fout').length;
    $('#bankInfo').textContent = P.bin.length ? `${P.bin.length} links${failed ? `, ${failed} mislukt` : ''}. Klik op een clip om hem aan het gekozen kanaal toe te voegen.` : 'Nog leeg: genereren gebruikt nu de ingebouwde generators.';
    $('#bankGrid').replaceChildren(...P.bin.map(u => {
      const e = Media.entry(u);
      const el = h('div', { class: 'clip' + (e.status === 'fout' ? ' err' : ''), tabIndex: 0, role: 'button', title: e.err || e.title || u, onclick: () => { this.addUrls([u], this.sel.ch); this.toast('Toegevoegd aan ' + this.channel().name); } },
        h('span', { class: 'bdg' }, Media.badge(u)),
        h('span', { class: 'st' }, label[e.status]),
        h('button', { class: 'del', 'aria-label': 'Uit beeldbank verwijderen', onclick: stop(() => { P.bin.splice(P.bin.indexOf(u), 1); this.renderBank(); save(); }) }, '×'));
      if (e.thumb) el.style.backgroundImage = `url("${e.thumb}")`;
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') el.click(); });
      return el;
    }));
  },

  channel() { return S().channels[this.sel.ch]; },

  // ── Modulatie koppelen ────────────────────────────────────────────────
  setArm(id) {
    this.arm = this.arm === id ? null : id;
    document.body.classList.toggle('arming', !!this.arm);
    const b = $('#armBanner');
    b.hidden = !this.arm;
    if (this.arm) {
      document.documentElement.style.setProperty('--arm', SRC[id].color);
      b.textContent = `${SRC[id].name} koppelen: sleep aan een knop om de sterkte te zetten, dubbelklik om los te koppelen. Esc = klaar.`;
    }
    this.chips.forEach(c => c.el.classList.toggle('armed', c.id === this.arm));
  },

  chip(id, label) {
    const s = SRC[id];
    const el = h('button', { class: 'chip', style: `--c:${s.color}`, title: `${s.name}: klik om te koppelen aan een knop`, onclick: stop(() => this.setArm(id)) }, h('span', {}, label ?? s.name));
    if (this.arm === id) el.classList.add('armed');
    this.chips.push({ id, el });
    return el;
  },

  modMenu(p, q, x, y, ctrl, self) {
    document.querySelector('.pop')?.remove();
    const pop = h('div', { class: 'pop', onclick: e => e.stopPropagation(), oncontextmenu: e => e.preventDefault() });
    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = e => { if (!pop.contains(e.target)) close(); };
    const draw = () => {
      pop.replaceChildren(
        h('h2', {}, `Modulatie · ${q.label || ''}`),
        ...p.m.map(m => h('div', { class: 'rt' },
          h('span', { style: `color:${SRC[m.s].color};width:52px;font:600 11px var(--mono)` }, SRC[m.s].name),
          h('input', { type: 'range', min: -100, max: 100, value: Math.round(m.a * 100), 'aria-label': `Sterkte ${SRC[m.s].name}`, style: `accent-color:${SRC[m.s].color}`, oninput: e => { m.a = e.target.value / 100; save(); } }),
          h('button', { class: 'mini', 'aria-label': 'Verwijderen', onclick: () => { p.m.splice(p.m.indexOf(m), 1); ctrl._dots(); draw(); save(); } }, '×'))),
        h('div', { class: 'srcs' }, SOURCES.filter(s => s.id !== self && !p.m.some(m => m.s === s.id)).map(s =>
          h('button', { class: 'chip', style: `--c:${s.color}`, onclick: () => { p.m.push({ s: s.id, a: .4 }); ctrl._dots(); draw(); save(); } }, h('span', {}, s.name)))),
      );
    };
    draw();
    pop.style.left = Math.min(x, innerWidth - 262) + 'px';
    pop.style.top = Math.min(y, innerHeight - 260) + 'px';
    document.body.append(pop);
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  },

  renderLibrary() {
    const colors = { rustig: '#3ad4e6', midden: '#f2c531', heftig: '#ff5f3c' };
    $('#scenes').replaceChildren(...P.scenes.map((s, i) => h('div', { class: 'scene', style: `--e:${colors[s.energy]}` },
      h('input', { type: 'text', value: s.name, 'aria-label': 'Naam scène', onchange: e => { s.name = e.target.value; save(); this.renderBand(); } }),
      sel(ENERGIES, s.energy, v => { s.energy = v; save(); this.renderLibrary(); }, { 'aria-label': 'Energie' }),
      h('div', { class: 'row' },
        h('button', { class: 'mini', title: 'Laden in deck A', onclick: () => loadDeck('a', s) }, 'Naar A'),
        h('button', { class: 'mini', title: 'Laden in deck B', onclick: () => loadDeck('b', s) }, 'Naar B'),
        h('button', { class: 'mini', 'aria-label': 'Scène verwijderen', title: 'Scène verwijderen', onclick: () => this.deleteScene(i) }, '×')),
    )));
  },
  deleteScene(i) {
    if (!confirm(`Scène "${P.scenes[i].name}" verwijderen?`)) return;
    const id = P.scenes[i].id;
    P.scenes.splice(i, 1);
    P.auto.rules.forEach(r => { if (r.to === 's:' + id) r.to = 'random'; });
    this.renderBand(); this.renderLibrary(); save();
  },

  // ── Regels ────────────────────────────────────────────────────────────
  ruleEls: [],
  renderRules() {
    const srcOpts = [['level', 'Niveau'], ['low', 'Laag'], ['mid', 'Mid'], ['high', 'Hoog'], ['always', 'Altijd']];
    const fromOpts = [['any', 'alles'], ...ENERGIES.map(([v, t]) => [v, t.toLowerCase()])];
    const toOpts = [['g:.12', 'Genereer rustig'], ['g:.5', 'Genereer midden'], ['g:.9', 'Genereer druk'], ['same', 'Genereer zelfde energie'], ['swap', 'Ander deck'],
      ['e:rustig', 'Bibliotheek: rustig'], ['e:midden', 'Bibliotheek: midden'], ['e:heftig', 'Bibliotheek: druk'], ['next', 'Bibliotheek: volgende'], ['random', 'Bibliotheek: willekeurig'],
      ['mutate', 'Mutatie'], ...P.scenes.map(s => ['s:' + s.id, 'Scène: ' + s.name])];
    this.ruleEls = [];
    const set = (r, k, v) => { r[k] = v; save(); };
    $('#rules').replaceChildren(...P.auto.rules.map(r => {
      const liveI = h('i'), liveB = h('b', { style: `left:${r.th * 100}%` }), prog = h('i');
      const row = h('div', { class: 'rule' + (r.on ? '' : ' off') },
        h('input', { type: 'checkbox', checked: r.on, 'aria-label': 'Regel aan', style: 'accent-color:var(--acc)', onchange: e => { r.on = e.target.checked; row.classList.toggle('off', !r.on); save(); } }),
        h('span', { class: 'w' }, 'Als'),
        sel(srcOpts, r.src, v => { set(r, 'src', v); this.renderRules(); }, { 'aria-label': 'Bron' }),
        r.src === 'always' ? null : sel([['<', 'onder'], ['>', 'boven']], r.cmp, v => set(r, 'cmp', v), { 'aria-label': 'Vergelijking' }),
        r.src === 'always' ? null : h('input', { type: 'number', min: 0, max: 1, step: .01, value: r.th, 'aria-label': 'Drempel', onchange: e => { set(r, 'th', clamp01(+e.target.value)); liveB.style.left = r.th * 100 + '%'; } }),
        h('span', { class: 'w' }, 'gedurende'),
        h('input', { type: 'number', min: 0, max: 600, step: .5, value: r.hold, 'aria-label': 'Seconden', onchange: e => set(r, 'hold', Math.max(0, +e.target.value)) }),
        h('span', { class: 'w' }, 's, in beeld'),
        sel(fromOpts, r.from, v => set(r, 'from', v), { 'aria-label': 'Vanuit' }),
        h('span', { class: 'w' }, 'naar'),
        sel(toOpts, r.to, v => set(r, 'to', v), { 'aria-label': 'Doel' }),
        sel(TRANSITIONS, r.trans, v => set(r, 'trans', v), { 'aria-label': 'Overgang' }),
        h('input', { type: 'number', min: 0, max: 20, step: .1, value: r.dur, 'aria-label': 'Duur overgang', title: 'Duur overgang (s)', onchange: e => set(r, 'dur', Math.max(0, +e.target.value)) }),
        h('button', { class: 'mini x', 'aria-label': 'Regel verwijderen', onclick: () => { P.auto.rules.splice(P.auto.rules.indexOf(r), 1); this.renderRules(); save(); } }, '×'),
        r.src === 'always' ? null : h('div', { class: 'live' }, liveI, liveB),
        h('div', { class: 'prog' }, prog));
      this.ruleEls.push({ r, liveI, prog });
      return row;
    }));
  },

  // ── Mixer ─────────────────────────────────────────────────────────────
  renderMixer() {
    Engine.thumbs.clear();
    const sc = S();
    $('#mixer').replaceChildren(...sc.channels.map((ch, i) => {
      const cv = h('canvas', { width: 96, height: 54 });
      Engine.thumbs.set(ch.id, cv.getContext('2d'));
      const row = h('div', { class: 'ch' + (i === this.sel.ch && this.sel.view === 'clip' ? ' sel' : '') + (ch.on ? '' : ' dark'), onclick: () => { this.sel = { ch: i, view: 'clip' }; this.renderMixer(); this.renderInspector(); $('#masterBtn').classList.remove('on'); } },
        cv,
        h('div', { class: 'mid' },
          h('div', { class: 'top' },
            h('input', { type: 'text', class: 'nm', value: ch.name, 'aria-label': 'Naam kanaal', onclick: e => e.stopPropagation(), onchange: e => { ch.name = e.target.value; save(); } }),
            h('button', { class: 'mini' + (ch.on ? ' on' : ''), title: `Aan/uit (toets ${i + 1})`, onclick: stop(() => { ch.on = !ch.on; this.renderMixer(); save(); }) }, 'AAN'),
            h('button', { class: 'mini solo' + (ch.solo ? ' on' : ''), title: 'Solo', onclick: stop(() => { ch.solo = !ch.solo; this.renderMixer(); save(); }) }, 'S')),
          fader(ch.op, Q.op, { label: 'Mix ' + ch.name }),
          sel(BLENDS.map((b, k) => [k, b]), ch.blend, v => { ch.blend = +v; save(); }, { onclick: e => e.stopPropagation(), 'aria-label': 'Mengmodus' })),
        h('div', { class: 'btns' },
          h('button', { class: 'mini', title: 'Randomize dit kanaal', onclick: stop(() => { Rnd.channel(ch, busyOf(sc)); this.renderMixer(); this.renderInspector(); save(); }) }, 'RND'),
          sc.channels.length > 1 ? h('button', { class: 'mini', 'aria-label': 'Kanaal verwijderen', title: 'Kanaal verwijderen', onclick: stop(() => this.deleteChannel(i)) }, '×') : null));
      return row;
    }));
  },
  deleteChannel(i) {
    const ch = S().channels[i];
    if (ch.clips.length && !confirm(`"${ch.name}" met ${ch.clips.length} clip(s) verwijderen?`)) return;
    S().channels.splice(i, 1);
    this.sel.ch = Math.max(0, Math.min(this.sel.ch, S().channels.length - 1));
    this.renderMixer(); this.renderInspector(); save();
  },

  // ── Inspector ─────────────────────────────────────────────────────────
  renderInspector() {
    const box = $('#inspector');
    if (this.sel.view === 'master') {
      const m = S().master;
      box.replaceChildren(
        h('div', { class: 'sec' }, h('div', { class: 'rowf' }, h('h2', {}, 'Master')), h('div', { class: 'knobs', style: 'padding:0' }, knob(m.op, { label: 'Helderheid', min: 0, max: 1, def: 1 }))),
        this.fxSection(m, 'Master-effecten'));
      return;
    }
    const ch = this.channel();
    if (!ch) { box.replaceChildren(); return; }
    this.clipBox = h('div', { class: 'clips' });
    this.clipNote = h('div', { class: 'note' });
    const ta = h('textarea', { placeholder: 'Plak hier links: YouTube, Instagram, TikTok, afbeeldingen…', 'aria-label': 'Links' });
    this.fxBox = h('div');
    box.replaceChildren(
      h('div', { class: 'sec' },
        h('div', { class: 'rowf' }, h('h2', {}, ch.name),
          h('button', { onclick: () => $('#fileIn').click() }, 'Bestanden'),
          h('button', { onclick: () => this.addLive('screen') }, 'Scherm'),
          h('button', { onclick: () => this.addLive('cam') }, 'Camera'),
          sel([['', 'Generator…'], ...Object.entries(GENS).map(([k, g]) => [k, g.name])], '', v => { if (v) this.addUrls(['gen:' + v], this.sel.ch); }, { 'aria-label': 'Generator toevoegen' })),
        ta,
        h('div', { class: 'rowf' },
          h('button', { onclick: () => { if (this.addUrls(extractUrls(ta.value), this.sel.ch)) ta.value = ''; } }, 'Naar dit kanaal'),
          h('button', { title: 'Links om en om over alle kanalen verdelen', onclick: () => { if (this.distribute(extractUrls(ta.value))) ta.value = ''; } }, 'Verdeel over kanalen')),
        this.clipBox, this.clipNote,
        h('div', { class: 'rowf' },
          h('span', { class: 'note' }, 'Wissel'),
          sel([['off', 'handmatig'], ['time', 'elke x sec'], ['beat', 'elke x beats']], ch.adv, v => { ch.adv = v; save(); }, { 'aria-label': 'Clip wisselen' }),
          h('input', { type: 'number', min: 1, max: 600, value: ch.every, 'aria-label': 'Aantal', onchange: e => { ch.every = Math.max(1, +e.target.value); save(); } }),
          this.check('Husselen', ch, 'shuffle'), this.check('Random start', ch, 'rndStart'), this.check('Sprong op beat', ch, 'jump'))),
      this.fxBox);
    this.renderClips();
    this.renderClipFx();
  },
  check(label, obj, key) {
    return h('label', { class: 'field' }, h('input', { type: 'checkbox', checked: obj[key], style: 'accent-color:var(--acc)', onchange: e => { obj[key] = e.target.checked; save(); } }), label);
  },
  onClipChange(ch) { if (this.sel.view === 'clip' && this.channel() === ch) { this.renderClips(); this.renderClipFx(); } },

  renderClips() {
    const ch = this.channel();
    if (!this.clipBox || !ch || this.sel.view !== 'clip') return;
    const label = { wacht: 'in wachtrij', ophalen: 'ophalen…', geladen: 'laden…', fout: 'FOUT', ready: '' };
    this.clipBox.replaceChildren(...ch.clips.map((c, i) => {
      const e = Media.entry(c.url);
      const el = h('div', { class: 'clip' + (i === ch.cur ? ' cur' : '') + (e.status === 'fout' ? ' err' : ''), tabIndex: 0, role: 'button', title: e.err || e.title || c.url, onclick: () => { Player.show(ch, i); this.renderClips(); this.renderClipFx(); save(); } },
        h('span', { class: 'bdg' }, Media.badge(c.url)),
        h('span', { class: 'st' }, label[e.status] || (e.kind === 'gen' ? e.title : '')),
        h('button', { class: 'del', 'aria-label': 'Clip verwijderen', onclick: stop(() => { ch.clips.splice(i, 1); if (ch.cur >= ch.clips.length) ch.cur = Math.max(0, ch.clips.length - 1); this.renderClips(); this.renderClipFx(); save(); }) }, '×'));
      if (e.thumb) el.style.backgroundImage = `url("${e.thumb}")`;
      else if (e.kind === 'gen') el.style.background = `linear-gradient(135deg,hsl(${(c.url.length * 47) % 360} 60% 22%),hsl(${(c.url.charCodeAt(4) * 31) % 360} 65% 38%))`;
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') el.click(); });
      return el;
    }));
    const cur = ch.clips[ch.cur];
    const e = cur && Media.entries.get(cur.url);
    this.clipNote.className = 'note' + (e?.status === 'fout' ? ' err' : '');
    this.clipNote.textContent = !cur ? 'Nog geen beeld in dit kanaal.' : e?.err || e?.title || cur.url;
  },

  renderClipFx() {
    const ch = this.channel(), c = ch?.clips[ch.cur];
    if (!this.fxBox) return;
    if (!c) { this.fxBox.replaceChildren(); return; }
    const isGen = c.url.startsWith('gen:');
    this.fxBox.replaceChildren(
      h('div', { class: 'sec' },
        h('div', { class: 'rowf' }, h('h2', {}, 'Clip'),
          !isGen ? sel([['cover', 'Vullen'], ['contain', 'Passend']], c.fit, v => { c.fit = v; save(); }, { 'aria-label': 'Passing' }) : null),
        h('div', { class: 'knobs', style: 'padding:0' }, knob(c.speed, Q.speed), isGen ? knob(c.a, Q.a) : null, isGen ? knob(c.b, Q.b) : null)),
      this.fxSection(c, 'Effecten op deze clip', () => this.copyFxToAll(ch, c)));
  },
  copyFxToAll(ch, c) {
    ch.clips.forEach(x => { if (x !== c) x.fx = cloneFresh(c.fx); });
    this.toast(`Effecten gekopieerd naar ${ch.clips.length - 1} clip(s).`);
    save();
  },

  fxSection(owner, title, copyAll) {
    const redraw = () => this.renderInspectorFx(owner, title, copyAll, sec);
    const sec = h('div', { class: 'sec' });
    redraw();
    return sec;
  },
  renderInspectorFx(owner, title, copyAll, sec) {
    const redraw = () => { this.renderInspectorFx(owner, title, copyAll, sec); save(); };
    const cats = Object.entries(FX_CATS);
    const add = h('select', { 'aria-label': 'Effect toevoegen', onchange: () => { if (add.value) { owner.fx.push(newFx(add.value)); redraw(); } } },
      h('option', { value: '' }, 'Effect toevoegen…'),
      cats.map(([id, name]) => h('optgroup', { label: name }, Object.values(FX).filter(d => d.cat === id).map(d => h('option', { value: d.id }, d.name)))));
    sec.replaceChildren(
      h('div', { class: 'rowf' }, h('h2', {}, title), add,
        h('button', { title: 'Nieuwe willekeurige effectketen', onclick: () => { owner.fx = Rnd.chain(Math.max(.25, busyOf(S()))); redraw(); } }, 'RND'),
        copyAll ? h('button', { title: 'Deze effecten op alle clips van dit kanaal zetten', onclick: copyAll }, 'Op alle clips') : null),
      h('div', { class: 'fxlist' }, owner.fx.map((fx, i) => {
        const d = FX[fx.type];
        const move = dir => { const j = i + dir; if (j < 0 || j >= owner.fx.length) return; [owner.fx[i], owner.fx[j]] = [owner.fx[j], owner.fx[i]]; redraw(); };
        return h('div', { class: 'fx' + (fx.on ? '' : ' off') },
          h('div', { class: 'fxh' },
            h('button', { class: 'mini' + (fx.on ? ' on' : ''), 'aria-label': 'Effect aan of uit', onclick: () => { fx.on = !fx.on; redraw(); } }, fx.on ? 'AAN' : 'UIT'),
            h('span', { class: 'n' }, d.name),
            h('button', { class: 'mini', title: 'Parameters randomizen', onclick: () => { Rnd.fx(fx, busyOf(S())); redraw(); } }, 'RND'),
            h('button', { class: 'mini', 'aria-label': 'Omhoog', onclick: () => move(-1) }, '↑'),
            h('button', { class: 'mini', 'aria-label': 'Omlaag', onclick: () => move(1) }, '↓'),
            h('button', { class: 'mini', 'aria-label': 'Effect verwijderen', onclick: () => { owner.fx.splice(i, 1); redraw(); } }, '×')),
          h('div', { class: 'knobs' }, d.params.map(q => knob(fx.p[q.k], q))));
      })));
  },

  addUrls(urls, chIdx) {
    const ch = S().channels[chIdx];
    if (!ch || !urls.length) return false;
    const first = ch.clips.length === 0;
    for (const u of urls.map(x => Media.normalize(x))) { ch.clips.push(newClip(u)); this.addToBin([u]); }
    if (first) ch.cur = 0;
    this.renderClips(); this.renderClipFx(); this.renderBank(); Media.preload(P); save();
    if (urls.length > 1) this.toast(`${urls.length} clips toegevoegd aan ${ch.name}.`);
    return true;
  },
  distribute(urls) {
    const list = S().channels;
    if (!urls.length) return false;
    urls.map(x => Media.normalize(x)).forEach((u, i) => { list[i % list.length].clips.push(newClip(u)); this.addToBin([u]); });
    this.renderClips(); this.renderClipFx(); this.renderBank(); Media.preload(P); save();
    this.toast(`${urls.length} clips verdeeld over ${list.length} kanalen.`);
    return true;
  },
  async addLive(type) {
    try {
      const url = await Media.startLive(type);
      const ch = this.channel();
      let i = ch.clips.findIndex(c => c.url === url);
      if (i < 0) { ch.clips.push(newClip(url)); i = ch.clips.length - 1; }
      Player.show(ch, i);
      this.renderClips(); this.renderClipFx(); save();
    } catch (err) { this.toast('Starten mislukt: ' + err.message); }
  },

  // ── Modulatiedek ──────────────────────────────────────────────────────
  async renderMod() {
    this.chips = [];
    const sc = S(), a = P.audio;
    const noMod = { noMod: true };
    const band = (id, i) => {
      const k = knob(a.gain[i], { label: 'Gain', min: 0, max: 2, def: 1 }, noMod);
      return h('div', { class: 'band' }, this.chip(id), k);
    };
    const onF = { noMod: true, onInput: () => AudioIn.applyFilters() };
    const devs = await AudioIn.devices();
    const inputOpts = [['none', 'Geen geluid'], ['demo', 'Demo-beat'], ['mic', 'Microfoon / line-in'], ...devs.map(d => ['mic:' + d.deviceId, d.label]), ['system', 'Systeemgeluid (tab/scherm delen)'], ['file', 'Audiobestand…']];
    const input = sel(inputOpts, this.audioValue, v => this.setAudio(v, input), { 'aria-label': 'Geluidsingang', style: 'max-width:190px' });
    this.lamp = h('div', { class: 'lamp', 'aria-hidden': 'true' });
    this.bpmEl = h('span', { class: 'big' }, '--');
    const agcBtn = h('button', { class: a.agc ? 'on' : '', title: 'Past het niveau automatisch aan het volume aan', onclick: () => { a.agc = !a.agc; agcBtn.classList.toggle('on', a.agc); save(); } }, 'Auto-gain');

    const lfoCards = sc.lfos.map((l, i) => {
      const id = 'lfo' + (i + 1);
      const rateBox = h('div', {});
      const paintRate = () => rateBox.replaceChildren(l.sync
        ? sel(LFO_DIVS.map((d, k) => [k, d[1]]), l.div, v => { l.div = +v; save(); }, { 'aria-label': 'Maatdeling' })
        : knob(l.rate, Q.rate));
      paintRate();
      const syncBtn = h('button', { class: 'mini' + (l.sync ? ' on' : ''), title: 'Mee met de beat', onclick: () => { l.sync = !l.sync; syncBtn.classList.toggle('on', l.sync); paintRate(); save(); } }, 'SYNC');
      return h('div', { class: 'lfo' },
        h('div', { class: 'rowf' }, this.chip(id), syncBtn,
          h('button', { class: 'mini', title: 'Randomize LFO', onclick: () => { l.shape = Math.floor(Math.random() * 6); l.rate.v = Math.random() * .7; this.renderMod(); save(); } }, 'RND')),
        sel(LFO_SHAPES.map((n, k) => [k, n]), l.shape, v => { l.shape = +v; save(); }, { 'aria-label': 'Vorm' }),
        h('div', { class: 'rowf' }, rateBox, knob(l.depth, Q.depth)));
    });
    const macros = sc.macros.map((p, i) => h('div', { class: 'macro' }, this.chip('m' + (i + 1), 'M' + (i + 1)), knob(p, { ...Q.macro, label: 'Macro ' + (i + 1) }, { self: 'm' + (i + 1) })));

    $('#deck').replaceChildren(
      h('div', { class: 'dk' },
        h('div', { class: 'rowf' }, h('h2', {}, 'Geluid'), input, agcBtn),
        h('div', { class: 'bands' },
          band('low', 0), band('mid', 1), band('high', 2),
          h('div', { class: 'knobs' },
            knob(a.lowX, { label: 'Laag/Mid', min: 0, max: 1, def: .523, fmt: n => Math.round(lowXHz(n)) + 'Hz' }, onF),
            knob(a.highX, { label: 'Mid/Hoog', min: 0, max: 1, def: .44, fmt: n => (highXHz(n) / 1000).toFixed(1) + 'k' }, onF),
            knob(a.attack, { label: 'Attack', min: 0, max: 1, def: .05 }, noMod),
            knob(a.release, { label: 'Release', min: 0, max: 1, def: .2 }, noMod)),
          h('div', { style: 'display:flex;flex-direction:column;gap:4px;width:80px' },
            this.chip('level'), this.chip('beat'), this.chip('rnd'),
            h('div', { class: 'rowf', style: 'flex-wrap:nowrap' }, this.lamp, this.bpmEl, h('button', { class: 'mini', title: 'Tik het tempo', onclick: () => AudioIn.tap() }, 'TAP'))))),
      h('div', { class: 'dk' }, h('div', { class: 'rowf' }, h('h2', {}, 'LFO')), h('div', { class: 'lfos' }, lfoCards)),
      h('div', { class: 'dk' }, h('div', { class: 'rowf' }, h('h2', {}, 'Macro')), h('div', { class: 'gridk' }, macros)));
  },

  async setAudio(v, input) {
    const prev = this.audioValue;
    try {
      if (v === 'file') { $('#audioFile').click(); input.value = prev; return; }
      if (v.startsWith('mic')) await AudioIn.set('mic', v.slice(4) || undefined);
      else await AudioIn.set(v);
      this.audioValue = v;
      if (v === 'mic') this.renderMod(); // apparaatnamen zijn pas na toestemming bekend
    } catch (err) {
      this.toast('Geluid starten mislukt: ' + err.message);
      input.value = prev;
    }
  },

  // ── Per frame ─────────────────────────────────────────────────────────
  update() {
    for (const c of this.controls) {
      if (!c.isConnected) { this.controls.delete(c); continue; }
      if (c._p.m.length) c._paint();
    }
    for (const c of this.chips) c.el.style.setProperty('--v', (Mod.src[c.id] || 0).toFixed(3));
    if (this.lamp) this.lamp.style.opacity = .12 + Mod.src.beat * .88;
    if (this.bpmEl && AudioIn.kind !== 'none') this.bpmEl.textContent = Math.round(AudioIn.tempo);
    const xv = Mod.val(P.xf);
    if (this.airA) { this.airA.style.opacity = 1 - xv; this.airB.style.opacity = xv; }
    for (const { r, liveI, prog } of this.ruleEls) {
      if (r.src !== 'always') liveI.style.width = (Mod.src[r.src] || 0) * 100 + '%';
      prog.style.width = Math.min(1, (r._t || 0) / (r.hold || .01)) * 100 + '%';
    }
  },
};

function extractUrls(text) { return text.match(/https?:\/\/[^\s"'<>]+/g) || []; }
