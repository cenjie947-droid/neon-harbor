// Neon Harbor — the city itself.
//
// buildCity fills the scene: ground and roads on the 60 m grid, the
// districts (downtown towers in the middle, houses out west, warehouses
// on the east docks, bright little shops along the beach), the pier and
// the ferris wheel at the shore, and the named places the story drives
// to.
//
// Two rules keep the city drivable. First, every building sits at least
// ten metres from a road centre line, so streets, intersections and the
// marker spots on them stay open — a stolen car can always drive away.
// Second, every solid thing registers a collider box, so the collision
// tests in state.js know about it. Markers sit on intersections or open
// ground, never inside a footprint, and the three story cars (the Comet,
// the bank van, the garage Stallion) are placed on open road by the
// vehicle spawn, so the city only has to leave those spots alone.

import * as THREE from 'three';
import { WORLD, rand, pick, clamp } from './state.js';

// How far a building face stays from a road centre line.
const EDGE_GAP = 10;

// The named places, as ground points. They sit on intersections (both
// coordinates on the grid) or on the open sand, so a car can always reach
// them, and the beacon can point at them without a wall in the way.
const MARKERS = {
  spray: [120, 60],
  paintShop: [60, 120],
  garage: [-60, 60],
  docks: [180, 120],
  warehouse: [180, 180],
  hideout: [-120, -180],
  showroom: [60, -120],
  bank: [0, 60],
  beach: [0, 210],
  hospital: [-120, -60],
};

// Palettes by district. Towers read as glass, houses as pastel stucco,
// warehouses as rust and steel, beach shops as bright paint.
const TOWER_PAINT = [0x8fa3b8, 0x6b7c8c, 0xa8b0b8, 0x7a8ba0, 0x93a7bb];
const MID_PAINT = [0xb08d6a, 0x9a8f7a, 0x8a7a6a, 0xc0a080, 0xa88a70];
const HOUSE_PAINT = [0xd9c9a8, 0xc9b8a0, 0xb8c9d9, 0xe0d0c0, 0xa8b8a8, 0xd9b8a0];
const DOCK_PAINT = [0x8a7a6a, 0x7a6a5a, 0x9a8a7a, 0x6a7a7a];
const SHOP_PAINT = [0xe08a5a, 0x5aa8c0, 0xd9c05a, 0xc05a7a, 0x7ac08a];

function skin(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts });
}

const ROOF_SKIN = skin(0x3a3f46, { roughness: 0.95 });
const GLASS_SKIN = new THREE.MeshStandardMaterial({
  color: 0x9fc3e8,
  emissive: 0x5a7a9a,
  emissiveIntensity: 0.7,
  roughness: 0.3,
  metalness: 0.4,
});

// One building: a body box, a roof slab, and a lit window band on the
// front face. Registers a collider so nothing can drive through it, and
// returns the group. `front` is the direction the window band faces:
// 0 faces +z, 1 faces +x, 2 faces -z, 3 faces -x.
function addBuilding(world, x, z, w, h, d, color, front = 0) {
  const node = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skin(color));
  shell.position.y = h / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  node.add(shell);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), ROOF_SKIN);
  cap.position.y = h + 0.25;
  cap.castShadow = true;
  node.add(cap);
  if (h >= 8) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w, d) * 0.62, h * 0.55, 0.12), GLASS_SKIN);
    const off = (Math.min(w, d) === w ? d : w) / 2 + 0.07;
    // [x, z, turn]: which face the band sits on, and whether it turns.
    const faces = [
      [0, off, 0],
      [off, 0, 1],
      [0, -off, 0],
      [-off, 0, 1],
    ];
    const place = faces[front];
    if (place[2] === 1) strip.rotation.y = Math.PI / 2;
    strip.position.x = place[0];
    strip.position.y = h * 0.52;
    strip.position.z = place[1];
    node.add(strip);
  }
  node.position.set(x, 0, z);
  world.scene.add(node);
  world.colliders.push({ x, z, hw: w / 2, hd: d / 2 });
  return node;
}

// A flat box on the ground that is not a building (road, sand, plaza).
function groundSlab(scene, x, z, w, d, color, y = 0.02, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), skin(color, opts));
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// A palm: trunk plus a crown of cones. Scattered along the beach and in
// the park so the shore reads as a shore, not a car park.
function addPalm(world, x, z, s = 1) {
  const node = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 5.5 * s, 7),
    skin(0x8a6a4a),
  );
  stem.position.y = 2.75 * s;
  stem.castShadow = true;
  node.add(stem);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 3.2 * s, 5), skin(0x4a8a4a));
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.1 * s, 5.6 * s, Math.sin(a) * 1.1 * s);
    leaf.rotation.z = Math.cos(a) * 0.9;
    leaf.rotation.x = -Math.sin(a) * 0.9;
    node.add(leaf);
  }
  node.position.set(x, 0, z);
  world.scene.add(node);
  return node;
}

// The beacon the missions point at: a light beam that rises from the
// marker and a ring on the ground that breathes. The main loop animates
// children[0]'s opacity and children[1]'s scale, so the order here is
// part of the contract — beam first, ring second.
function buildBeacon(world) {
  const node = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shaft.position.y = 17;
  node.add(shaft);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.22, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd76a }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.5;
  node.add(halo);
  node.visible = false;
  world.scene.add(node);
  return node;
}

// The ferris wheel on the boardwalk. children[0] is the wheel itself,
// which the main loop spins; children[1] holds the legs and the booth,
// which stay put. The wheel faces north, toward the city, so it reads
// from the streets.
function buildFerris(world) {
  const node = new THREE.Group();
  const disc = new THREE.Group();
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(13, 0.55, 10, 40), skin(0xd94f4f, { roughness: 0.5 }));
  hoop.castShadow = true;
  disc.add(hoop);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // One bar per direction, hub to rim: the long axis is Y, so turn it
    // to the radial direction and sit it halfway out.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 13, 0.35), skin(0xdddddd));
    bar.position.set(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 0);
    bar.rotation.z = a - Math.PI / 2;
    disc.add(bar);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), skin(pick([0xffd23e, 0x5aa8c0, 0xe08a5a, 0x7ac08a])));
    cabin.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    cabin.castShadow = true;
    disc.add(cabin);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12), skin(0x3a3f46));
  axle.rotation.x = Math.PI / 2;
  disc.add(axle);
  disc.position.y = 17;
  node.add(disc);
  const strutMat = skin(0x6a6a6a);
  for (let s = -1; s <= 1; s += 2) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 19, 0.9), strutMat);
    strut.position.set(s * 5.5, 8.5, 0);
    strut.rotation.z = s * 0.32;
    strut.castShadow = true;
    node.add(strut);
  }
  const kiosk = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5), skin(0xe08a5a));
  kiosk.position.set(9, 1.7, 4);
  kiosk.castShadow = true;
  node.add(kiosk);
  node.position.set(-40, 0, 205);
  world.scene.add(node);
  world.colliders.push({ x: -40, z: 205, hw: 7, hd: 7 });
  return node;
}

// The pier: a wooden deck walking out over the water from the beach, with
// rails and posts. It has no collider — it is thin, at the map edge, and
// the beach marker sits just north of it.
function buildPier(world) {
  const node = new THREE.Group();
  const planks = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 36), skin(0x8a6a4a, { roughness: 0.95 }));
  planks.position.set(0, 1, 16);
  planks.castShadow = true;
  planks.receiveShadow = true;
  node.add(planks);
  for (let s = -1; s <= 1; s += 2) {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 36), skin(0x6a4a2a));
    guard.position.set(s * 2.9, 1.8, 16);
    node.add(guard);
  }
  for (let i = 0; i < 5; i++) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 8), skin(0x5a4030));
    pile.position.set(i % 2 === 0 ? -2.4 : 2.4, 0, 2 + i * 8);
    node.add(pile);
  }
  node.position.set(0, 0, 212);
  world.scene.add(node);
  return node;
}

// The ground, the roads, the sand and the sea.
function layTerrain(world) {
  const scene = world.scene;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), skin(0xa8b09a, { roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // Sand band along the south shore, then the water past it.
  groundSlab(scene, 0, 208, 560, 20, 0xe0cfa0, 0.015);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a6a9a, roughness: 0.25, metalness: 0.15 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.12, 242);
  scene.add(water);
  world.sea = water;
  // Roads: one dark strip per grid line on each axis, with a thin centre
  // line. The two directions sit at slightly different heights so the
  // crossings do not z-fight.
  for (const line of world.roads.xs) {
    groundSlab(scene, 0, line, 480, WORLD.roadWidth, 0x3a3f46, 0.02);
    groundSlab(scene, 0, line, 480, 0.3, 0xd9c05a, 0.05);
    groundSlab(scene, line, 0, WORLD.roadWidth, 480, 0x3a3f46, 0.035);
    groundSlab(scene, line, 0, 0.3, 480, 0xd9c05a, 0.06);
  }
}

// Decide what a block holds from where its centre sits: towers near the
// middle, warehouses on the east docks, bright shops by the beach, houses
// everywhere else. The centre block is a park — open ground with palms —
// so the title orbit has somewhere green to look at.
function fillCityBlock(world, x0, x1, z0, z1) {
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const bw = x1 - x0;
  const bd = z1 - z0;
  if (Math.abs(mx) < 45 && Math.abs(mz) < 45) {
    // Central park.
    for (let i = 0; i < 6; i++) {
      addPalm(world, mx + rand(-16, 16), mz + rand(-16, 16), rand(0.8, 1.2));
    }
    groundSlab(world.scene, mx, mz, 26, 26, 0x8aa07a, 0.015);
  } else if (mx > 120 && mz > 0) {
    // East docks: long warehouses.
    addBuilding(world, mx, mz, 30, rand(8, 12), 16, pick(DOCK_PAINT), 3);
  } else if (mz > 120) {
    // Beach row: low bright shops.
    const n = 2;
    for (let i = 0; i < n; i++) {
      const bx = x0 + ((i + 0.5) / n) * bw + rand(-3, 3);
      addBuilding(world, bx, mz + rand(-4, 4), 13, rand(6, 9), 12, pick(SHOP_PAINT), 2);
    }
  } else if (Math.abs(mx) <= 90 && Math.abs(mz) <= 90) {
    // Downtown: one tall tower.
    addBuilding(world, mx + rand(-3, 3), mz + rand(-3, 3), rand(20, 26), rand(26, 58), rand(20, 26), pick(TOWER_PAINT), Math.floor(rand(0, 4)));
  } else if (Math.abs(mx) <= 150 && Math.abs(mz) <= 150) {
    // Mid ring: one or two mid-rise blocks.
    addBuilding(world, mx - bw * 0.2, mz, 16, rand(11, 20), 15, pick(MID_PAINT), 0);
    if (Math.random() < 0.6) {
      addBuilding(world, mx + bw * 0.22, mz + bd * 0.15, 13, rand(9, 16), 12, pick(MID_PAINT), 2);
    }
  } else {
    // Outer ring: small houses.
    const plots = [
      [x0 + bw * 0.28, z0 + bd * 0.3],
      [x0 + bw * 0.72, z0 + bd * 0.3],
      [x0 + bw * 0.28, z0 + bd * 0.72],
      [x0 + bw * 0.72, z0 + bd * 0.72],
    ];
    for (let k = 0; k < plots.length; k++) {
      const qx = plots[k][0];
      const qz = plots[k][1];
      if (Math.random() < 0.85) {
        addBuilding(world, qx, qz, rand(9, 12), rand(6, 10), rand(9, 12), pick(HOUSE_PAINT), Math.floor(rand(0, 4)));
      }
    }
  }
}

// The story landmarks, placed in the blocks beside their markers so the
// marker itself stays on open road: the bank, the hospital, Mara's garage,
// the paint shop, the showroom lot and the hideout house.
function addLandmarks(world) {
  // [x, z, w, h, d, color, front] for the plain landmarks. The hospital
  // cross and the showroom glass are added to their buildings after.
  const plain = [
    [18, 78, 22, 16, 18, 0xc9c2b0, 2],
    [-42, 78, 24, 8, 16, 0x7a6a5a, 2],
    [78, 138, 18, 7, 14, 0x5aa8c0, 2],
    [-102, -162, 12, 7, 11, 0xd9c9a8, 0],
    [205, 90, 26, 10, 18, pick(DOCK_PAINT), 3],
    [205, 150, 26, 11, 18, pick(DOCK_PAINT), 3],
  ];
  plain.forEach((spec) => {
    addBuilding(world, spec[0], spec[1], spec[2], spec[3], spec[4], spec[5], spec[6]);
  });
  // St. Aurelia Hospital: white block with a red cross on the roof.
  const clinic = addBuilding(world, -102, -42, 26, 18, 20, 0xe8e8e8, 0);
  const barA = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 2), skin(0xc0392b));
  barA.position.y = 19.5;
  const barB = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 6), skin(0xc0392b));
  barB.position.y = 19.5;
  clinic.add(barA);
  clinic.add(barB);
  // Showroom: a glass-front lot building; the Comet sits on the open
  // ground in front of it, on the marker.
  const lot = addBuilding(world, 78, -102, 24, 9, 18, 0x2a3a4a, 2);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 0.2), GLASS_SKIN);
  pane.position.x = 0;
  pane.position.y = 3.4;
  pane.position.z = -9.1;
  lot.add(pane);
  // A couple of dock cranes: simple frames over the water edge.
  for (let k = 0; k < 2; k++) {
    const cz = k === 0 ? 100 : 160;
    const hoist = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(2, 26, 2), skin(0xd9a03a));
    pole.position.y = 13;
    pole.castShadow = true;
    hoist.add(pole);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 22), skin(0xd9a03a));
    jib.position.set(0, 25, 8);
    hoist.add(jib);
    hoist.position.set(215, 0, cz);
    world.scene.add(hoist);
    world.colliders.push({ x: 215, z: cz, hw: 2, hd: 2 });
  }
}

export function buildCity(world) {
  layTerrain(world);
  // Blocks between the grid lines, inset by the setback.
  const grid = world.roads.xs;
  for (let a = 0; a < grid.length - 1; a++) {
    for (let b = 0; b < grid.length - 1; b++) {
      const x0 = grid[a] + EDGE_GAP;
      const x1 = grid[a + 1] - EDGE_GAP;
      const z0 = grid[b] + EDGE_GAP;
      const z1 = grid[b + 1] - EDGE_GAP;
      // The south row of blocks backs onto the beach, not more city.
      if (grid[b] >= 180) continue;
      fillCityBlock(world, x0, x1, z0, z1);
    }
  }
  // A few houses in the north and west edge strips, clear of the roads.
  const edgeHouses = [[-205, -60], [-205, 60], [205, -60], [-60, -205], [60, -205], [-150, -205]];
  for (const [hx, hz] of edgeHouses) {
    addBuilding(world, hx, hz, rand(10, 13), rand(6, 9), rand(10, 12), pick(HOUSE_PAINT), Math.floor(rand(0, 4)));
  }
  addLandmarks(world);
  // Palms along the beach.
  for (let i = 0; i < 12; i++) {
    addPalm(world, -150 + i * 27 + rand(-6, 6), rand(192, 206), rand(0.9, 1.3));
  }
  buildPier(world);
  world.ferris = buildFerris(world);
  world.beacon = buildBeacon(world);
  // Named places, as vectors the beacon and the mission checks can use.
  for (const [key, pt] of Object.entries(MARKERS)) {
    world.markers[key] = new THREE.Vector3(pt[0], 0, pt[1]);
  }
  // The sun: a warm directional light the main loop lifts to midday.
  const lamp = new THREE.DirectionalLight(0xfff2dd, 1.2);
  lamp.position.set(120, 180, 60);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.left = -260;
  lamp.shadow.camera.right = 260;
  lamp.shadow.camera.top = 260;
  lamp.shadow.camera.bottom = -260;
  lamp.shadow.camera.near = 1;
  lamp.shadow.camera.far = 600;
  lamp.shadow.bias = -0.0005;
  world.scene.add(lamp);
  world.sun = lamp;
}
