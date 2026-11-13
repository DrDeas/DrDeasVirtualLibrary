// The sky seen through the dome. It follows the visitor's own clock: stars at night,
// a warm horizon at dawn and dusk, blue at midday. The light that falls through the
// oculus changes with it.

import * as THREE from 'three';
import { rng } from './textures.js';

// hour, zenith, horizon, stars, light colour, light strength, shaft colour, shaft strength, fill
const KEYS = [
  [0.0, 0x04060f, 0x0c1424, 1.0, 0x9fb6ff, 0.45, 0x8fa8e8, 0.14, 0.3],
  [5.0, 0x04060f, 0x0c1424, 1.0, 0x9fb6ff, 0.45, 0x8fa8e8, 0.14, 0.3],
  [6.6, 0x24365f, 0xf0a071, 0.15, 0xffc9a0, 1.0, 0xffc08a, 0.26, 0.36],
  [9.0, 0x2d6bbd, 0xa8d1ef, 0.0, 0xfff3de, 2.0, 0xfff0d2, 0.36, 0.44],
  [16.5, 0x2d6bbd, 0xa8d1ef, 0.0, 0xfff3de, 2.0, 0xfff0d2, 0.36, 0.44],
  [18.6, 0x1b2250, 0xe9835b, 0.25, 0xffb080, 1.0, 0xffb07a, 0.28, 0.36],
  [20.6, 0x04060f, 0x0c1424, 1.0, 0x9fb6ff, 0.45, 0x8fa8e8, 0.14, 0.3],
  [24.0, 0x04060f, 0x0c1424, 1.0, 0x9fb6ff, 0.45, 0x8fa8e8, 0.14, 0.3],
];

export function buildSky(scene) {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        void main() {
          float h = pow( clamp( normalize( vDir ).y, 0.0, 1.0 ), 0.55 );
          gl_FragColor = vec4( mix( uHorizon, uTop, h ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  dome.renderOrder = -10;
  scene.add(dome);

  const rand = rng(7);
  const pts = [];
  for (let i = 0; i < 1800; i++) {
    const y = 0.12 + 0.88 * rand();
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push(r * Math.cos(a) * 380, y * 380, r * Math.sin(a) * 380);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  scene.add(stars);

  const a = new THREE.Color();
  const b = new THREE.Color();
  const mix = (ka, kb, i, t, target) => target.copy(a.setHex(ka[i])).lerp(b.setHex(kb[i]), t);

  return {
    // `hour` is 0..24 on the visitor's clock.
    apply(hour, lights, shaftMat) {
      let k = 0;
      while (k < KEYS.length - 2 && hour >= KEYS[k + 1][0]) k++;
      const ka = KEYS[k], kb = KEYS[k + 1];
      const t = THREE.MathUtils.clamp((hour - ka[0]) / (kb[0] - ka[0]), 0, 1);
      const num = (i) => ka[i] + (kb[i] - ka[i]) * t;
      mix(ka, kb, 1, t, uniforms.uTop.value);
      mix(ka, kb, 2, t, uniforms.uHorizon.value);
      starMat.opacity = num(3);
      stars.visible = starMat.opacity > 0.01;
      mix(ka, kb, 4, t, lights.sky.color);
      lights.sky.intensity = num(5);
      mix(ka, kb, 6, t, shaftMat.uniforms.uColor.value);
      shaftMat.uniforms.uStrength.value = num(7);
      lights.hemi.intensity = num(8);
    },
  };
}
