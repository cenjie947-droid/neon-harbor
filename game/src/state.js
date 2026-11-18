// Neon Harbor — shared game context and small math helpers.
// Every system receives the same `G` object; systems never import each other.
import * as THREE from 'three';

export const WORLD = {
  half: 240,            // city extends -240..240 on x and z
  roadGap: 60,          // distance between road centre lines
  roadWidth: 14,
  waterZ: 196,          // z beyond this is water
  sandZ: 168,           // sand band starts here
};

export function makeGame() {
  const G = {
    mode: 'title',          // title | playing | paused | busted | wasted | ending
    time: 0,
    paused: false,
    cash: 0,
    wanted: 0,              // 0..5 stars
    heatTimer: 0,           // seconds since last crime witnessed
    player: null,           // filled by player.js
    cars: [],               // all drivable cars (traffic + parked + special)
    traffic: [],            // subset: AI traffic cars
    peds: [],               // pedestrians
    policeCars: [],
    officers: [],
    enemies: [],            // armed gang members
    colliders: [],          // {minX,maxX,minZ,maxZ} building AABBs
    roads: { xs: [], zs: [] },
    markers: {},            // named world positions
    beacons: [],            // objective beacon meshes
    input: { keys: new Set(), mouseDX: 0, mouseDY: 0, clicked: false, clickHeld: false },
    cameraYaw: 0.6, cameraPitch: 0.32,
    shake: 0,
    missionIndex: 0,        // 0..4 active, 5 = all done
    missionStep: 0,
    missionTimer: 0,
    missionActive: false,
    missionDone: false,
    saveData: null,
    audio: null, hud: null, fx: null,
    scene: null, camera: null, renderer: null,
    sun: null,
    stats: { crimes: 0, carsStolen: 0, missionsDone: 0 },
    debug: {},
  };
  return G;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function dist2D(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Circle (x,z,r) vs AABB colliders: push the circle out, return true if it hit.
export function collideCircle(G, x, z, r) {
  let hit = false;
  for (const c of G.colliders) {
    const nx = clamp(x, c.minX, c.maxX);
    const nz = clamp(z, c.minZ, c.maxZ);
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push; z += dz * push;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = x - (c.minX - r), pr = (c.maxX + r) - x;
        const pt = z - (c.minZ - r), pb = (c.maxZ + r) - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
  }
  return { hit, x, z };
}

export function inWorldBounds(x, z) {
  return x > -WORLD.half + 4 && x < WORLD.half - 4 && z > -WORLD.half + 4 && z < WORLD.waterZ - 2;
}

// Does any building AABB block the 2D segment (x1,z1)-(x2,z2)? Slab-method
// test against each collider; used for police line of sight.
export function segmentBlocked(G, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  for (const c of G.colliders) {
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) {
      if (x1 < c.minX || x1 > c.maxX) continue;
    } else {
      let a = (c.minX - x1) / dx, b = (c.maxX - x1) / dx;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (z1 < c.minZ || z1 > c.maxZ) continue;
    } else {
      let a = (c.minZ - z1) / dz, b = (c.maxZ - z1) / dz;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

// Is this point on a road (within half a road width of a road centre line)?
export function onRoad(G, x, z) {
  const hw = WORLD.roadWidth / 2;
  for (const rx of G.roads.xs) if (Math.abs(x - rx) < hw) return true;
  for (const rz of G.roads.zs) if (Math.abs(z - rz) < hw) return true;
  return false;
}

export function makeCanvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
