// Alle effecten en generatoren. Elk effect is een fragment shader met eigen parameters.
// Parameter: [sleutel, label, min, max, standaard, {step, opts, rnd:[laag,hoog]}]
// In GLSL heet een parameter p_<sleutel>.

const GLSL_LIB = `
#define TAU 6.28318530718
float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(rand(i),rand(i+vec2(1,0)),f.x),mix(rand(i+vec2(0,1)),rand(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+vec2(17.,9.);a*=.5;}return v;}
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);float e=1e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x);}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.,2./3.,1./3.,3.);vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec2 mirrorUV(vec2 p){return 1.-abs(mod(p,2.)-1.);}
mat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
`;

const FX_CATS = { kleur: 'Kleur', glitch: 'Glitch', vorm: 'Spiegel & vorm', stijl: 'Stijl', tijd: 'Feedback & tijd' };
const FX = {};

function defFx(id, name, cat, params, glsl, extra = {}) {
  FX[id] = {
    id, name, cat, glsl, ...extra,
    params: params.map(([k, label, min, max, def, o = {}]) => {
      if (o.opts) { min = 0; max = o.opts.length - 1; o.step = 1; }
      return { k, label, min, max, def, ...o };
    }),
  };
}

// ── Kleur ────────────────────────────────────────────────────────────────
defFx('hsv', 'Hue / verzadiging', 'kleur',
  [['hue', 'Hue', 0, 1, 0], ['sat', 'Verzad.', 0, 3, 1, { rnd: [.4, 2.4] }], ['val', 'Helder', 0, 2, 1, { rnd: [.8, 1.4] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec3 h=rgb2hsv(c.rgb);h.x=fract(h.x+p_hue);h.y=clamp(h.y*p_sat,0.,1.);h.z*=p_val;c.rgb=hsv2rgb(h);return c;}`);

defFx('adjust', 'Licht / contrast', 'kleur',
  [['bri', 'Helder', -.5, .5, 0, { rnd: [-.1, .2] }], ['con', 'Contrast', 0, 3, 1, { rnd: [.8, 2] }], ['gam', 'Gamma', .3, 3, 1, { rnd: [.6, 1.5] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb=pow(clamp((c.rgb-.5)*p_con+.5+p_bri,0.,1.),vec3(p_gam));return c;}`);

defFx('invert', 'Inverteren', 'kleur', [['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb=mix(c.rgb,1.-c.rgb,p_amt);return c;}`);

defFx('posterize', 'Posterize', 'kleur', [['lev', 'Niveaus', 2, 16, 4, { step: 1 }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb=floor(c.rgb*p_lev+.5)/p_lev;return c;}`);

defFx('duotone', 'Duotone', 'kleur',
  [['a', 'Kleur A', 0, 1, .7], ['b', 'Kleur B', 0, 1, .1], ['amt', 'Mate', 0, 1, 1, { rnd: [.6, 1] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);float l=luma(c.rgb);vec3 d=mix(hsv2rgb(vec3(p_a,.9,.25)),hsv2rgb(vec3(p_b,.75,1.)),l);c.rgb=mix(c.rgb,d,p_amt);return c;}`);

defFx('huekill', 'Kleurbereik uit', 'kleur',
  [['hue', 'Kleur', 0, 1, 0], ['width', 'Breedte', 0, .5, .12], ['soft', 'Zacht', 0, .3, .05],
   ['mode', 'Wordt', 0, 2, 0, { opts: ['grijs', 'zwart', 'doorzichtig'] }],
   ['inv', 'Bereik', 0, 1, 0, { opts: ['dit uit', 'alleen dit'] }], ['amt', 'Mate', 0, 1, 1, { rnd: [.7, 1] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec3 h=rgb2hsv(c.rgb);float d=abs(fract(h.x-p_hue+.5)-.5);
   float m=(1.-smoothstep(p_width,p_width+p_soft+.001,d))*smoothstep(.04,.18,h.y);
   if(p_inv>.5)m=1.-m;m*=p_amt;
   if(p_mode<.5)c.rgb=mix(c.rgb,vec3(luma(c.rgb)),m);else if(p_mode<1.5)c.rgb*=1.-m;else c.a*=1.-m;return c;}`);

defFx('lumakey', 'Licht/donker uit', 'kleur',
  [['low', 'Onder', 0, 1, .15, { rnd: [0, .5] }], ['high', 'Boven', 0, 1, 1, { rnd: [.6, 1] }], ['soft', 'Zacht', 0, .5, .08], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);float l=luma(c.rgb),s=p_soft+.001;float m=smoothstep(p_low-s,p_low,l)*(1.-smoothstep(p_high,p_high+s,l));c.a*=mix(1.,m,p_amt);return c;}`,
  { wild: true });

defFx('rgbgain', 'RGB-kanalen', 'kleur',
  [['r', 'Rood', 0, 2, 1], ['g', 'Groen', 0, 2, 1], ['b', 'Blauw', 0, 2, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb*=vec3(p_r,p_g,p_b);return c;}`);

defFx('swap', 'Kanalen wisselen', 'kleur',
  [['mode', 'Volgorde', 0, 4, 1, { opts: ['GBR', 'BRG', 'BGR', 'RBG', 'GRB'] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);if(p_mode<.5)c.rgb=c.gbr;else if(p_mode<1.5)c.rgb=c.brg;else if(p_mode<2.5)c.rgb=c.bgr;else if(p_mode<3.5)c.rgb=c.rbg;else c.rgb=c.grb;return c;}`);

defFx('solarize', 'Solarize', 'kleur', [['th', 'Drempel', 0, 1, .5]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb=mix(c.rgb,1.-c.rgb,step(p_th,c.rgb));return c;}`);

defFx('palette', 'Psychedelisch palet', 'kleur',
  [['freq', 'Banden', .2, 6, 1.5], ['off', 'Fase', 0, 1, 0], ['speed', 'Snelheid', 0, 2, .15, { rnd: [0, .8] }], ['amt', 'Mate', 0, 1, 1, { rnd: [.4, 1] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);float l=luma(c.rgb);vec3 q=.5+.5*cos(TAU*(l*p_freq+p_off+time*p_speed+vec3(0.,.33,.67)));c.rgb=mix(c.rgb,q,p_amt);return c;}`);

defFx('threshold', 'Zwart-wit drempel', 'kleur',
  [['th', 'Drempel', 0, 1, .5, { rnd: [.25, .75] }], ['hue', 'Kleur', 0, 1, 0], ['sat', 'Verzad.', 0, 1, 0], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec3 q=step(p_th,luma(c.rgb))*hsv2rgb(vec3(p_hue,p_sat,1.));c.rgb=mix(c.rgb,q,p_amt);return c;}`);

defFx('xor', 'Bit-crush XOR', 'kleur',
  [['mask', 'Masker', 0, 1, .4], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);ivec3 i=ivec3(c.rgb*255.);int m=int(p_mask*255.);i=i^ivec3(m,m>>1,m>>2);c.rgb=mix(c.rgb,vec3(i&255)/255.,p_amt);return c;}`);

// ── Glitch ───────────────────────────────────────────────────────────────
defFx('rgbsplit', 'RGB-splitsing', 'glitch',
  [['amt', 'Afstand', 0, 1, .15, { rnd: [.02, .4] }], ['ang', 'Hoek', 0, 1, 0]],
  `vec4 fx(vec2 uv){vec2 d=p_amt*.1*vec2(cos(p_ang*TAU),sin(p_ang*TAU));vec4 c=texture(t,uv);return vec4(texture(t,uv+d).r,c.g,texture(t,uv-d).b,c.a);}`);

defFx('blocks', 'Blokglitch', 'glitch',
  [['amt', 'Mate', 0, 1, .2, { rnd: [.05, .5] }], ['size', 'Raster', 3, 60, 16, { step: 1 }], ['speed', 'Tempo', 0, 30, 8]],
  `vec4 fx(vec2 uv){float k=floor(time*p_speed);vec2 g=floor(uv*p_size);float r=rand(g+k);vec2 q=uv;
   if(r<p_amt)q+=vec2(rand(g+k+1.)-.5,rand(g+k+2.)-.5)*.3;vec4 c=texture(t,mirrorUV(q));if(r<p_amt*.3)c.rgb=c.gbr;return c;}`);

defFx('slices', 'Lijnverschuiving', 'glitch',
  [['amt', 'Afstand', 0, 1, .25, { rnd: [.05, .6] }], ['prob', 'Kans', 0, 1, .3], ['count', 'Lijnen', 2, 120, 30, { step: 1 }], ['speed', 'Tempo', 0, 30, 10]],
  `vec4 fx(vec2 uv){float y=floor(uv.y*p_count),k=floor(time*p_speed);float d=rand(vec2(y,k))>1.-p_prob?(rand(vec2(y,k+3.))-.5)*p_amt:0.;return texture(t,vec2(fract(uv.x+d),uv.y));}`);

defFx('vhs', 'VHS', 'glitch',
  [['amt', 'Mate', 0, 1, .5], ['grain', 'Ruis', 0, 1, .3]],
  `vec4 fx(vec2 uv){float n=vnoise(vec2(uv.y*40.,time*9.));float tr=smoothstep(.96,1.,sin(uv.y*3.+time*2.));float d=(n-.5)*.02*p_amt+tr*.1*p_amt;vec2 a=vec2(fract(uv.x+d),uv.y);
   float s=.006*p_amt;vec4 c=vec4(texture(t,a+vec2(s,0.)).r,texture(t,a).g,texture(t,a-vec2(s,0.)).b,texture(t,a).a);
   c.rgb+=(rand(uv*fract(time)*90.)-.5)*.35*p_grain;c.rgb*=.93+.07*sin(uv.y*res.y*1.5);return c;}`);

defFx('scan', 'Scanlines', 'glitch',
  [['count', 'Lijnen', 10, 400, 120, { step: 1 }], ['amt', 'Mate', 0, 1, .4], ['speed', 'Rollen', -20, 20, 2]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb*=1.-p_amt*(.5+.5*sin(uv.y*p_count*TAU+time*p_speed));return c;}`);

defFx('pixel', 'Pixelate', 'glitch', [['size', 'Grootte', 1, 80, 12, { rnd: [3, 40] }]],
  `vec4 fx(vec2 uv){vec2 n=res/max(1.,p_size);return texture(t,(floor(uv*n)+.5)/n);}`);

defFx('datamosh', 'Datamosh', 'glitch',
  [['amt', 'Mate', 0, 1, .7, { rnd: [.4, 1] }], ['size', 'Raster', 8, 160, 48, { step: 1 }], ['th', 'Gevoelig', 0, .6, .15], ['flow', 'Stroom', 0, 1, .3]],
  `vec4 fx(vec2 uv){vec2 g=(floor(uv*p_size)+.5)/p_size;vec4 c=texture(t,uv);float d=length(texture(t,g).rgb-texture(prev,g).rgb);
   vec2 f=vec2(rand(g+1.)-.5,rand(g+2.)-.5)*.03*p_flow;float k=(1.-smoothstep(p_th,p_th+.1,d))*p_amt;if(rand(g+floor(time*5.))<.03)k=0.;return mix(c,texture(prev,uv+f),k);}`,
  { prev: true });

defFx('stutter', 'Stotter', 'glitch',
  [['hold', 'Vasthouden', 1, 30, 6, { step: 1 }], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);return mix(c,texture(prev,uv),mod(frame,max(1.,p_hold))>=1.?p_amt:0.);}`,
  { prev: true });

defFx('grain', 'Filmkorrel', 'glitch', [['amt', 'Mate', 0, 1, .2]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb+=(rand(uv*90.+fract(time))-.5)*p_amt;return c;}`);

// ── Spiegel & vorm ───────────────────────────────────────────────────────
defFx('mirror', 'Spiegel', 'vorm',
  [['mode', 'Richting', 0, 4, 0, { opts: ['links>rechts', 'rechts>links', 'onder>boven', 'boven>onder', 'kwadrant'] }], ['pos', 'As', 0, 1, .5, { rnd: [.3, .7] }]],
  `vec4 fx(vec2 uv){vec2 q=uv;float c=p_pos;if(p_mode<.5||p_mode>3.5)q.x=c-abs(q.x-c);else if(p_mode<1.5)q.x=c+abs(q.x-c);
   if(p_mode>3.5||(p_mode>1.5&&p_mode<2.5))q.y=c-abs(q.y-c);else if(p_mode>2.5&&p_mode<3.5)q.y=c+abs(q.y-c);return texture(t,mirrorUV(q));}`);

defFx('kaleido', 'Caleidoscoop', 'vorm',
  [['seg', 'Delen', 2, 16, 6, { step: 1 }], ['rot', 'Draai', 0, 1, 0], ['zoom', 'Zoom', .3, 3, 1, { rnd: [.6, 2] }], ['off', 'Bron', -.5, .5, 0]],
  `vec4 fx(vec2 uv){vec2 ar=vec2(res.x/res.y,1.);vec2 q=(uv-.5)*ar;float r=length(q)*p_zoom,a=atan(q.y,q.x)+p_rot*TAU,s=TAU/floor(p_seg);a=mod(a,s);a=abs(a-s*.5);q=r*vec2(cos(a),sin(a))/ar;return texture(t,mirrorUV(q+.5+vec2(p_off,0.)));}`);

defFx('transform', 'Zoom / draai', 'vorm',
  [['zoom', 'Zoom', .2, 5, 1, { rnd: [.7, 2] }], ['rot', 'Draai', -.5, .5, 0], ['x', 'X', -1, 1, 0, { rnd: [-.2, .2] }], ['y', 'Y', -1, 1, 0, { rnd: [-.2, .2] }]],
  `vec4 fx(vec2 uv){vec2 ar=vec2(res.x/res.y,1.);vec2 q=(uv-.5)*ar;q=rot2(p_rot*TAU)*q/p_zoom;return texture(t,mirrorUV(q/ar+.5+vec2(p_x,p_y)));}`);

defFx('tile', 'Tegels', 'vorm', [['n', 'Aantal', 1, 12, 3, { step: 1, rnd: [2, 6] }], ['mir', 'Modus', 0, 1, 1, { opts: ['herhalen', 'spiegelen'] }]],
  `vec4 fx(vec2 uv){vec2 q=uv*floor(p_n);return texture(t,p_mir>.5?mirrorUV(q):fract(q));}`);

defFx('wave', 'Golf', 'vorm',
  [['amt', 'Hoogte', 0, .3, .03, { rnd: [.005, .1] }], ['freq', 'Dichtheid', 1, 60, 12], ['speed', 'Tempo', -10, 10, 2]],
  `vec4 fx(vec2 uv){vec2 q=uv+vec2(sin(uv.y*p_freq+time*p_speed),cos(uv.x*p_freq*.7+time*p_speed*.8))*p_amt;return texture(t,mirrorUV(q));}`);

defFx('swirl', 'Draaikolk', 'vorm', [['amt', 'Draai', -8, 8, 2.5], ['rad', 'Straal', .1, 1, .6]],
  `vec4 fx(vec2 uv){vec2 ar=vec2(res.x/res.y,1.);vec2 q=(uv-.5)*ar;float d=length(q),k=clamp(1.-d/p_rad,0.,1.);q=rot2(k*k*p_amt)*q;return texture(t,q/ar+.5);}`);

defFx('bulge', 'Visoog', 'vorm', [['amt', 'Bol', -1, 2, .6, { rnd: [-.6, 1.5] }]],
  `vec4 fx(vec2 uv){vec2 q=uv*2.-1.;float r=length(q);q*=mix(1.,pow(r,max(.05,p_amt+1.))/max(r,.001),.9);return texture(t,mirrorUV(q*.5+.5));}`);

defFx('polar', 'Polair', 'vorm', [['amt', 'Mate', 0, 1, 1, { rnd: [.3, 1] }]],
  `vec4 fx(vec2 uv){vec2 q=uv-.5;vec2 p=vec2(atan(q.y,q.x)/TAU+.5,length(q)*2.);return texture(t,mirrorUV(mix(uv,p,p_amt)));}`);

defFx('liquid', 'Vloeibaar', 'vorm',
  [['amt', 'Mate', 0, .5, .08, { rnd: [.02, .25] }], ['scale', 'Schaal', .5, 12, 4], ['speed', 'Tempo', 0, 3, .4]],
  `vec4 fx(vec2 uv){vec2 p=uv*p_scale;float T=time*p_speed;vec2 d=vec2(fbm(p+T),fbm(p+vec2(5.2,1.3)-T))-.5;return texture(t,mirrorUV(uv+d*p_amt));}`);

defFx('zoomblur', 'Zoomvervaging', 'vorm', [['amt', 'Mate', 0, 1, .25, { rnd: [.05, .6] }]],
  `vec4 fx(vec2 uv){vec4 s=vec4(0.);for(int i=0;i<14;i++){float k=1.-p_amt*.4*float(i)/13.;s+=texture(t,(uv-.5)*k+.5);}return s/14.;}`);

defFx('mask', 'Vormmasker', 'vorm',
  [['shape', 'Vorm', 0, 3, 0, { opts: ['cirkel', 'ruit', 'ring', 'band'] }], ['size', 'Grootte', 0, 1.2, .5], ['soft', 'Zacht', 0, .5, .05]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec2 q=(uv-.5)*vec2(res.x/res.y,1.);float d;if(p_shape<.5)d=length(q);else if(p_shape<1.5)d=abs(q.x)+abs(q.y);else if(p_shape<2.5)d=abs(length(q)-p_size*.6)+p_size*.82;else d=abs(q.y);
   c.a*=1.-smoothstep(p_size-p_soft,p_size+.001,d);return c;}`,
  { wild: true });

// ── Stijl ────────────────────────────────────────────────────────────────
defFx('edges', 'Neonranden', 'stijl',
  [['gain', 'Sterkte', 0, 8, 3], ['tint', 'Bronkleur', 0, 1, 1], ['amt', 'Mate', 0, 1, 1, { rnd: [.5, 1] }]],
  `vec4 fx(vec2 uv){vec2 e=1.5/res;float a=luma(texture(t,uv+vec2(-e.x,e.y)).rgb),b=luma(texture(t,uv+vec2(0.,e.y)).rgb),c=luma(texture(t,uv+e).rgb),d=luma(texture(t,uv-vec2(e.x,0.)).rgb),f=luma(texture(t,uv+vec2(e.x,0.)).rgb),g=luma(texture(t,uv-e).rgb),h=luma(texture(t,uv-vec2(0.,e.y)).rgb),i=luma(texture(t,uv+vec2(e.x,-e.y)).rgb);
   float m=length(vec2(c+2.*f+i-a-2.*d-g,a+2.*b+c-g-2.*h-i))*p_gain;vec4 src=texture(t,uv);vec3 q=clamp(m,0.,1.)*mix(vec3(1.),normalize(src.rgb+.05)*1.6,p_tint);return vec4(mix(src.rgb,q,p_amt),src.a);}`);

defFx('halftone', 'Halftone', 'stijl',
  [['size', 'Raster', 3, 40, 10], ['ang', 'Hoek', 0, 1, .12], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec2 p=rot2(p_ang*TAU)*(uv*res)/p_size;vec2 cell=fract(p)-.5;vec2 ctr=(rot2(-p_ang*TAU)*((floor(p)+.5)*p_size))/res;vec4 c=texture(t,ctr);float r=sqrt(luma(c.rgb))*.72;float d=smoothstep(r+.06,r-.06,length(cell));vec4 s=texture(t,uv);return vec4(mix(s.rgb,c.rgb*d,p_amt),s.a);}`);

defFx('ascii', 'ASCII', 'stijl',
  [['size', 'Letter', 4, 28, 10, { step: 2 }], ['color', 'Kleur', 0, 1, 1], ['amt', 'Mate', 0, 1, 1]],
  `float ch(int n,vec2 p){p=floor(p*vec2(-4.,4.)+2.5);if(clamp(p.x,0.,4.)==p.x&&clamp(p.y,0.,4.)==p.y){int a=int(p.x+.5)+5*int(p.y+.5);if(((n>>a)&1)==1)return 1.;}return 0.;}
   vec4 fx(vec2 uv){vec2 s=vec2(p_size)/res;vec4 c=texture(t,(floor(uv/s)+.5)*s);float g=luma(c.rgb);int n=4096;if(g>.2)n=65600;if(g>.3)n=332772;if(g>.4)n=15255086;if(g>.5)n=23385164;if(g>.6)n=15252014;if(g>.7)n=13199452;if(g>.8)n=11512810;
   vec2 q=mod(uv/s,1.)*2.-1.;vec3 r=mix(vec3(g),c.rgb,p_color)*ch(n,q);return vec4(mix(texture(t,uv).rgb,r,p_amt),c.a);}`);

defFx('emboss', 'Reliëf', 'stijl', [['amt', 'Mate', 0, 1, 1], ['gain', 'Sterkte', .5, 6, 2]],
  `vec4 fx(vec2 uv){vec2 e=1.5/res;vec4 c=texture(t,uv);float d=luma(texture(t,uv-e).rgb)-luma(texture(t,uv+e).rgb);return vec4(mix(c.rgb,vec3(.5+d*p_gain),p_amt),c.a);}`);

defFx('blur', 'Vervagen', 'stijl', [['amt', 'Mate', 0, 1, .25, { rnd: [.05, .5] }]],
  `vec4 fx(vec2 uv){vec4 s=texture(t,uv);float n=1.;for(int r=1;r<=3;r++)for(int i=0;i<8;i++){float a=float(i)/8.*TAU+float(r);vec2 d=vec2(cos(a),sin(a))*float(r)/3.*p_amt*.06*vec2(res.y/res.x,1.);s+=texture(t,uv+d);n+=1.;}return s/n;}`);

defFx('glow', 'Gloed', 'stijl', [['th', 'Drempel', 0, 1, .55, { rnd: [.3, .8] }], ['amt', 'Sterkte', 0, 3, 1, { rnd: [.3, 1.8] }], ['rad', 'Straal', 0, 1, .4]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec3 s=vec3(0.);for(int r=1;r<=3;r++)for(int i=0;i<8;i++){float a=float(i)/8.*TAU+float(r)*.7;vec2 d=vec2(cos(a),sin(a))*float(r)/3.*p_rad*.08*vec2(res.y/res.x,1.);vec3 q=texture(t,uv+d).rgb;s+=q*smoothstep(p_th,p_th+.2,luma(q));}c.rgb+=s/24.*p_amt*2.;return c;}`);

defFx('vignette', 'Vignet', 'stijl', [['amt', 'Mate', 0, 1, .6], ['size', 'Grootte', .2, 1.2, .75]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);c.rgb*=1.-p_amt*smoothstep(p_size*.5,p_size,length(uv-.5)*1.3);return c;}`);

defFx('strobe', 'Stroboscoop', 'stijl',
  [['rate', 'Tempo', .5, 30, 8], ['amt', 'Mate', 0, 1, .6], ['color', 'Naar', 0, 1, 0, { opts: ['zwart', 'wit'] }]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);if(fract(time*p_rate)>.5)c.rgb=mix(c.rgb,vec3(p_color),p_amt);return c;}`,
  { wild: true });

// ── Feedback & tijd ──────────────────────────────────────────────────────
defFx('trails', 'Sporen', 'tijd', [['decay', 'Naloop', 0, .995, .9, { rnd: [.7, .98] }], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv),q=texture(prev,uv);return vec4(mix(c.rgb,max(c.rgb,q.rgb*p_decay),p_amt),max(c.a,q.a*p_decay));}`,
  { prev: true });

defFx('feedback', 'Feedbacktunnel', 'tijd',
  [['zoom', 'Zoom', .85, 1.15, 1.03, { rnd: [.96, 1.08] }], ['rot', 'Draai', -.2, .2, .02, { rnd: [-.06, .06] }], ['hue', 'Hue', 0, .2, .01],
   ['decay', 'Naloop', .5, 1, .95, { rnd: [.85, .98] }], ['th', 'Drempel', 0, 1, .15, { rnd: [.05, .4] }], ['amt', 'Mate', 0, 1, 1]],
  `vec4 fx(vec2 uv){vec4 c=texture(t,uv);vec2 ar=vec2(res.x/res.y,1.);vec2 q=rot2(p_rot)*((uv-.5)*ar)/p_zoom;vec3 f=texture(prev,q/ar+.5).rgb;vec3 h=rgb2hsv(f);h.x=fract(h.x+p_hue);f=hsv2rgb(h)*p_decay;
   float k=mix(1.,smoothstep(p_th,p_th+.2,luma(c.rgb)),p_amt);return vec4(mix(f,c.rgb,k),1.);}`,
  { prev: true });

// ── Generatoren (beeld zonder link) ──────────────────────────────────────
const GENS = {
  plasma: { name: 'Plasma', glsl: `vec4 gen(vec2 uv){vec2 p=(uv-.5)*vec2(res.x/res.y,1.)*(3.+a*9.);float v=sin(p.x+time)+sin(p.y*1.3+time*.7)+sin((p.x+p.y)*.7+time*1.3)+sin(length(p)*2.-time*1.5+low*3.);return vec4(.5+.5*cos(TAU*(v*.25+b+vec3(0.,.33,.67))),1.);}` },
  tunnel: { name: 'Tunnel', glsl: `vec4 gen(vec2 uv){vec2 p=(uv-.5)*vec2(res.x/res.y,1.);float r=length(p)+1e-3,an=atan(p.y,p.x)/TAU;vec2 q=vec2(an*(4.+floor(a*16.))+time*.2,.25/r+time*(1.+low*2.));float c=step(.5,fract(q.x))==step(.5,fract(q.y))?1.:.12;vec3 col=hsv2rgb(vec3(fract(b+q.y*.05),.8,1.));return vec4(col*c*smoothstep(0.,.25,r)*(.7+high),1.);}` },
  cells: { name: 'Cellen', glsl: `vec4 gen(vec2 uv){vec2 p=uv*vec2(res.x/res.y,1.)*(3.+a*14.);vec2 i=floor(p);float md=9.,id=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y);vec2 o=vec2(rand(i+g),rand(i+g+7.));o=.5+.5*sin(time+TAU*o);float d=length(g+o-fract(p));if(d<md){md=d;id=rand(i+g+3.);}}return vec4(hsv2rgb(vec3(fract(id+b+time*.03),.8,1.-md*(1.2-mid))),1.);}` },
  bars: { name: 'Spectrumbalken', glsl: `vec4 gen(vec2 uv){float n=floor(8.+a*56.);float i=floor(uv.x*n)/n;float k=i<.33?low:i<.66?mid:high;float h=.08+k*(.5+.5*vnoise(vec2(i*29.,time*3.)));float d=abs(uv.y-.5);float on=step(d,h*.5)*step(.08,fract(uv.x*n));return vec4(hsv2rgb(vec3(fract(b+i*.6),.85,on)),1.);}` },
  rings: { name: 'Ringen', glsl: `vec4 gen(vec2 uv){vec2 p=(uv-.5)*vec2(res.x/res.y,1.);float d=length(p);float v=sin(d*(14.+a*70.)-time*4.+low*7.);float g=smoothstep(.0,.9,v);return vec4(hsv2rgb(vec3(fract(b+d*.8+time*.03),.75,g*(.6+mid))),1.);}` },
  clouds: { name: 'Wolken', glsl: `vec4 gen(vec2 uv){vec2 p=uv*vec2(res.x/res.y,1.)*(1.5+a*5.);float f=fbm(p+vec2(time*.12,-time*.08)+fbm(p+time*.1));vec3 c=mix(hsv2rgb(vec3(b,.75,.12)),hsv2rgb(vec3(fract(b+.15),.55,1.)),smoothstep(.25,.85,f));return vec4(c,1.);}` },
  stripes: { name: 'Strepen', glsl: `vec4 gen(vec2 uv){vec2 p=rot2(a*TAU)*((uv-.5)*vec2(res.x/res.y,1.));float v=step(.5,fract(p.x*(5.+mid*14.)+time*.6+sin(p.y*5.+time)*.25));return vec4(hsv2rgb(vec3(fract(b+v*.45),.85,.25+v*.75)),1.);}` },
  stars: { name: 'Sterrenveld', glsl: `vec4 gen(vec2 uv){vec2 p=(uv-.5)*vec2(res.x/res.y,1.);vec3 c=vec3(0.);for(int l=0;l<5;l++){float z=fract(float(l)*.2+time*(.08+low*.25));float s=mix(26.,2.,z);vec2 q=p*s+float(l)*11.;vec2 i=floor(q);float r=rand(i);if(r>.72-a*.3){vec2 o=vec2(rand(i+1.),rand(i+2.))*.7+.15;float d=length(fract(q)-o);c+=hsv2rgb(vec3(fract(b+r),.45,1.))*smoothstep(.09,.0,d)*z*2.;}}return vec4(c,1.);}` },
};
