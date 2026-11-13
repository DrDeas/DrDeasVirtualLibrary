// The tower: wall, spiral ramp, balustrade, shelving bays, pilasters, dome and the
// atrium floor. Geometry is generated once and merged by material, so the whole
// building is a dozen draw calls.

import * as THREE from 'three';
import { Geo, axisMatrix } from './geo.js';
import {
  R_OUT, R_IN, SLAB, BAY, ROWS, ROW_PITCH, SHELF_DEPTH, PILASTER_W, LANDING, POOL_R,
  TAU, rampY, bayBaseY, polar,
} from './config.js';

const WARM = new THREE.Color(1.0, 0.72, 0.42);

// Shelf lighting is drawn as glowing strips rather than real lamps (there are over
// two hundred of them). This adds the warm wash those strips would cast on nearby
// surfaces: the closer a surface is to the book wall, the more it picks up.
function wallWash(material, uniform) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWash = uniform;
    shader.vertexShader = 'varying vec3 vWashPos;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 washPos = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        washPos = instanceMatrix * washPos;
      #endif
      vWashPos = ( modelMatrix * washPos ).xyz;`
    );
    shader.fragmentShader = 'varying vec3 vWashPos;\nuniform vec3 uWash;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * uWash * smoothstep( ${(R_IN + 0.2).toFixed(2)}, ${(R_OUT - 0.1).toFixed(2)}, length( vWashPos.xz ) );`
    );
  };
  return material;
}

export function buildMaterials(tex) {
  const wash = { value: new THREE.Color(0.2, 0.155, 0.1) };
  const std = (opts) => wallWash(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...opts }), wash);
  return {
    wash,
    floor: std({ map: tex.travertine, roughness: 0.38, metalness: 0.0 }),
    plaster: std({ map: tex.plaster, color: 0xd6d2cb, roughness: 0.9 }),
    walnut: std({ map: tex.walnut, roughness: 0.55 }),
    brass: std({ color: 0xc9a45c, roughness: 0.28, metalness: 1.0 }),
    bronze: std({ color: 0x4a3a28, roughness: 0.45, metalness: 0.9 }),
    cushion: std({ color: 0x7a1f24, roughness: 0.95 }),
    marble: new THREE.MeshStandardMaterial({ map: tex.marble, roughness: 0.16, metalness: 0.0 }),
    led: new THREE.MeshBasicMaterial({ color: WARM.clone().multiplyScalar(2.6), side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: WARM.clone().multiplyScalar(4.0) }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xbfd9e0, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.1,
      envMapIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false,
    }),
  };
}

export function buildArchitecture(scene, layout, mats, tex) {
  const L = layout;
  const H = (u) => rampY(u, L);
  const breaks = [0, L.uTop];
  const group = new THREE.Group();
  scene.add(group);

  const g = {
    floor: new Geo(), plaster: new Geo(), walnut: new Geo(), brass: new Geo(),
    led: new Geo(), glass: new Geo(), cushion: new Geo(), bronze: new Geo(),
  };
  const P = (r, u, y) => polar(r, u, y, new THREE.Vector3());

  // ---- Ramp ----------------------------------------------------------------
  const uSoffit = TAU - LANDING; // below this the ramp sits on a solid plinth
  g.floor.ribbon(-LANDING, L.uEnd, (u) => [R_IN, H(u)], (u) => [R_OUT, H(u)], { breaks });
  g.plaster.ribbon(uSoffit, L.uEnd, (u) => [R_IN, H(u) - SLAB], (u) => [R_OUT, H(u) - SLAB], { breaks });
  // The pale band that faces the atrium: plinth wall first, then the slab edge.
  g.walnut.ribbon(0, uSoffit, () => [R_IN, 0], (u) => [R_IN, H(u) - 0.02], { breaks });
  g.brass.ribbon(0, uSoffit, (u) => [R_IN, H(u) - 0.02], (u) => [R_IN, H(u) + 0.02], { breaks });
  g.plaster.ribbon(0, uSoffit, (u) => [R_IN, H(u) + 0.02], (u) => [R_IN, H(u) + 0.1], { breaks });
  g.plaster.ribbon(uSoffit, L.uEnd, (u) => [R_IN, H(u) - SLAB], (u) => [R_IN, H(u) + 0.1], { breaks });
  // Kerb under the glass.
  g.plaster.ribbon(0, L.uEnd, (u) => [R_IN, H(u) + 0.1], (u) => [R_IN + 0.12, H(u) + 0.1], { breaks });
  g.plaster.ribbon(0, L.uEnd, (u) => [R_IN + 0.12, H(u)], (u) => [R_IN + 0.12, H(u) + 0.1], { breaks });
  // Cove light tucked under the slab edge.
  g.led.ribbon(uSoffit, L.uEnd, (u) => [R_IN + 0.015, H(u) - SLAB - 0.004], (u) => [R_IN + 0.09, H(u) - SLAB - 0.004], { breaks });
  g.led.ribbon(uSoffit, L.uEnd, (u) => [R_IN - 0.004, H(u) - SLAB], (u) => [R_IN - 0.004, H(u) - SLAB + 0.03], { breaks });

  // Balustrade: glass with a brass rail lit from beneath.
  const rg = R_IN + 0.06;
  const railLo = 1.08, railHi = 1.13;
  g.glass.ribbon(0.03, L.uEnd, (u) => [rg, H(u) + 0.1], (u) => [rg, H(u) + railLo], { breaks });
  g.brass.ribbon(0.03, L.uEnd, (u) => [rg - 0.035, H(u) + railHi], (u) => [rg + 0.035, H(u) + railHi], { breaks });
  g.brass.ribbon(0.03, L.uEnd, (u) => [rg - 0.035, H(u) + railLo], (u) => [rg - 0.035, H(u) + railHi], { breaks });
  g.brass.ribbon(0.03, L.uEnd, (u) => [rg + 0.035, H(u) + railLo], (u) => [rg + 0.035, H(u) + railHi], { breaks });
  g.led.ribbon(0.03, L.uEnd, (u) => [rg - 0.03, H(u) + railLo - 0.002], (u) => [rg + 0.03, H(u) + railLo - 0.002], { breaks });

  // Where the ramp stops at the top: slab end, glass and rail across it.
  const yT = L.topY;
  g.plaster.quad(P(R_IN, L.uEnd, yT - SLAB), P(R_OUT, L.uEnd, yT - SLAB), P(R_OUT, L.uEnd, yT + 0.1), P(R_IN, L.uEnd, yT + 0.1));
  g.glass.quad(P(rg, L.uEnd - 0.004, yT + 0.1), P(R_OUT, L.uEnd - 0.004, yT + 0.1), P(R_OUT, L.uEnd - 0.004, yT + railLo), P(rg, L.uEnd - 0.004, yT + railLo));
  g.brass.quad(P(rg, L.uEnd - 0.004, yT + railLo), P(R_OUT, L.uEnd - 0.004, yT + railLo), P(R_OUT, L.uEnd - 0.004, yT + railHi), P(rg, L.uEnd - 0.004, yT + railHi));
  // Newel post where the balustrade begins.
  g.brass.add(new THREE.BoxGeometry(0.09, 1.16, 0.09), axisMatrix(rg, 0.03, 0.58));

  // Wall that closes the plinth beside the entrance landing.
  const endH = H(uSoffit) - SLAB;
  g.plaster.quad(P(R_IN, -LANDING, 0), P(R_OUT, -LANDING, 0), P(R_OUT, -LANDING, endH), P(R_IN, -LANDING, endH));

  // ---- Tower wall ----------------------------------------------------------
  g.walnut.ribbon(0, TAU, () => [R_OUT, -0.2], () => [R_OUT, L.wallTop]);
  g.brass.ribbon(0, TAU, () => [R_OUT - 0.3, L.wallTop], () => [R_OUT, L.wallTop]);
  g.brass.ribbon(0, TAU, () => [R_OUT - 0.3, L.wallTop - 0.16], () => [R_OUT - 0.3, L.wallTop]);
  g.led.ribbon(0, TAU, () => [R_OUT - 0.3, L.wallTop - 0.2], () => [R_OUT - 0.3, L.wallTop - 0.16]);

  // ---- Shelving bays -------------------------------------------------------
  const pil = PILASTER_W / R_OUT;
  const rs = R_OUT - SHELF_DEPTH;
  for (let b = 0; b < L.bays; b++) {
    const u0 = b * BAY + pil / 2;
    const u1 = (b + 1) * BAY - pil / 2;
    const base = bayBaseY(b, L);
    const o = { step: 0.05 };
    for (let j = 0; j < ROWS; j++) {
      const y = base + j * ROW_PITCH;
      g.walnut.ribbon(u0, u1, () => [rs, y], () => [R_OUT, y], o);
      g.brass.ribbon(u0, u1, () => [rs, y - 0.035], () => [rs, y + 0.014], o);
      g.led.ribbon(u0, u1, () => [rs + 0.004, y - 0.052], () => [rs + 0.004, y - 0.035], o);
      g.walnut.ribbon(u0, u1, () => [rs, y - 0.052], () => [R_OUT, y - 0.052], o);
    }
    // Cabinet base down to the ramp, and the canopy over the top shelf.
    g.walnut.ribbon(u0, u1, (u) => [rs + 0.03, H(u) - 0.02], () => [rs + 0.03, base - 0.052], o);
    const yc = base + ROWS * ROW_PITCH;
    const rc = R_OUT - 0.3;
    g.walnut.ribbon(u0, u1, () => [rc, yc], () => [R_OUT, yc], o);
    g.walnut.ribbon(u0, u1, () => [rc, yc + 0.016], () => [rc, yc + 0.24], o);
    g.walnut.ribbon(u0, u1, () => [rc, yc + 0.24], () => [R_OUT, yc + 0.24], o);
    g.led.ribbon(u0, u1, () => [rc - 0.003, yc], () => [rc - 0.003, yc + 0.016], o);
    g.brass.ribbon(u0, u1, () => [rc - 0.004, yc + 0.215], () => [rc - 0.004, yc + 0.24], o);
  }

  // ---- Pilasters and their lamps ------------------------------------------
  const nPil = L.bays + 1;
  const pilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(PILASTER_W, 1, 0.34), mats.walnut, nPil);
  const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10), mats.lamp, nPil);
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.03), mats.brass, nPil);
  const halo = [];
  const m = new THREE.Matrix4();
  const sc = new THREE.Matrix4();
  for (let b = 0; b < nPil; b++) {
    const u = b * BAY;
    const y0 = H(u) - 0.25;
    const hasRampAbove = u + TAU <= L.uEnd + pil;
    const y1 = hasRampAbove ? H(u + TAU) - SLAB + 0.02 : H(u) + 3.55;
    axisMatrix(R_OUT - 0.17, u, (y0 + y1) / 2, m);
    pilasters.setMatrixAt(b, m.multiply(sc.makeScale(1, y1 - y0, 1)));
    const yl = H(u) + 2.45;
    lamps.setMatrixAt(b, axisMatrix(R_OUT - 0.40, u, yl, m));
    plates.setMatrixAt(b, axisMatrix(R_OUT - 0.355, u, yl, m));
    halo.push((R_OUT - 0.42) * Math.cos(u), yl, (R_OUT - 0.42) * Math.sin(u));
  }
  group.add(pilasters, lamps, plates);

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3));
  const halos = new THREE.Points(haloGeo, new THREE.PointsMaterial({
    map: tex.glow, color: WARM, size: 1.5, sizeAttenuation: true, transparent: true,
    opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(halos);

  // ---- Atrium --------------------------------------------------------------
  const floorGeo = new THREE.RingGeometry(POOL_R, R_IN + 0.02, 128, 1);
  const fuv = floorGeo.attributes.uv;
  const fpos = floorGeo.attributes.position;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fpos.getX(i), fpos.getY(i));
  const atriumFloor = new THREE.Mesh(floorGeo, mats.marble);
  atriumFloor.rotation.x = -Math.PI / 2;
  group.add(atriumFloor);

  for (const [r, w] of [[POOL_R, 0.09], [POOL_R + 0.42, 0.025], [POOL_R + 1.62, 0.025], [R_IN - 0.72, 0.04]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + w, 128, 1), mats.brass);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.003;
    group.add(ring);
  }

  // Built-in bench along the plinth wall, from where the wall is tall enough to lean
  // on round to the entrance.
  const ub0 = 1.5, ub1 = uSoffit - 0.25;
  const rb = R_IN - 0.62;
  g.cushion.ribbon(ub0, ub1, () => [rb, 0.46], () => [R_IN, 0.46]);
  g.cushion.ribbon(ub0, ub1, () => [rb, 0.38], () => [rb, 0.46]);
  g.walnut.ribbon(ub0, ub1, () => [rb + 0.03, 0.09], () => [rb + 0.03, 0.38]);
  g.led.ribbon(ub0, ub1, () => [rb + 0.04, 0.03], () => [rb + 0.04, 0.085]);
  for (const u of [ub0, ub1]) {
    g.walnut.quad(P(rb + 0.03, u, 0), P(R_IN, u, 0), P(R_IN, u, 0.38), P(rb + 0.03, u, 0.38));
    g.cushion.quad(P(rb, u, 0.38), P(R_IN, u, 0.38), P(R_IN, u, 0.46), P(rb, u, 0.46));
  }

  // ---- Dome ----------------------------------------------------------------
  const DOME_H = R_OUT * 0.72;
  const OCULUS = 2.4;
  const domeY = (rr) => L.wallTop + DOME_H * Math.sqrt(Math.max(0, 1 - (rr * rr) / (R_OUT * R_OUT)));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R_OUT, 64, 20, 0, TAU, Math.asin(OCULUS / R_OUT), Math.PI / 2 - Math.asin(OCULUS / R_OUT)),
    new THREE.MeshBasicMaterial({
      color: 0xa9c8dc, transparent: true, opacity: 0.1, side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  dome.scale.y = DOME_H / R_OUT;
  dome.position.y = L.wallTop;
  dome.renderOrder = 2;
  group.add(dome);

  // Ribs: one above every pilaster, tied together by three rings.
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const rib = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const RIB_STEPS = 14;
  for (let i = 0; i < 22; i++) {
    const a = i * BAY;
    let prev = P(R_OUT - 0.04, a, domeY(R_OUT - 0.04));
    for (let k = 1; k <= RIB_STEPS; k++) {
      const rr = THREE.MathUtils.lerp(R_OUT - 0.04, OCULUS, k / RIB_STEPS);
      const next = P(rr, a, domeY(rr) - 0.03);
      const dir = new THREE.Vector3().subVectors(next, prev);
      const len = dir.length();
      q.setFromUnitVectors(up, dir.normalize());
      rib.compose(new THREE.Vector3().addVectors(prev, next).multiplyScalar(0.5), q, one);
      g.bronze.add(new THREE.CylinderGeometry(0.045, 0.045, len * 1.03, 5, 1, true), rib);
      prev = next;
    }
  }
  for (const rr of [OCULUS, 5.2, 8.2]) {
    const ringM = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, domeY(rr) - 0.03, 0);
    g.bronze.add(new THREE.TorusGeometry(rr, rr === OCULUS ? 0.11 : 0.045, 6, 96), ringM);
  }

  for (const key of Object.keys(g)) {
    const mesh = g[key].mesh(mats[key]);
    if (key === 'glass') mesh.renderOrder = 3;
    group.add(mesh);
  }

  return { group, domeTop: L.wallTop + DOME_H, oculus: OCULUS, halos };
}

export function buildLights(scene, layout) {
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x2b2622, 0.5);
  scene.add(hemi);

  // Three warm lamps hung on the tower's axis stand in for all the light that
  // spills out of the bays into the atrium.
  const levels = [3.2, layout.topY * 0.55, layout.topY + 2.5];
  const fills = levels.map((y, i) => {
    const light = new THREE.PointLight(0xffdcb4, [22, 30, 26][i], 0, 2);
    light.position.set(0, y, 0);
    scene.add(light);
    return light;
  });

  // Daylight or moonlight falling through the oculus.
  const sky = new THREE.DirectionalLight(0xffffff, 1.2);
  sky.position.set(2, layout.wallTop + 12, 1.2);
  sky.target.position.set(0, 0, 0);
  scene.add(sky, sky.target);

  return { hemi, fills, sky };
}

