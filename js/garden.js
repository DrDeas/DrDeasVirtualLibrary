// The garden at the foot of the tower: a still pool that mirrors the spiral above it,
// an island with a cherry tree, a stone lantern, and the column of light and drifting
// petals under the oculus. It carries over the Japanese garden, water and cherry
// blossom of the original library.

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Geo } from './geo.js';
import { rng } from './textures.js';
import { POOL_R, TAU, LANDING } from './config.js';

const WaterShader = {
  name: 'PoolShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      // Slow rings spreading from the island plus a little cross-chop.
      vec2 p = vWorld.xz;
      float d = length( p );
      vec2 radial = p / max( d, 0.001 );
      float ring = cos( d * 5.0 - uTime * 1.1 ) * 0.5 + cos( d * 11.0 - uTime * 1.7 ) * 0.25;
      vec2 chop = vec2( cos( p.y * 7.0 + uTime * 0.8 ), cos( p.x * 6.0 - uTime * 0.6 ) ) * 0.3;
      vec2 slope = radial * ring + chop;
      vec4 uv = vUv;
      uv.xy += slope * 0.006 * uv.w;
      vec3 mirror = texture2DProj( tDiffuse, uv ).rgb;
      vec3 view = normalize( cameraPosition - vWorld );
      float fresnel = 0.32 + 0.68 * pow( 1.0 - clamp( view.y, 0.0, 1.0 ), 3.0 );
      gl_FragColor = vec4( mix( color, mirror, fresnel ), 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function buildTree(group, tex, rand) {
  const bark = new Geo();
  const tips = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);

  function grow(start, dir, len, radius, depth) {
    const end = start.clone().addScaledVector(dir, len);
    q.setFromUnitVectors(up, dir);
    m.compose(start.clone().lerp(end, 0.5), q, one);
    bark.add(new THREE.CylinderGeometry(radius * 0.7, radius, len, depth > 2 ? 7 : 5, 1, true), m);
    if (depth <= 2) tips.push({ p: end, spread: 0.35 + depth * 0.22 });
    if (depth === 0) return;
    const kids = depth > 3 ? 3 : 2 + (rand() > 0.55 ? 1 : 0);
    const twist = rand() * TAU;
    for (let i = 0; i < kids; i++) {
      const a = twist + (i / kids) * TAU + (rand() - 0.5) * 0.7;
      const tilt = 0.45 + rand() * 0.5;
      // Lean away from the parent, then pull gently back toward the sky so the crown
      // spreads wide rather than tall.
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const d = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt));
      d.y += 0.12;
      d.normalize();
      grow(end, d, len * (0.7 + rand() * 0.12), radius * 0.68, depth - 1);
    }
  }

  const lean = new THREE.Vector3(0.12, 1, -0.08).normalize();
  grow(new THREE.Vector3(0, 0.3, 0), lean, 1.7, 0.26, 5);

  group.add(bark.mesh(new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.95 })));

  // Blossom: thousands of small flower cards clustered round the twig ends.
  const perTip = Math.ceil(5200 / tips.length);
  const count = perTip * tips.length;
  const blossom = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex.blossom, alphaTest: 0.45, side: THREE.DoubleSide }),
    count
  );
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let top = 0;
  let n = 0;
  for (const tip of tips) {
    for (let i = 0; i < perTip; i++) {
      const r = tip.spread * Math.cbrt(rand());
      const th = rand() * TAU;
      const ph = Math.acos(2 * rand() - 1);
      dummy.position.set(
        tip.p.x + r * Math.sin(ph) * Math.cos(th),
        tip.p.y + r * Math.cos(ph) * 0.8,
        tip.p.z + r * Math.sin(ph) * Math.sin(th)
      );
      dummy.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
      dummy.scale.setScalar(0.13 + rand() * 0.13);
      dummy.updateMatrix();
      blossom.setMatrixAt(n, dummy.matrix);
      // Deeper pink in the shade under the crown, almost white where light falls.
      const lit = THREE.MathUtils.clamp((dummy.position.y - 2.2) / 4.5, 0, 1);
      col.setHSL(0.94 + rand() * 0.03, 0.75, 0.56 + lit * 0.28 + rand() * 0.08);
      blossom.setColorAt(n, col);
      top = Math.max(top, dummy.position.y);
      n++;
    }
  }
  blossom.instanceColor.needsUpdate = true;
  group.add(blossom);
  return top;
}

function buildPetals(group, tex, rand, time) {
  const COUNT = 320;
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = COUNT;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, map: { value: tex.petal } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec2 vUv;
      mat2 rot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, -s, s, c ); }
      void main() {
        vUv = uv;
        float fall = fract( uTime * ( 0.03 + 0.03 * aSeed.y ) + aSeed.x );
        float ang = aSeed.z * 6.2832 + uTime * 0.12 * ( aSeed.w - 0.5 );
        float rad = 0.4 + 5.2 * sqrt( aSeed.w );
        vec3 c = vec3( cos( ang ) * rad, mix( 2.6 + 4.6 * aSeed.z, 0.03, fall ), sin( ang ) * rad );
        c.x += sin( uTime * 0.9 + aSeed.x * 40.0 ) * 0.4;
        c.z += cos( uTime * 0.7 + aSeed.y * 40.0 ) * 0.4;
        vec3 p = position * ( 0.06 + 0.04 * aSeed.y );
        float spin = uTime * ( 1.2 + 2.0 * aSeed.y ) + aSeed.z * 20.0;
        p.yz = rot( spin ) * p.yz;
        p.xz = rot( spin * 0.7 ) * p.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( c + p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D( map, vUv );
        if ( t.a < 0.5 ) discard;
        gl_FragColor = vec4( t.rgb, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const petals = new THREE.Mesh(geo, mat);
  petals.frustumCulled = false;
  group.add(petals);

  // Petals that have already settled on the water.
  const afloat = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.1, 0.1),
    new THREE.MeshBasicMaterial({ map: tex.petal, alphaTest: 0.5, side: THREE.DoubleSide }),
    150
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 150; i++) {
    const r = 1.9 + (POOL_R - 2.0) * Math.sqrt(rand());
    const a = rand() * TAU;
    dummy.position.set(Math.cos(a) * r, 0.006, Math.sin(a) * r);
    dummy.rotation.set(-Math.PI / 2, 0, rand() * TAU);
    dummy.scale.setScalar(0.7 + rand() * 0.9);
    dummy.updateMatrix();
    afloat.setMatrixAt(i, dummy.matrix);
  }
  group.add(afloat);
  return afloat;
}

function buildLantern(group, mats, tex, rockMat) {
  const lantern = new THREE.Group();
  const add = (geo, mat, y) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    lantern.add(mesh);
    return mesh;
  };
  add(new THREE.CylinderGeometry(0.2, 0.26, 0.12, 6), rockMat, 0.06);
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 6), rockMat, 0.37);
  add(new THREE.CylinderGeometry(0.2, 0.1, 0.08, 6), rockMat, 0.66);
  add(new THREE.BoxGeometry(0.2, 0.2, 0.2), mats.lamp, 0.8);
  for (let i = 0; i < 4; i++) {
    const post = add(new THREE.BoxGeometry(0.035, 0.22, 0.035), rockMat, 0.8);
    post.position.x = i < 2 ? -0.1 : 0.1;
    post.position.z = i % 2 ? -0.1 : 0.1;
  }
  add(new THREE.ConeGeometry(0.34, 0.2, 6), rockMat, 1.0);
  add(new THREE.SphereGeometry(0.05, 8, 6), rockMat, 1.13);
  const light = new THREE.PointLight(0xffb469, 5, 9, 2);
  light.position.y = 0.8;
  lantern.add(light);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex.glow, color: 0xffb469, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7,
  }));
  halo.scale.setScalar(1.3);
  halo.position.y = 0.8;
  lantern.add(halo);
  lantern.position.set(-1.05, 0.3, 0.75);
  group.add(lantern);
}

export function buildGarden(scene, mats, tex, arch, quality) {
  const group = new THREE.Group();
  scene.add(group);
  const rand = rng(2020);
  const time = { value: 0 };

  // ---- Pool ----------------------------------------------------------------
  const poolGeo = new THREE.CircleGeometry(POOL_R, 96);
  let mirror = null;
  if (quality.reflections) {
    mirror = new Reflector(poolGeo, {
      textureWidth: quality.mirrorSize,
      textureHeight: quality.mirrorSize,
      color: 0x06181a,
      shader: WaterShader,
      multisample: 0,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.02;
    mirror.material.uniforms.uTime = time;
    group.add(mirror);
  }
  // Plain glossy water for devices (and headsets) where a live mirror costs too much.
  const still = new THREE.Mesh(poolGeo, new THREE.MeshStandardMaterial({ color: 0x0a2a2c, roughness: 0.04, metalness: 0.85 }));
  still.rotation.x = -Math.PI / 2;
  still.position.y = -0.02;
  still.visible = !mirror;
  group.add(still);

  // ---- Island, rocks, stepping stones -------------------------------------
  const rockMat = new THREE.MeshStandardMaterial({ map: tex.rock, roughness: 0.9, flatShading: true });
  const islandGeo = new THREE.SphereGeometry(1.75, 40, 10, 0, TAU, 0, Math.PI / 2);
  const iuv = islandGeo.attributes.uv;
  for (let i = 0; i < iuv.count; i++) iuv.setXY(i, iuv.getX(i) * 9, iuv.getY(i) * 2.4);
  const island = new THREE.Mesh(islandGeo, new THREE.MeshStandardMaterial({ map: tex.moss, roughness: 1 }));
  island.scale.y = 0.22;
  island.position.y = -0.03;
  group.add(island);

  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const k = 0.82 + 0.36 * Math.abs(Math.sin(rp.getX(i) * 12.9898 + rp.getY(i) * 78.233 + rp.getZ(i) * 37.719) * 43758.5453 % 1);
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k, rp.getZ(i) * k);
  }
  rockGeo.computeVertexNormals();
  const rocks = [
    [1.25, 0.12, -0.7, 0.42, 0.3, 0.36], [1.55, 0.02, 0.35, 0.3, 0.2, 0.26], [-1.5, 0.05, -0.5, 0.36, 0.26, 0.3],
    [-0.3, 0.1, 1.6, 0.28, 0.18, 0.34], [0.5, 0.2, -1.35, 0.24, 0.2, 0.22], [-2.6, -0.02, 1.9, 0.34, 0.22, 0.3],
  ];
  for (const [x, y, z, sx, sy, sz] of rocks) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, y, z);
    rock.scale.set(sx, sy, sz);
    rock.rotation.y = x * 3 + z;
    group.add(rock);
  }

  // Stones leading from the entrance side out toward the island.
  const stoneGeo = new THREE.CylinderGeometry(0.36, 0.4, 0.1, 9);
  const pathAngle = -LANDING / 2;
  for (let i = 0; i < 4; i++) {
    const r = POOL_R - 0.5 - i * 0.62;
    const a = pathAngle + (i % 2 ? 0.09 : -0.09);
    const stone = new THREE.Mesh(stoneGeo, rockMat);
    stone.position.set(Math.cos(a) * r, 0.0, Math.sin(a) * r);
    stone.rotation.y = i * 1.3;
    stone.scale.set(1 + (i % 2) * 0.15, 1, 0.9);
    group.add(stone);
  }

  buildLantern(group, mats, tex, rockMat);
  buildTree(group, tex, rand);
  const afloat = buildPetals(group, tex, rand, time);

  // ---- Light from the oculus ----------------------------------------------
  const shaftH = arch.domeTop;
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.75) }, uStrength: { value: 0.3 }, uTop: { value: shaftH } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vN = normalize( mat3( modelMatrix ) * normal );
        vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTop;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        // Bright where we look through the thick middle of the beam, fading to nothing
        // at its edges so the cylinder itself is never seen.
        vec3 view = normalize( cameraPosition - vWorld );
        float core = pow( abs( dot( normalize( vN ), view ) ), 2.2 );
        float h = vWorld.y / uTop;
        float fade = smoothstep( 0.0, 0.12, h ) * ( 0.35 + 0.65 * h );
        gl_FragColor = vec4( uColor * uStrength * core * fade, 1.0 );
      }`,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(arch.oculus * 0.95, 3.7, shaftH, 48, 1, true), shaftMat);
  shaft.position.y = shaftH / 2;
  shaft.renderOrder = 4;
  group.add(shaft);

  const moteGeo = new THREE.BufferGeometry();
  const mp = [];
  for (let i = 0; i < 420; i++) {
    const r = 3.3 * Math.sqrt(rand());
    const a = rand() * TAU;
    mp.push(Math.cos(a) * r, rand() * shaftH * 0.85, Math.sin(a) * r);
  }
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    map: tex.glow, color: 0xfff0d0, size: 0.07, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(motes);

  return {
    group, mirror, still, shaftMat, motes,
    update(t, dt) {
      time.value = t;
      motes.rotation.y += dt * 0.02;
      motes.position.y = Math.sin(t * 0.2) * 0.25;
      afloat.rotation.y += dt * 0.006;
    },
    // The live mirror cannot be drawn per-eye in a headset, so swap it out there.
    setMirror(on) {
      if (!mirror) return;
      mirror.visible = on;
      still.visible = !on;
    },
  };
}
