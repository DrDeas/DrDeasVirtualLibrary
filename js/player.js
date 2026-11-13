// The visitor: where they stand, where they look, and how they get about.
//
// There are two places to stand. The atrium is the flat ring of floor between the pool
// and the bench. The ramp is everything from the entrance landing to the top; a
// position on it is tracked as `u`, the unwound angle used throughout (see config.js),
// so the right height is known on every turn of the spiral.

import * as THREE from 'three';
import {
  R_OUT, R_IN, LANDING, POOL_R, EYE, TAU, rampY, clamp, lerp, smooth, wrapAngle,
} from './config.js';

const GATE_LO = -LANDING + 0.3; // the opening between atrium and ramp, as angles
const GATE_HI = -0.07;
const ATRIUM_MAX = R_IN - 0.95; // the bench
const WALK = 3.0;

export function yawToward(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export class Player {
  constructor(camera, layout) {
    this.camera = camera;
    this.layout = layout;
    // The rig stands on the floor and turns; the camera rides on it at eye height and
    // tilts. In a headset the headset drives the camera and only the rig is moved.
    this.rig = new THREE.Group();
    this.rig.add(camera);
    camera.position.set(0, EYE, 0);
    camera.rotation.order = 'YXZ';

    this.x = 0; this.z = 0; this.y = 0;
    this.u = 0;
    this.onRamp = false;
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.flight = null;
    this.tour = null;
    this.inVR = false;
    this.home();
  }

  home() {
    const a = -LANDING / 2;
    this.onRamp = false;
    this.x = Math.cos(a) * 6.35;
    this.z = Math.sin(a) * 6.35;
    this.y = 0;
    this.yaw = yawToward(-this.x, -this.z);
    this.pitch = 0.3;
    this.vel.set(0, 0);
    this.flight = null;
    this.apply();
  }

  // The spot from which a book is comfortably read, and the gaze that centres it.
  viewOf(book) {
    const u = book.place.u;
    const r = R_OUT - 2.35;
    const y = rampY(u, this.layout);
    return {
      onRamp: true, u, r, y,
      yaw: yawToward(Math.cos(u), Math.sin(u)),
      pitch: Math.atan2(book.place.y - (y + EYE), book.place.r - r),
    };
  }

  rampStart() {
    const u = -LANDING / 2;
    return { onRamp: true, u, r: R_IN + 1.5, y: 0, yaw: yawToward(-Math.sin(u), Math.cos(u)), pitch: 0 };
  }

  // Glides to a view. Short hops follow the ramp; longer ones swing out over the
  // atrium so the camera never passes through a floor.
  flyTo(view, onArrive) {
    this.tour = null;
    const from = {
      r: Math.hypot(this.x, this.z), a: Math.atan2(this.z, this.x), y: this.y,
      yaw: this.yaw, pitch: this.pitch, u: this.u, onRamp: this.onRamp,
    };
    const alongRamp = from.onRamp && view.onRamp && Math.abs(view.u - from.u) < 1.6;
    const turn = alongRamp ? view.u - from.u : wrapAngle(view.u - from.a);
    const dist = Math.hypot(turn * 8, view.y - from.y, view.r - from.r);
    if (dist < 0.05 && Math.abs(wrapAngle(view.yaw - from.yaw)) < 0.02) {
      this._land(view);
      if (onArrive) onArrive();
      return;
    }
    this.flight = {
      from, view, alongRamp, turn, t: 0,
      duration: alongRamp ? clamp(0.5 + dist * 0.12, 0.6, 1.5) : clamp(1.3 + dist * 0.07, 1.6, 3.4),
      onArrive,
    };
    this.vel.set(0, 0);
  }

  _land(view) {
    this.onRamp = view.onRamp;
    this.u = view.u;
    this.x = view.r * Math.cos(view.u);
    this.z = view.r * Math.sin(view.u);
    this.y = view.y;
    this.yaw = view.yaw;
    this.pitch = view.pitch;
  }

  _fly(dt) {
    const f = this.flight;
    f.t = Math.min(1, f.t + dt / f.duration);
    const e = smooth(f.t);
    let r, a, y;
    if (f.alongRamp) {
      a = f.from.u + f.turn * e;
      r = lerp(f.from.r, f.view.r, e);
      y = rampY(a, this.layout);
    } else {
      // Step in over the atrium, travel, step back out.
      const out = smooth(f.t / 0.28) * (1 - smooth((f.t - 0.72) / 0.28));
      a = f.from.a + f.turn * smooth((f.t - 0.1) / 0.8);
      r = lerp(lerp(f.from.r, f.view.r, e), 5.3, out);
      y = lerp(f.from.y, f.view.y, smooth((f.t - 0.22) / 0.56));
    }
    this.x = r * Math.cos(a);
    this.z = r * Math.sin(a);
    this.y = y;
    this.yaw = f.from.yaw + wrapAngle(f.view.yaw - f.from.yaw) * e;
    this.pitch = lerp(f.from.pitch, f.view.pitch, e);
    if (f.t >= 1) {
      this.flight = null;
      this._land(f.view);
      if (f.onArrive) f.onArrive();
    }
  }

  // A slow drifting view up and down the atrium, shown behind the welcome screen.
  startTour() {
    this.flight = null;
    this.tour = { t: 0 };
  }

  stopTour() {
    if (!this.tour) return;
    this.tour = null;
    this.home();
  }

  _tour(dt) {
    const tour = this.tour;
    tour.t += dt;
    const a = -LANDING / 2 + tour.t * 0.07;
    const lift = 0.5 - 0.5 * Math.cos(tour.t * 0.085);
    const r = 5.6;
    this.x = r * Math.cos(a);
    this.z = r * Math.sin(a);
    this.y = 0.4 + lift * (this.layout.topY + 0.5);
    // Look across the void at the far wall, a little ahead of the direction of travel.
    const la = a + Math.PI - 0.5;
    this.yaw = yawToward(R_OUT * Math.cos(la) - this.x, R_OUT * Math.sin(la) - this.z);
    this.pitch = lerp(0.3, -0.22, lift);
  }

  // `move` is the wish to walk: x to the right, y forward, each -1..1. `turn` and
  // `stroll` are -1..1. `heading` is the direction "forward" means, as a yaw.
  update(dt, input) {
    if (this.tour) { this._tour(dt); this.apply(); return; }
    if (this.flight) { this._fly(dt); this.apply(); return; }

    this.yaw -= input.turn * 1.9 * dt;
    const heading = input.heading ?? this.yaw;
    const speed = WALK * (input.fast ? 2.2 : 1);
    const fx = -Math.sin(heading), fz = -Math.cos(heading);
    const wantX = (fx * input.move.y - fz * input.move.x) * speed;
    const wantZ = (fz * input.move.y + fx * input.move.x) * speed;
    const ease = 1 - Math.exp(-dt * 9);
    this.vel.x += (wantX - this.vel.x) * ease;
    this.vel.y += (wantZ - this.vel.y) * ease;
    if (this.vel.lengthSq() > 1e-5) this._step(this.x + this.vel.x * dt, this.z + this.vel.y * dt);

    if (input.stroll) this._stroll(input.stroll * dt * speed);

    const floor = this.onRamp ? rampY(this.u, this.layout) : 0;
    this.y += (floor - this.y) * (1 - Math.exp(-dt * 14));
    this.apply();
  }

  // Walks along the ramp, turning with it so the view of the wall holds steady.
  _stroll(distance) {
    if (!this.onRamp) {
      this.flyTo(this.rampStart());
      return;
    }
    const r = Math.hypot(this.x, this.z);
    const before = this.u;
    this.u = clamp(this.u + distance / r, GATE_LO, this.layout.uEnd - 0.3);
    // Drift toward the middle of the ramp, where the shelves are best seen.
    let rr = r + (R_OUT - 2.0 - r) * Math.min(1, Math.abs(distance) * 0.35);
    if (this.u > GATE_HI) rr = Math.max(rr, R_IN + 0.45);
    this.x = rr * Math.cos(this.u);
    this.z = rr * Math.sin(this.u);
    this.yaw -= this.u - before;
  }

  _step(nx, nz) {
    let r = Math.hypot(nx, nz);
    let a = Math.atan2(nz, nx);
    if (!this.onRamp) {
      const inGate = a > GATE_LO && a < GATE_HI;
      if (r > ATRIUM_MAX) {
        const wasInGate = Math.hypot(this.x, this.z) > ATRIUM_MAX;
        if (wasInGate) a = clamp(a, GATE_LO, GATE_HI);
        else if (!inGate) r = ATRIUM_MAX;
      }
      r = Math.max(r, POOL_R + 0.4);
      if (r >= R_IN) { this.onRamp = true; this.u = a; }
      this.x = r * Math.cos(a);
      this.z = r * Math.sin(a);
      return;
    }
    let u = this.u + wrapAngle(a - this.u);
    u = clamp(u, GATE_LO, this.layout.uEnd - 0.3);
    if (r < R_IN + 0.45) {
      if (this.u <= GATE_HI) {
        // On the landing: free to step down into the atrium, but not to cut the corner
        // past the first post of the balustrade.
        u = Math.min(u, GATE_HI);
        if (r < R_IN) this.onRamp = false;
      } else {
        r = R_IN + 0.45;
      }
    }
    r = Math.min(r, R_OUT - (u < 0 ? 0.5 : 0.8));
    this.u = u;
    this.x = r * Math.cos(u);
    this.z = r * Math.sin(u);
  }

  look(dx, dy) {
    if (this.flight || this.tour) return;
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.35, 1.35);
  }

  apply() {
    this.rig.position.set(this.x, this.y, this.z);
    this.rig.rotation.y = this.yaw;
    if (!this.inVR) {
      this.camera.position.set(0, EYE, 0);
      this.camera.rotation.set(this.pitch, 0, 0);
    }
  }
}

// Keyboard, mouse and touch, reduced to the few numbers Player.update needs.
export class Input {
  constructor(canvas, player) {
    this.keys = new Set();
    this.stick = new THREE.Vector2();
    this.buttons = { stroll: 0 };
    this.move = new THREE.Vector2();
    this.dragged = false;
    this.enabled = false;
    this.onReset = () => {};

    const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    window.addEventListener('keydown', (e) => {
      if (typing() || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
      // Space walks the ramp; it must not also press whichever button was clicked last.
      if (e.code === 'Space' && this.enabled && document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.enabled) this.onReset();
      if (/^(Arrow|Space|PageUp|PageDown)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Drag to look. A press that never moves is a click, which the interface uses to
    // open a book.
    let active = null, lx = 0, ly = 0, travelled = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (active !== null) return;
      active = e.pointerId;
      lx = e.clientX; ly = e.clientY; travelled = 0;
      this.dragged = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled > 6) this.dragged = true;
      if (this.dragged && this.enabled) {
        const k = e.pointerType === 'touch' ? 0.0042 : 0.0026;
        player.look(dx * k, dy * k);
      }
    });
    const end = (e) => { if (e.pointerId === active) active = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wheel = clamp((this.wheel || 0) - e.deltaY * 0.004, -1.5, 1.5);
    }, { passive: false });
  }

  read(dt) {
    const k = (code) => (this.keys.has(code) ? 1 : 0);
    this.move.set(
      k('KeyD') - k('KeyA') + this.stick.x,
      k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + this.stick.y
    );
    // The scroll wheel gives a short push forward or back that dies away.
    if (this.wheel) {
      this.move.y += this.wheel;
      this.wheel *= Math.exp(-dt * 6);
      if (Math.abs(this.wheel) < 0.02) this.wheel = 0;
    }
    if (this.move.lengthSq() > 1) this.move.normalize();
    return {
      move: this.enabled ? this.move : this.move.set(0, 0),
      turn: this.enabled ? k('ArrowRight') + k('KeyE') - k('ArrowLeft') - k('KeyQ') : 0,
      stroll: this.enabled ? clamp(k('Space') + k('PageUp') - k('KeyC') - k('PageDown') + this.buttons.stroll, -1, 1) : 0,
      fast: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }
}
