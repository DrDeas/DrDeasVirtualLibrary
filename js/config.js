// Dimensions of the library and the maths of its spiral.
//
// The building is a round tower. A ramp winds up the inside of its wall; the wall is
// divided into bays of 15 books (5 across, 3 high) in reading order, so walking up the
// ramp is walking forward through the reading log. The tower is sized for the full
// challenge of 1,000 books, and the bays beyond the latest book stand empty.
//
// A point on the ramp is described by `u`, the angle travelled around the tower in
// radians since the first bay (so u keeps growing past 2π on the second turn), and
// `r`, the distance from the tower's axis. World position is (r cos u, y, r sin u).

export const CHALLENGE = {
  books: 1000,
  weeks: 1000,
  start: new Date(2020, 8, 27),
  end: new Date(2039, 10, 26),
};

export const R_OUT = 10.5; // inner face of the tower wall
export const RAMP_W = 3.0;
export const R_IN = R_OUT - RAMP_W; // edge of the ramp, where the balustrade stands
export const PITCH = 4.4; // height gained per full turn
export const SLAB = 0.35; // ramp thickness

export const BAYS_PER_TURN = 22;
export const BAY = (Math.PI * 2) / BAYS_PER_TURN;
export const COLS = 5;
export const ROWS = 3;
export const PER_BAY = COLS * ROWS;

export const BOOK_W = 0.44;
export const BOOK_H = (BOOK_W * 1000) / 664;
export const BOOK_D = 0.035;
export const ROW_PITCH = 0.8;
export const SHELF_BASE = 0.5; // lowest shelf above the ramp
export const SHELF_DEPTH = 0.24;
export const PILASTER_W = 0.42;

export const LANDING = 0.8; // flat entrance landing, in radians before the first bay
export const TOP_LANDING = 0.9;

export const POOL_R = 4.0;
export const EYE = 1.65;

export const TAU = Math.PI * 2;

export function layoutFor(bookCount) {
  const slots = Math.max(CHALLENGE.books, bookCount);
  const bays = Math.ceil(slots / PER_BAY);
  const uTop = bays * BAY;
  const topY = (PITCH * uTop) / TAU;
  const wallTop = topY + 4.8;
  return { bays, slots: bays * PER_BAY, uTop, uEnd: uTop + TOP_LANDING, topY, wallTop };
}

// Height of the ramp surface at u.
export function rampY(u, layout) {
  return (PITCH * Math.min(Math.max(u, 0), layout.uTop)) / TAU;
}

export function polar(r, u, y, target) {
  return target.set(r * Math.cos(u), y, r * Math.sin(u));
}

// Where a book sits. `slot` counts from 0 in reading order.
export function slotPlacement(slot, layout) {
  const bay = Math.floor(slot / PER_BAY);
  const k = slot % PER_BAY;
  const row = Math.floor(k / COLS); // 0 is the top shelf
  const col = k % COLS;
  const pilaster = PILASTER_W / R_OUT;
  const span = BAY - pilaster;
  const u = bay * BAY + pilaster / 2 + ((col + 0.5) / COLS) * span;
  const base = bayBaseY(bay, layout);
  const y = base + (ROWS - 1 - row) * ROW_PITCH + BOOK_H / 2 + 0.012;
  return { bay, row, col, u, y, r: R_OUT - 0.11 };
}

// Height of a bay's lowest shelf.
export function bayBaseY(bay, layout) {
  return rampY((bay + 0.5) * BAY, layout) + SHELF_BASE;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// Wraps an angle into (-π, π].
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
