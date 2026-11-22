// Neon Harbor — city builder (round 6 fresh rewrite).
// Builds the whole procedural coastal city into the scene and owns the
// collision data every other system queries: the road grid, the building
// colliders, and the two helpers (circle test + segment test).
//
// Layout rules (these fix real bugs — do not "simplify" them away):
//  - Roads are 12 m corridors centred on grid lines spaced 60 m apart.
//  - No building collider may touch a road corridor.
//  - Landmark buildings stand NORTH-EAST of their markers, except the
//    warehouse, which stands WEST (the docks occupy its north-east block).
//  - Houses skip landmark footprints and stay clear of the docks marker,
//    which sits on open ground and must be reachable within 9 m.
//  - Showroom lot cars face heading 0 (see SHOWROOM_LOTS).

export const ROAD_LINES = [-180, -120, -60, 0, 60, 120, 180];
export const ROAD_HALF = 6; // half the 12 m corridor width
export const WORLD_EDGE = 260; // ground plane half-size

// Race start line: on the harbour straight (the z = 180 road), between
// the x = 0 and x = 60 intersections, facing east along the road.
export const RACE_PAD = { x: 30, z: 180, heading: Math.PI / 2 };
// Pay N Spray pad centre: a few metres north-east of the spray marker so
// a car parked on the marker is visibly on the yellow pad.
export const SPRAY_PAD = { x: 124, z: 56 };
// Showroom lot: five display bays south of the showroom, all heading 0.
export const SHOWROOM_LOTS = [
  { x: 162, z: 44, heading: 0 },
  { x: 162, z: 52, heading: 0 },
  { x: 162, z: 60, heading: 0 },
  { x: 162, z: 68, heading: 0 },
  { x: 162, z: 76, heading: 0 },
];

// Small deterministic RNG so the city is identical every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Nearest grid line to a coordinate.
function nearestLine(v) {
  let best = ROAD_LINES[0];
  for (const line of ROAD_LINES) {
    if (Math.abs(line - v) < Math.abs(best - v)) best = line;
  }
  return best;
}

// Clamp a box centre so the whole box stays inside its block with at
// least ROAD_HALF + 1 m of clearance from every road corridor. If the box
// is too wide for the block it is shrunk to fit.
function fitInBlock(cx, cz, hw, hd) {
  const fitAxis = (c, half) => {
    const line = nearestLine(c);
    // Block runs from (line - 60 + ROAD_HALF + 1) to (line + 60 - ROAD_HALF - 1)
    // on the side the centre sits; simpler: clamp between the two lines
    // bracketing the centre, each pushed in by corridor + margin.
    let lo = -WORLD_EDGE, hi = WORLD_EDGE;
    for (let i = 0; i < ROAD_LINES.length - 1; i++) {
      if (c >= ROAD_LINES[i] && c <= ROAD_LINES[i + 1]) {
        lo = ROAD_LINES[i] + ROAD_HALF + 1;
        hi = ROAD_LINES[i + 1] - ROAD_HALF - 1;
        break;
      }
    }
    if (c < ROAD_LINES[0]) { lo = -WORLD_EDGE; hi = ROAD_LINES[0] - ROAD_HALF - 1; }
    if (c > ROAD_LINES[ROAD_LINES.length - 1]) { lo = ROAD_LINES[ROAD_LINES.length - 1] + ROAD_HALF + 1; hi = WORLD_EDGE; }
    const maxHalf = Math.max(2, (hi - lo) / 2 - 0.5);
    const h = Math.min(half, maxHalf);
    const mid = (lo + hi) / 2;
    return { centre: clamp(c, lo + h, hi - h) || mid, half: h };
  };
  const fx = fitAxis(cx, hw);
  const fz = fitAxis(cz, hd);
  return { x: fx.centre, z: fz.centre, hw: fx.half, hd: fz.half };
}

export function buildCity(G, THREE, scene) {
  const colliders = [];
  G.colliders = colliders;
  const rand = mulberry32(20261122);
  const palette = [0x8a7f70, 0x7d8aa0, 0xa08a7d, 0x6f7d6a, 0x9a8f7a, 0x7a6f8a, 0xb09a80];
  const roofPalette = [0x5a4a3a, 0x3a4a5a, 0x6a3a3a, 0x4a5a3a, 0x555555];

  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
    }
    return matCache.get(key);
  }
  function box(w, h, d, color, x, y, z, parent = scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function addCollider(x, z, hw, hd) {
    colliders.push({ x, z, hw, hd });
    return colliders[colliders.length - 1];
  }

  // --- ground, beach, water ---------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_EDGE * 2, WORLD_EDGE * 2),
    mat(0x9aa78a)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sand strip along the south shore, then water beyond it.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(520, 34), mat(0xdcc493));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, 212);
  scene.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(520, 60), mat(0x3f8fbf));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.01, 252);
  scene.add(water);

  // --- roads ---------------------------------------------------------------
  for (const line of ROAD_LINES) {
    for (const horizontal of [true, false]) {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? 520 : ROAD_HALF * 2, horizontal ? ROAD_HALF * 2 : 520),
        mat(0x3c3f45)
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(horizontal ? 0 : line, 0.03, horizontal ? line : 0);
      scene.add(strip);
      // Dashed centre line.
      for (let t = -240; t <= 240; t += 16) {
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(horizontal ? 7 : 0.5, horizontal ? 0.5 : 7),
          mat(0xd8d8c8)
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horizontal ? t : line, 0.04, horizontal ? line : t);
        scene.add(dash);
      }
    }
  }

  // --- helpers -------------------------------------------------------------
  function building(x, z, w, h, d, color, roofColor) {
    const fit = fitInBlock(x, z, w / 2, d / 2);
    const body = box(fit.hw * 2, h, fit.hd * 2, color, fit.x, h / 2, fit.z);
    body.castShadow = true;
    box(fit.hw * 2 + 0.6, 0.5, fit.hd * 2 + 0.6, roofColor, fit.x, h + 0.25, fit.z);
    // Window bands on the south face so buildings read as buildings.
    const band = box(fit.hw * 2 - 2, 1.1, 0.15, 0x2a3542, fit.x, h * 0.62, fit.z + fit.hd + 0.08);
    band.material = mat(0x2a3542, { emissive: 0x223344 });
    addCollider(fit.x, fit.z, fit.hw, fit.hd);
    return { x: fit.x, z: fit.z, hw: fit.hw, hd: fit.hd };
  }

  const reserved = []; // landmark footprints houses must skip
  function overlapsReserved(x, z, hw, hd, pad = 4) {
    for (const r of reserved) {
      if (Math.abs(x - r.x) < hw + r.hw + pad && Math.abs(z - r.z) < hd + r.hd + pad) return true;
    }
    return false;
  }

  // --- landmarks -----------------------------------------------------------
  // Offset north-east of the marker (+x, -z); the warehouse goes west.
  const landmarkDefs = [
    { key: 'bank', w: 20, h: 14, d: 16, color: 0xb8a888, roof: 0x5a4a3a },
    { key: 'garage', w: 22, h: 9, d: 16, color: 0x8a7f70, roof: 0x3a4a5a },
    { key: 'hideout', w: 16, h: 11, d: 14, color: 0x7d8aa0, roof: 0x555555 },
    { key: 'hospital', w: 24, h: 16, d: 18, color: 0xd8d8d0, roof: 0x6a3a3a },
    { key: 'paintShop', w: 20, h: 10, d: 16, color: 0xa08a7d, roof: 0x4a5a3a },
    { key: 'showroom', w: 26, h: 12, d: 18, color: 0x9fb4c8, roof: 0x3a4a5a },
    { key: 'spray', w: 18, h: 8, d: 14, color: 0x7a6f8a, roof: 0x5a4a3a },
    { key: 'warehouse', w: 26, h: 12, d: 20, color: 0x8a8078, roof: 0x555555 },
  ];
  for (const def of landmarkDefs) {
    const m = G.markers[def.key];
    const dx = def.key === 'warehouse' ? -16 : 16;
    const dz = def.key === 'warehouse' ? 0 : -16;
    const placed = building(m.x + dx, m.z + dz, def.w, def.h, def.d, def.color, def.roof);
    reserved.push(placed);
  }

  // Pay N Spray: yellow pad + awning kiosk at the spray pad.
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(11, 9), mat(0xe8c832));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(SPRAY_PAD.x, 0.05, SPRAY_PAD.z);
  scene.add(pad);
  box(6, 0.4, 3, 0x2a6ab0, SPRAY_PAD.x + 6, 3.4, SPRAY_PAD.z - 5);
  box(0.4, 3.4, 0.4, 0x888888, SPRAY_PAD.x + 3.4, 1.7, SPRAY_PAD.z - 5);
  box(0.4, 3.4, 0.4, 0x888888, SPRAY_PAD.x + 8.6, 1.7, SPRAY_PAD.z - 5);

  // Race start line: checkered pad across the harbour straight.
  const checker = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 2; j++) {
      const sq = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 1.4),
        mat((i + j) % 2 === 0 ? 0x111111 : 0xffffff)
      );
      sq.rotation.x = -Math.PI / 2;
      sq.position.set((i - 3.5) * 1.4, 0.05, (j - 0.5) * 1.4);
      checker.add(sq);
    }
  }
  checker.position.set(RACE_PAD.x, 0, RACE_PAD.z);
  scene.add(checker);

  // --- houses ---------------------------------------------------------------
  // One or two houses per downtown block; skip the beach row, landmark
  // footprints, and a 12 m keep-out around the docks marker.
  for (let ix = 0; ix < ROAD_LINES.length - 1; ix++) {
    for (let iz = 0; iz < ROAD_LINES.length - 1; iz++) {
      const x0 = ROAD_LINES[ix] + ROAD_HALF + 1;
      const x1 = ROAD_LINES[ix + 1] - ROAD_HALF - 1;
      const z0 = ROAD_LINES[iz] + ROAD_HALF + 1;
      const z1 = ROAD_LINES[iz + 1] - ROAD_HALF - 1;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (cz > 175) continue; // beach / harbour row, no houses
      const count = rand() < 0.55 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const w = 12 + rand() * 8;
        const d = 10 + rand() * 7;
        const h = 7 + rand() * 9;
        const hx = count === 1 ? cx : (n === 0 ? x0 + w / 2 + 3 : x1 - w / 2 - 3);
        const hz = cz + (rand() - 0.5) * 8;
        if (overlapsReserved(hx, hz, w / 2, d / 2)) continue;
        if (Math.hypot(hx - G.markers.docks.x, hz - G.markers.docks.z) < 14) continue;
        const color = palette[Math.floor(rand() * palette.length)];
        const roof = roofPalette[Math.floor(rand() * roofPalette.length)];
        building(hx, hz, w, h, d, color, roof);
      }
    }
  }

  // --- docks ----------------------------------------------------------------
  // Crates and a crane near the docks, kept clear of the marker itself.
  for (const [cx, cz, s] of [[-168, 96, 3], [-164, 100, 2.4], [-168, 128, 3.4], [-162, 132, 2.2]]) {
    box(s, s, s, 0x9a7a4a, cx, s / 2, cz).castShadow = true;
    addCollider(cx, cz, s / 2, s / 2);
  }
  box(1.2, 22, 1.2, 0xd8a832, -172, 11, 104);
  box(10, 1.2, 1.2, 0xd8a832, -168, 21, 104);

  // --- pier + ferris wheel ---------------------------------------------------
  const pier = new THREE.Group();
  for (let z = 204; z <= 246; z += 3) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 2.8), mat(0x8a6a42));
    plank.position.set(-30, 0.6, z);
    pier.add(plank);
  }
  for (const px of [-32.6, -27.4]) {
    for (let z = 208; z <= 244; z += 9) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), mat(0x6a4a2a));
      post.position.set(px, 0, z);
      pier.add(post);
    }
  }
  scene.add(pier);

  const wheel = new THREE.Group();
  wheel.position.set(60, 14, 212);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(12, 0.5, 8, 28), mat(0xd84a6a));
  wheel.add(rim);
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.4, 24, 0.4), mat(0xd8d8d8));
    spoke.rotation.z = (i / 8) * Math.PI;
    wheel.add(spoke);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), mat(0x3fa8d8));
    cabin.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 0);
    wheel.add(cabin);
  }
  scene.add(wheel);
  box(2, 14, 2, 0x888888, 60, 7, 212);
  addCollider(60, 212, 2, 2);

  // --- street props ------------------------------------------------------------
  for (let i = 0; i < 60; i++) {
    const line = ROAD_LINES[Math.floor(rand() * ROAD_LINES.length)];
    const along = -240 + rand() * 480;
    const side = rand() < 0.5 ? -1 : 1;
    const lx = line + side * 8.5;
    const lz = along;
    if (Math.abs(lz) > 200) continue;
    box(0.25, 5, 0.25, 0x666666, lx, 2.5, lz);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat(0xffe8a0, { emissive: 0xaa8833 }));
    lamp.position.set(lx, 5.1, lz);
    scene.add(lamp);
  }
  for (let i = 0; i < 40; i++) {
    const tx = -200 + rand() * 400;
    const tz = -200 + rand() * 380;
    if (hitsBuilding(tx, tz, 2)) continue;
    if (Math.hypot(tx - G.markers.docks.x, tz - G.markers.docks.z) < 12) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), mat(0x6a4a2a));
    trunk.position.set(tx, 1.2, tz);
    scene.add(trunk);
    const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), mat(0x4a7a3a));
    top.position.set(tx, 3.6, tz);
    scene.add(top);
  }

  // --- collision API -----------------------------------------------------------
  function hitsBuilding(x, z, r = 0) {
    for (const c of colliders) {
      const nx = clamp(x, c.x - c.hw, c.x + c.hw);
      const nz = clamp(z, c.z - c.hd, c.z + c.hd);
      const dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz < r * r) return c;
    }
    return null;
  }

  // Slab test: does the segment (x1,z1)-(x2,z2) touch any building box?
  function segmentBlocked(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    for (const c of colliders) {
      let t0 = 0, t1 = 1;
      let blocked = true;
      for (const [p, d, lo, hi] of [[x1, dx, c.x - c.hw, c.x + c.hw], [z1, dz, c.z - c.hd, c.z + c.hd]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) { blocked = false; break; }
        } else {
          let a = (lo - p) / d, b = (hi - p) / d;
          if (a > b) { const tmp = a; a = b; b = tmp; }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) { blocked = false; break; }
        }
      }
      if (blocked) return c;
    }
    return null;
  }

  function isOnRoad(x, z) {
    for (const line of ROAD_LINES) {
      if (Math.abs(x - line) <= ROAD_HALF || Math.abs(z - line) <= ROAD_HALF) return true;
    }
    return false;
  }

  // Spiral search for a spot clear of buildings (used for safe spawns).
  function clearSpot(x, z, r) {
    if (!hitsBuilding(x, z, r)) return { x, z };
    for (let ring = 1; ring <= 12; ring++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const px = x + Math.cos(ang) * ring * 3;
        const pz = z + Math.sin(ang) * ring * 3;
        if (!hitsBuilding(px, pz, r)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  const api = {
    ROAD_LINES,
    ROAD_HALF,
    RACE_PAD,
    SPRAY_PAD,
    SHOWROOM_LOTS,
    colliders,
    hitsBuilding,
    segmentBlocked,
    isOnRoad,
    clearSpot,
    update(dt) {
      wheel.rotation.z += dt * 0.25;
    },
  };
  G.city = api;
  return api;
}

export default buildCity;
