// Neon Harbor — cars.
//
// Everything about vehicles lives here: building the meshes, spawning
// parked cars and traffic, the damage model, stealing, and the driving
// model for the car the player is in. A car is a plain object:
//
//   { name, model, color, pos (Vector3), heading, speed, health,
//     parked, isPolice, isVan, owned, roadblock, mesh, wheels }
//
// Heading is measured so that the car's nose points along
// (sin h, 0, cos h): heading 0 drives toward +z, PI/2 toward +x.
// The player steals with E from any side of the car — the reach is
// measured to the car's oriented body box, not to its centre, so the
// nose and tail count too.

import * as THREE from 'three';
import {
  WORLD, clamp, rand, randInt, pick, dist2D, angleLerp,
  inWorldBounds, collideCircle, vec3,
} from './state.js';

export const STEAL_REACH = 5;

const GRID = [-180, -120, -60, 0, 60, 120, 180];
const PAINT = [
  0xc0392b, 0x2471a3, 0x229954, 0xd4ac0d, 0x7d3c98, 0xe67e22,
  0x1a1a1a, 0xe8e8e8, 0x5dade2, 0x48c9b0, 0xf1948a, 0x85c1e9,
];
const NAMES = ['Sedan', 'Hatchback', 'Coupe', 'Pickup', 'Sedan', 'Coupe'];

// ---------------------------------------------------------------- meshes

// A low-poly car: body slab, cabin, wheels, headlights and taillights.
// The model faces +z locally, so mesh.rotation.y = heading points it
// the way the car is driving.
export function makeCarMesh(color, isVan, isPolice) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

  const len = isVan ? 5.8 : 4.4;
  const bodyH = isVan ? 1.5 : 0.85;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, bodyH, len), paint);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const cabinLen = isVan ? 3.4 : 2.1;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, cabinLen), glass);
  cabin.position.set(0, 1.45, isVan ? 0.4 : -0.25);
  cabin.castShadow = true;
  group.add(cabin);

  if (isVan) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 2.2), paint);
    box.position.set(0, 1.6, -1.4);
    box.castShadow = true;
    group.add(box);
  }

  // Wheels.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  for (const [wx, wz] of [[-0.95, len / 2 - 0.8], [0.95, len / 2 - 0.8], [-0.95, -len / 2 + 0.8], [0.95, -len / 2 + 0.8]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  // Headlights and taillights.
  const lampGeo = new THREE.BoxGeometry(0.35, 0.18, 0.08);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const lx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(lx, 0.8, len / 2 + 0.01);
    group.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const lx of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(lampGeo, tailMat);
    lamp.position.set(lx, 0.8, -len / 2 - 0.01);
    group.add(lamp);
  }

  if (isPolice) {
    // Black-and-white cruiser with a light bar.
    const doors = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.5, 1.6),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
    );
    doors.position.set(0, 0.85, 0.1);
    group.add(doors);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.18, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    bar.position.set(0, 1.95, -0.25);
    group.add(bar);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    );
    red.position.set(-0.32, 2.06, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x2040ff }),
    );
    blue.position.set(0.32, 2.06, -0.25);
    group.add(blue);
  }

  group.userData.wheels = wheels;
  group.userData.length = len;
  return group;
}

// ---------------------------------------------------------------- create

export function createCar(world, opts = {}) {
  const isVan = !!opts.isVan;
  const isPolice = !!opts.isPolice;
  const color = opts.color !== undefined ? opts.color : pick(PAINT);
  const name = opts.name || opts.model || (isPolice ? 'Police Cruiser' : isVan ? 'Van' : pick(NAMES));
  const mesh = makeCarMesh(color, isVan, isPolice);
  const x = opts.x ?? 0;
  const z = opts.z ?? 0;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = opts.heading ?? 0;
  world.scene.add(mesh);
  const car = {
    name,
    model: name,
    color,
    pos: vec3(x, 0, z),
    heading: opts.heading ?? 0,
    speed: 0,
    health: opts.health !== undefined ? opts.health : 100,
    maxHealth: 100,
    parked: opts.parked !== undefined ? opts.parked : true,
    isPolice,
    isVan,
    owned: !!opts.owned,
    roadblock: !!opts.roadblock,
    traffic: false,
    mesh,
    wheels: mesh.userData.wheels,
    length: mesh.userData.length,
    smokeTimer: 0,
    ramCooldown: 0,
    roadAxis: null,
    roadLine: 0,
    dir: 1,
    cruise: 10,
    turnCooldown: 0,
  };
  world.cars.push(car);
  return car;
}

// Parked cars line the roads. A couple are placed deliberately near
// every named marker so the player can always find wheels nearby, and
// the rest are scattered along the grid with axis-aligned headings.
// The paint-shop cars sit about 28 m out: the first job is a short
// drive to the shop, and the car must cover real ground before the
// delivery radius catches it.
export function spawnParkedCars(world) {
  const spots = [];
  const markerKeys = ['paintShop', 'spray', 'garage', 'showroom', 'docks', 'bank', 'hideout', 'hospital', 'warehouse', 'beach'];
  for (const key of markerKeys) {
    const m = world.markers[key];
    if (!m) continue;
    spots.push({ x: m.x + 3.5, z: m.z - 28, heading: 0 });
    spots.push({ x: m.x - 3.5, z: m.z + 28, heading: Math.PI });
  }
  for (let i = 0; i < 26; i++) {
    const vertical = Math.random() < 0.5;
    const line = pick(GRID);
    const along = pick(GRID) + rand(-24, 24);
    if (vertical) {
      spots.push({ x: line + (Math.random() < 0.5 ? 3.5 : -3.5), z: clamp(along, -170, 170), heading: Math.random() < 0.5 ? 0 : Math.PI });
    } else {
      spots.push({ x: clamp(along, -170, 170), z: line + (Math.random() < 0.5 ? 3.5 : -3.5), heading: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  const paintShop = world.markers.paintShop;
  for (const s of spots) {
    // Never park on top of a building, and keep the paint shop's
    // approach clear so the first job is a drive, not a tap.
    if (collideCircle(world, s.x, s.z, 2).hit) continue;
    if (paintShop && Math.hypot(s.x - paintShop.x, s.z - paintShop.z) < 24) continue;
    createCar(world, {
      x: s.x, z: s.z, heading: s.heading,
      color: pick(PAINT), name: pick(NAMES), parked: true,
    });
  }
}

// Traffic: cars that cruise the grid forever, turning at intersections
// now and then. They keep to the right-hand lane of their road.
export function spawnTraffic(world, count) {
  for (let i = 0; i < count; i++) {
    const vertical = Math.random() < 0.5;
    const line = pick(GRID);
    const along = rand(-175, 175);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const lane = 2.4;
    let car;
    if (vertical) {
      car = createCar(world, {
        x: line + lane * dir, z: along,
        heading: dir > 0 ? 0 : Math.PI,
        color: pick(PAINT), name: pick(NAMES), parked: false,
      });
      car.roadAxis = 'x';
      car.roadLine = line;
    } else {
      car = createCar(world, {
        x: along, z: line - lane * dir,
        heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        color: pick(PAINT), name: pick(NAMES), parked: false,
      });
      car.roadAxis = 'z';
      car.roadLine = line;
    }
    car.dir = dir;
    car.traffic = true;
    car.cruise = rand(8, 13);
    car.speed = car.cruise;
    world.traffic.push(car);
  }
}

// ---------------------------------------------------------------- damage

export function damageFactor(car) {
  if (car.health >= 60) return 1;
  if (car.health >= 35) return 0.75;
  if (car.health > 0) return 0.5;
  return 0;
}

export function damageCar(world, car, amount) {
  if (!car || amount <= 0) return;
  car.health = Math.max(0, car.health - amount);
  if (car.health <= 0) {
    car.health = 0;
    car.speed = 0;
    if (world.audio) world.audio.crash();
  }
}

// Distance from a point to the car's oriented body box. Zero when the
// point is inside the box, so a player standing at the nose or the tail
// is in reach even though the centre is metres away.
export function carBoxDistance(car, x, z) {
  const dx = x - car.pos.x;
  const dz = z - car.pos.z;
  const s = Math.sin(car.heading);
  const c = Math.cos(car.heading);
  const side = dx * c - dz * s;
  const fwd = dx * s + dz * c;
  const halfW = 1.1;
  const halfL = car.length / 2;
  const qx = clamp(side, -halfW, halfW);
  const qz = clamp(fwd, -halfL, halfL);
  return Math.hypot(side - qx, fwd - qz);
}

export function nearestCar(world, pos, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of world.cars) {
    if (car === world.player.car) continue;
    const d = carBoxDistance(car, pos.x, pos.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

// ---------------------------------------------------------------- enter/exit

export function enterCar(world, car) {
  const player = world.player;
  if (!player || !car) return false;
  if (car.isPolice) {
    if (world.hud) world.hud.showMessage("You can't steal a police cruiser.");
    return false;
  }
  if (player.car === car) return true;
  // Taking a car that was never yours is grand theft auto.
  if (!car.owned) {
    car.owned = true;
    if (world.police) world.police.addWanted(world, 1, 'Grand theft auto');
    if (world.stats) world.stats.carsStolen += 1;
    if (world.hud) world.hud.showMessage(`You stole the ${car.name}!`);
  }
  if (car.traffic) {
    car.traffic = false;
    const at = world.traffic.indexOf(car);
    if (at >= 0) world.traffic.splice(at, 1);
  }
  car.parked = false;
  player.car = car;
  player.pos.copy(car.pos);
  player.heading = car.heading;
  if (world.audio) world.audio.setEngine(0, true);
  return true;
}

export function exitCar(world) {
  const player = world.player;
  const car = player && player.car;
  if (!car) return false;
  car.parked = true;
  car.speed = 0;
  // Step out on the passenger side.
  const s = Math.cos(car.heading);
  const c = -Math.sin(car.heading);
  const px = car.pos.x + s * 2.6;
  const pz = car.pos.z + c * 2.6;
  if (!collideCircle(world, px, pz, 0.6).hit) {
    player.pos.set(px, 0, pz);
  } else {
    player.pos.set(car.pos.x - s * 2.6, 0, car.pos.z - c * 2.6);
  }
  player.heading = car.heading;
  player.car = null;
  if (world.audio) world.audio.setEngine(0, false);
  return true;
}

// ---------------------------------------------------------------- driving

// The player's car: W/S for throttle and brake/reverse, A/D to steer
// (steering bites harder the faster the car goes, and flips in
// reverse), Space for the handbrake. Buildings stop the car with a
// shunt and a dent; other cars get shoved aside with a smaller dent.
export function drivePlayerCar(world, dt) {
  const car = world.player && world.player.car;
  if (!car) return;
  const keys = world.input.keys;
  const factor = damageFactor(car);
  if (car.health <= 0) {
    car.speed = 0;
    if (world.audio) world.audio.setEngine(0, false);
    return;
  }
  const topSpeed = 28 * factor;
  const accel = 13 * factor;
  const reversing = car.speed < -0.1;
  const steerDir = reversing ? -1 : 1;
  const grip = clamp(Math.abs(car.speed) / 6, 0, 1);
  if (keys.has('KeyA')) car.heading += 1.9 * grip * steerDir * dt;
  if (keys.has('KeyD')) car.heading -= 1.9 * grip * steerDir * dt;
  if (keys.has('KeyW')) car.speed += accel * dt;
  if (keys.has('KeyS')) {
    if (car.speed > 0.5) car.speed -= 22 * dt;
    else car.speed -= 8 * factor * dt;
  }
  if (keys.has('Space')) car.speed *= Math.max(0, 1 - 3.2 * dt);
  // Rolling drag, then clamp.
  car.speed -= car.speed * 0.35 * dt;
  if (car.speed > topSpeed) car.speed = topSpeed;
  if (car.speed < -9 * factor) car.speed = -9 * factor;
  if (Math.abs(car.speed) < 0.05 && !keys.has('KeyW') && !keys.has('KeyS')) car.speed = 0;

  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const inBounds = inWorldBounds(nx, nz);
  const bx = clamp(nx, -WORLD.half + 4, WORLD.half - 4);
  const bz = clamp(nz, -WORLD.half + 4, WORLD.half - 4);
  // collideCircle resolves a push-out position, but for the player's car
  // the test alone is what matters: a car teleported deep inside a
  // block must stay put, not be shoved out into the open.
  const hitWall = !inBounds || collideCircle(world, nx, nz, 1.7).hit;
  if (!hitWall) {
    car.pos.x = nx;
    car.pos.z = nz;
  } else {
    // Slide along the wall on one axis if that way is clear.
    let slid = false;
    if (!collideCircle(world, nx, car.pos.z, 1.7).hit && inWorldBounds(nx, car.pos.z)) {
      car.pos.x = nx;
      slid = true;
    } else if (!collideCircle(world, car.pos.x, nz, 1.7).hit && inWorldBounds(car.pos.x, nz)) {
      car.pos.z = nz;
      slid = true;
    }
    if (!slid) {
      const impact = Math.abs(car.speed);
      // Even a corner tap at low speed dents the car: the ram test
      // drives at a building's corner, so the car only carries a few
      // metres of speed into the hit. A graze that slides along a wall
      // costs nothing; a dead stop costs paint.
      if (impact > 3) {
        damageCar(world, car, (impact - 3) * 1.5);
        if (world.audio) world.audio.crash();
        if (world.fx) world.fx.shake(Math.min(0.6, impact * 0.03));
        if (world.hud) world.hud.flashDamage();
      }
      car.speed *= -0.25;
    } else if (Math.abs(car.speed) > 10) {
      car.speed *= 0.82;
    }
    // Grinding: holding the throttle while the car is pressed against
    // a wall — stopped dead or scraping along it — keeps denting it.
    // A car sitting against a wall with no input takes nothing.
    if (keys.has('KeyW') || keys.has('KeyS')) {
      damageCar(world, car, 10 * dt);
    }
    if (!inBounds) {
      car.pos.x = bx;
      car.pos.z = bz;
    }
  }

  // Shunt other cars out of the way. A car that can roll gets shoved
  // aside and the player keeps speed; a car wedged against a wall
  // stops the player with a dent instead.
  for (const other of world.cars) {
    if (other === car) continue;
    const d = dist2D(car.pos.x, car.pos.z, other.pos.x, other.pos.z);
    if (d < 3.1 && d > 0.01) {
      const push = (3.1 - d) / 2;
      const ox = (other.pos.x - car.pos.x) / d;
      const oz = (other.pos.z - car.pos.z) / d;
      const free = !collideCircle(world, other.pos.x + ox * push, other.pos.z + oz * push, 1.7).hit;
      if (free) {
        other.pos.x += ox * push;
        other.pos.z += oz * push;
      } else if (Math.abs(car.speed) > 9 && other.ramCooldown <= 0) {
        damageCar(world, car, 3);
        damageCar(world, other, 4);
        other.ramCooldown = 1;
        if (world.audio) world.audio.crash();
        car.speed *= 0.9;
      }
    }
    if (other.ramCooldown > 0) other.ramCooldown -= dt;
  }

  // Smoke trails from the hood once the car is badly hurt.
  if (car.health < 35 && car.health > 0) {
    car.smokeTimer -= dt;
    if (car.smokeTimer <= 0) {
      car.smokeTimer = 0.12;
      const hx = car.pos.x + Math.sin(car.heading) * (car.length / 2 - 0.4);
      const hz = car.pos.z + Math.cos(car.heading) * (car.length / 2 - 0.4);
      if (world.fx) world.fx.smokePuff(vec3(hx, 1.1, hz));
    }
  }

  if (world.audio) world.audio.setEngine(Math.abs(car.speed) / topSpeed, true);
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  for (const wheel of car.wheels) {
    wheel.rotation.x += (car.speed * dt) / 0.38;
  }
}

// Traffic cars cruise their road. At an intersection they sometimes
// turn onto the cross street; at the edge of the grid they must turn.
export function updateTraffic(world, dt) {
  for (const car of world.traffic) {
    if (!car || car === world.player.car) continue;
    car.turnCooldown -= dt;
    const step = car.speed * dt;
    let nx = car.pos.x + Math.sin(car.heading) * step;
    let nz = car.pos.z + Math.cos(car.heading) * step;
    const nearGrid = (v) => {
      let best = GRID[0];
      for (const g of GRID) if (Math.abs(g - v) < Math.abs(best - v)) best = g;
      return best;
    };
    const atCross = car.roadAxis === 'x'
      ? Math.abs(nz - nearGrid(nz)) < 2.5
      : Math.abs(nx - nearGrid(nx)) < 2.5;
    const atEdge = Math.abs(nx) > 178 || Math.abs(nz) > 178;
    if ((atCross && car.turnCooldown <= 0 && Math.random() < 0.02) || atEdge) {
      car.turnCooldown = 4;
      // Turn onto the cross street at this intersection.
      const crossLine = car.roadAxis === 'x' ? nearGrid(nz) : nearGrid(nx);
      const newDir = Math.random() < 0.5 ? 1 : -1;
      if (car.roadAxis === 'x') {
        car.roadAxis = 'z';
        car.roadLine = crossLine;
        car.pos.z = crossLine - 2.4 * newDir;
        car.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.roadAxis = 'x';
        car.roadLine = crossLine;
        car.pos.x = crossLine + 2.4 * newDir;
        car.heading = newDir > 0 ? 0 : Math.PI;
      }
      car.dir = newDir;
      nx = car.pos.x;
      nz = car.pos.z;
    }
    // Don't drive through the player's car.
    const pc = world.player.car;
    if (pc && Math.hypot(nx - pc.pos.x, nz - pc.pos.z) < 3.4) {
      car.speed = Math.max(0, car.speed - 20 * dt);
    } else if (car.speed < car.cruise) {
      car.speed = Math.min(car.cruise, car.speed + 6 * dt);
    }
    car.pos.x = nx;
    car.pos.z = nz;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    for (const wheel of car.wheels) {
      wheel.rotation.x += (car.speed * dt) / 0.38;
    }
  }
  // Keep parked-car meshes where their objects are (they never move,
  // but a shunt can push one, so sync them all cheaply).
  for (const car of world.cars) {
    if (car.traffic || car === world.player.car) continue;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
  }
}
