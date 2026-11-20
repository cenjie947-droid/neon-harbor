// Neon Harbor — shared state and the small tools every system uses.
//
// This file owns two things: the `game` object that every module reads and
// writes (one bag of state, created by makeGame, so nothing has to guess
// which fields exist), and the handful of helpers the rest of the game
// leans on — clamping, random picks, 2D distance, angle blending, and the
// collision tests against the city's building boxes. The city module fills
// in the colliders and the named places; this file only knows how to test
// against them, so the collision rules live in exactly one place.

import * as THREE from 'three';

// The city's fixed measurements. The road grid is a 60 m lattice from
// -180 to 180 on both axes, the buildable world runs to 240, and the shore
// is a band at the south edge: sand from sandZ out to the water at waterZ.
export const WORLD = {
  half: 240,
  roadWidth: 10,
  waterZ: 218,
  sandZ: 198,
  gridStep: 60,
  gridMin: -180,
  gridMax: 180,
};

// The road centre lines, shared by traffic, parked cars, police spawns and
// the minimap. One array serves both axes because the grid is square.
const GRID_LINES = [-180, -120, -60, 0, 60, 120, 180];

// One fresh state bag per run. Everything a system touches is initialised
// here, so a module never has to defend against a missing field — it just
// reads and writes. Systems that own a field (the HUD, the police, the
// save slot) replace the null placeholder with their own instance during
// world assembly.
export function makeGame() {
  return {
    // Run state.
    mode: 'title',
    time: 0,
    cash: 0,
    wanted: 0,
    heatTimer: 0,
    // Story state.
    missionIndex: 0,
    missionStep: 0,
    missionActive: false,
    missionDone: false,
    missionTimer: 0,
    // Taxi side job.
    taxi: { phase: 'none', fare: 0, client: null, dest: null, waitTimer: 8 },
    // Beacon and its current target marker.
    beacon: null,
    beaconTarget: null,
    // City data, filled in by buildCity.
    markers: {},
    roads: { xs: [...GRID_LINES], zs: [...GRID_LINES] },
    colliders: [],
    // Actors.
    cars: [],
    traffic: [],
    peds: [],
    policeCars: [],
    officers: [],
    enemies: [],
    // Story cars, set by the parked-car spawn.
    cometGT: null,
    bankVan: null,
    // Lifetime tallies, shown on the ending screen.
    stats: { carsStolen: 0, missionsDone: 0, crimes: 0 },
    // Raw input, filled in by the keyboard and mouse handlers.
    input: { keys: new Set(), mouseDX: 0, mouseDY: 0 },
    // System instances, wired up by buildWorld.
    player: null,
    hud: null,
    audio: null,
    fx: null,
    police: null,
    combat: null,
    missions: null,
    save: null,
    // Rendering and scenery handles.
    scene: null,
    camera: null,
    renderer: null,
    sun: null,
    sea: null,
    ferris: null,
    // Frame skipping switches, driven by the main loop.
    renderEnabled: true,
    _render: true,
  };
}

// --- small math -----------------------------------------------------------

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// A float in [lo, hi). One helper for every random draw so the distribution
// is the same everywhere and nobody re-implements it slightly differently.
export function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

// An integer in [lo, hi], both ends inclusive.
export function randInt(lo, hi) {
  return Math.floor(rand(lo, hi + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Flat distance on the ground plane. Everything that measures "how far"
// in this game ignores height — the city is flat.
export function dist2D(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Blend from one heading to another along the shortest arc, so a car
// turning from 350 degrees to 10 degrees swings 20 degrees through north
// instead of 340 the long way round. `t` is the fraction of the gap.
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

export function inWorldBounds(x, z) {
  const h = WORLD.half;
  return x >= -h && x <= h && z >= -h && z <= h;
}

// --- collision ------------------------------------------------------------

// A collider is an axis-aligned box on the ground: { x, z, hw, hd } where
// hw/hd are the half extents. The city registers one per building, plus a
// few for landmarks. Nothing else in the game touches this list directly —
// it goes through the two tests below.

// Push a circle out of every box it overlaps and say whether it hit
// anything. The result is the resolved position, so callers just adopt it:
// `const moved = collideCircle(game, x, z, r); x = moved.x; z = moved.z;`
// A couple of passes settle corners where two boxes meet. The world edge
// counts as a wall too, so nothing can leave the map.
export function collideCircle(game, x, z, r) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const box of game.colliders) {
      const dx = x - box.x;
      const dz = z - box.z;
      const ox = box.hw + r - Math.abs(dx);
      if (ox <= 0) continue;
      const oz = box.hd + r - Math.abs(dz);
      if (oz <= 0) continue;
      hit = true;
      if (ox < oz) x = box.x + (dx < 0 ? -1 : 1) * (box.hw + r);
      else z = box.z + (dz < 0 ? -1 : 1) * (box.hd + r);
    }
  }
  const edge = WORLD.half - r;
  if (x < -edge) { x = -edge; hit = true; }
  if (x > edge) { x = edge; hit = true; }
  if (z < -edge) { z = -edge; hit = true; }
  if (z > edge) { z = edge; hit = true; }
  return { hit, x, z };
}

// True when a straight line between two ground points crosses a building.
// Used for police line of sight: a wall between an officer and Cole breaks
// the sight line, which is what makes hiding behind a block work. The slab
// test checks each box exactly instead of sampling, so a thin building
// cannot be stepped over between samples.
export function segmentBlocked(game, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const box of game.colliders) {
    let t0 = 0;
    let t1 = 1;
    // X slab.
    if (dx === 0) {
      if (x1 < box.x - box.hw || x1 > box.x + box.hw) continue;
    } else {
      let a = (box.x - box.hw - x1) / dx;
      let b = (box.x + box.hw - x1) / dx;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    // Z slab.
    if (dz === 0) {
      if (z1 < box.z - box.hd || z1 > box.z + box.hd) continue;
    } else {
      let a = (box.z - box.hd - z1) / dz;
      let b = (box.z + box.hd - z1) / dz;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

// A tiny vector helper for callers that want a THREE.Vector3 without
// importing three themselves. Kept here because the state module is the
// one place every system already imports.
export function vec3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}
