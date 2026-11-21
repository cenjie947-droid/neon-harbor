// Neon Harbor — shared world state and geometry helpers.
// One place owns the numbers every module reads: the world size, the road
// grid, the live game object, and the small math routines used for
// collision, steering and distance checks.

import * as THREE from 'three';

// World dimensions, in metres. The playable city is a square; the beach
// and sea sit on its southern edge.
export const WORLD = {
  half: 240,
  roadWidth: 10,
  waterZ: 218,
  sandZ: 198,
  gridStep: 60,
  gridMin: -180,
  gridMax: 180,
};

// Road centre-lines. The city is a regular grid, so the X roads and the Z
// roads share the same line positions.
const GRID_LINES = [];
for (let v = WORLD.gridMin; v <= WORLD.gridMax; v += WORLD.gridStep) {
  GRID_LINES.push(v);
}

// Build a fresh game object. Main fills in the three.js pieces (scene,
// camera, renderer, sun, sea, ferris) and the subsystem handles
// (player, hud, audio, fx, police, combat, missions, save) once they
// exist; until then they stay null so nothing reads a half-built system.
export function makeGame() {
  const g = {
    // Run state.
    mode: 'title',
    time: 0,
    cash: 0,
    wanted: 0,
    heatTimer: 0,

    // Story progress.
    missionIndex: 0,
    missionStep: 0,
    missionActive: false,
    missionDone: false,
    missionTimer: 0,

    // Taxi side job (free roam).
    taxi: { phase: 'none', fare: 0, client: null, dest: null, waitTimer: 8 },

    // Navigation aids.
    beacon: null,
    beaconTarget: null,

    // City data, filled in by city.js.
    markers: {},
    roads: { xs: [...GRID_LINES], zs: [...GRID_LINES] },
    colliders: [],

    // Live entities.
    cars: [],
    traffic: [],
    peds: [],
    policeCars: [],
    officers: [],
    enemies: [],
    cometGT: null,
    bankVan: null,

    // Lifetime totals shown on the ending screen.
    stats: { carsStolen: 0, missionsDone: 0, crimes: 0 },

    // Input state, fed by main's listeners.
    input: { keys: new Set(), mouseDX: 0, mouseDY: 0 },

    // Subsystem handles, attached by main after construction.
    player: null,
    hud: null,
    audio: null,
    fx: null,
    police: null,
    combat: null,
    missions: null,
    save: null,

    // Three.js handles, attached by main.
    scene: null,
    camera: null,
    renderer: null,
    sun: null,
    sea: null,
    ferris: null,

    // Rendering switch used by the headless test driver.
    renderEnabled: true,
    _render: true,
  };
  return g;
}

// --- small math helpers -------------------------------------------------

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

export function randInt(lo, hi) {
  return Math.floor(rand(lo, hi + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function dist2D(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Shortest-arc interpolation between two headings.
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

export function inWorldBounds(x, z) {
  const h = WORLD.half;
  return x >= -h && x <= h && z >= -h && z <= h;
}

export function vec3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

// --- collision ----------------------------------------------------------

// Resolve a circle (centre x,z, radius r) against every box collider.
// Returns { hit, x, z }: hit is true when any collider pushed the circle,
// and x/z are the resolved centre — slid out of the box along the axis of
// smallest penetration. Callers test .hit and use .x/.z as the new
// position; the return is a resolved position, never a plain boolean.
export function collideCircle(game, x, z, r) {
  let hit = false;
  let px = x;
  let pz = z;
  for (const c of game.colliders) {
    const hw = c.hw || 0;
    const hd = c.hd || 0;
    const dx = px - c.x;
    const dz = pz - c.z;
    const ox = hw + r - Math.abs(dx);
    const oz = hd + r - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    hit = true;
    if (ox < oz) {
      px = c.x + (dx >= 0 ? hw + r : -(hw + r));
    } else {
      pz = c.z + (dz >= 0 ? hd + r : -(hd + r));
    }
  }
  // Keep the circle inside the playable square too.
  const h = WORLD.half - r;
  if (px < -h) { px = -h; hit = true; }
  if (px > h) { px = h; hit = true; }
  if (pz < -h) { pz = -h; hit = true; }
  if (pz > h) { pz = h; hit = true; }
  return { hit, x: px, z: pz };
}

// True when the straight segment from (x1,z1) to (x2,z2) crosses any
// box collider (with a small clearance margin), used for police and
// pedestrian line-of-sight checks.
export function segmentBlocked(game, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const c of game.colliders) {
    const hw = (c.hw || 0) + 0.5;
    const hd = (c.hd || 0) + 0.5;
    // Slab test against the box.
    let tmin = 0;
    let tmax = 1;
    let ok = true;
    const axes = [
      { d: dx, p: x1 - c.x, half: hw },
      { d: dz, p: z1 - c.z, half: hd },
    ];
    for (const ax of axes) {
      if (Math.abs(ax.d) < 1e-9) {
        if (Math.abs(ax.p) > ax.half) { ok = false; break; }
      } else {
        let t0 = (-ax.half - ax.p) / ax.d;
        let t1 = (ax.half - ax.p) / ax.d;
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
        if (tmin > tmax) { ok = false; break; }
        if (t0 > tmin) tmin = t0;
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin <= tmax && tmax >= 0 && tmin <= 1) return true;
  }
  return false;
}
