// Opstarten, hoofdlus en globale bediening.
(async function main() {
  P = loadSaved();

  try {
    Engine.init($('#gl'));
  } catch (err) {
    document.body.textContent = err.message;
    return;
  }
  await Media.init();

  const helper = $('#helper');
  if (Media.helper.ok && Media.helper.ytdlp) { helper.textContent = 'helper + yt-dlp actief'; helper.classList.add('ok'); }
  else if (Media.helper.ok) { helper.textContent = 'yt-dlp ontbreekt'; helper.classList.add('bad'); helper.title = 'Start de app via start.bat om yt-dlp te installeren.'; }
  else { helper.textContent = 'zonder helper'; helper.classList.add('bad'); helper.title = 'Start de app via start.bat om links van YouTube, Instagram en TikTok te gebruiken.'; }

  Media.onChange = () => { UI.renderClips(); UI.renderBank(); };

  // ── Bovenbalk ──
  const res = $('#res');
  res.value = P.res;
  res.onchange = () => { P.res = +res.value; Engine.setRes(P.res); save(); };

  const rndActions = { mutate: s => Rnd.mutate(s), fx: s => Rnd.fxAll(s), routes: s => Rnd.routes(s), images: s => Rnd.images(s) };
  const doRandom = kind => {
    if ((kind === 'fx' || kind === 'images') && P.edit === onAirDeck()) Engine.startTransition('glitch', .3);
    rndActions[kind](S());
    Media.preload(P);
    UI.renderAll();
    save();
  };
  document.querySelectorAll('[data-rnd]').forEach(b => { b.onclick = () => doRandom(b.dataset.rnd); });

  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('#stage').requestFullscreen(); };
  $('#full').onclick = fullscreen;
  const blackout = () => { Engine.blackout = !Engine.blackout; $('#black').classList.toggle('on', Engine.blackout); };
  $('#black').onclick = blackout;

  $('#popout').onclick = () => {
    const w = window.open('', 'autovisual-output', 'width=1280,height=720');
    if (!w) { UI.toast('Sta pop-ups toe om het output-venster te openen.'); return; }
    w.document.title = 'AutoVisual output';
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    w.document.body.replaceChildren();
    const c = w.document.createElement('canvas');
    c.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block;cursor:none';
    c.title = 'Dubbelklik voor volledig scherm';
    c.ondblclick = () => c.requestFullscreen();
    w.document.body.append(c);
    UI.output = { w, c, ctx: c.getContext('2d') };
  };

  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(P, stripRuntime, 1)], { type: 'application/json' });
    h('a', { href: URL.createObjectURL(blob), download: 'autovisual-set.json' }).click();
  };
  $('#import').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!(data.version <= 2) || !data.scenes?.length) throw new Error('Geen AutoVisual-set.');
      Fade.cur = null;
      P = migrate(data);
      Engine.setRes(P.res); res.value = P.res;
      Media.preload(P); syncFaderBar(); UI.renderAll(); save();
    } catch (err) { UI.toast('Importeren mislukt: ' + err.message); }
  };

  // ── Crossfader ──
  const xfMode = $('#xfMode'), xfDur = $('#xfDur'), autoBtn = $('#autoOn'), cool = $('#cooldown');
  xfMode.append(...TRANSITIONS.map(([v, t]) => h('option', { value: v }, t)));
  xfMode.onchange = () => { P.xfMode = xfMode.value; save(); };
  xfDur.onchange = () => { P.xfDur = Math.max(0, +xfDur.value); save(); };
  function syncFaderBar() {
    xfMode.value = P.xfMode;
    xfDur.value = P.xfDur;
    autoBtn.classList.toggle('on', P.auto.on);
    autoBtn.textContent = P.auto.on ? 'Auto aan' : 'Auto uit';
    cool.value = P.auto.cooldown;
  }
  $('#toA').onclick = () => Fade.to('a');
  $('#toB').onclick = () => Fade.to('b');
  autoBtn.onclick = () => { P.auto.on = !P.auto.on; syncFaderBar(); save(); };
  cool.onchange = () => { P.auto.cooldown = Math.max(0, +cool.value); save(); };
  syncFaderBar();
  UI.airA = $('#airA');
  UI.airB = $('#airB');
  $('#pvA').onclick = () => UI.setEdit('a');
  $('#pvB').onclick = () => UI.setEdit('b');

  // ── Tabs en beeldbank ──
  document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { UI.tab = b.dataset.tab; UI.renderTabs(); }; });
  $('#bankAdd').onclick = () => {
    const ta = $('#bankText');
    const urls = extractUrls(ta.value).map(u => Media.normalize(u));
    if (!urls.length) { UI.toast('Geen links gevonden.'); return; }
    const added = UI.addToBin(urls);
    ta.value = '';
    UI.toast(`${added} nieuwe links in de beeldbank.`);
    UI.renderBank(); save();
  };
  $('#bankFiles').onclick = () => $('#bankFileIn').click();
  const fileUrls = files => [...files].filter(f => /^(video|image)\//.test(f.type)).map(f => Media.registerFile(f));
  $('#bankFileIn').onchange = e => { UI.addToBin(fileUrls(e.target.files)); e.target.value = ''; UI.renderBank(); save(); };

  $('#ruleAdd').onclick = () => {
    P.auto.rules.push({ id: uid(), on: true, src: 'level', cmp: '<', th: .3, hold: 5, from: 'any', to: 'same', trans: 'fade', dur: 1 });
    UI.renderRules(); save();
  };
  $('#chAdd').onclick = () => { S().channels.push(newChannel(S().channels.length + 1)); UI.sel = { ch: S().channels.length - 1, view: 'clip' }; UI.renderMixer(); UI.renderInspector(); save(); };
  $('#masterBtn').onclick = () => {
    UI.sel.view = UI.sel.view === 'master' ? 'clip' : 'master';
    $('#masterBtn').classList.toggle('on', UI.sel.view === 'master');
    UI.renderMixer(); UI.renderInspector();
  };

  // ── Bestanden, plakken, toetsen ──
  const addFiles = files => { const urls = fileUrls(files); if (urls.length) UI.addUrls(urls, UI.sel.ch); };
  $('#fileIn').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#audioFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { await AudioIn.set('file', f); UI.audioValue = 'none'; UI.toast('Speelt: ' + f.name); }
    catch (err) { UI.toast('Afspelen mislukt: ' + err.message); }
  };
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
  const typing = el => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  addEventListener('paste', e => {
    if (typing(e.target)) return;
    const urls = extractUrls(e.clipboardData.getData('text')).map(u => Media.normalize(u));
    if (!urls.length) return;
    const added = UI.addToBin(urls);
    UI.toast(`${added} nieuwe links in de beeldbank.`);
    UI.renderBank(); save();
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && UI.arm) { UI.setArm(UI.arm); return; }
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '8') { const ch = S().channels[+k - 1]; if (ch) { ch.on = !ch.on; UI.renderMixer(); save(); } }
    else if (k === 'b') blackout();
    else if (k === 'f') fullscreen();
    else if (k === 'r') generateDeck(P.edit);
    else if (k === 'm') doRandom('mutate');
    else if (k === 'arrowleft') Fade.to('a');
    else if (k === 'arrowright') Fade.to('b');
  });

  // ── Hoofdlus ──
  Media.preload(P);
  UI.renderAll();
  let last = performance.now(), frames = 0, fpsT = last;
  const fpsEl = $('#fps');
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    AudioIn.update(dt);
    Mod.audio(dt);
    Fade.update(dt);
    Auto.update(dt);
    for (const k of DECKS) Player.update(dt, P.decks[k]);
    Engine.render(dt);
    const out = UI.output;
    if (out) {
      if (out.w.closed) UI.output = null;
      else {
        if (out.c.width !== Engine.W || out.c.height !== Engine.H) { out.c.width = Engine.W; out.c.height = Engine.H; }
        out.ctx.drawImage(Engine.canvas, 0, 0);
      }
    }
    UI.update();
    frames++;
    if (now - fpsT > 1000) { fpsEl.textContent = frames + ' fps'; frames = 0; fpsT = now; }
  }
  requestAnimationFrame(tick);
  window.AV = { Engine, Media, Mod, AudioIn, Auto, Fade, Rnd, UI, getP: () => P, tick: dt => { AudioIn.update(dt); Mod.audio(dt); Fade.update(dt); Auto.update(dt); for (const k of DECKS) Player.update(dt, P.decks[k]); Engine.render(dt); UI.update(); } };
})();
