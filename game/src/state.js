// Neon Harbor — the shared bag of state and the small tools everyone uses.
//
// Two jobs live here. First, the single `game` object: one place where
// every system finds the fields it needs, created by makeGame so no
// module ever has to wonder whether a field exists yet. Second, the
// little math and collision helpers the rest of the game leans on —
// clamping a number, rolling a random value, measuring flat distance,
// blending a heading, and testing a circle or a line against the
// building boxes the city registers. The collision rules live here and
// nowhere else, so every system pushes out of walls the same way.

import * as THREE from 'three';

// Fixed measurements for the whole city. The streets run on a 60-metre
// lattice from -180 to 180 on both axes, the buildable world reaches
// out to 240, and the southern edge is a band of sand that gives way
// to water.
export const WORLD = {
  half: 240,
  roadWidth: 10,
  waterZ: 218,
  sandZ: 198,
  gridStep: 60,
  gridMin: -180,
  gridMax: 180,
};

// The centre lines of the road grid, shared by traffic, parked cars,
// police spawns and the minimap. One list serves both axes because
// the grid is square.
const GRID_LINES = [-180, -120, -60, 0, 60, 120, 180];

// One fresh state bag per run. Fields are grouped by who owns them
// and filled in here, so a module never defends against a missing
// field — it just reads and writes. Systems that own a field (the HUD,
// the police, the save slot) swap their null placeholder for a real
// instance while the world is being assembled.
export function makeGame() {
  const g = {};

  // Run state.
  g.mode = 'title';
  g.time = 0;
  g.cash = 0;
  g.wanted = 0;
  g.heatTimer = 0;

  // Story state.
  g.missionIndex = 0;
  g.missionStep = 0;
  g.missionActive = false;
  g.missionDone = false;
  g.missionTimer = 0;

  // Taxi side job.
  g.taxi = { phase: 'none', fare: 0, client: null, dest: null, waitTimer: 8 };

  // Beacon and its current target marker.
  g.beacon = null;
  g.beaconTarget = null;

  // City data, filled in by buildCity.
  g.markers = {};
  g.roads = { xs: GRID_LINES.slice(), zs: GRID_LINES.slice() };
  g.colliders = [];

  // Actors.
  g.cars = [];
  g.traffic = [];
  g.peds = [];
  g.policeCars = [];
  g.officers = [];
  g.enemies = [];

  // Story cars, set by the parked-car spawn.
  g.cometGT = null;
  g.bankVan = null;

  // Lifetime tallies, shown on the ending screen.
  g.stats = { carsStolen: 0, missionsDone: 0, crimes: 0 };

  // Raw input, filled in by the keyboard and mouse handlers.
  g.input = { keys: new Set(), mouseDX: 0, mouseDY: 0 };

  // System instances, wired up by buildWorld.
  g.player = null;
  g.hud = null;
  g.audio = null;
  g.fx = null;
  g.police = null;
  g.combat = null;
  g.missions = null;
  g.save = null;

  // Rendering and scenery handles.
  g.scene = null;
  g.camera = null;
  g.renderer = null;
  g.sun = null;
  g.sea = null;
  g.ferris = null;

  // Frame skipping switches, driven by the main loop.
  g.renderEnabled = true;
  g._render = true;

  return g;
}

// --- small math -----------------------------------------------------------

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// A float in [lo, hi). One helper for every random draw so the
// distribution is the same everywhere and nobody re-implements it
// slightly differently.
export function rand(lo, hi) {
  return lo + (hi - lo) * Math.random();
}

// An integer in [lo, hi], both ends inclusive.
export function randInt(lo, hi) {
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Flat distance on the ground plane. Everything that measures "how
// far" in this game ignores height — the city is flat.
export function dist2D(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Fold a heading difference into (-PI, PI] so a turn always takes the
// short way round.
function foldDelta(d) {
  const full = Math.PI * 2;
  let out = d % full;
  if (out > Math.PI) out -= full;
  if (out < -Math.PI) out += full;
  return out;
}

// Blend from one heading to another along the shortest arc, so a car
// turning from 350 degrees to 10 degrees swings 20 degrees through
// north instead of 340 the long way round. `t` is the fraction of
// the gap.
export function angleLerp(a, b, t) {
  return a + foldDelta(b - a) * clamp(t, 0, 1);
}

export function inWorldBounds(x, z) {
  const h = WORLD.half;
  if (x < -h) return false;
  if (x > h) return false;
  if (z < -h) return false;
  if (z > h) return false;
  return true;
}

// --- collision ------------------------------------------------------------

// A collider is an axis-aligned box on the ground: { x, z, hw, hd }
// where hw/hd are the half extents. The city registers one per
// building, plus a few for landmarks. Nothing else in the game touches
// this list directly — it goes through the two tests below.

// Push a circle out of one box along the axis with the smaller
// overlap. Returns the resolved spot plus whether anything hit.
function shoveOut(box, x, z, r) {
  const dx = x - box.x;
  const dz = z - box.z;
  const overX = box.hw + r - Math.abs(dx);
  if (overX <= 0) return { x, z, hit: false };
  const overZ = box.hd + r - Math.abs(dz);
  if (overZ <= 0) return { x, z, hit: false };
  if (overX < overZ) {
    const side = dx < 0 ? -1 : 1;
    return { x: box.x + side * (box.hw + r), z, hit: true };
  }
  const side = dz < 0 ? -1 : 1;
  return { x, z: box.z + side * (box.hd + r), hit: true };
}

// Push a circle out of every box it overlaps and say whether it hit
// anything. The result is the resolved position, so callers just
// adopt it: `const moved = collideCircle(game, x, z, r); x = moved.x;
// z = moved.z;` A couple of passes settle corners where two boxes
// meet. The world edge counts as a wall too, so nothing can leave
// the map.
export function collideCircle(game, x, z, r) {
  let hit = false;
  let pass = 0;
  while (pass < 2) {
    let i = 0;
    while (i < game.colliders.length) {
      const out = shoveOut(game.colliders[i], x, z, r);
      x = out.x;
      z = out.z;
      if (out.hit) hit = true;
      i++;
    }
    pass++;
  }
  const edge = WORLD.half - r;
  if (x < -edge) { x = -edge; hit = true; }
  if (x > edge) { x = edge; hit = true; }
  if (z < -edge) { z = -edge; hit = true; }
  if (z > edge) { z = edge; hit = true; }
  return { hit, x, z };
}

// Clip the [0, 1] travel interval against one axis of a box. Returns
// null when the line misses the box on this axis entirely.
function clipAxis(start, span, low, high) {
  if (span === 0) {
    if (start < low || start > high) return null;
    return [0, 1];
  }
  let a = (low - start) / span;
  let b = (high - start) / span;
  if (a > b) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  return [a, b];
}

// True when a straight line between two ground points crosses a
// building. Used for police line of sight: a wall between an officer
// and Cole breaks the sight line, which is what makes hiding behind
// a block work. The slab test checks each box exactly instead of
// sampling, so a thin building cannot be stepped over between
// samples.
export function segmentBlocked(game, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let i = 0;
  while (i < game.colliders.length) {
    const box = game.colliders[i];
    let t0 = 0;
    let t1 = 1;
    const xs = clipAxis(x1, dx, box.x - box.hw, box.x + box.hw);
    if (xs === null) { i++; continue; }
    if (xs[0] > t0) t0 = xs[0];
    if (xs[1] < t1) t1 = xs[1];
    if (t0 > t1) { i++; continue; }
    const zs = clipAxis(z1, dz, box.z - box.hd, box.z + box.hd);
    if (zs === null) { i++; continue; }
    if (zs[0] > t0) t0 = zs[0];
    if (zs[1] < t1) t1 = zs[1];
    if (t0 > t1) { i++; continue; }
    return true;
  }
  return false;
}

// A tiny vector helper for callers that want a THREE.Vector3 without
// importing three themselves. Kept here because the state module is
// the one place every system already imports.
export function vec3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}
