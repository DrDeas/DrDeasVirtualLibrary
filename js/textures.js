// Every surface texture is painted here at start-up, so the site ships no image files
// other than the book covers.

import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// `metres` is how much wall or floor one copy of the texture covers; geometry UVs are
// in metres throughout.
function finish(canvas, metres, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / metres, 1 / metres);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function speckle(ctx, rand, count, colours, maxSize, alpha) {
  const { width: w, height: h } = ctx.canvas;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[(rand() * colours.length) | 0];
    ctx.globalAlpha = alpha * rand();
    const s = 0.5 + rand() * maxSize;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

// Draws a wandering line that leaves one edge and re-enters on the opposite one, so
// the texture tiles without a seam.
function vein(ctx, rand, width, alpha, colour) {
  const { width: w, height: h } = ctx.canvas;
  let x = rand() * w;
  let y = rand() * h;
  let dir = rand() * Math.PI * 2;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const nx = x + Math.cos(dir) * 14;
    const ny = y + Math.sin(dir) * 14;
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.lineWidth = width * (0.4 + rand());
    // Repeat the stroke across an edge only when it actually crosses one.
    const xs = nx < 0 ? [0, w] : nx > w ? [0, -w] : [0];
    const ys = ny < 0 ? [0, h] : ny > h ? [0, -h] : [0];
    for (const ox of xs) {
      for (const oy of ys) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(nx + ox, ny + oy);
        ctx.stroke();
      }
    }
    x = ((nx % w) + w) % w;
    y = ((ny % h) + h) % h;
    dir += (rand() - 0.5) * 0.9;
  }
  ctx.globalAlpha = 1;
}

function walnut(renderer) {
  const c = makeCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const rand = rng(11);
  ctx.fillStyle = '#4a3423';
  ctx.fillRect(0, 0, 1024, 1024);
  // Vertical grain: thousands of thin streaks, light and dark.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 1024;
    const light = rand() > 0.5;
    ctx.fillStyle = light ? '#7d5c3a' : '#21140b';
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    ctx.fillRect(x, 0, 0.6 + rand() * 2.4, 1024);
  }
  // Broad tonal bands, as between boards cut from different planks.
  for (let x = 0; x < 1024; x += 128) {
    ctx.fillStyle = rand() > 0.5 ? '#000' : '#a67a45';
    ctx.globalAlpha = 0.05 + rand() * 0.07;
    ctx.fillRect(x, 0, 128, 1024);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#1a0d07';
    ctx.fillRect(x, 0, 1.5, 1024);
  }
  ctx.globalAlpha = 1;
  return finish(c, 2.4, renderer);
}

function travertine(renderer) {
  const c = makeCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const rand = rng(23);
  ctx.fillStyle = '#d8cfbd';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#efe4cf' : '#b9a482';
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    ctx.fillRect(0, rand() * 1024, 1024, 1 + rand() * 5);
  }
  ctx.globalAlpha = 1;
  speckle(ctx, rand, 5000, ['#8f7a5c', '#f6eedf', '#a8926f'], 2.2, 0.35);
  // Slab joints.
  ctx.strokeStyle = 'rgba(70,52,34,0.55)';
  ctx.lineWidth = 2;
  for (const p of [1, 513]) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 1024);
    ctx.moveTo(0, p);
    ctx.lineTo(1024, p);
    ctx.stroke();
  }
  return finish(c, 2.0, renderer);
}

function marble(renderer) {
  const c = makeCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const rand = rng(37);
  ctx.fillStyle = '#10201c';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#1c3a31' : '#070f0d';
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(rand() * 1024, rand() * 1024, 60 + rand() * 200, 30 + rand() * 90,
      rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Broad soft veins are drawn on a spare canvas and blurred in one pass.
  const soft = makeCanvas(1024, 1024);
  const sctx = soft.getContext('2d');
  for (let i = 0; i < 9; i++) vein(sctx, rand, 5, 0.16, '#9fc4b3');
  ctx.filter = 'blur(1.2px)';
  ctx.drawImage(soft, 0, 0);
  ctx.filter = 'none';
  for (let i = 0; i < 16; i++) vein(ctx, rand, 1.3, 0.5, '#d8e8df');
  speckle(ctx, rand, 2500, ['#c9a45c', '#dfeee6'], 1.6, 0.25);
  return finish(c, 3.2, renderer);
}

function plaster(renderer) {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const rand = rng(41);
  ctx.fillStyle = '#e9dfcd';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, rand, 9000, ['#f7f0e2', '#cbbea6'], 3, 0.18);
  return finish(c, 1.5, renderer);
}

function moss(renderer) {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const rand = rng(53);
  ctx.fillStyle = '#2f4a22';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, rand, 14000, ['#4f7a30', '#1c2f14', '#6b9440', '#3c5c28'], 4, 0.5);
  return finish(c, 1.2, renderer);
}

function rock(renderer) {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const rand = rng(67);
  ctx.fillStyle = '#56544f';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, rand, 12000, ['#77746d', '#35332f', '#8d897f'], 5, 0.4);
  for (let i = 0; i < 6; i++) vein(ctx, rand, 1.5, 0.35, '#26241f');
  return finish(c, 1.0, renderer);
}

// A soft round glow, used for lamp halos and motes.
export function glowTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A five-petalled blossom with a transparent surround.
export function blossomTexture() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    const g = ctx.createLinearGradient(0, 0, 0, -58);
    g.addColorStop(0, '#f7a8c4');
    g.addColorStop(0.5, '#ffe3ee');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-30, -22, -24, -58, 0, -50);
    ctx.bezierCurveTo(24, -58, 30, -22, 0, 0);
    ctx.fill();
  }
  ctx.fillStyle = '#d6577f';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function petalTexture() {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 60, 0, 4);
  g.addColorStop(0, '#f39fbd');
  g.addColorStop(1, '#fff3f7');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(32, 62);
  ctx.bezierCurveTo(0, 40, 6, 2, 32, 12);
  ctx.bezierCurveTo(58, 2, 64, 40, 32, 62);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildTextures(renderer) {
  return {
    walnut: walnut(renderer),
    travertine: travertine(renderer),
    marble: marble(renderer),
    plaster: plaster(renderer),
    moss: moss(renderer),
    rock: rock(renderer),
    glow: glowTexture(),
    blossom: blossomTexture(),
    petal: petalTexture(),
  };
}
