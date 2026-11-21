// Neon Harbor — shared world state and helpers.
//
// One plain object (`makeGame()`) holds everything the modules pass
// around, so no module keeps hidden global state. Geometry helpers live
// here too: collision against the city's axis-aligned building boxes and
// line-of-sight checks the police use to decide whether they can see Cole.
import * as THREE from 'three';

export const WORLD = {
  half: 240,
  roadWidth: 10,
  waterZ: 218,
  sandZ: 198,
  gridStep: 60,
  gridMin: -180,
  gridMax: 180,
};

// Road centre-lines. The city grid, the traffic and the mission driving
// all agree on these lines.
export const GRID_LINES = [];
for (let v = WORLD.gridMin; v <= WORLD.gridMax; v += WORLD.gridStep) {
  GRID_LINES.push(v);
}

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

// Shortest-arc interpolation between two headings (radians).
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

export function inWorldBounds(x, z) {
  return Math.abs(x) <= WORLD.half && Math.abs(z) <= WORLD.half;
}

export function vec3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

// Circle vs the city's building boxes. Returns a RESOLVED position: the
// point slid out of any box it overlapped, plus whether anything was hit.
// Callers test `.hit` and use `.x` / `.z` — never a bare boolean.
export function collideCircle(game, x, z, r) {
  let hit = false;
  for (const c of game.colliders) {
    const dx = x - c.x;
    const dz = z - c.z;
    const px = c.hw + r - Math.abs(dx);
    if (px <= 0) continue;
    const pz = c.hd + r - Math.abs(dz);
    if (pz <= 0) continue;
    hit = true;
    if (px < pz) x = c.x + (dx >= 0 ? 1 : -1) * (c.hw + r);
    else z = c.z + (dz >= 0 ? 1 : -1) * (c.hd + r);
  }
  return { hit, x, z };
}

// True when any building box sits between the two ground points.
// Sampled every ~2 m so a thin wall still blocks the sightline.
export function segmentBlocked(game, x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(1, Math.ceil(d / 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    for (const c of game.colliders) {
      if (Math.abs(x - c.x) < c.hw + 0.5 && Math.abs(z - c.z) < c.hd + 0.5) {
        return true;
      }
    }
  }
  return false;
}

// Fresh per-run game state. The main entry fills in scene / camera /
// renderer and the subsystem objects (player, audio, fx, hud, police,
// combat, missions, save) after creating this.
export function makeGame() {
  return {
    mode: 'title',
    time: 0,
    cash: 0,
    wanted: 0,
    heatTimer: 0,

    missionIndex: 0,
    missionStep: 0,
    missionActive: false,
    missionDone: false,
    missionTimer: 0,

    taxi: { phase: 'none', fare: 0, client: null, dest: null, waitTimer: 8 },
    beacon: null,
    beaconTarget: null,

    markers: {},
    roads: { xs: [...GRID_LINES], zs: [...GRID_LINES] },
    colliders: [],

    cars: [],
    traffic: [],
    peds: [],
    policeCars: [],
    officers: [],
    enemies: [],
    cometGT: null,
    bankVan: null,

    stats: { carsStolen: 0, missionsDone: 0, crimes: 0 },

    input: { keys: new Set(), mouseDX: 0, mouseDY: 0 },

    player: null,
    hud: null,
    audio: null,
    fx: null,
    police: null,
    combat: null,
    missions: null,
    save: null,

    scene: null,
    camera: null,
    renderer: null,
    sun: null,
    sea: null,
    ferris: null,

    renderEnabled: true,
    _render: true,
  };
}
