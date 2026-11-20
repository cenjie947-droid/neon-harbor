// Neon Harbor — one shared world object, plus the little geometry and
// random helpers every system leans on. Nothing here knows about the
// player, the police or the missions; it only describes the city grid and
// hands out a fresh game context that the other modules fill in.
import * as THREE from 'three';

// The city is a 480 by 480 square, centred on the origin, with roads every
// 60 metres and the sea along the south edge.
export const WORLD = {
  half: 240,
  roadGap: 60,
  roadWidth: 14,
  waterZ: 196,
  sandZ: 168,
};

export function makeGame() {
  return {
    mode: 'title', // title | briefing | playing | paused | mission-complete | busted | wasted | ending
    time: 0,
    paused: false,
    cash: 0,
    wanted: 0, // 0..5
    heatTimer: 0, // seconds spent genuinely unseen while wanted
    player: null,
    cars: [],
    traffic: [],
    peds: [],
    policeCars: [],
    officers: [],
    enemies: [],
    colliders: [], // building footprints {minX, maxX, minZ, maxZ}
    roads: { xs: [], zs: [] },
    markers: {},
    beacons: [],
    input: { keys: new Set(), mouseDX: 0, mouseDY: 0, clicked: false, clickHeld: false },
    cameraYaw: 0.6,
    cameraPitch: 0.32,
    shake: 0,
    missionIndex: 0,
    missionStep: 0,
    missionTimer: 0,
    missionActive: false,
    missionDone: false,
    saveData: null,
    audio: null,
    hud: null,
    fx: null,
    scene: null,
    camera: null,
    renderer: null,
    sun: null,
    stats: { crimes: 0, carsStolen: 0, missionsDone: 0 },
    taxi: { phase: 'none', client: null, fare: 0, dest: null, waitTimer: 0 },
    debug: {},
  };
}

export function clamp(v, low, high) {
  if (v < low) return low;
  if (v > high) return high;
  return v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function rand(low, high) {
  return low + Math.random() * (high - low);
}

export function randInt(low, high) {
  return Math.floor(rand(low, high + 1));
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Shortest-arc interpolation between two headings, so a car turning from
// 350 degrees to 10 degrees swings 20 degrees instead of 340.
export function angleLerp(from, to, t) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}

// Push a circle of radius r out of every building footprint it overlaps.
// Returns the corrected position and whether anything was hit.
export function collideCircle(G, x, z, r) {
  let hit = false;
  for (const box of G.colliders) {
    const nearestX = clamp(x, box.minX, box.maxX);
    const nearestZ = clamp(z, box.minZ, box.maxZ);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      x += dx * push;
      z += dz * push;
    } else {
      // Dead centre inside the box: leave through the closest face.
      const left = x - (box.minX - r);
      const right = box.maxX + r - x;
      const top = z - (box.minZ - r);
      const bottom = box.maxZ + r - z;
      const smallest = Math.min(left, right, top, bottom);
      if (smallest === left) x = box.minX - r;
      else if (smallest === right) x = box.maxX + r;
      else if (smallest === top) z = box.minZ - r;
      else z = box.maxZ + r;
    }
  }
  return { hit, x, z };
}

export function inWorldBounds(x, z) {
  return x > -WORLD.half + 4 && x < WORLD.half - 4 && z > -WORLD.half + 4 && z < WORLD.waterZ - 2;
}

// Slab test: does the segment (x1,z1)-(x2,z2) cross any building? The
// police use it to decide whether they can actually see the player.
export function segmentBlocked(G, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const box of G.colliders) {
    let t0 = 0;
    let t1 = 1;
    let clear = true;
    if (Math.abs(dx) < 1e-9) {
      if (x1 < box.minX || x1 > box.maxX) clear = false;
    } else {
      let a = (box.minX - x1) / dx;
      let b = (box.maxX - x1) / dx;
      if (a > b) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) clear = false;
    }
    if (clear) {
      if (Math.abs(dz) < 1e-9) {
        if (z1 < box.minZ || z1 > box.maxZ) clear = false;
      } else {
        let a = (box.minZ - z1) / dz;
        let b = (box.maxZ - z1) / dz;
        if (a > b) {
          const tmp = a;
          a = b;
          b = tmp;
        }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) clear = false;
      }
    }
    if (clear) return true;
  }
  return false;
}

// True when (x, z) sits on a road surface, i.e. within half a road width
// of any road centre line.
export function onRoad(G, x, z) {
  const half = WORLD.roadWidth / 2;
  for (const rx of G.roads.xs) {
    if (Math.abs(x - rx) < half) return true;
  }
  for (const rz of G.roads.zs) {
    if (Math.abs(z - rz) < half) return true;
  }
  return false;
}

export function makeCanvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
