// Neon Harbor — procedural coastal city.
//
// Builds the whole island in one pass: a downtown road grid, a harbor
// beach with a pier and a ferris wheel, dockside warehouses and quiet
// residential blocks. Everything the rest of the game needs is left on
// the world object: the ten named markers, the road grid, the building
// colliders, and handles to the sun, the sea and the ferris wheel.
//
// The look is deliberately bright: a high pale sun, a light-blue sky and
// pale buildings, so the city reads as sun-soaked at noon rather than
// moody at dusk. Roads are flat dark strips laid over a pale ground
// plane; buildings are simple boxes with a roof slab, which keeps the
// mesh count low and the headless renderer fast.

import * as THREE from 'three';
import { WORLD, rand, randInt, pick } from './state.js';

// The road grid: seven avenues each way, 60 m apart, 10 m wide.
const GRID = [-180, -120, -60, 0, 60, 120, 180];
// Centres of the 50 m blocks that sit between the roads.
const BLOCKS = [-150, -90, -30, 30, 90, 150];

const MARKER_SPOTS = {
  bank: { x: -120, z: -120, color: 0xffc93c, label: 'Harbor Bank' },
  beach: { x: 0, z: 205, color: 0x35c4dc, label: 'Neon Beach' },
  docks: { x: -120, z: 180, color: 0xff7a1a, label: 'The Docks' },
  garage: { x: 0, z: -120, color: 0xb678ff, label: "Mara's Garage" },
  hideout: { x: -60, z: -60, color: 0x58d68d, label: 'Hideout' },
  hospital: { x: 180, z: -60, color: 0xffffff, label: 'St. Aurelia Hospital' },
  paintShop: { x: 60, z: 120, color: 0xff4fa3, label: 'Paint Shop' },
  showroom: { x: 120, z: -120, color: 0xffe14d, label: 'Showroom' },
  spray: { x: 120, z: 60, color: 0x3f8cff, label: 'Pay N Spray' },
  warehouse: { x: -180, z: 60, color: 0xc98a4b, label: 'Warehouse' },
};

// Pale, sun-bleached facades with a few glass towers mixed in.
const FACADE = [
  0xe8e0d0, 0xdfe8ee, 0xf2d8b8, 0xd8cfc0, 0xcfe0e8,
  0xe8c8a8, 0xd0d8c8, 0xf0e8d8, 0xc8d8e8, 0xe0c8d0,
];
const GLASS = [0x9fc8e8, 0x7fb8d8, 0xa8d0e0, 0x8fb8c8];

function flatBox(w, h, d, color, x, y, z, parent) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function groundPlane(w, d, color, x, z, y, parent) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// One downtown block: a single big slab that fills the middle of the
// block, so a player ducking into a block centre is hidden from the
// roads by solid walls on every side. Towers grow taller toward the
// middle of the map; the outer ring stays low.
function raiseBlock(world, cx, cz) {
  const scene = world.scene;
  const fromCentre = Math.max(Math.abs(cx), Math.abs(cz));
  const tall = fromCentre <= 90;
  const height = tall
    ? rand(26, 68)
    : rand(9, 24);
  const glass = tall && Math.random() < 0.45;
  const color = glass ? pick(GLASS) : pick(FACADE);
  const w = 34;
  const d = 34;
  const body = flatBox(w, height, d, color, cx, height / 2, cz, scene);
  body.userData.isBuilding = true;
  // A thin roof slab and, on the tallest towers, a rooftop box.
  flatBox(w + 1, 1.2, d + 1, 0x8a8078, cx, height + 0.6, cz, scene);
  if (height > 45) {
    flatBox(10, 6, 10, 0x6a6a72, cx, height + 4, cz, scene);
  }
  world.colliders.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
}

// A low warehouse slab for the dockside blocks, long and flat.
function raiseWarehouse(world, cx, cz) {
  const scene = world.scene;
  const w = 40;
  const d = 22;
  const h = 11;
  flatBox(w, h, d, 0xb8a88e, cx, h / 2, cz, scene);
  flatBox(w + 1, 1, d + 1, 0x5a5a62, cx, h + 0.5, cz, scene);
  world.colliders.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });
}

// A small floating pin above a marker, plus a painted ring on the
// ground, so every named place is visible from a distance.
function markerPin(world, key, spot) {
  const scene = world.scene;
  const pin = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.6),
    new THREE.MeshBasicMaterial({ color: spot.color }),
  );
  pin.position.set(spot.x, 7, spot.z);
  scene.add(pin);
  world.markerPins = world.markerPins || {};
  world.markerPins[key] = pin;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.4, 28),
    new THREE.MeshBasicMaterial({ color: spot.color, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(spot.x, 0.06, spot.z);
  scene.add(ring);
}

// The Pay N Spray pad: a painted rectangle on the road with a yellow
// awning on posts at its north edge, high enough for any car to pass.
function sprayPad(world, spot) {
  const scene = world.scene;
  groundPlane(12, 12, 0x2a2f36, spot.x, spot.z, 0.045, scene);
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(5.2, 6, 4, 1),
    new THREE.MeshBasicMaterial({ color: 0xffd23c, side: THREE.DoubleSide }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.rotation.z = Math.PI / 4;
  edge.position.set(spot.x, 0.06, spot.z);
  scene.add(edge);
  const awn = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 5),
    new THREE.MeshLambertMaterial({ color: 0xffd23c, side: THREE.DoubleSide }),
  );
  awn.rotation.x = -Math.PI / 2 + 0.25;
  awn.position.set(spot.x, 4.6, spot.z - 7.5);
  awn.castShadow = true;
  scene.add(awn);
  for (const dx of [-5.5, 5.5]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 4.6, 8),
      new THREE.MeshLambertMaterial({ color: 0x3a3f44 }),
    );
    post.position.set(spot.x + dx, 2.3, spot.z - 9.5);
    post.castShadow = true;
    scene.add(post);
  }
}

// A pier of wooden boards running out into the sea, plus a ferris
// wheel on the sand. The wheel's rim is the part that turns; the legs
// stay put.
function beachfront(world) {
  const scene = world.scene;
  // Pier at x = -40, boards from the sand out over the water.
  groundPlane(9, 52, 0xa8825a, -40, 224, 0.05, scene);
  for (let i = 0; i < 6; i++) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 2.4, 8),
      new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
    );
    post.position.set(-40 + (i % 2 === 0 ? -4 : 4), 0.4, 206 + i * 8);
    scene.add(post);
  }
  // Ferris wheel at (40, 212), facing the city.
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(40, 0, 212);
  const spinner = new THREE.Group();
  spinner.position.y = 20;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(16, 0.7, 10, 40),
    new THREE.MeshLambertMaterial({ color: 0xff5a7a }),
  );
  spinner.add(rim);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 31, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
    );
    spoke.rotation.z = a;
    spinner.add(spoke);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.4, 2.4),
      new THREE.MeshLambertMaterial({ color: pick([0xffd23c, 0x35c4dc, 0xff7a1a, 0x58d68d]) }),
    );
    cabin.position.set(Math.sin(a) * 16, Math.cos(a) * 16, 0);
    spinner.add(cabin);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 2.5, 12),
    new THREE.MeshLambertMaterial({ color: 0x3a3f44 }),
  );
  hub.rotation.x = Math.PI / 2;
  spinner.add(hub);
  wheelGroup.add(spinner);
  for (const dx of [-7, 7]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 22, 1.4),
      new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }),
    );
    leg.position.set(dx, 10, 0);
    leg.rotation.z = dx > 0 ? -0.32 : 0.32;
    leg.castShadow = true;
    wheelGroup.add(leg);
  }
  scene.add(wheelGroup);
  wheelGroup.userData.wheel = spinner;
  world.ferris = wheelGroup;
  // A few beach umbrellas for colour.
  for (const [ux, uz, col] of [[-70, 206, 0xff5a7a], [10, 208, 0xffd23c], [90, 206, 0x35c4dc]]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3, 8),
      new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
    );
    pole.position.set(ux, 1.5, uz);
    scene.add(pole);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 1.2, 10),
      new THREE.MeshLambertMaterial({ color: col }),
    );
    top.position.set(ux, 3.4, uz);
    scene.add(top);
  }
}

// Dockside crane and container stacks on the sand south of the docks.
function docks(world) {
  const scene = world.scene;
  const crane = new THREE.Group();
  crane.position.set(-150, 0, 194);
  flatBox(3, 26, 3, 0xd8b13c, 0, 13, 0, crane);
  const arm = flatBox(26, 2, 2, 0xd8b13c, 8, 24, 0, crane);
  arm.castShadow = true;
  flatBox(2, 6, 2, 0x3a3f44, 18, 20, 0, crane);
  scene.add(crane);
  const cols = [0xc0392b, 0x2471a3, 0x229954, 0xd4ac0d];
  let i = 0;
  for (const [cx, cz] of [[-172, 198], [-168, 204], [-140, 200], [-128, 196]]) {
    flatBox(9, 3.4, 3.6, cols[i++ % cols.length], cx, 1.7, cz, scene);
  }
}

// Street trees in the gaps between buildings and roads. They carry no
// collider, so they never trap the player or a car.
function plantTrees(world) {
  const scene = world.scene;
  for (let n = 0; n < 54; n++) {
    const bx = pick(BLOCKS);
    const bz = pick(BLOCKS);
    const sx = Math.random() < 0.5 ? -1 : 1;
    const sz = Math.random() < 0.5 ? -1 : 1;
    const x = bx + sx * rand(20, 23);
    const z = bz + sz * rand(20, 23);
    if (Math.abs(x) > 235 || Math.abs(z) > 190) continue;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.35, 2.6, 7),
      new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
    );
    trunk.position.set(x, 1.3, z);
    scene.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(rand(1.6, 2.4), 8, 7),
      new THREE.MeshLambertMaterial({ color: pick([0x4a8a3a, 0x5a9a44, 0x3a7a34]) }),
    );
    crown.position.set(x, 3.6, z);
    crown.castShadow = true;
    scene.add(crown);
  }
}

export function buildCity(world) {
  const scene = world.scene;
  world.roads = { xs: [...GRID], zs: [...GRID] };
  world.colliders = [];
  world.markers = {};
  for (const [key, spot] of Object.entries(MARKER_SPOTS)) {
    world.markers[key] = { x: spot.x, z: spot.z, name: spot.label };
  }

  // Sky, light and ground.
  scene.background = new THREE.Color(0x9fd4f2);
  scene.fog = new THREE.Fog(0x9fd4f2, 260, 640);
  const sun = new THREE.DirectionalLight(0xfff1cf, 2.8);
  sun.position.set(140, 200, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 620;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  world.sun = sun;
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8a6a, 1.15);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // City ground, then the beach and sea to the south.
  groundPlane(560, 480, 0x7fa06a, 0, -20, 0, scene);
  groundPlane(560, 46, 0xe8d29a, 0, 209, 0.02, scene);
  const sea = groundPlane(560, 340, 0x2f7fc4, 0, 392, 0.01, scene);
  world.sea = sea;

  // Roads: pale sidewalk ribbons with a dark asphalt strip on top, and
  // a thin pale centre line so the grid reads at a glance.
  for (const v of GRID) {
    groundPlane(14, 480, 0xb8bcc0, v, -20, 0.02, scene);
    groundPlane(480, 14, 0xb8bcc0, 0, v, 0.02, scene);
    groundPlane(10, 480, 0x3a3f44, v, -20, 0.03, scene);
    groundPlane(480, 10, 0x3a3f44, 0, v, 0.03, scene);
    groundPlane(0.5, 480, 0xe8e8e8, v, -20, 0.04, scene);
    groundPlane(480, 0.5, 0xe8e8e8, 0, v, 0.04, scene);
  }

  // Buildings, block by block. The two dockside rows are warehouses.
  for (const bx of BLOCKS) {
    for (const bz of BLOCKS) {
      if (bz >= 150) {
        raiseWarehouse(world, bx, bz);
      } else {
        raiseBlock(world, bx, bz);
      }
    }
  }

  // Marker pins, the spray pad, the beach and the docks.
  for (const [key, spot] of Object.entries(MARKER_SPOTS)) {
    markerPin(world, key, spot);
  }
  sprayPad(world, MARKER_SPOTS.spray);
  beachfront(world);
  docks(world);
  plantTrees(world);

  world.bounds = WORLD.half;
  return world;
}
