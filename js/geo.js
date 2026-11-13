// A small mesh builder for curved architecture. Almost everything in the tower is a
// "ribbon": a strip stretched between two edges that both wind around the axis, such
// as the ramp (inner edge to outer edge) or a shelf front (bottom edge to top edge).

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Matrix3();

export class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  // a(u) and b(u) return [radius, height] for the strip's two edges at angle u.
  // UVs are in metres unless `unit` is set, in which case they run 0..1 both ways.
  // `breaks` lists angles where an edge has a corner and so needs a vertex.
  ribbon(u0, u1, a, b, { unit = false, breaks = [], step = 0.035 } = {}) {
    const stops = [u0, ...breaks.filter((x) => x > u0 + 1e-6 && x < u1 - 1e-6), u1];
    for (let s = 0; s + 1 < stops.length; s++) this._span(stops[s], stops[s + 1], a, b, unit, u0, u1, step);
    return this;
  }

  _span(s0, s1, a, b, unit, u0, u1, step) {
    const segs = Math.max(1, Math.ceil((s1 - s0) / step));
    const base = this.count;
    const eps = 1e-4;
    for (let i = 0; i <= segs; i++) {
      const u = s0 + ((s1 - s0) * i) / segs;
      // Sample the tangent from inside the span so corners stay crisp.
      const ut = Math.min(Math.max(u, s0 + eps), s1 - eps);
      const [ra, ya] = a(u);
      const [rb, yb] = b(u);
      const [ra2, ya2] = a(ut + eps);
      const [ra1, ya1] = a(ut - eps);
      const c = Math.cos(u);
      const s = Math.sin(u);
      const ax = ra * c, az = ra * s, bx = rb * c, bz = rb * s;
      // Tangent along the strip (from edge a) crossed with the direction across it.
      const tx = ra2 * Math.cos(ut + eps) - ra1 * Math.cos(ut - eps);
      const ty = ya2 - ya1;
      const tz = ra2 * Math.sin(ut + eps) - ra1 * Math.sin(ut - eps);
      const wx = bx - ax, wy = yb - ya, wz = bz - az;
      _v.set(ty * wz - tz * wy, tz * wx - tx * wz, tx * wy - ty * wx).normalize();
      const width = Math.hypot(wx, wy, wz);
      this.pos.push(ax, ya, az, bx, yb, bz);
      this.nor.push(_v.x, _v.y, _v.z, _v.x, _v.y, _v.z);
      if (unit) {
        const t = (u - u0) / (u1 - u0);
        this.uv.push(t, 0, t, 1);
      } else {
        const along = u * (ra + rb) * 0.5;
        this.uv.push(along, 0, along, width);
      }
      if (i < segs) {
        const k = base + i * 2;
        this.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }

  // A flat four-cornered panel; corners are THREE.Vector3 in order around the edge.
  quad(p0, p1, p2, p3) {
    const base = this.count;
    const n = new THREE.Vector3().subVectors(p1, p0).cross(_v.subVectors(p3, p0)).normalize();
    const w = p0.distanceTo(p1);
    const h = p0.distanceTo(p3);
    for (const p of [p0, p1, p2, p3]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
    }
    this.uv.push(0, 0, w, 0, w, h, 0, h);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  // Appends any three.js geometry, moved into place by `matrix`.
  add(geometry, matrix) {
    const base = this.count;
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const t = geometry.attributes.uv;
    if (matrix) _n.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (matrix) _v.applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i);
      if (matrix) _v.applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) this.idx.push(base + geometry.index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    geometry.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material) {
    return new THREE.Mesh(this.build(), material);
  }
}

// Turns an object so its local +z faces the tower's axis and its local +x runs in the
// direction of increasing u (left to right for someone facing the wall).
export function faceAxis(object, u) {
  object.rotation.set(0, Math.atan2(-Math.cos(u), -Math.sin(u)), 0);
  return object;
}

export function axisMatrix(r, u, y, target = new THREE.Matrix4()) {
  const yaw = Math.atan2(-Math.cos(u), -Math.sin(u));
  target.makeRotationY(yaw);
  target.setPosition(r * Math.cos(u), y, r * Math.sin(u));
  return target;
}
