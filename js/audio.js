// Geluidsingang: drie filterbanden, niveau en beatdetectie.
const AudioIn = {
  ctx: null, kind: 'none', stream: null, node: null, fileEl: null, fileNode: null, demoTimer: null,
  low: 0, mid: 0, high: 0, level: 0, beatEdge: false, bpm: 120, tapBpm: 0, taps: [],
  env: [0, 0, 0], peak: [.03, .03, .03], lvlEnv: 0, lvlPeak: .03, avg: 0, lastBeat: 0, intervals: [],

  setup() {
    if (this.ctx) return;
    const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.input = c.createGain();
    this.monitor = c.createGain();
    this.monitor.connect(c.destination);
    const f = (type, freq) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = .707; return n; };
    const chain = (...nodes) => { nodes.reduce((a, b) => (a.connect(b), b)); return nodes; };
    this.lp = [f('lowpass', 200), f('lowpass', 200)];
    this.mhp = [f('highpass', 200), f('highpass', 200)];
    this.mlp = [f('lowpass', 2500), f('lowpass', 2500)];
    this.hp = [f('highpass', 2500), f('highpass', 2500)];
    const an = () => { const a = c.createAnalyser(); a.fftSize = 2048; return a; };
    this.an = [an(), an(), an()];
    this.anAll = an();
    chain(this.input, ...this.lp, this.an[0]);
    chain(this.input, ...this.mhp, ...this.mlp, this.an[1]);
    chain(this.input, ...this.hp, this.an[2]);
    this.input.connect(this.anAll);
    this.buf = new Float32Array(2048);
  },

  applyFilters() {
    if (!this.ctx) return;
    const lo = lowXHz(P.audio.lowX.v), hi = highXHz(P.audio.highX.v);
    [...this.lp, ...this.mhp].forEach(n => n.frequency.value = lo);
    [...this.mlp, ...this.hp].forEach(n => n.frequency.value = hi);
  },

  stop() {
    if (this.node) { try { this.node.disconnect(); } catch {} this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.fileEl) this.fileEl.pause();
    if (this.fileNode) { try { this.fileNode.disconnect(); } catch {} }
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    if (this.demoBus) { this.demoBus.disconnect(); this.demoBus = null; }
    this.kind = 'none';
  },

  async set(kind, arg) {
    this.setup();
    await this.ctx.resume();
    this.stop();
    this.applyFilters();
    this.peak = [.03, .03, .03]; this.lvlPeak = .03;
    const clean = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (kind === 'mic') {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: arg ? { ...clean, deviceId: { exact: arg } } : clean });
      this.node = this.ctx.createMediaStreamSource(this.stream);
      this.node.connect(this.input);
    } else if (kind === 'system') {
      this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: clean });
      if (!this.stream.getAudioTracks().length) { this.stop(); throw new Error('Geen geluid gedeeld. Zet "ook audio delen" aan.'); }
      this.node = this.ctx.createMediaStreamSource(this.stream);
      this.node.connect(this.input);
    } else if (kind === 'file') {
      if (!this.fileEl) {
        this.fileEl = new Audio(); this.fileEl.loop = true;
        this.fileNode = this.ctx.createMediaElementSource(this.fileEl);
      }
      this.fileEl.src = URL.createObjectURL(arg);
      this.fileNode.connect(this.input);
      this.fileNode.connect(this.monitor);
      await this.fileEl.play();
    } else if (kind === 'demo') {
      this.startDemo();
    } else {
      kind = 'none';
    }
    this.kind = kind;
  },

  async devices() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.label); }
    catch { return []; }
  },

  // Testbeat met een rustig stuk, om scènewissels te horen en te zien.
  startDemo() {
    const c = this.ctx, bus = this.demoBus = c.createGain();
    bus.gain.value = .6; bus.connect(this.input); bus.connect(this.monitor);
    const noise = c.createBuffer(1, c.sampleRate * .2, c.sampleRate);
    noise.getChannelData(0).forEach((_, i, a) => a[i] = Math.random() * 2 - 1);
    const hit = (type, t, f0, f1, dur, vol) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur);
    };
    const hat = (t, vol) => {
      const s = c.createBufferSource(), h = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noise; h.type = 'highpass'; h.frequency.value = 6000;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .06);
      s.connect(h); h.connect(g); g.connect(bus); s.start(t); s.stop(t + .08);
    };
    const step = 60 / 128 / 4;
    const notes = [55, 55, 65.4, 49];
    let n = 0, next = c.currentTime + .05;
    this.demoTimer = setInterval(() => {
      while (next < c.currentTime + .15) {
        const bar = Math.floor(n / 16) % 24, s = n % 16;
        const calm = bar >= 12 && bar < 18;       // zes rustige maten
        const peak = bar >= 8 && bar < 12 || bar >= 20;
        const root = notes[Math.floor(n / 32) % 4];
        if (calm) { if (s === 0) hit('sine', next, root * 4, root * 4, step * 14, .05); }
        else {
          if (s % 4 === 0) hit('sine', next, 150, 42, .22, 1);
          if (s % 4 === 2) hit('sawtooth', next, root * 2, root * 2, step * 1.6, .22);
          if (peak) { hat(next, s % 2 ? .25 : .4); hit('sawtooth', next, root * 2, root * 2, step, .3); if (s % 3 === 0) hit('square', next, root * 8, root * 8, step, .14); }
          else if (s % 4 === 2) hat(next, .2);
        }
        n++; next += step;
      }
    }, 30);
  },

  tap() {
    const now = performance.now() / 1000;
    this.taps = this.taps.filter(t => now - t < 3); this.taps.push(now);
    if (this.taps.length >= 3) this.tapBpm = 60 * (this.taps.length - 1) / (now - this.taps[0]);
  },

  rms(an) {
    an.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  },

  update(dt) {
    this.beatEdge = false;
    if (!this.ctx || this.kind === 'none') {
      this.low = this.mid = this.high = this.level = 0;
      return;
    }
    const cfg = P.audio;
    const atk = 1 - Math.exp(-dt / (.002 + cfg.attack.v * .2));
    const rel = 1 - Math.exp(-dt / (.02 + cfg.release.v * 1.2));
    const follow = (env, x, a = atk, r = rel) => env + (x - env) * (x > env ? a : r);
    const decay = Math.exp(-dt / 25);
    const out = [];
    let lowRaw = 0;
    for (let i = 0; i < 3; i++) {
      const r = this.rms(this.an[i]);
      if (i === 0) lowRaw = r;
      this.peak[i] = Math.max(r, this.peak[i] * decay, .02);
      const x = r < .0015 ? 0 : cfg.agc ? Math.pow(r / this.peak[i], 1.5) : r * 4;
      this.env[i] = follow(this.env[i], x);
      out[i] = clamp01(this.env[i] * cfg.gain[i].v * 2);
    }
    [this.low, this.mid, this.high] = out;

    const lr = this.rms(this.anAll);
    // Niveau is relatief aan het luidste stuk van de laatste anderhalve minuut, niet aan losse klappen.
    this.lvlAvg = (this.lvlAvg || 0) + (lr - (this.lvlAvg || 0)) * (1 - Math.exp(-dt / .4));
    this.lvlPeak = Math.max(this.lvlAvg, this.lvlPeak * Math.exp(-dt / 90), .02);
    const lx = lr < .0015 ? 0 : cfg.agc ? this.lvlAvg / this.lvlPeak : lr * 3;
    // Bewust traag: dit is de energie van de muziek, niet de losse klappen.
    this.lvlEnv = follow(this.lvlEnv, lx, 1 - Math.exp(-dt / .25), 1 - Math.exp(-dt / 1.1));
    this.level = clamp01(this.lvlEnv);

    const now = performance.now() / 1000;
    this.avg += (lowRaw - this.avg) * (1 - Math.exp(-dt / .5));
    if (lowRaw > this.avg * 1.35 && lowRaw > this.peak[0] * .35 && now - this.lastBeat > .2) {
      const iv = now - this.lastBeat;
      this.lastBeat = now;
      this.beatEdge = true;
      if (iv < 2) {
        this.intervals.push(iv);
        if (this.intervals.length > 16) this.intervals.shift();
        const sorted = [...this.intervals].sort((a, b) => a - b);
        let b = 60 / sorted[sorted.length >> 1];
        while (b < 80) b *= 2;
        while (b > 175) b /= 2;
        if (this.intervals.length >= 6) this.bpm = b;
      }
    }
  },

  get tempo() { return this.tapBpm || this.bpm; },
};
