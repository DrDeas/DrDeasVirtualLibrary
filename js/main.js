import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { loadBooks } from './books.js';
import { layoutFor } from './config.js';
import { buildTextures } from './textures.js';
import { buildMaterials, buildArchitecture, buildLights } from './architecture.js';
import { buildGarden } from './garden.js';
import { buildSignage } from './signage.js';
import { buildSky } from './sky.js';
import { BookWall } from './bookwall.js';
import { Player, Input } from './player.js';
import { Interface } from './ui.js';
import { setupXR } from './xr.js';

const params = new URLSearchParams(location.search);

// Phones and tablets get a lighter version: no live mirror in the pool, fewer
// full-size covers held at once. `?quality=high` or `?quality=low` overrides the guess.
function chooseQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const wanted = params.get('quality');
  const low = wanted ? wanted === 'low' : coarse;
  return {
    low,
    reflections: !low,
    mirrorSize: 1024,
    hiresCovers: low ? 10 : 26,
    samples: low ? 0 : 4,
    maxPixelRatio: low ? 1.5 : 2,
  };
}

function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const wanted = ['600 40px "Cormorant Garamond"', 'italic 500 40px "Cormorant Garamond"', '400 20px Lato', '700 20px Lato'];
  const loading = Promise.all(wanted.map((f) => document.fonts.load(f))).catch(() => {});
  return Promise.race([loading, new Promise((r) => setTimeout(r, 2500))]);
}

async function start() {
  const canvas = document.getElementById('view');
  const quality = chooseQuality();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    throw new Error('This browser could not start WebGL, which the library needs.', { cause: err });
  }
  let pixelRatio = Math.min(devicePixelRatio || 1, quality.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const [{ books, source }] = await Promise.all([loadBooks(), fontsReady()]);
  const layout = layoutFor(books.length);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d0906, 0.011);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 900);

  const tex = buildTextures(renderer);
  const mats = buildMaterials(tex);
  const arch = buildArchitecture(scene, layout, mats, tex);
  const lights = buildLights(scene, layout);
  const garden = buildGarden(scene, mats, tex, arch, quality);
  const signage = buildSignage(scene, layout, mats, books);
  const sky = buildSky(scene);
  const wall = new BookWall(scene, layout, books, renderer, quality);

  const player = new Player(camera, layout);
  scene.add(player.rig);
  const input = new Input(canvas, player);
  const ui = new Interface({ books, layout, player, input, wall, camera, canvas });
  const xr = setupXR({ renderer, scene, camera, player, wall, garden, button: document.getElementById('btnVR') });

  // ---- Rendering ----------------------------------------------------------
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // Only surfaces brighter than white bloom: the light strips and lamps, never a cover.
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.5, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    // Keep a useful width of view on tall phone screens.
    camera.fov = camera.aspect < 1 ? 78 : 62;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);
  resize();

  // Reflections for brass and polished stone are captured from the building itself.
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTexture = null;
  function captureSurroundings() {
    const mirrorWasOn = garden.mirror?.visible;
    if (garden.mirror) garden.mirror.visible = false;
    scene.environment = null;
    const next = pmrem.fromScene(scene, 0, 0.1, 200, { position: new THREE.Vector3(0, 5, 0) });
    if (envTexture) envTexture.dispose();
    envTexture = next;
    scene.environment = envTexture.texture;
    scene.environmentIntensity = 0.4;
    if (garden.mirror) garden.mirror.visible = mirrorWasOn;
  }

  const fixedHour = params.has('hour') ? Number(params.get('hour')) : null;
  function applySky() {
    const now = new Date();
    sky.apply(fixedHour ?? now.getHours() + now.getMinutes() / 60, lights, garden.shaftMat);
  }
  applySky();

  player.startTour();
  let last = performance.now();
  let elapsed = 0;
  let sinceSlow = 0;
  let frames = 0, frameTime = 0;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    const vr = renderer.xr.isPresenting;

    player.update(dt, vr && xr ? xr.read() : input.read(dt));
    wall.update(camera, dt, elapsed);
    garden.update(elapsed, dt);
    ui.update();

    sinceSlow += dt;
    if (sinceSlow > 5) {
      sinceSlow = 0;
      signage.update(new Date());
      applySky();
    }

    if (vr) renderer.render(scene, camera);
    else composer.render(dt);

    // If the device cannot keep up, trade sharpness for smoothness.
    frames++;
    frameTime += dt;
    if (frames === 90) {
      if (!vr && frameTime / frames > 1 / 34 && pixelRatio > 0.75) {
        pixelRatio = Math.max(0.75, pixelRatio - 0.25);
        resize();
      }
      frames = 0;
      frameTime = 0;
    }
  });

  await wall.load((f) => ui.progress(f));
  captureSurroundings();
  ui.ready(source);

  window.library = { books, layout, player, wall, ui, scene, camera, renderer };
}

start().catch((err) => {
  console.error(err);
  const hint = document.getElementById('introHint');
  document.getElementById('loading').classList.add('done');
  document.getElementById('enter').hidden = true;
  hint.classList.add('error');
  hint.textContent = err.message || 'The library could not be opened.';
});
