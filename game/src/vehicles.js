// Neon Harbor — cars: building, parking, traffic, stealing, driving.
//
// A car is a plain object with a THREE group for a mesh. Heading uses
// the same convention as the player: forward is (sin h, cos h), so a
// heading of 0 points north. Cars drive with a sustained-acceleration
// model — hold W to build speed, S to brake or reverse — and take
// damage from hard hits: below 60 health they lose pace, below 35 they
// trail smoke from the hood, at 0 they are disabled and will not move
// until the Pay N Spray fixes them.
//
// Stealing is measured to the car's oriented body box, not its centre,
// so the prompt appears from any side of the car out to STEAL_REACH.

import * as THREE from 'three';
import { WORLD, clamp, rand, pick, angleLerp, collideCircle } from './state.js';

export const STEAL_REACH = 5;

const CAR_COLORS = [
  0xc83a3a, 0x3a6ac8, 0x3a9a4a, 0xd8d8d8, 0x2a2a2e, 0xe8e8e8,
  0xd8a83a, 0x8a5ac8, 0x3aa8c8, 0xc86a3a, 0x7a8a9a, 0x4a5a6a,
];
const CAR_NAMES = [
  'Sundowner', 'Harbor LX', 'Coastal', 'Bay Runner', 'Neon Coupe',
  'Pier Cruiser', 'Sunset GT', 'Dockside', 'Marina', 'Palma',
];
const VAN_NAMES = ['Hauler', 'Cargo King', 'Dock Van'];

const WHEEL_SPOTS = [
  [-1, 0.32], [1, 0.32], [-1, -0.32], [1, -0.32],
];

// --- mesh building -------------------------------------------------------

// Build a car mesh. Returns { group, wheels } — wheels spin with speed.
export function makeCarMesh(color, isVan = false, isPolice = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: isPolice ? 0x1a1a22 : color,
    roughness: 0.35,
    metalness: 0.55,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x182838, roughness: 0.15, metalness: 0.7,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 });
  const len = isVan ? 5.4 : 4.4;
  const wid = isVan ? 2.1 : 1.9;

  const body = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.75, len), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);

  if (isVan) {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(wid - 0.1, 1.5, len * 0.62), paint);
    cargo.position.set(0, 1.5, -len * 0.14);
    cargo.castShadow = true;
    group.add(cargo);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(wid - 0.2, 0.8, 1.1), glass);
    cab.position.set(0, 1.25, len * 0.32);
    group.add(cab);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(wid - 0.25, 0.65, len * 0.48), glass);
    cabin.position.set(0, 1.28, -len * 0.06);
    cabin.castShadow = true;
    group.add(cabin);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(wid - 0.15, 0.22, len * 0.22), paint);
    hood.position.set(0, 1.0, len * 0.36);
    group.add(hood);
  }

  // Bumpers, headlights and tail lights.
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.06, 0.28, 0.25), dark);
  bumperF.position.set(0, 0.42, len / 2);
  group.add(bumperF);
  const bumperR = bumperF.clone();
  bumperR.position.z = -len / 2;
  group.add(bumperR);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2b0, emissive: 0xffe9a0, emissiveIntensity: 0.7, roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xc82828, emissive: 0x881818, emissiveIntensity: 0.6,
  });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.1), headMat);
    hl.position.set(s * (wid / 2 - 0.35), 0.72, len / 2 + 0.02);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.1), tailMat);
    tl.position.set(s * (wid / 2 - 0.35), 0.72, -len / 2 - 0.02);
    group.add(tl);
  }

  if (isPolice) {
    // White doors and a red/blue light bar.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(wid + 0.04, 0.5, len * 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.3 }),
    );
    door.position.set(0, 0.62, 0);
    group.add(door);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.35), dark);
    barBase.position.set(0, 1.72, -len * 0.06);
    group.add(barBase);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.36),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 1 }),
    );
    red.position.set(-0.28, 1.78, -len * 0.06);
    group.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x2040ff, emissiveIntensity: 1 }),
    );
    blue.position.set(0.28, 1.78, -len * 0.06);
    group.add(blue);
    group.userData.lightRed = red;
    group.userData.lightBlue = blue;
  }

  // Wheels.
  const wheels = [];
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.8 });
  for (const [sx, sz] of WHEEL_SPOTS) {
    const wheel = new THREE.Group();
    const tyreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14), tyreMat);
    tyreMesh.rotation.z = Math.PI / 2;
    tyreMesh.castShadow = true;
    wheel.add(tyreMesh);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(sx * wid / 2, 0.36, sz * len);
    group.add(wheel);
    wheels.push(wheel);
  }

  group.userData.length = len;
  group.userData.width = wid;
  return { group, wheels };
}

// --- car lifecycle --------------------------------------------------------

export function createCar(world, opts = {}) {
  const game = world;
  const color = opts.color ?? pick(CAR_COLORS);
  const isVan = !!opts.isVan;
  const isPolice = !!opts.isPolice;
  const { group, wheels } = makeCarMesh(color, isVan, isPolice);
  const heading = opts.heading ?? rand(0, Math.PI * 2);
  const car = {
    pos: new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0),
    speed: 0,
    heading,
    health: opts.health ?? 100,
    maxHealth: 100,
    mesh: group,
    wheels,
    length: isVan ? 5.4 : 4.4,
    width: isVan ? 2.1 : 1.9,
    roadAxis: opts.roadAxis || null,
    roadLine: opts.roadLine ?? null,
    traffic: !!opts.traffic,
    cruise: opts.cruise ?? rand(10, 14),
    turnCooldown: 0,
    smokeTimer: 0,
    bumpCooldown: 0, // one bump-damage tick per second, see drivePlayerCar
    parked: !!opts.parked,
    owned: false,
    name: opts.name || (isVan ? pick(VAN_NAMES) : pick(CAR_NAMES)),
    dir: opts.dir ?? (Math.random() < 0.5 ? 1 : -1),
    model: opts.model || (isVan ? 'van' : 'sedan'),
    isPolice,
    isVan,
    color,
    special: opts.special || null,
  };
  group.position.copy(car.pos);
  group.rotation.y = heading;
  game.scene.add(group);
  game.cars.push(car);
  if (car.traffic) game.traffic.push(car);
  return car;
}

// Park a spread of cars along road edges near the places missions visit,
// so there is always a car to steal within a short walk of the paint
// shop, the spray pad, the showroom and the garage.
export function spawnParkedCars(world) {
  const game = world;
  const spots = [];
  // Along the east-west road at z = 120, near the paint shop (60, 120).
  for (const x of [36, 48, 72, 84, 96]) spots.push({ x, z: 126.5, heading: 0 });
  for (const x of [24, 108]) spots.push({ x, z: 113.5, heading: -Math.PI / 2 });
  // Along the north-south road at x = 120, near the spray pad (120, 60).
  for (const z of [36, 48, 84, 96]) spots.push({ x: 126.5, z, heading: 0 });
  for (const z of [24, 108]) spots.push({ x: 113.5, z, heading: Math.PI });
  // Near the showroom (180, 60) and the garage (-120, 60).
  for (const z of [36, 48, 84]) spots.push({ x: 186.5, z, heading: 0 });
  for (const z of [48, 72, 96]) spots.push({ x: -113.5, z, heading: Math.PI });
  // Near the hideout, hospital and bank.
  for (const [x, z, h] of [
    [12, -174, Math.PI / 2], [-12, -174, -Math.PI / 2],
    [126, -114, Math.PI / 2], [114, -126, 0],
    [-48, -54, Math.PI / 2], [-72, -66, -Math.PI / 2],
    [24, 180, Math.PI / 2], [-24, 180, -Math.PI / 2],
  ]) spots.push({ x, z, heading: h });
  // A few extra scattered cars so the city never feels empty.
  for (let i = 0; i < 10; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(game.roads.xs);
    const along = rand(-170, 170);
    const off = Math.random() < 0.5 ? 6.5 : -6.5;
    if (axis === 'x') spots.push({ x: along, z: line + off, heading: Math.PI / 2 });
    else spots.push({ x: line + off, z: along, heading: 0 });
  }
  const made = [];
  for (const s of spots) {
    made.push(createCar(game, {
      x: s.x, z: s.z, heading: s.heading, parked: true,
    }));
  }
  return made;
}

// Flowing traffic: cars cruise the grid roads at a steady pace.
export function spawnTraffic(world, count = 14) {
  const game = world;
  const made = [];
  for (let i = 0; i < count; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(game.roads.xs);
    const along = rand(-180, 180);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x = axis === 'x' ? along : line;
    const z = axis === 'x' ? line : along;
    const heading = axis === 'x'
      ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (dir > 0 ? 0 : Math.PI);
    made.push(createCar(game, {
      x, z, heading, traffic: true, roadAxis: axis, roadLine: line,
      dir, cruise: rand(9, 14), isVan: Math.random() < 0.15,
    }));
  }
  return made;
}

// --- damage ---------------------------------------------------------------

// Speed multiplier from health: full pace above 60, slower below 60,
// limping below 35, dead at 0.
export function damageFactor(car) {
  if (car.health <= 0) return 0;
  if (car.health < 35) return 0.45;
  if (car.health < 60) return 0.7;
  return 1;
}

export function damageCar(world, car, amount) {
  const game = world;
  if (!car || car.health <= 0) return;
  car.health = Math.max(0, car.health - amount);
  if (game.fx) {
    const at = car.pos.clone();
    at.y = 1;
    game.fx.burst(at, 0xffc860, Math.min(10, 3 + Math.floor(amount / 4)), 5, 0.5);
  }
  if (game.audio) game.audio.crash();
  if (car.health === 0 && game.hud) game.hud.feed('The car is wrecked — it will not move.');
}

// --- steal range ----------------------------------------------------------

// Distance from a point to the car's oriented body box. Zero inside the
// box, otherwise the distance to the nearest edge — so standing at the
// nose, the tail or either door all count the same way.
export function carBoxDistance(car, x, z) {
  const dx = x - car.pos.x;
  const dz = z - car.pos.z;
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  // Rotate into the car's frame: forward is +z there.
  const localX = dx * ch - dz * sh;
  const localZ = dx * sh + dz * ch;
  const hx = car.width / 2;
  const hz = car.length / 2;
  const ox = Math.max(Math.abs(localX) - hx, 0);
  const oz = Math.max(Math.abs(localZ) - hz, 0);
  return Math.hypot(ox, oz);
}

export function nearestCar(world, pos, maxDist = STEAL_REACH) {
  const game = world;
  let best = null;
  let bestD = maxDist;
  for (const car of game.cars) {
    if (car.isPolice) continue;
    const d = carBoxDistance(car, pos.x, pos.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// --- entering / exiting ----------------------------------------------------

export function enterCar(world, car) {
  const game = world;
  const player = game.player;
  if (!player || !car || player.car) return false;
  car.parked = false;
  car.traffic = false;
  car.owned = true;
  const idx = game.traffic.indexOf(car);
  if (idx >= 0) game.traffic.splice(idx, 1);
  player.car = car;
  player.pos.copy(car.pos);
  player.pos.y = 0;
  if (player.mesh) player.mesh.visible = false;
  if (player.group) player.group.visible = false;
  game.stats.carsStolen += 1;
  if (game.audio) game.audio.click();
  return true;
}

export function exitCar(world) {
  const game = world;
  const player = game.player;
  if (!player || !player.car) return false;
  const car = player.car;
  car.speed = 0;
  // Step out on the driver's side, clear of the body.
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  const sideX = car.pos.x + ch * 2.2;
  const sideZ = car.pos.z - sh * 2.2;
  player.pos.set(sideX, 0, sideZ);
  player.car = null;
  if (player.mesh) player.mesh.visible = true;
  if (player.group) player.group.visible = true;
  return true;
}

// --- driving ---------------------------------------------------------------

// Drive the player's car for one frame. Sustained acceleration: holding
// W builds speed, S brakes then reverses, A/D steer, Space handbrakes.
// Building hits damage the car; a wrecked car does not move at all.
export function drivePlayerCar(world, dt) {
  const game = world;
  const player = game.player;
  const car = player ? player.car : null;
  if (!car) return;
  const keys = game.input.keys;
  const factor = damageFactor(car);
  car.bumpCooldown = Math.max(0, (car.bumpCooldown || 0) - dt);
  const topSpeed = 30 * factor;
  const reverseTop = 9 * factor;
  const accel = 15 * factor;
  const brake = 26;

  if (factor <= 0) {
    car.speed = 0;
  } else if (keys.has('KeyW')) {
    car.speed += accel * dt;
  } else if (keys.has('KeyS')) {
    if (car.speed > 0.5) car.speed -= brake * dt;
    else car.speed -= accel * 0.55 * dt;
  } else {
    // Rolling drag when no pedal is pressed.
    car.speed -= car.speed * 1.1 * dt;
    if (Math.abs(car.speed) < 0.15) car.speed = 0;
  }
  if (keys.has('Space')) car.speed -= car.speed * 4 * dt;
  car.speed = clamp(car.speed, -reverseTop, topSpeed);

  // Steering bites harder at low speed, less at full speed.
  const steerInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  const steerAuthority = clamp(Math.abs(car.speed) / 8, 0, 1) * 1.9;
  const dirSign = car.speed >= 0 ? 1 : -1;
  car.heading += steerInput * steerAuthority * dirSign * dt;

  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const stepLen = car.speed * dt;
  let nx = car.pos.x + fx * stepLen;
  let nz = car.pos.z + fz * stepLen;

  // Buildings: slide around them, and take damage on a hard hit.
  const res = game.colliders.length ? collideCircle(game, nx, nz, 1.7) : { hit: false, x: nx, z: nz };
  if (res.hit) {
    const impact = Math.abs(car.speed);
    nx = res.x;
    nz = res.z;
    if (impact > 7) {
      damageCar(game, car, Math.min(22, (impact - 7) * 1.6));
      if (game.fx) game.fx.shake(Math.min(0.5, impact * 0.02));
    }
    car.speed *= -0.25;
  }

  // Other cars: a soft shove and a little damage both ways.
  for (const other of game.cars) {
    if (other === car) continue;
    const dx = nx - other.pos.x;
    const dz = nz - other.pos.z;
    const d = Math.hypot(dx, dz);
    const minD = 3.4;
    if (d > 0.01 && d < minD) {
      const push = (minD - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      nx += ux * push;
      nz += uz * push;
      if (!other.traffic && Math.abs(car.speed) > 6 && car.bumpCooldown <= 0) {
        // One tick per shunt, not per frame: without the cooldown a
        // cruiser pinning the car costs 4 hp every frame (up to 80/s),
        // which turns the "shunt, not an execution" ram into a kill.
        damageCar(game, car, 4);
        damageCar(game, other, 4);
        car.bumpCooldown = 1;
      }
      if (other.traffic) {
        other.pos.x -= ux * push;
        other.pos.z -= uz * push;
      }
    }
  }

  car.pos.set(nx, 0, nz);
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  // Spin the wheels with the road speed.
  const spin = (car.speed * dt) / 0.36;
  for (const w of car.wheels) w.rotation.x += spin;

  // The player rides with the car.
  player.pos.copy(car.pos);
  player.heading = car.heading;

  // Smoke from the hood once the car is badly hurt.
  if (car.health > 0 && car.health < 35 && game.fx) {
    car.smokeTimer -= dt;
    if (car.smokeTimer <= 0) {
      car.smokeTimer = 0.12;
      const hood = car.pos.clone();
      hood.x += fx * (car.length / 2 - 0.4);
      hood.z += fz * (car.length / 2 - 0.4);
      hood.y = 1.1;
      game.fx.smokePuff(hood);
    }
  }

  // Engine sound follows speed.
  if (game.audio) game.audio.setEngine(clamp(Math.abs(car.speed) / 30, 0, 1), true);
}

// --- traffic ----------------------------------------------------------------

export function updateTraffic(world, dt) {
  const game = world;
  for (const car of game.traffic) {
    car.turnCooldown -= dt;
    // Slow down for a car stopped ahead in the same lane.
    let blocked = false;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of game.cars) {
      if (other === car) continue;
      const ox = other.pos.x - car.pos.x;
      const oz = other.pos.z - car.pos.z;
      const ahead = ox * fx + oz * fz;
      const lat = Math.abs(fx * oz - fz * ox);
      if (ahead > 0 && ahead < 11 && lat < 2.6) { blocked = true; break; }
    }
    const target = blocked ? 0 : car.cruise;
    car.speed += (target - car.speed) * Math.min(1, 1.6 * dt);

    let nx = car.pos.x + fx * car.speed * dt;
    let nz = car.pos.z + fz * car.speed * dt;

    // At an intersection, sometimes turn onto the cross road.
    const nearX = car.roadAxis === 'x'
      ? game.roads.xs.reduce((a, b) => (Math.abs(b - car.pos.x) < Math.abs(a - car.pos.x) ? b : a))
      : null;
    const nearZ = car.roadAxis === 'z'
      ? game.roads.zs.reduce((a, b) => (Math.abs(b - car.pos.z) < Math.abs(a - car.pos.z) ? b : a))
      : null;
    const onJunction = car.turnCooldown <= 0 && (
      (car.roadAxis === 'x' && Math.abs(car.pos.x - (nearX ?? 999)) < 2.5) ||
      (car.roadAxis === 'z' && Math.abs(car.pos.z - (nearZ ?? 999)) < 2.5)
    );
    if (onJunction && Math.random() < 0.35) {
      const turnLeft = Math.random() < 0.5;
      if (car.roadAxis === 'x') {
        car.roadAxis = 'z';
        car.roadLine = nearX;
        car.pos.x = nearX;
      } else {
        car.roadAxis = 'x';
        car.roadLine = nearZ;
        car.pos.z = nearZ;
      }
      car.heading += turnLeft ? -Math.PI / 2 : Math.PI / 2;
      car.turnCooldown = 4;
      // Recompute the step from the turned heading.
      nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
      nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
    } else if (car.roadAxis === 'x') {
      nz = car.roadLine;
    } else if (car.roadAxis === 'z') {
      nx = car.roadLine;
    }

    // Reverse direction at the edge of the map instead of driving off it.
    if (nx > WORLD.half - 6 || nx < -WORLD.half + 6 || nz > WORLD.half - 6 || nz < -WORLD.half + 6) {
      car.heading += Math.PI;
      car.dir *= -1;
      nx = clamp(nx, -WORLD.half + 8, WORLD.half - 8);
      nz = clamp(nz, -WORLD.half + 8, WORLD.half - 8);
    }

    car.pos.set(nx, 0, nz);
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    const spin = (car.speed * dt) / 0.36;
    for (const w of car.wheels) w.rotation.x += spin;
  }
}

// Ease a car's heading toward a target (used by police steering).
// Exported here for reuse by other modules.
export function easeHeading(car, target, dt) {
  car.heading = angleLerp(car.heading, target, Math.min(1, 3 * dt));
}
