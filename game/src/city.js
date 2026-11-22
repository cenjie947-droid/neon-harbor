// Neon Harbor — the procedural sun-soaked coastal city.
//
// One build pass lays out the whole map: tall downtown towers around
// the centre, dockside warehouses and cranes to the west and south,
// quiet residential blocks to the north and east, and a harbour/beach
// strip along the south edge with a pier and a ferris wheel. Everything
// is built from plain boxes, cylinders and planes in bright daylight —
// no textures, no dark moody lighting.
//
// The build also writes the gameplay data other modules rely on:
// game.markers (the ten named places), game.roads (the grid lines) and
// game.colliders (axis-aligned building boxes the player, cars, camera
// and pedestrians slide around). Markers always sit on open ground or
// road, never inside a building footprint, so the driver can reach them.

import * as THREE from 'three';
import { WORLD, rand, randInt, pick } from './state.js';

// Road centre-lines, derived from the shared world grid.
const GRID = [];
for (let v = WORLD.gridMin; v <= WORLD.gridMax; v += WORLD.gridStep) GRID.push(v);

// Block centres sit halfway between neighbouring road lines.
const BLOCKS = [];
for (let i = 0; i < GRID.length - 1; i++) BLOCKS.push((GRID[i] + GRID[i + 1]) / 2);

const PALETTES = {
  downtown: [0x8fa8c8, 0x9fb4d8, 0x7e9cc0, 0xb8c4d4, 0x6f8fb8, 0xa8b8cc],
  residential: [0xe8c8a0, 0xd8b890, 0xc8a878, 0xe0d0b8, 0xf0dcc0, 0xd0a080],
  warehouse: [0x9aa0a8, 0x8a8f96, 0xb0a89a, 0x7a7f86],
};

function makeBox(w, h, d, color, x, y, z, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  return mesh;
}

// A thin ground slab (sidewalk, pad, boardwalk) lying on the terrain.
function makeSlab(w, d, color, x, z, y = 0.02) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.05, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

// Register a building: add the mesh, record its footprint for
// collision, cap the roof in a lighter tone, and add lit window strips
// on the street-facing side of tall blocks.
function addBuilding(game, group, cx, cz, w, h, d, color, opts = {}) {
  const body = makeBox(w, h, d, color, cx, h / 2, cz, opts);
  group.add(body);
  game.colliders.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
  const cap = makeBox(w * 0.92, 0.6, d * 0.92, 0xf8f4ec, cx, h + 0.3, cz, { shadow: false });
  group.add(cap);
  if (h > 12) {
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x2a4a6a, roughness: 0.3, metalness: 0.4,
      emissive: 0x88bbff, emissiveIntensity: 0.25,
    });
    const rows = Math.min(6, Math.floor(h / 6));
    for (let r = 0; r < rows; r++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.1, 0.2), winMat);
      strip.position.set(cx, 4 + r * 5, cz + d / 2 + 0.1);
      group.add(strip);
    }
  }
  return body;
}

// Named places: [key, marker x, marker z, building w, h, d, color, sign, side?].
// One table drives both the shopfronts below and the house generator's
// keep-out check, so the two can never disagree about a footprint.
// side 'E' (default) puts the building east of its marker; the
// warehouse goes 'W' — the docks occupy its north-east block.
const LANDMARK_DEFS = [
  ['bank', -60, -60, 22, 16, 18, 0x9fb4d8, 0x2a4a6a],
  ['garage', -120, 60, 24, 9, 16, 0x8a8f96, 0xffd23a],
  ['hideout', 0, -180, 16, 8, 14, 0xc8a878, 0x3a7a4a],
  ['hospital', 120, -120, 24, 20, 18, 0xf0f0f0, 0xc83a3a],
  ['paintShop', 60, 120, 20, 8, 14, 0x3aa8ff, 0xffd23a],
  ['showroom', 180, 60, 26, 10, 18, 0xd8d8e0, 0xffd23a],
  ['spray', 120, 60, 20, 8, 14, 0xffd23a, 0x2a4a6a],
  ['warehouse', -180, 120, 26, 11, 20, 0x9aa0a8, 0xc84a3a, 'W'],
];

// Where a landmark's building stands: to the side of its marker far
// enough to clear the north-south road, and north far enough that its
// south face clears the east-west road. The old straight-north
// placement put every shopfront on the north-south road through its
// marker — the Pay N Spray shop sat across the x = 120 road and stopped
// the street race's north leg dead at z = 53.
function landmarkRect(mx, mz, bw, bd, side = 'E') {
  return {
    x: side === 'W' ? mx - bw / 2 - 6 : mx + bw / 2 + 6,
    z: mz - 14 - Math.max(0, bd / 2 - 7),
    hw: bw / 2,
    hd: bd / 2,
  };
}

function rectsOverlap(a, b, pad = 0) {
  return Math.abs(a.x - b.x) < a.hw + b.hw + pad
    && Math.abs(a.z - b.z) < a.hd + b.hd + pad;
}

// A small shopfront / special-purpose building next to a marker point:
// the building stands north-east of the marker (see landmarkRect) so
// the marker pad itself stays on open ground and no road is blocked,
// with a coloured sign board on top.
function addLandmark(game, group, mx, mz, bw, bh, bd, color, labelColor, side = 'E') {
  const r = landmarkRect(mx, mz, bw, bd, side);
  const bx = r.x;
  const bz = r.z;
  addBuilding(game, group, bx, bz, bw, bh, bd, color);
  const sign = makeBox(bw * 0.8, 1.6, 0.4, labelColor, bx, bh + 1.2, bz + bd / 2 + 0.3, { shadow: false });
  group.add(sign);
  return { x: mx, z: mz };
}

// A palm tree: brown trunk, green cone crown.
function addPalm(group, x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.4, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 }),
  );
  trunk.position.set(x, 2.5, z);
  trunk.castShadow = true;
  group.add(trunk);
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a9a4a, roughness: 0.9 }),
  );
  top.position.set(x, 5.8, z);
  group.add(top);
}

export function buildCity(world) {
  const game = world;
  const scene = game.scene;
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // --- sky, light, ground --------------------------------------------
  scene.background = new THREE.Color(0x8ec9ee);
  scene.fog = new THREE.Fog(0xa8d4f0, 260, 620);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.1);
  sun.position.set(140, 220, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  scene.add(sun);
  game.sun = sun;

  // Base ground: warm concrete for the city, sand near the sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2 + 40, WORLD.half * 2 + 40),
    new THREE.MeshStandardMaterial({ color: 0x9aa08e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -8);
  ground.receiveShadow = true;
  group.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2 + 40, WORLD.half * 2 - WORLD.sandZ),
    new THREE.MeshStandardMaterial({ color: 0xeed9a8, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.03, (WORLD.sandZ + WORLD.half) / 2 - 4);
  sand.receiveShadow = true;
  group.add(sand);

  // The sea: a big bright blue plane past the sand.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 320),
    new THREE.MeshStandardMaterial({ color: 0x2a8fd8, roughness: 0.25, metalness: 0.15 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, WORLD.waterZ + 130);
  group.add(sea);
  game.sea = sea;

  // --- roads -----------------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.95 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5e9a8 });
  for (const v of GRID) {
    const hRoad = new THREE.Mesh(new THREE.BoxGeometry(WORLD.half * 2, 0.06, WORLD.roadWidth), roadMat);
    hRoad.position.set(0, 0.04, v);
    hRoad.receiveShadow = true;
    group.add(hRoad);
    const vRoad = new THREE.Mesh(new THREE.BoxGeometry(WORLD.roadWidth, 0.06, WORLD.half * 2), roadMat);
    vRoad.position.set(v, 0.04, 0);
    vRoad.receiveShadow = true;
    group.add(vRoad);
    // Centre dashes along both roads.
    for (let t = -WORLD.half + 8; t < WORLD.half; t += 16) {
      const d1 = new THREE.Mesh(new THREE.BoxGeometry(4, 0.02, 0.35), lineMat);
      d1.position.set(t, 0.08, v);
      group.add(d1);
      const d2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 4), lineMat);
      d2.position.set(v, 0.08, t);
      group.add(d2);
    }
  }
  // Sidewalks: pale slabs edging every block (beach blocks have none).
  for (const bx of BLOCKS) {
    for (const bz of BLOCKS) {
      if (bz >= WORLD.sandZ - 30) continue;
      group.add(makeSlab(52, 52, 0xb8b0a0, bx, bz, 0.03));
    }
  }
  game.roads = { xs: [...GRID], zs: [...GRID] };

  // --- downtown towers -------------------------------------------------
  // The four blocks around the centre are tall glass-and-concrete towers.
  const downtownBlocks = [[-30, -30], [30, -30], [-30, 30], [30, 30]];
  for (const [bx, bz] of downtownBlocks) {
    const n = randInt(2, 3);
    for (let i = 0; i < n; i++) {
      const ox = bx + pick([-14, 0, 14]);
      const oz = bz + pick([-14, 0, 14]);
      addBuilding(game, group, ox, oz, rand(14, 20), rand(34, 72), rand(14, 20),
        pick(PALETTES.downtown));
    }
  }

  // --- residential blocks ----------------------------------------------
  // North and east blocks get low houses; some get a palm out front.
  for (const bx of BLOCKS) {
    for (const bz of BLOCKS) {
      const isDowntown = downtownBlocks.some(([x, z]) => x === bx && z === bz);
      const isDocks = bx <= -120 && bz >= 60;
      const isBeach = bz >= 150;
      if (isDowntown || isDocks || isBeach) continue;
      const houses = randInt(2, 4);
      for (let i = 0; i < houses; i++) {
        const ox = bx + rand(-16, 16);
        const oz = bz + rand(-16, 16);
        const w = rand(9, 14);
        const d = rand(9, 14);
        // Never spawn a house inside (or touching) a landmark shopfront:
        // the shopfronts now stand in the blocks, where houses live too.
        const houseRect = { x: ox, z: oz, hw: w / 2, hd: d / 2 };
        const clashes = LANDMARK_DEFS.some(([, mx, mz, bw, , bd, , , side]) =>
          rectsOverlap(houseRect, landmarkRect(mx, mz, bw, bd, side), 2));
        if (clashes) continue;
        addBuilding(game, group, ox, oz, w, rand(5, 11), d,
          pick(PALETTES.residential));
        if (Math.random() < 0.4) addPalm(group, ox + w / 2 + 3, oz + 2);
      }
    }
  }

  // --- docks (west, south) ----------------------------------------------
  // Big low warehouses, stacked containers and two gantry cranes.
  const dockBlocks = [[-150, 90], [-150, 150], [-90, 150]];
  for (const [bx, bz] of dockBlocks) {
    addBuilding(game, group, bx, bz, rand(26, 34), rand(9, 13), rand(18, 24),
      pick(PALETTES.warehouse));
  }
  const containerColors = [0xc84a3a, 0x3a7ac8, 0x4aa84a, 0xd8a83a, 0x8a5ac8];
  for (let i = 0; i < 14; i++) {
    const cx = rand(-190, -110);
    const cz = rand(60, 170);
    const rot = Math.random() < 0.5 ? 0 : Math.PI / 2;
    const c = makeBox(8, 2.6, 2.6, pick(containerColors), cx, 1.3, cz);
    c.rotation.y = rot;
    group.add(c);
    if (Math.random() < 0.5) {
      const c2 = makeBox(8, 2.6, 2.6, pick(containerColors), cx, 3.9, cz);
      c2.rotation.y = rot;
      group.add(c2);
    }
  }
  for (const cx of [-170, -130]) {
    const leg1 = makeBox(1.5, 26, 1.5, 0xd8b83a, cx, 13, 120);
    const leg2 = makeBox(1.5, 26, 1.5, 0xd8b83a, cx + 8, 13, 120);
    const beam = makeBox(14, 2, 2, 0xd8b83a, cx + 4, 26, 120);
    group.add(leg1, leg2, beam);
    game.colliders.push({ x: cx + 4, z: 120, hw: 7, hd: 1.5 });
  }

  // --- beach, pier and ferris wheel --------------------------------------
  // Boardwalk along the sand.
  group.add(makeSlab(WORLD.half * 2, 10, 0xc8a878, 0, WORLD.sandZ - 4, 0.05));
  // Pier reaching out over the water at x = -30.
  const pier = new THREE.Group();
  pier.position.set(-30, 0, WORLD.sandZ + 8);
  pier.add(makeBox(8, 0.8, 46, 0x9a7a52, 0, 1.2, 18));
  for (let z = 0; z <= 36; z += 9) {
    for (const x of [-3.5, 3.5]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 }),
      );
      post.position.set(x, 0.4, z);
      pier.add(post);
    }
  }
  group.add(pier);
  game.colliders.push({ x: -30, z: WORLD.sandZ + 26, hw: 4.5, hd: 23 });

  // Ferris wheel on the beach at x = 60: two legs, a hub and a rim with
  // bright gondolas. game.ferris is the spinning rim group.
  const wheelBase = new THREE.Group();
  wheelBase.position.set(60, 0, 212);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 26, 8), legMat);
    leg.position.set(s * 7, 13, 0);
    leg.rotation.z = -s * 0.27;
    leg.castShadow = true;
    wheelBase.add(leg);
  }
  const rim = new THREE.Group();
  rim.position.set(0, 26, 0);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5a7a, roughness: 0.5, metalness: 0.2 });
  const torus = new THREE.Mesh(new THREE.TorusGeometry(11, 0.5, 8, 40), rimMat);
  wheelBase.add(torus);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 11, 6), rimMat);
    spoke.position.set(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 0);
    spoke.rotation.z = a + Math.PI / 2;
    rim.add(spoke);
    const gondola = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.8, 1.6),
      new THREE.MeshStandardMaterial({ color: pick([0xffd23a, 0x3aa8ff, 0x4ad84a, 0xff8a3a]), roughness: 0.6 }),
    );
    gondola.position.set(Math.cos(a) * 11, Math.sin(a) * 11, 0);
    rim.add(gondola);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 12), legMat);
  hub.rotation.x = Math.PI / 2;
  rim.add(hub);
  wheelBase.add(rim);
  group.add(wheelBase);
  game.ferris = rim;
  game.colliders.push({ x: 60, z: 212, hw: 8, hd: 3 });

  // Beach umbrellas for colour.
  for (let i = 0; i < 8; i++) {
    const ux = rand(-160, 200);
    const uz = rand(202, 226);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 }),
    );
    pole.position.set(ux, 1.2, uz);
    group.add(pole);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 1, 10),
      new THREE.MeshStandardMaterial({ color: pick([0xff5a7a, 0xffd23a, 0x3aa8ff]), roughness: 0.7 }),
    );
    top.position.set(ux, 2.6, uz);
    group.add(top);
  }

  // --- named places -------------------------------------------------------
  // Each marker sits on open ground; its building stands north-east of
  // it (see landmarkRect), clear of both roads.
  const markers = {};
  for (const [key, mx, mz, bw, bh, bd, color, label, side] of LANDMARK_DEFS) {
    markers[key] = addLandmark(game, group, mx, mz, bw, bh, bd, color, label, side);
  }
  // South of the dock warehouse, on open ground: the marker must never
  // sit inside a building — at (-150, 90) it was dead-centre in the dock
  // warehouse, 11 m from any approach, so mission 2's docks pickup and
  // any taxi fare to the docks could never complete (NEAR = 9).
  markers.docks = { x: -150, z: 110 };
  markers.beach = { x: 0, z: 212 };
  game.markers = markers;

  // Pay N Spray pad: a bright yellow square on the ground at the spray
  // marker so drivers can see where to stop.
  group.add(makeSlab(12, 12, 0xffd23a, markers.spray.x, markers.spray.z, 0.06));
  // Paint-shop pad in sky blue.
  group.add(makeSlab(12, 12, 0x7ac8ff, markers.paintShop.x, markers.paintShop.z, 0.06));

  // A few street trees along the central avenue.
  for (let z = -180; z <= 180; z += 60) {
    for (const sx of [-8, 8]) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.4, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 }),
      );
      trunk.position.set(sx, 2, z + 12);
      group.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(2.4, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a9a3a, roughness: 0.9 }),
      );
      crown.position.set(sx, 5.4, z + 12);
      group.add(crown);
    }
  }

  return game;
}
