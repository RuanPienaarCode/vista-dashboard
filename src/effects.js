'use strict';
/* Living backgrounds: canvas particle systems. Each system is a small object
   { resize(w,h), step(dt,w,h,t), draw(ctx,w,h,t) }; the controller owns the
   canvas, the frame loop, DPR, and pausing when the view is hidden. */

const TYPES = [
  { id: 'auto', name: 'Auto — stars at night, dust by day', icon: 'sparkles' },
  { id: 'stars', name: 'Stars', icon: 'star' },
  { id: 'leaves', name: 'Falling leaves', icon: 'leaf' },
  { id: 'snow', name: 'Snow', icon: 'snowflake' },
  { id: 'fireflies', name: 'Fireflies', icon: 'zap' },
  { id: 'rain', name: 'Rain', icon: 'cloud-rain' },
  { id: 'dust', name: 'Dust and light', icon: 'sun' },
  { id: 'constellation', name: 'Constellation', icon: 'git-fork' },
  { id: 'none', name: 'None', icon: 'ban' },
];

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

/* Base counts per 1440×900 of canvas at intensity 1. */
const BASE = { stars: 220, leaves: 36, snow: 160, fireflies: 46, rain: 220, dust: 42, constellation: 70, none: 0 };

function countFor(type, intensity, w, h, mobile) {
  const base = BASE[type] || 0;
  const area = Math.min(1.6, Math.max(0.35, (w * h) / (1440 * 900)));
  return Math.round(base * intensity * area * (mobile ? 0.6 : 1));
}

function stars(n) {
  let ps = [], shooter = null, nextShot = rand(3, 8);
  const spawn = (w, h) => ({ x: rand(0, w), y: rand(0, h * 0.85), r: rand(0.4, 1.7), ph: rand(0, TAU), sp: rand(0.4, 1.6), warm: Math.random() < 0.25 });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h)); },
    step(dt, w, h, t) {
      nextShot -= dt;
      if (!shooter && nextShot <= 0) {
        shooter = { x: rand(w * 0.2, w * 0.9), y: rand(0, h * 0.35), vx: -rand(500, 800), vy: rand(150, 300), life: rand(0.5, 0.9), age: 0 };
        nextShot = rand(4, 11);
      }
      if (shooter) { shooter.x += shooter.vx * dt; shooter.y += shooter.vy * dt; shooter.age += dt; if (shooter.age > shooter.life) shooter = null; }
    },
    draw(ctx, w, h, t) {
      for (const p of ps) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph));
        ctx.fillStyle = p.warm ? `rgba(255,236,200,${a})` : `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        if (p.r > 1.3) {
          ctx.fillStyle = `rgba(255,255,255,${a * 0.12})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.2, 0, TAU); ctx.fill();
        }
      }
      if (shooter) {
        const k = 1 - shooter.age / shooter.life;
        const len = 90;
        const nx = shooter.vx, ny = shooter.vy, m = Math.hypot(nx, ny) || 1;
        const g = ctx.createLinearGradient(shooter.x, shooter.y, shooter.x - nx / m * len, shooter.y - ny / m * len);
        g.addColorStop(0, `rgba(255,255,255,${0.9 * k})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(shooter.x, shooter.y); ctx.lineTo(shooter.x - nx / m * len, shooter.y - ny / m * len); ctx.stroke();
      }
    },
  };
}

/* Leaf colours. Each palette is a weighted set of families, so a fall reads
   as mostly one thing with a few others through it — not an even rainbow. */
const LEAF_PALETTES = [
  { id: 'autumn', name: 'Autumn — orange, red and brown' },
  { id: 'summer', name: 'Summer — shades of green' },
];
const LEAF_FAMILIES = {
  autumn: [
    { w: 5, hue: [20, 36], sat: [72, 92], lit: [44, 56] },  /* orange */
    { w: 3, hue: [0, 12], sat: [62, 82], lit: [36, 48] },   /* red */
    { w: 3, hue: [18, 30], sat: [32, 52], lit: [24, 34] },  /* brown */
    { w: 1, hue: [40, 48], sat: [70, 88], lit: [46, 56] },  /* a little gold */
  ],
  summer: [
    { w: 4, hue: [96, 122], sat: [42, 62], lit: [30, 42] },  /* leaf green */
    { w: 3, hue: [128, 150], sat: [34, 54], lit: [22, 32] }, /* deep green */
    { w: 2, hue: [72, 90], sat: [48, 66], lit: [40, 50] },   /* yellow-green */
    { w: 2, hue: [100, 130], sat: [14, 28], lit: [40, 52] }, /* sage */
  ],
};
const leafPalette = id => (LEAF_FAMILIES[id] ? id : 'autumn');

/* One leaf's colour, from a palette. `r` is injectable so the test can pin it. */
function leafColour(palette, r) {
  const rnd = r || Math.random;
  const fams = LEAF_FAMILIES[leafPalette(palette)];
  const total = fams.reduce((a, f) => a + f.w, 0);
  let pick = rnd() * total, fam = fams[fams.length - 1];
  for (const f of fams) { if (pick < f.w) { fam = f; break; } pick -= f.w; }
  const at = ([a, b]) => a + rnd() * (b - a);
  return { hue: at(fam.hue), sat: at(fam.sat), lit: at(fam.lit) };
}

/* Sun from above, on a leaf that tumbles.
   `face` is the tumble, -1..1: its sign says which side of the leaf is
   towards you, its size how square-on that side is.
   - the top of the leaf (screen-up) is lit, the bottom is in its own shade;
   - the underside, when it shows, is a shade darker than the top face;
   - a leaf turned edge-on catches less light than one lying flat to you.
   Shaded by proportion, never by a fixed step — a fixed step turns the deep
   greens and browns black. Lightness is rounded so the per-frame colour
   strings stay few. */
const UNDERSIDE = 0.68;
function leafShade(p, face) {
  const f = Math.max(-1, Math.min(1, Number(face) || 0));
  /* blend through the flip rather than snapping, so a leaf turning over
     darkens as it goes instead of flickering */
  const u = Math.max(0, Math.min(1, (f + 0.3) / 0.6));
  const side = UNDERSIDE + (1 - UNDERSIDE) * u * u * (3 - 2 * u);
  const tilt = 0.72 + 0.28 * Math.abs(f);
  const k = side * tilt;
  const at = (m, alpha) => `hsla(${p.hue},${p.sat}%,${Math.round(Math.max(5, Math.min(90, p.lit * k * m)))}%,${alpha.toFixed(2)})`;
  return { light: at(1.3, p.a), dark: at(0.55, p.a), vein: at(0.5, p.a * 0.8), k };
}

function leafPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
  ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
}

/* One leaf. p: { x, y, s, rot, a, hue, sat, lit }; face: the tumble, -1..1. */
function drawLeaf(ctx, p, face) {
  const s = p.s;
  const sx = Math.max(0.25, Math.abs(face));
  const { light, dark, vein } = leafShade(p, face);
  /* No drop shadow: an offset silhouette made the leaves look as if they
     hovered over a surface, and in open air there is nothing to cast on.
     The depth comes from the shading alone. */
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.scale(sx, 1);
  /* Lit from above: the gradient runs along SCREEN down, whatever way the
     leaf is turned — that direction, carried into the leaf's own rotated and
     squashed space. */
  let dx = Math.sin(p.rot) / sx, dy = Math.cos(p.rot);
  const m = Math.hypot(dx, dy) || 1;
  dx = (dx / m) * s; dy = (dy / m) * s;
  const g = ctx.createLinearGradient(-dx, -dy, dx, dy);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  leafPath(ctx, s);
  ctx.fill();
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(0.8, s * 0.05);
  ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 0.8); ctx.stroke();
  ctx.restore();
}

function leaves(n, opts) {
  const palette = leafPalette(opts && opts.leafPalette);
  let ps = [];
  const spawn = (w, h, top) => {
    const c = leafColour(palette);
    /* a little see-through: the photo should still show behind a leaf */
    const a = rand(0.6, 0.82);
    return {
      x: rand(-40, w + 40), y: top ? rand(-120, -20) : rand(-h, h), s: rand(10, 22), rot: rand(0, TAU), rv: rand(-1.6, 1.6),
      vy: rand(22, 55), swA: rand(20, 60), swF: rand(0.5, 1.3), ph: rand(0, TAU), a, flip: rand(0.6, 1.4),
      hue: Math.round(c.hue), sat: Math.round(c.sat), lit: c.lit,
    };
  };
  return {
    palette,
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h, false)); },
    step(dt, w, h, t) {
      for (const p of ps) {
        p.y += p.vy * dt;
        p.x += (Math.cos(t * p.swF + p.ph) * p.swA + 12) * dt;
        p.rot += p.rv * dt;
        if (p.y > h + 30 || p.x > w + 60) Object.assign(p, spawn(w, h, true));
      }
    },
    draw(ctx, w, h, t) {
      for (const p of ps) drawLeaf(ctx, p, Math.sin(t * p.flip + p.ph));
    },
  };
}

function snow(n) {
  let ps = [];
  const spawn = (w, h, top) => ({ x: rand(0, w), y: top ? rand(-30, -4) : rand(0, h), r: rand(0.8, 3), vy: rand(18, 60), swA: rand(8, 30), swF: rand(0.4, 1.2), ph: rand(0, TAU), a: rand(0.45, 0.9) });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h, false)); },
    step(dt, w, h, t) {
      for (const p of ps) {
        p.y += p.vy * dt * (0.6 + p.r / 3);
        p.x += Math.sin(t * p.swF + p.ph) * p.swA * dt;
        if (p.y > h + 6) Object.assign(p, spawn(w, h, true));
        if (p.x < -10) p.x = w + 8; else if (p.x > w + 10) p.x = -8;
      }
    },
    draw(ctx) {
      for (const p of ps) {
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    },
  };
}

function fireflies(n) {
  /* A firefly flies: it holds a heading that wanders, surges and pauses,
     bobs as it goes, and now and then darts off somewhere else. The glow
     pulses on its own clock, so a lit one is often mid-flight. */
  let ps = [];
  const spawn = (w, h) => ({
    x: rand(0, w), y: rand(h * 0.1, h), ang: rand(0, TAU), turn: rand(-1.5, 1.5),
    base: rand(28, 70), surgeF: rand(0.3, 0.9), surgePh: rand(0, TAU),
    bobA: rand(6, 16), bobF: rand(1.5, 3.5), bobPh: rand(0, TAU),
    dart: 0, dartAng: 0, nextDart: rand(2, 9),
    r: rand(1.8, 3.2), ph: rand(0, TAU), sp: rand(0.6, 1.8), hue: rand(48, 78),
  });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h)); },
    step(dt, w, h, t) {
      for (const p of ps) {
        /* heading: a random walk on the turn rate, so paths curve and loop */
        p.turn += rand(-6, 6) * dt;
        p.turn = Math.max(-2.5, Math.min(2.5, p.turn)) * 0.985;
        p.ang += p.turn * dt;
        /* speed: surges and near-pauses */
        let speed = p.base * (0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(t * p.surgeF + p.surgePh), 2));
        /* the odd dart */
        p.nextDart -= dt;
        if (p.dart <= 0 && p.nextDart <= 0) { p.dart = rand(0.25, 0.6); p.dartAng = p.ang + rand(-1.2, 1.2); p.nextDart = rand(3, 10); }
        if (p.dart > 0) { p.dart -= dt; p.ang += (p.dartAng - p.ang) * Math.min(1, dt * 8); speed += 140; }
        const bob = Math.cos(t * p.bobF + p.bobPh) * p.bobA;
        p.x += (Math.cos(p.ang) * speed) * dt;
        p.y += (Math.sin(p.ang) * speed * 0.7 + bob) * dt;
        /* stay in the scene: turn back gently near the edges, wrap if past them */
        if (p.x < 20) p.ang += (Math.cos(p.ang) < 0 ? 3 : 0) * dt; else if (p.x > w - 20) p.ang += (Math.cos(p.ang) > 0 ? 3 : 0) * dt;
        if (p.y < 20) p.ang += (Math.sin(p.ang) < 0 ? 3 : 0) * dt; else if (p.y > h - 20) p.ang += (Math.sin(p.ang) > 0 ? 3 : 0) * dt;
        if (p.x < -30) p.x = w + 20; else if (p.x > w + 30) p.x = -20;
        if (p.y < -30) p.y = h + 20; else if (p.y > h + 30) p.y = -20;
      }
    },
    draw(ctx, w, h, t) {
      for (const p of ps) {
        const a = Math.max(0, 0.15 + Math.sin(t * p.sp + p.ph));
        if (a < 0.05) continue;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        g.addColorStop(0, `hsla(${p.hue},100%,78%,${Math.min(1, a)})`);
        g.addColorStop(0.35, `hsla(${p.hue},100%,60%,${a * 0.35})`);
        g.addColorStop(1, `hsla(${p.hue},100%,60%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 6, 0, TAU); ctx.fill();
      }
    },
  };
}

function rain(n) {
  let ps = [];
  const spawn = (w, h, top) => ({ x: rand(-40, w + 40), y: top ? rand(-60, -10) : rand(-h, h), len: rand(10, 24), vy: rand(520, 820), vx: rand(-40, -10), a: rand(0.18, 0.45) });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h, false)); },
    step(dt, w, h) {
      for (const p of ps) { p.y += p.vy * dt; p.x += p.vx * dt; if (p.y > h + 30) Object.assign(p, spawn(w, h, true)); }
    },
    draw(ctx) {
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      for (const p of ps) {
        ctx.strokeStyle = `rgba(220,230,255,${p.a})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * 0.02, p.y - p.len); ctx.stroke();
      }
    },
  };
}

function dust(n) {
  let ps = [];
  const spawn = (w, h) => ({ x: rand(0, w), y: rand(0, h), r: rand(2, 26), vx: rand(-6, 6), vy: rand(-9, -2), a: rand(0.03, 0.14), ph: rand(0, TAU), sp: rand(0.2, 0.6), warm: Math.random() < 0.5 });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h)); },
    step(dt, w, h, t) {
      for (const p of ps) {
        p.x += (p.vx + Math.sin(t * p.sp + p.ph) * 4) * dt; p.y += p.vy * dt;
        if (p.y < -p.r * 2) { p.y = h + p.r; p.x = rand(0, w); }
        if (p.x < -p.r * 2) p.x = w + p.r; else if (p.x > w + p.r * 2) p.x = -p.r;
      }
    },
    draw(ctx, w, h, t) {
      for (const p of ps) {
        const a = p.a * (0.7 + 0.3 * Math.sin(t * p.sp + p.ph));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, p.warm ? `rgba(255,240,210,${a})` : `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    },
  };
}

function constellation(n) {
  let ps = [];
  const LINK = 130;
  const spawn = (w, h) => ({ x: rand(0, w), y: rand(0, h), vx: rand(-14, 14), vy: rand(-14, 14), r: rand(1, 2.2) });
  return {
    resize(w, h) { ps = []; for (let i = 0; i < n; i++) ps.push(spawn(w, h)); },
    step(dt, w, h) {
      for (const p of ps) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        p.x = Math.min(w, Math.max(0, p.x)); p.y = Math.min(h, Math.max(0, p.y));
      }
    },
    draw(ctx) {
      ctx.lineWidth = 0.8;
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const al = (1 - Math.sqrt(d2) / LINK) * 0.35;
          ctx.strokeStyle = `rgba(255,255,255,${al})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const p of ps) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
    },
  };
}

const FACTORIES = { stars, leaves, snow, fireflies, rain, dust, constellation };

function makeSystem(type, count, opts) {
  const f = FACTORIES[type];
  return f ? f(count, opts || {}) : null;
}

/* Resolve 'auto' to a concrete type for this hour. */
function resolveType(type, hour) {
  if (type !== 'auto') return type;
  return (hour < 6 || hour >= 19) ? 'stars' : 'dust';
}

/* The controller. opts: { type, intensity, reduced, mobile, hour, leafPalette } */
function startEffect(canvas, opts) {
  const ctx = canvas.getContext('2d');
  let type = resolveType(opts.type, opts.hour), intensity = opts.intensity, leafPal = leafPalette(opts.leafPalette);
  const reduced = !!opts.reduced, mobile = !!opts.mobile;
  let sys = null, raf = 0, last = 0, running = true, w = 0, h = 0;
  /* Two independent facts gate a frame: the page is in the foreground, and
     the canvas is on screen. Folding them into one flag lost the first on
     resume — see onVis. */
  let pageShown = true, onScreen = true;
  const isVisible = () => pageShown && onScreen;

  function build() {
    const n = countFor(type, intensity, w, h, mobile);
    sys = type === 'none' || !n ? null : makeSystem(type, n, { leafPalette: leafPal });
    if (sys) sys.resize(w, h);
    if (!sys) ctx.clearRect(0, 0, w, h);
  }
  function size() {
    const host = canvas.parentElement || canvas;
    const r = host.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    if (nw === w && nh === h && sys) return;
    w = nw; h = nh;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (reduced && sys) { sys.step(0.016, w, h, 0); ctx.clearRect(0, 0, w, h); sys.draw(ctx, w, h, 0); }
  }
  function frame(ts) {
    raf = 0;
    if (!running || !isVisible() || !sys) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    const t = ts / 1000;
    sys.step(dt, w, h, t);
    ctx.clearRect(0, 0, w, h);
    sys.draw(ctx, w, h, t);
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && running && isVisible() && sys && !reduced) { last = 0; raf = requestAnimationFrame(frame); } }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => { size(); kick(); }); ro.observe(canvas.parentElement || canvas); }
  else window.addEventListener('resize', size);
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(entries => { onScreen = entries.some(e => e.isIntersecting); if (onScreen) kick(); });
    io.observe(canvas);
  }
  /* Backgrounding a phone fires visibilitychange but no intersection change,
     so coming back must not wait for the observer: pageShown is tracked on its
     own and the observer's verdict (onScreen) is left untouched. */
  const onVis = () => { pageShown = !document.hidden; if (pageShown) kick(); };
  document.addEventListener('visibilitychange', onVis);

  size();
  kick();

  return {
    get type() { return type; },
    setType(t, hour) { type = resolveType(t, hour); build(); if (reduced && sys) { ctx.clearRect(0, 0, w, h); sys.draw(ctx, w, h, 0); } kick(); },
    setIntensity(i) { intensity = i; build(); kick(); },
    /* Only rebuilds when it would change something on screen. */
    setLeafPalette(pal) {
      const next = leafPalette(pal);
      if (next === leafPal) return;
      leafPal = next;
      if (type === 'leaves') { build(); if (reduced && sys) { ctx.clearRect(0, 0, w, h); sys.draw(ctx, w, h, 0); } kick(); }
    },
    pause() { running = false; },
    resume() { running = true; kick(); },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', size);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      ctx.clearRect(0, 0, w, h);
    },
  };
}

module.exports = { TYPES, BASE, LEAF_PALETTES, countFor, makeSystem, resolveType, startEffect, leafColour, leafPalette, leafShade, drawLeaf };
