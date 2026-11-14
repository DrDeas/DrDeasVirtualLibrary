// Everything in the building that is written: the challenge tracker and clock by the
// entrance, the Sontag quotation inlaid in the atrium floor, the Fanon quotation
// circling the wall beneath the dome, the King mural, year markers along the ramp and
// the inscription that waits at the top.

import * as THREE from 'three';
import { Geo, faceAxis } from './geo.js';
import { makeCanvas } from './textures.js';
import {
  CHALLENGE, R_OUT, R_IN, BAY, PER_BAY, LANDING, POOL_R, SLAB, TAU, rampY, polar,
} from './config.js';

export const SERIF = '"Cormorant Garamond", "Iowan Old Style", Georgia, serif';
const SANS = 'Lato, "Helvetica Neue", Arial, sans-serif';
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function challengeStats(books, now = new Date()) {
  const finished = books.filter((b) => b.finished).length;
  const totalWeeks = Math.ceil((CHALLENGE.end - CHALLENGE.start) / WEEK);
  const week = Math.min(totalWeeks, Math.max(0, Math.ceil((now - CHALLENGE.start) / WEEK)));
  return {
    finished,
    week,
    totalWeeks,
    bookShare: Math.min(1, finished / CHALLENGE.books),
    weekShare: week / totalWeeks,
    weeksLeft: totalWeeks - week,
    ahead: finished - week, // one book a week is the pace
  };
}

function canvasTexture(canvas, anisotropy = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// Spreads a line of text across exactly `width` pixels by adjusting letter spacing.
function justify(ctx, text, x, y, width) {
  const natural = ctx.measureText(text).width;
  const gap = (width - natural) / Math.max(1, text.length - 1);
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + gap;
  }
}

// ---- Challenge tracker and clock -------------------------------------------

function drawTracker(canvas, books, now) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, Hh = canvas.height;
  const s = challengeStats(books, now);
  const g = ctx.createLinearGradient(0, 0, 0, Hh);
  g.addColorStop(0, '#1d1510');
  g.addColorStop(1, '#120c08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, Hh);
  ctx.strokeStyle = '#c9a45c';
  ctx.lineWidth = 6;
  ctx.strokeRect(22, 22, W - 44, Hh - 44);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(38, 38, W - 76, Hh - 76);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#c9a45c';
  ctx.font = `700 30px ${SANS}`;
  justify(ctx, 'THE READING CHALLENGE', 250, 130, W - 500);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f6ecd9';
  ctx.font = `600 124px ${SERIF}`;
  ctx.fillText('1,000 Books', W / 2, 270);
  ctx.font = `italic 500 84px ${SERIF}`;
  ctx.fillText('in 1,000 Weeks', W / 2, 365);

  const bar = (y, label, value, share, colour) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9a45c';
    ctx.font = `700 32px ${SANS}`;
    ctx.fillText(label, 110, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f6ecd9';
    ctx.font = `600 54px ${SERIF}`;
    ctx.fillText(value, W - 110, y + 4);
    ctx.fillStyle = 'rgba(246,236,217,0.12)';
    ctx.fillRect(110, y + 30, W - 220, 30);
    ctx.fillStyle = colour;
    ctx.fillRect(110, y + 30, (W - 220) * share, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(246,236,217,0.6)';
    ctx.font = `400 32px ${SANS}`;
    ctx.fillText(`${(share * 100).toFixed(1)}%`, 110, y + 104);
  };
  bar(500, 'BOOKS FINISHED', `${s.finished.toLocaleString()} / 1,000`, s.bookShare, '#d9b25f');
  bar(700, 'WEEKS ELAPSED', `${s.week.toLocaleString()} / ${s.totalWeeks.toLocaleString()}`, s.weekShare, '#b56576');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f6ecd9';
  ctx.font = `italic 500 46px ${SERIF}`;
  const pace = s.ahead > 0 ? `${s.ahead} books ahead of pace`
    : s.ahead < 0 ? `${-s.ahead} books behind pace` : 'Exactly on pace';
  ctx.fillText(pace, W / 2, 925);
  ctx.fillStyle = 'rgba(246,236,217,0.65)';
  ctx.font = `400 33px ${SANS}`;
  ctx.fillText('September 27, 2020  —  November 26, 2039', W / 2, 990);
  ctx.fillText(`${s.weeksLeft.toLocaleString()} weeks (${(s.weeksLeft / 52.18).toFixed(1)} years) remaining`, W / 2, 1040);

  // Clock.
  ctx.strokeStyle = 'rgba(201,164,92,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(110, 1100);
  ctx.lineTo(W - 110, 1100);
  ctx.stroke();
  ctx.fillStyle = '#f6ecd9';
  ctx.font = `500 112px ${SERIF}`;
  ctx.fillText(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), W / 2, 1218);
  ctx.fillStyle = '#c9a45c';
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), W / 2, 1274);
}

// ---- Curved inscriptions ---------------------------------------------------

// Text laid round a circle on the floor, letters' feet toward the pool, so that it
// reads upright to someone looking at it across the water.
function floorInscription(text, size, radiusPx, fontPx, startAngle) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e2bd72';
  ctx.font = `600 ${fontPx}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const natural = widths.reduce((a, b) => a + b, 0);
  const scale = (TAU * radiusPx) / natural; // stretch spacing to close the circle
  let travelled = 0;
  [...text].forEach((ch, i) => {
    const phi = startAngle + ((travelled + widths[i] / 2) * scale) / radiusPx;
    travelled += widths[i];
    ctx.save();
    ctx.translate(size / 2 + radiusPx * Math.cos(phi), size / 2 + radiusPx * Math.sin(phi));
    ctx.rotate(phi + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  return c;
}

function bandInscription(text, w, h, fontPx) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${fontPx}px ${SERIF}`;
  ctx.textBaseline = 'middle';
  justify(ctx, text, fontPx * 0.5, h / 2 + fontPx * 0.04, w - fontPx);
  return c;
}

export function buildSignage(scene, layout, mats, books) {
  const group = new THREE.Group();
  scene.add(group);
  const L = layout;
  const H = (u) => rampY(u, L);
  const glowText = (map, strength = 1.5) => new THREE.MeshBasicMaterial({
    map, color: new THREE.Color(1.0, 0.76, 0.42).multiplyScalar(strength), transparent: true,
    depthWrite: false, side: THREE.DoubleSide,
  });

  // ---- Tracker, on the wall beside the entrance landing --------------------
  const trackerCanvas = makeCanvas(1024, 1336);
  drawTracker(trackerCanvas, books, new Date());
  const trackerTex = canvasTexture(trackerCanvas);
  const wallH = H(TAU - LANDING) - SLAB;
  const trackerH = Math.min(3.0, wallH - 0.5);
  const tracker = new THREE.Mesh(
    new THREE.PlaneGeometry((trackerH * 1024) / 1336, trackerH),
    new THREE.MeshBasicMaterial({ map: trackerTex })
  );
  polar((R_IN + R_OUT) / 2, -LANDING, wallH / 2 + 0.05, tracker.position);
  tracker.rotation.y = LANDING;
  tracker.translateZ(0.03);
  group.add(tracker);

  // ---- King mural, on the tower wall behind the landing --------------------
  const mu0 = -LANDING + 0.1, mu1 = -0.08;
  const muralW = (mu1 - mu0) * R_OUT;
  const muralH = muralW * (514 / 2048);
  const my0 = 1.2, my1 = my0 + muralH;
  const rm = R_OUT - 0.03;
  const backing = new Geo().ribbon(mu0 - 0.012, mu1 + 0.012, () => [rm, my0 - 0.12], () => [rm, my1 + 0.12]);
  group.add(backing.mesh(new THREE.MeshBasicMaterial({ color: 0xf1e9da, side: THREE.DoubleSide })));
  const frame = new Geo()
    .ribbon(mu0 - 0.018, mu1 + 0.018, () => [rm + 0.012, my0 - 0.17], () => [rm + 0.012, my1 + 0.17]);
  group.add(frame.mesh(mats.brass));
  const mural = new Geo().ribbon(mu0, mu1, () => [rm - 0.008, my0], () => [rm - 0.008, my1], { unit: true });
  const muralMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, opacity: 0 });
  group.add(mural.mesh(muralMat));
  new THREE.TextureLoader().load('assets/king-labor.webp', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    muralMat.map = tex;
    muralMat.opacity = 1;
    muralMat.needsUpdate = true;
  });

  // ---- Sontag, inlaid in the atrium floor ----------------------------------
  const ringOuter = POOL_R + 1.6;
  const SIZE = 2048;
  const pxPerM = SIZE / (ringOuter * 2);
  const sontag = '“Time exists in order that everything doesn’t happen all at once … and books exist so that it isn’t all forgotten.”  —  Susan Sontag   ✦   ';
  const floorCanvas = floorInscription(sontag, SIZE, (POOL_R + 1.02) * pxPerM, 0.4 * pxPerM, -LANDING / 2 + Math.PI - 1.1);
  const floorText = new THREE.Mesh(
    new THREE.RingGeometry(POOL_R + 0.5, ringOuter, 128, 1),
    new THREE.MeshBasicMaterial({ map: canvasTexture(floorCanvas, 16), transparent: true, depthWrite: false })
  );
  floorText.rotation.x = -Math.PI / 2;
  floorText.position.y = 0.004;
  group.add(floorText);

  // ---- Fanon, circling the wall beneath the dome ---------------------------
  const fanon = '“MY FINAL PRAYER:  O MY BODY, MAKE OF ME ALWAYS A MAN WHO QUESTIONS!”  —  FRANTZ FANON   ✦';
  const friezeTex = canvasTexture(bandInscription(fanon, 4096, 128, 76));
  friezeTex.wrapS = THREE.RepeatWrapping;
  friezeTex.repeat.x = 2;
  const frieze = new Geo().ribbon(0, TAU, () => [R_OUT - 0.02, L.wallTop - 1.43], () => [R_OUT - 0.02, L.wallTop - 0.4], { unit: true });
  group.add(frieze.mesh(glowText(friezeTex, 1.7)));

  // ---- Inscription at the top of the ramp ----------------------------------
  const summit = makeCanvas(2048, 512);
  const sctx = summit.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.textAlign = 'center';
  sctx.font = `600 190px ${SERIF}`;
  sctx.fillText('Book One Thousand', 1024, 230);
  sctx.font = `italic 500 78px ${SERIF}`;
  sctx.fillText('reserved for November 26, 2039', 1024, 380);
  const su0 = L.uTop + 0.27, su1 = L.uEnd - 0.27;
  const sh = ((su1 - su0) * R_OUT) / 4;
  const summitGeo = new Geo().ribbon(su0, su1, () => [R_OUT - 0.02, L.topY + 1.4], () => [R_OUT - 0.02, L.topY + 1.4 + sh], { unit: true });
  group.add(summitGeo.mesh(glowText(canvasTexture(summit), 1.5)));

  // ---- Year markers --------------------------------------------------------
  const years = new Map();
  for (const book of books) {
    if (book.year && !years.has(book.year)) years.set(book.year, book);
  }
  for (const [year, book] of years) {
    const c = makeCanvas(256, 128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#17100b';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#c9a45c';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#f0cf8a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 84px ${SERIF}`;
    ctx.fillText(String(year), 128, 68);
    const u = Math.floor(book.slot / PER_BAY) * BAY;
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.18), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
    polar(R_OUT - 0.345, u, H(u) + 1.62, plaque.position);
    faceAxis(plaque, u);
    group.add(plaque);
  }

  let minute = -1;
  return {
    group,
    years,
    update(now) {
      if (now.getMinutes() === minute) return;
      minute = now.getMinutes();
      drawTracker(trackerCanvas, books, now);
      trackerTex.needsUpdate = true;
    },
  };
}
