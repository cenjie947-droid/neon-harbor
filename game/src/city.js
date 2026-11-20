// Neon Harbor — the city itself.
//
// buildCity fills the scene: ground and roads on the 60 m grid, the
// districts (downtown towers in the middle, houses out west, warehouses on
// the east docks, bright little shops along the beach), the pier and the
// ferris wheel at the shore, and the named places the story drives to.
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
const SETBACK = 10;

// The named places, as ground points. They sit on intersections (both
// coordinates on the grid) or on the open sand, so a car can always reach
// them, and the beacon can point at them without a wall in the way.
const PLACES = {
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
const TOWER_COLORS = [0x8fa3b8, 0x6b7c8c, 0xa8b0b8, 0x7a8ba0, 0x93a7bb];
const MID_COLORS = [0xb08d6a, 0x9a8f7a, 0x8a7a6a, 0xc0a080, 0xa88a70];
const HOUSE_COLORS = [0xd9c9a8, 0xc9b8a0, 0xb8c9d9, 0xe0d0c0, 0xa8b8a8, 0xd9b8a0];
const DOCK_COLORS = [0x8a7a6a, 0x7a6a5a, 0x9a8a7a, 0x6a7a7a];
const SHOP_COLORS = [0xe08a5a, 0x5aa8c0, 0xd9c05a, 0xc05a7a, 0x7ac08a];

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts });
}

const ROOF_MAT = mat(0x3a3f46, { roughness: 0.95 });
const WINDOW_MAT = new THREE.MeshStandardMaterial({
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
function building(game, x, z, w, h, d, color, front = 0) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), ROOF_MAT);
  roof.position.y = h + 0.25;
  roof.castShadow = true;
  group.add(roof);
  if (h >= 8) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w, d) * 0.62, h * 0.55, 0.12), WINDOW_MAT);
    const off = (Math.min(w, d) === w ? d : w) / 2 + 0.07;
    if (front === 0) band.position.set(0, h * 0.52, off);
    else if (front === 2) band.position.set(0, h * 0.52, -off);
    else if (front === 1) { band.rotation.y = Math.PI / 2; band.position.set(off, h * 0.52, 0); }
    else { band.rotation.y = Math.PI / 2; band.position.set(-off, h * 0.52, 0); }
    group.add(band);
  }
  group.position.set(x, 0, z);
  game.scene.add(group);
  game.colliders.push({ x, z, hw: w / 2, hd: d / 2 });
  return group;
}

// A flat box on the ground that is not a building (road, sand, plaza).
function slab(scene, x, z, w, d, color, y = 0.02, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), mat(color, opts));
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// A palm: trunk plus a crown of cones. Scattered along the beach and in
// the park so the shore reads as a shore, not a car park.
function palm(game, x, z, s = 1) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 5.5 * s, 7),
    mat(0x8a6a4a),
  );
  trunk.position.y = 2.75 * s;
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0; i < 5; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 3.2 * s, 5), mat(0x4a8a4a));
    const a = (i / 5) * Math.PI * 2;
    frond.position.set(Math.cos(a) * 1.1 * s, 5.6 * s, Math.sin(a) * 1.1 * s);
    frond.rotation.z = Math.cos(a) * 0.9;
    frond.rotation.x = -Math.sin(a) * 0.9;
    group.add(frond);
  }
  group.position.set(x, 0, z);
  game.scene.add(group);
  return group;
}

// The beacon the missions point at: a light beam that rises from the
// marker and a ring on the ground that breathes. The main loop animates
// children[0]'s opacity and children[1]'s scale, so the order here is
// part of the contract — beam first, ring second.
function makeBeacon(game) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 17;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.22, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd76a }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.5;
  group.add(ring);
  group.visible = false;
  game.scene.add(group);
  return group;
}

// The ferris wheel on the boardwalk. children[0] is the wheel itself,
// which the main loop spins; children[1] holds the legs and the booth,
// which stay put. The wheel faces north, toward the city, so it reads
// from the streets.
function makeFerris(game) {
  const group = new THREE.Group();
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(13, 0.55, 10, 40), mat(0xd94f4f, { roughness: 0.5 }));
  rim.castShadow = true;
  wheel.add(rim);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // One bar per direction, hub to rim: the long axis is Y, so turn it
    // to the radial direction and sit it halfway out.
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.35, 13, 0.35), mat(0xdddddd));
    spoke.position.set(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), mat(pick([0xffd23e, 0x5aa8c0, 0xe08a5a, 0x7ac08a])));
    car.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    car.castShadow = true;
    wheel.add(car);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12), mat(0x3a3f46));
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  wheel.position.y = 17;
  group.add(wheel);
  const legMat = mat(0x6a6a6a);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 19, 0.9), legMat);
    leg.position.set(side * 5.5, 8.5, 0);
    leg.rotation.z = side * 0.32;
    leg.castShadow = true;
    group.add(leg);
  }
  const booth = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5), mat(0xe08a5a));
  booth.position.set(9, 1.7, 4);
  booth.castShadow = true;
  group.add(booth);
  group.position.set(-40, 0, 205);
  game.scene.add(group);
  game.colliders.push({ x: -40, z: 205, hw: 7, hd: 7 });
  return group;
}

// The pier: a wooden deck walking out over the water from the beach, with
// rails and posts. It has no collider — it is thin, at the map edge, and
// the beach marker sits just north of it.
function makePier(game) {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 36), mat(0x8a6a4a, { roughness: 0.95 }));
  deck.position.set(0, 1, 16);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 36), mat(0x6a4a2a));
    rail.position.set(side * 2.9, 1.8, 16);
    group.add(rail);
  }
  for (let i = 0; i < 5; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 8), mat(0x5a4030));
    post.position.set(i % 2 === 0 ? -2.4 : 2.4, 0, 2 + i * 8);
    group.add(post);
  }
  group.position.set(0, 0, 212);
  game.scene.add(group);
  return group;
}

// The ground, the roads, the sand and the sea.
function layGround(game) {
  const scene = game.scene;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), mat(0xa8b09a, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Sand band along the south shore, then the water past it.
  slab(scene, 0, 208, 560, 20, 0xe0cfa0, 0.015);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a6a9a, roughness: 0.25, metalness: 0.15 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.12, 242);
  scene.add(sea);
  game.sea = sea;
  // Roads: one dark strip per grid line on each axis, with a thin centre
  // line. The two directions sit at slightly different heights so the
  // crossings do not z-fight.
  for (const line of game.roads.xs) {
    slab(scene, 0, line, 480, WORLD.roadWidth, 0x3a3f46, 0.02);
    slab(scene, 0, line, 480, 0.3, 0xd9c05a, 0.05);
    slab(scene, line, 0, WORLD.roadWidth, 480, 0x3a3f46, 0.035);
    slab(scene, line, 0, 0.3, 480, 0xd9c05a, 0.06);
  }
}

// Decide what a block holds from where its centre sits: towers near the
// middle, warehouses on the east docks, bright shops by the beach, houses
// everywhere else. The centre block is a park — open ground with palms —
// so the title orbit has somewhere green to look at.
function fillBlock(game, x0, x1, z0, z1) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = x1 - x0;
  const d = z1 - z0;
  // Central park.
  if (Math.abs(cx) < 45 && Math.abs(cz) < 45) {
    for (let i = 0; i < 6; i++) {
      palm(game, cx + rand(-16, 16), cz + rand(-16, 16), rand(0.8, 1.2));
    }
    slab(game.scene, cx, cz, 26, 26, 0x8aa07a, 0.015);
    return;
  }
  // East docks: long warehouses.
  if (cx > 120 && cz > 0) {
    building(game, cx, cz, 30, rand(8, 12), 16, pick(DOCK_COLORS), 3);
    return;
  }
  // Beach row: low bright shops.
  if (cz > 120) {
    const n = 2;
    for (let i = 0; i < n; i++) {
      const bx = x0 + ((i + 0.5) / n) * w + rand(-3, 3);
      building(game, bx, cz + rand(-4, 4), 13, rand(6, 9), 12, pick(SHOP_COLORS), 2);
    }
    return;
  }
  // Downtown: one tall tower.
  if (Math.abs(cx) <= 90 && Math.abs(cz) <= 90) {
    building(game, cx + rand(-3, 3), cz + rand(-3, 3), rand(20, 26), rand(26, 58), rand(20, 26), pick(TOWER_COLORS), Math.floor(rand(0, 4)));
    return;
  }
  // Mid ring: one or two mid-rise blocks.
  if (Math.abs(cx) <= 150 && Math.abs(cz) <= 150) {
    building(game, cx - w * 0.2, cz, 16, rand(11, 20), 15, pick(MID_COLORS), 0);
    if (Math.random() < 0.6) {
      building(game, cx + w * 0.22, cz + d * 0.15, 13, rand(9, 16), 12, pick(MID_COLORS), 2);
    }
    return;
  }
  // Outer ring: small houses.
  const spots = [
    [x0 + w * 0.28, z0 + d * 0.3],
    [x0 + w * 0.72, z0 + d * 0.3],
    [x0 + w * 0.28, z0 + d * 0.72],
    [x0 + w * 0.72, z0 + d * 0.72],
  ];
  for (const [hx, hz] of spots) {
    if (Math.random() < 0.85) {
      building(game, hx, hz, rand(9, 12), rand(6, 10), rand(9, 12), pick(HOUSE_COLORS), Math.floor(rand(0, 4)));
    }
  }
}

// The story landmarks, placed in the blocks beside their markers so the
// marker itself stays on open road: the bank, the hospital, Mara's garage,
// the paint shop, the showroom lot and the hideout house.
function placeLandmarks(game) {
  // Harbor Bank: stone block with a columned front, just off its marker.
  building(game, 18, 78, 22, 16, 18, 0xc9c2b0, 2);
  // St. Aurelia Hospital: white block with a red cross on the roof.
  const hosp = building(game, -102, -42, 26, 18, 20, 0xe8e8e8, 0);
  const cross1 = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 2), mat(0xc0392b));
  cross1.position.set(0, 19.5, 0);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 6), mat(0xc0392b));
  cross2.position.set(0, 19.5, 0);
  hosp.add(cross1);
  hosp.add(cross2);
  // Mara's garage: low wide shed with a big door facing the road.
  building(game, -42, 78, 24, 8, 16, 0x7a6a5a, 2);
  // Paint shop: a colourful low shop on Harbor Row.
  building(game, 78, 138, 18, 7, 14, 0x5aa8c0, 2);
  // Showroom: a glass-front lot building; the Comet sits on the open
  // ground in front of it, on the marker.
  const show = building(game, 78, -102, 24, 9, 18, 0x2a3a4a, 2);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 0.2), WINDOW_MAT);
  glass.position.set(0, 3.4, -9.1);
  show.add(glass);
  // Hideout: a small house tucked in the north-west corner.
  building(game, -102, -162, 12, 7, 11, 0xd9c9a8, 0);
  // Docks warehouses along the east strip, east of the docks marker.
  building(game, 205, 90, 26, 10, 18, pick(DOCK_COLORS), 3);
  building(game, 205, 150, 26, 11, 18, pick(DOCK_COLORS), 3);
  // A couple of dock cranes: simple frames over the water edge.
  for (const cz of [100, 160]) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2, 26, 2), mat(0xd9a03a));
    mast.position.y = 13;
    mast.castShadow = true;
    crane.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 22), mat(0xd9a03a));
    arm.position.set(0, 25, 8);
    crane.add(arm);
    crane.position.set(215, 0, cz);
    game.scene.add(crane);
    game.colliders.push({ x: 215, z: cz, hw: 2, hd: 2 });
  }
}

export function buildCity(game) {
  layGround(game);
  // Blocks between the grid lines, inset by the setback.
  const lines = game.roads.xs;
  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      const x0 = lines[i] + SETBACK;
      const x1 = lines[i + 1] - SETBACK;
      const z0 = lines[j] + SETBACK;
      const z1 = lines[j + 1] - SETBACK;
      // The south row of blocks backs onto the beach, not more city.
      if (lines[j] >= 180) continue;
      fillBlock(game, x0, x1, z0, z1);
    }
  }
  // A few houses in the north and west edge strips, clear of the roads.
  for (const [hx, hz] of [[-205, -60], [-205, 60], [205, -60], [-60, -205], [60, -205], [-150, -205]]) {
    building(game, hx, hz, rand(10, 13), rand(6, 9), rand(10, 12), pick(HOUSE_COLORS), Math.floor(rand(0, 4)));
  }
  placeLandmarks(game);
  // Palms along the beach.
  for (let i = 0; i < 12; i++) {
    palm(game, -150 + i * 27 + rand(-6, 6), rand(192, 206), rand(0.9, 1.3));
  }
  makePier(game);
  game.ferris = makeFerris(game);
  game.beacon = makeBeacon(game);
  // Named places, as vectors the beacon and the mission checks can use.
  for (const [key, [x, z]] of Object.entries(PLACES)) {
    game.markers[key] = new THREE.Vector3(x, 0, z);
  }
  // The sun: a warm directional light the main loop lifts to midday.
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0005;
  game.scene.add(sun);
  game.sun = sun;
}
