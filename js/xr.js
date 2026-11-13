// Headset support. The left stick walks (in the direction the visitor is facing), the
// right stick turns in steps and, pushed forward or back, follows the ramp. Pointing a
// controller at a cover and pulling the trigger opens a card for that book.

import * as THREE from 'three';
import { makeCanvas } from './textures.js';
import { formatDate } from './books.js';
import { SERIF } from './signage.js';

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines++;
      if (lines === maxLines) { ctx.fillText(`${line}…`, x, y); return y + lineHeight; }
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = words[i];
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y + lineHeight;
}

export function setupXR({ renderer, scene, camera, player, wall, garden, button }) {
  if (!navigator.xr) return null;
  renderer.xr.enabled = true;

  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { button.hidden = !ok; }).catch(() => {});
  button.addEventListener('click', async () => {
    const current = renderer.xr.getSession();
    if (current) { current.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      await renderer.xr.setSession(session);
    } catch (err) {
      console.error('Could not start VR', err);
    }
  });

  // ---- Book card ----------------------------------------------------------
  const cardCanvas = makeCanvas(1280, 800);
  const cardTex = new THREE.CanvasTexture(cardCanvas);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.7),
    new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, depthTest: false })
  );
  card.renderOrder = 20;
  card.visible = false;
  scene.add(card);
  let shown = null;

  function drawCard(book, img) {
    const ctx = cardCanvas.getContext('2d');
    ctx.clearRect(0, 0, 1280, 800);
    ctx.fillStyle = 'rgba(20,13,9,0.95)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 1280, 800, 36);
    ctx.fill();
    ctx.strokeStyle = '#c9a45c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(14, 14, 1252, 772, 26);
    ctx.stroke();
    if (img) ctx.drawImage(img, 60, 70, 438, 660);
    const x = 550, w = 670;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9a45c';
    ctx.font = '700 26px Lato, Arial, sans-serif';
    ctx.fillText(`NO. ${book.number}  ·  ${book.category.toUpperCase()}`, x, 110);
    ctx.fillStyle = '#f6ecd9';
    ctx.font = `600 58px ${SERIF}`;
    let y = wrapText(ctx, book.title, x, 180, w, 62, 3);
    ctx.fillStyle = 'rgba(246,236,217,0.7)';
    ctx.font = `italic 500 40px ${SERIF}`;
    ctx.fillText(book.author, x, y, w);
    y += 46;
    ctx.fillStyle = '#c9a45c';
    ctx.font = '400 26px Lato, Arial, sans-serif';
    const when = book.finished ? `Finished ${formatDate(book.dateCompleted)}` : book.status;
    ctx.fillText([when, book.ownership].filter(Boolean).join('  ·  '), x, y);
    ctx.fillStyle = 'rgba(246,236,217,0.88)';
    ctx.font = '400 27px Lato, Arial, sans-serif';
    wrapText(ctx, book.summary, x, y + 54, w, 38, Math.floor((740 - y - 54) / 38));
    cardTex.needsUpdate = true;
  }

  const head = new THREE.Vector3();
  const gaze = new THREE.Vector3();
  function showCard(book) {
    shown = book;
    wall.setSelected(book);
    if (!book) { card.visible = false; return; }
    drawCard(book, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (shown === book) drawCard(book, img); };
    img.src = book.cover;
    // Hang the card a comfortable arm's reach in front of the visitor, facing them.
    camera.getWorldPosition(head);
    camera.getWorldDirection(gaze);
    gaze.y = 0;
    gaze.normalize();
    card.position.copy(head).addScaledVector(gaze, 1.25);
    card.position.y = head.y - 0.08;
    card.lookAt(head.x, card.position.y, head.z);
    card.visible = true;
  }

  // ---- Controllers --------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const controllers = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xecc983, transparent: true, opacity: 0.7 }));
    line.scale.z = 6;
    c.add(line);
    c.addEventListener('connected', (e) => { c.userData.source = e.data; });
    c.addEventListener('disconnected', () => { c.userData.source = null; });
    c.addEventListener('selectstart', () => showCard(aim(c)));
    player.rig.add(c);
    return c;
  });

  function aim(controller) {
    rotation.extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
    return wall.pick(raycaster);
  }

  renderer.xr.addEventListener('sessionstart', () => {
    player.inVR = true;
    player.tour = null;
    player.flight = null;
    player.pitch = 0;
    camera.rotation.set(0, 0, 0);
    garden.setMirror(false);
    button.textContent = 'Exit VR';
  });
  renderer.xr.addEventListener('sessionend', () => {
    player.inVR = false;
    showCard(null);
    wall.setHover(null);
    garden.setMirror(true);
    button.textContent = 'Enter VR';
  });

  const move = new THREE.Vector2();
  let turned = false;
  return {
    // Returns what the sticks are asking for, in the shape Player.update expects.
    read() {
      move.set(0, 0);
      let stroll = 0;
      let hover = null;
      for (const c of controllers) {
        const source = c.userData.source;
        if (!source) continue;
        if (!hover) hover = aim(c);
        const axes = source.gamepad?.axes;
        if (!axes || axes.length < 4) continue;
        const x = Math.abs(axes[2]) > 0.15 ? axes[2] : 0;
        const y = Math.abs(axes[3]) > 0.15 ? axes[3] : 0;
        if (source.handedness === 'left') {
          move.set(x, -y);
        } else {
          if (Math.abs(x) > 0.7 && !turned) { player.yaw -= Math.sign(x) * (Math.PI / 6); turned = true; }
          if (Math.abs(x) < 0.3) turned = false;
          if (Math.abs(y) > 0.5) stroll = -Math.sign(y);
        }
      }
      wall.setHover(hover);
      camera.getWorldDirection(gaze);
      return { move, turn: 0, stroll, fast: false, heading: Math.atan2(-gaze.x, -gaze.z) };
    },
  };
}
