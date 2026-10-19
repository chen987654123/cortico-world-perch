/**
 * The companion's page: it walks along the top edge of whatever window it is standing on and
 * super-jumps to another window top, or down to the bottom of the desktop.
 *
 * Window tops come from the World every half second, in physical pixels; this page converts them
 * to CSS pixels with the window's device pixel ratio and runs the motion itself.
 */

const canvas = document.getElementById('stage');
const g = canvas.getContext('2d');

const GRAVITY = 2400;
const WALK_SPEED = 76;
const RUN_SPEED = 132;
const JUMP_HEAD = 96;
/** Horizontal speed during a super jump; a tall jump spends longer in the air, so it also crosses further. */
const JUMP_VX = 900;

let W = 0, H = 0, dpr = 1;
let platforms = [];
let origin = { x: 0, y: 0 };
/** Bottom of the usable desktop (the window also covers the taskbar strip). */
let floorY = 0;

const pet = {
  x: 0, y: 0, vx: 0, vy: 0,
  facing: 1, onGround: true, platformId: 'desktop',
  mode: 'idle', landAt: 0, jumpStart: 0,
  init: false,
};
let targetX = null;
let nextThink = 0;
let trail = [];
let sparks = [];

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function desktopPlatform() {
  return { id: 'desktop', kind: 'desktop', title: '', x0: 0, x1: W, y: floorY || H - 4 };
}

function currentPlatform() {
  return platforms.find((p) => p.id === pet.platformId) ?? null;
}

async function poll() {
  try {
    const res = await fetch('/api/platforms', { cache: 'no-store' });
    const data = await res.json();
    if (!data?.area) return;
    origin = { x: data.area.x, y: data.area.y };
    const scale = dpr || 1;
    floorY = Math.min(H - 4, (data.area.y + data.area.height - origin.y) / scale - 4);
    const list = [];
    for (const p of data.platforms ?? []) {
      const x0 = Math.max(0, (p.x0 - origin.x) / scale);
      const x1 = Math.min(W, (p.x1 - origin.x) / scale);
      const y = (p.y - origin.y) / scale;
      if (x1 - x0 < 60 || y < 30 || y > H - 10) continue;
      list.push({ id: `${p.title}|${Math.round(p.y)}|${Math.round(p.x0)}`, kind: 'window', title: p.title, x0, x1, y });
    }
    list.push(desktopPlatform());
    platforms = list;
    if (!pet.init) {
      const floor = desktopPlatform();
      pet.x = W / 2;
      pet.y = floor.y;
      pet.platformId = floor.id;
      pet.init = true;
      nextThink = performance.now() + 1500;
    }
    if (data.command === 'hop') requestHop(true);
  } catch {
    /* the World restarts with the app; the next poll recovers */
  }
}

/**
 * A ballistic arc that starts at the companion's feet and comes down on `target`.
 * The apex is put above the higher of the two ends, so a window near the top of the screen is
 * reachable from the bottom of the desktop.
 */
function planJump(target) {
  const rise = Math.max(0, pet.y - target.y);
  let head = Math.min(H * 1.25, rise + JUMP_HEAD + rand(0, 70));
  if (head <= rise + 12) head = rise + 12;
  const vy0 = -Math.sqrt(2 * GRAVITY * head);
  const drop = pet.y - target.y;
  const t = (-vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * GRAVITY * drop))) / GRAVITY;
  const mid = (target.x0 + target.x1) / 2;
  let tx = clamp(mid, target.x0 + 16, target.x1 - 16);
  let vx = (tx - pet.x) / t;
  if (Math.abs(vx) > JUMP_VX) {
    // too far for one arc: come down on the edge that is nearer
    tx = pet.x < mid ? target.x0 + 16 : target.x1 - 16;
    vx = (tx - pet.x) / t;
  }
  return { vy0, vx: clamp(vx, -JUMP_VX, JUMP_VX), tx, t };
}

function requestHop(forced = false) {
  if (!pet.init) return;
  const from = pet.platformId;
  const candidates = platforms.filter((p) => p.id !== from);
  if (!candidates.length) return;
  // prefer a window over the desktop, and a different height, but keep it reachable
  const ordered = candidates
    .map((p) => ({ p, score: Math.random() + (p.kind === 'window' ? 0.6 : 0) }))
    .sort((a, b) => b.score - a.score)
    .map((it) => it.p);
  let chosen = null, plan = null;
  for (const p of ordered) {
    const next = planJump(p);
    if (Math.abs(next.vx) < JUMP_VX * 0.99) { chosen = p; plan = next; break; }
  }
  if (!chosen) {
    chosen = ordered[0];
    plan = planJump(chosen);
  }
  pet.onGround = false;
  pet.mode = 'jump';
  pet.vy = plan.vy0;
  pet.vx = plan.vx;
  pet.facing = plan.vx >= 0 ? 1 : -1;
  pet.jumpStart = performance.now();
  pet.platformId = chosen.id;
  targetX = plan.tx;
  if (forced) burst(pet.x, pet.y, 10);
}

function burst(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
    sparks.push({ x, y, vx: Math.cos(a) * rand(60, 220), vy: Math.sin(a) * rand(60, 220), life: rand(0.25, 0.6), age: 0 });
  }
}

function land(platform) {
  pet.y = platform.y;
  pet.platformId = platform.id;
  pet.onGround = true;
  pet.vx = 0;
  pet.vy = 0;
  pet.mode = 'idle';
  pet.landAt = performance.now();
  burst(pet.x, pet.y, 6);
  nextThink = performance.now() + rand(900, 2600);
}

function think(now) {
  if (!pet.onGround) return;
  if (now < nextThink) return;
  const plat = currentPlatform() ?? desktopPlatform();
  const roll = Math.random();
  if (roll < 0.55) {
    pet.mode = 'walk';
    targetX = rand(plat.x0 + 28, Math.max(plat.x0 + 30, plat.x1 - 28));
    if (Math.abs(targetX - pet.x) < 40) targetX = plat.x1 - pet.x > pet.x - plat.x0 ? plat.x1 - 30 : plat.x0 + 30;
    nextThink = now + rand(1500, 4000);
  } else {
    requestHop(false);
  }
}

function step(dt) {
  if (!pet.init) return;
  const now = performance.now();

  if (pet.onGround) {
    const plat = currentPlatform();
    if (!plat) {
      pet.onGround = false;
      pet.vy = 0;
    } else {
      pet.y = plat.y;
      if (pet.mode === 'walk' && targetX !== null) {
        const dir = Math.sign(targetX - pet.x);
        pet.x += dir * WALK_SPEED * dt;
        pet.facing = dir || pet.facing;
        if (Math.abs(targetX - pet.x) < 2) { pet.mode = 'idle'; targetX = null; }
        if (pet.x < plat.x0 - 8 || pet.x > plat.x1 + 8) { pet.onGround = false; pet.vy = 40; pet.mode = 'fall'; }
      }
    }
  }

  if (!pet.onGround) {
    const prevY = pet.y;
    pet.vy += GRAVITY * dt;
    pet.x += pet.vx * dt;
    pet.y += pet.vy * dt;
    pet.x = clamp(pet.x, 6, W - 6);
    if (pet.vy > 0) {
      let best = null;
      for (const p of platforms) {
        if (pet.x < p.x0 - 2 || pet.x > p.x1 + 2) continue;
        if (prevY <= p.y + 1 && pet.y >= p.y && (!best || p.y < best.y)) best = p;
      }
      if (best) land(best);
    }
    if (pet.y > H + 80) {
      const floor = desktopPlatform();
      pet.x = W / 2;
      land(floor);
    }
  }

  think(now);
  updateEffects(dt);

  // trail while rising fast
  if (pet.mode === 'jump' && pet.vy < -260) {
    trail.push({ x: pet.x, y: pet.y - 20, age: 0 });
  }
  for (const t of trail) t.age += dt;
  trail = trail.filter((t) => t.age < 0.45);
  if (trail.length > 40) trail.splice(0, trail.length - 40);
}

function updateEffects(dt) {
  for (const s of sparks) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 900 * dt;
  }
  sparks = sparks.filter((s) => s.age < s.life);
}

function lightning(x0, y0, x1, y1, seed) {
  const segs = 7;
  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const jitter = (Math.sin(seed + i * 2.3) * 0.5 + Math.sin(seed * 1.7 + i * 5.1) * 0.5) * 9 * (1 - t * 0.3);
    g.lineTo(x0 + (x1 - x0) * t + jitter, y0 + (y1 - y0) * t + Math.cos(seed + i) * 4);
  }
  g.stroke();
}

function draw(now) {
  g.clearRect(0, 0, W, H);
  if (!pet.init) return;

  const plat = currentPlatform();
  const grounded = pet.onGround && plat;

  // shadow on the surface it stands on
  if (grounded) {
    g.save();
    g.globalAlpha = 0.16;
    g.fillStyle = '#0F172A';
    g.beginPath();
    g.ellipse(pet.x, pet.y + 1, 17, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // super-jump trail
  if (trail.length > 2) {
    g.save();
    g.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = 1 - trail[i].age / 0.45;
      g.globalAlpha = Math.max(0, a) * 0.75;
      g.strokeStyle = i % 2 ? '#FBBF24' : '#FDE68A';
      g.lineWidth = 2.4 * Math.max(0.2, a);
      lightning(trail[i - 1].x, trail[i - 1].y, trail[i].x, trail[i].y, i * 1.7);
    }
    g.restore();
  }

  for (const s of sparks) {
    const a = 1 - s.age / s.life;
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.fillStyle = '#FBBF24';
    g.beginPath();
    g.arc(s.x, s.y, 2.2 * a + 0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // squash & stretch
  const rising = !pet.onGround && pet.vy < 0;
  const falling = !pet.onGround && pet.vy >= 0;
  let sy = 1, sx = 1;
  if (rising) { sy = 1.16; sx = 0.88; }
  if (falling) { sy = clamp(1 + pet.vy / 6000, 1, 1.14); sx = 1 / sy; }
  const sinceLand = now - pet.landAt;
  if (pet.onGround && sinceLand < 170) {
    const k = 1 - sinceLand / 170;
    sy = 1 - 0.22 * k;
    sx = 1 + 0.22 * k;
  }

  const walkBob = pet.mode === 'walk' ? Math.sin(now / 90) * 1.6 : Math.sin(now / 620) * 0.7;
  const lean = pet.mode === 'jump' ? clamp(pet.vx / 900, -0.22, 0.22) : 0;

  g.save();
  g.translate(pet.x, pet.y + walkBob * 0.4);
  g.scale(pet.facing * sx, sy);
  g.rotate(lean);

  drawBody(now, walkBob);
  g.restore();
}

function drawBody(now, bob) {
  const bodyH = 34, bodyW = 30;

  // feet
  g.fillStyle = '#14614B';
  g.beginPath();
  g.ellipse(-8, -1, 6, 3.4, 0, 0, Math.PI * 2);
  g.ellipse(8, -1, 6, 3.4, 0, 0, Math.PI * 2);
  g.fill();

  // body
  g.fillStyle = '#1F8A70';
  g.strokeStyle = '#0E5B47';
  g.lineWidth = 1.4;
  g.beginPath();
  g.ellipse(0, -bodyH / 2 - 2, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // belly
  g.fillStyle = '#E9F7F1';
  g.beginPath();
  g.ellipse(1, -13, 9.5, 10.5, 0, 0, Math.PI * 2);
  g.fill();

  // ears
  g.fillStyle = '#1F8A70';
  g.strokeStyle = '#0E5B47';
  g.beginPath();
  g.ellipse(-9, -bodyH - 1, 4.2, 6, -0.35, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(9, -bodyH - 1, 4.2, 6, 0.35, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // eyes
  const blink = Math.sin(now / 3400) > 0.985;
  g.fillStyle = '#0B2B22';
  if (blink) {
    g.fillRect(2, -27, 5, 1.6);
    g.fillRect(11, -27, 5, 1.6);
  } else {
    g.beginPath();
    g.ellipse(4.6, -26, 2.7, 3.4, 0, 0, Math.PI * 2);
    g.ellipse(13.4, -26, 2.7, 3.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(5.6, -27.2, 1, 0, Math.PI * 2);
    g.arc(14.4, -27.2, 1, 0, Math.PI * 2);
    g.fill();
  }

  // lightning emblem on the belly
  g.fillStyle = '#F5B301';
  g.beginPath();
  g.moveTo(-1, -19);
  g.lineTo(-5.2, -12.4);
  g.lineTo(-1.6, -12.4);
  g.lineTo(-3.2, -6.6);
  g.lineTo(3.4, -14.6);
  g.lineTo(-0.6, -14.6);
  g.closePath();
  g.fill();

  // little scarf flowing while moving
  const swing = pet.onGround ? Math.sin((now / 160) + bob) * 2 : 5;
  g.strokeStyle = '#E4573D';
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-13, -20);
  g.quadraticCurveTo(-19, -19 + swing * 0.3, -24 - Math.abs(swing) * 0.4, -17 + swing);
  g.stroke();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

poll();
setInterval(poll, 500);

// report where it is, for `perch_status` and for checking the whole chain from outside
setInterval(() => {
  const plat = currentPlatform();
  fetch('/api/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x: Math.round(pet.x), y: Math.round(pet.y), onGround: pet.onGround, mode: pet.mode,
      platform: plat ? (plat.kind === 'window' ? plat.title : 'desktop') : null,
      platforms: platforms.length, dpr, size: [Math.round(W), Math.round(H)],
    }),
  }).catch(() => {});
}, 700);
