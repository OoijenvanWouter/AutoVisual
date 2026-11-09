// WebGL2-renderer: bron → effectketen per clip → kanaalmix → master → overgang.
const VS = `#version 300 es
out vec2 vUv;
void main(){vec2 v=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=v;gl_Position=vec4(v*2.-1.,0.,1.);}`;
const FS_HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;out vec4 outColor;
uniform sampler2D t;uniform sampler2D prev;uniform sampler2D t2;
uniform vec2 res;uniform float time;uniform float frame;
`;

const Engine = {
  gl: null, canvas: null, W: 1280, H: 720, frame: 0, time: 0,
  programs: new Map(), free: [], all: [], chRT: new Map(), hist: new Map(), thumbs: new Map(),
  lastOut: null, tr: null, blackout: false, thumbI: 0, compileQueue: [], deckOut: {}, previews: {},

  init(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is niet beschikbaar in deze browser.');
    gl.bindVertexArray(gl.createVertexArray());
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); UI.toast('De grafische kaart is gereset. Herlaad de pagina.'); });

    this.src = {
      copy: `uniform float gain;void main(){outColor=vec4(texture(t,vUv).rgb*gain,1.);}`,
      fit: `uniform vec2 scale;void main(){vec2 q=(vUv-.5)*scale+.5;if(q.x<0.||q.x>1.||q.y<0.||q.y>1.){outColor=vec4(0.);return;}outColor=texture(t,q);}`,
      blend: `uniform float op;uniform int mode;
        vec3 ov(vec3 a,vec3 b){return mix(2.*a*b,1.-2.*(1.-a)*(1.-b),step(.5,a));}
        void main(){vec3 a=texture(t,vUv).rgb;vec4 s=texture(t2,vUv);vec3 b=s.rgb,c=b;float al=s.a*op;
          if(mode==1)c=a+b;else if(mode==2)c=1.-(1.-a)*(1.-b);else if(mode==3)c=a*b;else if(mode==4)c=ov(a,b);
          else if(mode==5)c=abs(a-b);else if(mode==6)c=a+b-2.*a*b;else if(mode==7)c=max(a,b);else if(mode==8)c=min(a,b);
          else if(mode==9)c=a/max(1.-b,.02);else if(mode==10){al*=smoothstep(.04,.3,luma(b));}
          outColor=vec4(mix(a,clamp(c,0.,1.),al),1.);}`,
      trans: `uniform float p;uniform int mode;
        void main(){vec2 uv=vUv;vec3 a=texture(t,uv).rgb,b=texture(t2,uv).rgb,c;
          if(mode==1){float g=rand(floor(uv*vec2(26.,15.))+floor(time*24.));vec2 d=vec2((rand(vec2(floor(uv.y*30.),floor(time*24.)))-.5)*.2*(1.-abs(2.*p-1.)),0.);a=texture(t,fract(uv+d)).rgb;b=texture(t2,fract(uv-d)).rgb;c=g<p?b:a;}
          else if(mode==2){c=mix(a,b,step(.5,p));c=mix(c,vec3(1.),1.-abs(2.*p-1.));}
          else if(mode==3){vec2 q=(uv-.5)/(1.+p*2.5)+.5;a=texture(t,q).rgb;c=mix(a,b,p*p);}
          else if(mode==4){float l=luma(a);c=mix(a,b,smoothstep(l-.12,l+.12,p*1.24-.12));}
          else if(mode==5)c=p<.5?a:b;
          else if(mode==6){float n=max(1.,90.*(1.-abs(2.*p-1.)));vec2 s=vec2(n)/res;vec2 g=(floor(uv/s)+.5)*s;c=mix(texture(t,g).rgb,texture(t2,g).rgb,smoothstep(.4,.6,p));}
          else if(mode==7){c=uv.x<p?texture(t2,vec2(uv.x-p+1.,uv.y)).rgb:texture(t,vec2(uv.x-p,uv.y)).rgb;}
          else c=mix(a,b,p);outColor=vec4(c,1.);}`,
    };
    this.compileQueue = [...Object.keys(this.src).map(k => () => this.base(k)), ...Object.keys(FX).map(k => () => this.fxProg(k)), ...Object.keys(GENS).map(k => () => this.genProg(k))];
    this.setRes(P.res);
  },

  setRes(h) {
    const w = Math.round(h * 16 / 9);
    this.W = w; this.H = h;
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl;
    this.all.forEach(r => { gl.deleteFramebuffer(r.fb); gl.deleteTexture(r.tex); });
    this.all = []; this.free = [];
    this.chRT.clear(); this.hist.clear();
    this.lastOut = null; this.tr = null; this.deckOut = {};
  },

  compile(key, body) {
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS_HEAD + GLSL_LIB + body);
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    let prog = null;
    if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      const u = {};
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(pr, i).name; u[name] = gl.getUniformLocation(pr, name); }
      prog = { pr, u };
    } else {
      console.error('Shader fout in', key, gl.getShaderInfoLog(fs));
    }
    this.programs.set(key, prog);
    return prog;
  },
  base(k) { return this.compile('base:' + k, this.src[k]); },
  fxProg(id) {
    const d = FX[id];
    return this.compile('fx:' + id, d.params.map(q => `uniform float p_${q.k};`).join('') + '\n' + d.glsl + '\nvoid main(){outColor=fx(vUv);}');
  },
  genProg(id) { return this.compile('gen:' + id, 'uniform float low,mid,high,a,b;\n' + GENS[id].glsl + '\nvoid main(){outColor=gen(vUv);}'); },

  acquire() {
    if (this.free.length) return this.free.pop();
    const gl = this.gl, tex = gl.createTexture(), fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.texParams();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const rt = { tex, fb };
    this.all.push(rt);
    return rt;
  },
  release(rt) { if (rt) this.free.push(rt); },
  // Kanalen die niet meer op een deck staan geven hun buffer terug.
  pruneChannels() {
    const live = new Set(DECKS.flatMap(k => P.decks[k].channels.map(c => c.id)));
    for (const [id, rt] of this.chRT) if (!live.has(id)) { this.release(rt); this.chRT.delete(id); }
  },
  texParams() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  },

  bindTex(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); },
  pass(prog, target, tex0, tex1, uniforms = {}) {
    const gl = this.gl;
    if (!prog) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    if (target) gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(prog.pr);
    const u = prog.u;
    if (tex0) { this.bindTex(0, tex0); if (u.t) gl.uniform1i(u.t, 0); }
    if (tex1) { this.bindTex(1, tex1); if (u.t2) gl.uniform1i(u.t2, 1); if (u.prev) gl.uniform1i(u.prev, 1); }
    if (u.res) gl.uniform2f(u.res, this.W, this.H);
    if (u.time) gl.uniform1f(u.time, this.time);
    if (u.frame) gl.uniform1f(u.frame, this.frame);
    for (const k in uniforms) {
      if (!u[k]) continue;
      const v = uniforms[k];
      if (Array.isArray(v)) gl.uniform2f(u[k], v[0], v[1]);
      else if (k === 'mode') gl.uniform1i(u[k], v);
      else gl.uniform1f(u[k], v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  },

  upload(e) {
    const gl = this.gl, el = e.el;
    const fresh = e.kind === 'image' ? !e.uploaded : (el.readyState >= 2 && el.currentTime !== e.lastT);
    if (!fresh && e.tex) return;
    if (!e.tex) {
      e.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      this.texParams();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    if (!fresh) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      e.uploaded = true;
      if (e.kind === 'video') e.lastT = el.currentTime;
    } catch (err) {
      Media.fail(e, 'Deze bron geeft geen toegang tot de pixels. Start de app via start.bat.');
    }
  },

  // Verwerk een effectketen: geeft het eindresultaat terug en geeft de invoer vrij.
  chain(list, input) {
    let cur = input;
    for (const fx of list) {
      if (!fx.on || !FX[fx.type]) continue;
      const d = FX[fx.type], prog = this.fxProg(d.id);
      if (!prog) continue;
      const u = {};
      for (const q of d.params) u['p_' + q.k] = Mod.q(fx.p[q.k], q);
      let h = null;
      if (d.prev) {
        h = this.hist.get(fx.id);
        if (!h) { h = { rt: this.acquire(), seen: 0 }; this.pass(this.base('copy'), h.rt, cur.tex, null, { gain: 1 }); this.hist.set(fx.id, h); }
        h.seen = this.frame;
      }
      const next = this.acquire();
      this.passFx(prog, next, cur.tex, h && h.rt.tex, u);
      this.release(cur);
      cur = next;
      if (h) this.copyRT(cur, h.rt);
    }
    return cur;
  },
  passFx(prog, target, tex, prevTex, u) {
    const gl = this.gl;
    // Effecten gebruiken alleen float-uniformen; 'mode' is hier ook een float.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(prog.pr);
    const L = prog.u;
    this.bindTex(0, tex); if (L.t) gl.uniform1i(L.t, 0);
    this.bindTex(1, prevTex || tex); if (L.prev) gl.uniform1i(L.prev, 1);
    if (L.res) gl.uniform2f(L.res, this.W, this.H);
    if (L.time) gl.uniform1f(L.time, this.time);
    if (L.frame) gl.uniform1f(L.frame, this.frame);
    for (const k in u) if (L[k]) gl.uniform1f(L[k], u[k]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },
  copyRT(a, b) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, a.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, b.fb);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  },

  renderSource(clip, dt) {
    const out = this.acquire();
    const e = Media.entries.get(clip.url);
    const speed = Mod.q(clip.speed, Q.speed);
    if (e.kind === 'gen') {
      clip._time = (clip._time ?? Math.random() * 100) + dt * speed;
      const prog = this.genProg(clip.url.slice(4));
      this.passGen(prog, out, clip);
      return out;
    }
    if (e.kind === 'video' && !e.url.startsWith('live:')) {
      const rate = Math.max(.1, Math.min(4, speed));
      if (Math.abs(e.el.playbackRate - rate) > .02) e.el.playbackRate = rate;
    }
    this.upload(e);
    const sa = (e.w || 16) / (e.h || 9), ra = this.W / this.H;
    const wide = sa > ra;
    const scale = clip.fit === 'contain' ? (wide ? [1, sa / ra] : [ra / sa, 1]) : (wide ? [ra / sa, 1] : [1, sa / ra]);
    this.pass(this.base('fit'), out, e.tex, null, { scale });
    return out;
  },
  passGen(prog, target, clip) {
    if (!prog) return;
    const gl = this.gl, L = prog.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(prog.pr);
    if (L.res) gl.uniform2f(L.res, this.W, this.H);
    if (L.time) gl.uniform1f(L.time, clip._time);
    if (L.low) gl.uniform1f(L.low, Mod.src.low);
    if (L.mid) gl.uniform1f(L.mid, Mod.src.mid);
    if (L.high) gl.uniform1f(L.high, Mod.src.high);
    if (L.a) gl.uniform1f(L.a, Mod.val(clip.a));
    if (L.b) gl.uniform1f(L.b, Mod.val(clip.b));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },

  renderChannel(ch, clip, dt) {
    let input = this.renderSource(clip, dt);
    input = this.chain(clip.fx, input);
    this.release(this.chRT.get(ch.id));
    this.chRT.set(ch.id, input);
  },

  meanLevel(rt) {
    const gl = this.gl, data = new Uint8Array(this.W * this.H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 160, n += 3) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / n;
  },

  startTransition(mode, dur) {
    if (mode === 'cut' || dur <= 0 || !this.lastOut) return;
    if (this.tr) this.release(this.tr.rt);
    this.tr = { rt: this.lastOut, mode: this.modeIndex(mode), dur, t: 0 };
    this.lastOut = null;
  },
  modeIndex(mode) { return Math.max(0, TRANSITIONS.findIndex(t => t[0] === mode)); },

  // Rendert één deck: kanalen → mix → master-effecten.
  renderDeck(scene, dt, active) {
    const gl = this.gl;
    const anySolo = scene.channels.some(c => c.solo);
    const visible = [];
    scene.channels.forEach((ch, i) => {
      const vis = ch.on && (!anySolo || ch.solo);
      if (vis) visible.push(ch);
      let clip = ch.clips[ch.cur];
      if (!clip) { this.release(this.chRT.get(ch.id)); this.chRT.delete(ch.id); return; }
      const e = Media.use(clip.url, this.frame);
      if (e.status === 'ready') ch._show = clip;
      else if (ch._show && ch.clips.includes(ch._show) && Media.entries.get(ch._show.url)?.status === 'ready') { clip = ch._show; Media.use(clip.url, this.frame); }
      else return;
      active.add(Media.entries.get(clip.url));
      if (vis || (this.frame + i) % 4 === 0) this.renderChannel(ch, clip, dt);
    });

    let acc = this.acquire();
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    for (const ch of visible) {
      const rt = this.chRT.get(ch.id);
      if (!rt) continue;
      const next = this.acquire();
      this.pass(this.base('blend'), next, acc.tex, rt.tex, { op: Mod.val(ch.op), mode: ch.blend });
      this.release(acc);
      acc = next;
    }
    acc = this.chain(scene.master.fx, acc);
    const gain = Mod.val(scene.master.op);
    if (gain < .999) {
      const next = this.acquire();
      this.pass(this.base('copy'), next, acc.tex, null, { gain });
      this.release(acc);
      acc = next;
    }
    // Genereren mag niet op een zwart beeld eindigen: dan nog een keer gooien.
    const g = scene._guard;
    if (g && --g.frames <= 0) {
      scene._guard = null;
      if (g.tries > 0 && this.meanLevel(acc) < 3) {
        Rnd.generate(scene, scene.busy);
        scene._guard.tries = g.tries - 1;
        Media.preload(P);
        UI.renderAll();
      }
    }
    return acc;
  },

  // Kopieert een buffer via een hoek van het canvas naar een 2D-preview.
  drawPreview(ctx, rt) {
    const gl = this.gl, tw = ctx.canvas.width, th = ctx.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, tw, th);
    this.pass(this.base('copy'), null, rt.tex, null, { gain: 1 });
    ctx.drawImage(this.canvas, 0, this.H - th, tw, th, 0, 0, tw, th);
  },

  render(dt) {
    const gl = this.gl;
    this.frame++;
    this.time += dt;
    for (let i = 0; i < 2 && this.compileQueue.length; i++) this.compileQueue.shift()();

    const x = Mod.val(P.xf);
    const mixing = x > .001 && x < .999;
    const onAir = x < .5 ? 'a' : 'b';
    const active = new Set();
    for (const key of DECKS) {
      const scene = P.decks[key];
      Mod.scene(dt, scene);
      scene._dt = (scene._dt || 0) + dt;
      // Het deck dat niet in beeld is mag op halve snelheid: dat is alleen preview.
      if (!mixing && key !== onAir && this.frame % 2 && this.deckOut[key]) continue;
      const out = this.renderDeck(scene, scene._dt, active);
      scene._dt = 0;
      this.release(this.deckOut[key]);
      this.deckOut[key] = out;
    }
    Media.sync(active, this.frame);
    Mod.scene(0, S());  // knoppen en meters tonen het deck dat je bewerkt

    const fadeMode = Fade.cur ? Fade.cur.mode : P.xfMode;
    let acc = this.acquire();
    this.pass(this.base('trans'), acc, this.deckOut.a.tex, this.deckOut.b.tex, { p: x, mode: this.modeIndex(fadeMode) });

    if (this.tr) {
      this.tr.t += dt;
      const p = Math.min(1, this.tr.t / this.tr.dur);
      const next = this.acquire();
      this.pass(this.base('trans'), next, this.tr.rt.tex, acc.tex, { p, mode: this.tr.mode });
      this.release(acc);
      acc = next;
      if (p >= 1) { this.release(this.tr.rt); this.tr = null; }
    }
    this.release(this.lastOut);
    this.lastOut = acc;

    // Previews om en om: het scheelt kopieerwerk en 30 beelden per seconde is genoeg.
    const pk = DECKS[this.frame % 2];
    if (this.previews[pk]) this.drawPreview(this.previews[pk], this.deckOut[pk]);
    const list = S().channels;
    if (list.length) {
      const ch = list[this.thumbI++ % list.length];
      const ctx = this.thumbs.get(ch.id), rt = this.chRT.get(ch.id);
      if (ctx && rt && ctx.canvas.isConnected) this.drawPreview(ctx, rt);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    this.pass(this.base('copy'), null, acc.tex, null, { gain: this.blackout ? 0 : 1 });

    if (this.frame % 60 === 0) this.pruneChannels();
    if (this.frame % 240 === 0) {
      for (const [id, h] of this.hist) if (this.frame - h.seen > 240) { this.release(h.rt); this.hist.delete(id); }
    }
  },
};
