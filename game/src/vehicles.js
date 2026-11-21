// Neon Harbor — cars: building, parking, traffic, stealing, driving.
//
// A car is a plain object with a THREE group for a mesh. Heading uses
// the same convention everywhere in the game: forward is
// (sin(heading), cos(heading)), so heading 0 drives toward +z and
// heading PI/2 toward +x. Driving is a sustained-acceleration model —
// hold W to build speed, S to brake or reverse — and damage slows the
// car, makes it smoke, and finally disables it.
import * as THREE from 'three';
import { GRID_LINES, clamp, rand, randInt, pick, collideCircle } from './state.js';

export const STEAL_REACH = 5;

const CAR_COLORS = [
  0xc0392b, 0x2e6fb0, 0xe0a83c, 0x58b368, 0xe6e6e6,
  0x222222, 0x9b59b6, 0x3fa7a0, 0xd97b2f, 0x7a8894,
];
const CAR_NAMES = [
  'Comet', 'Stallion', 'Blista', 'Panto', 'Voodoo',
  'Buccaneer', 'Sabre', 'Futo', 'Prairie', 'Dukes',
];
const VAN_LENGTH = 5.2;
const CAR_LENGTH = 4.4;
const CAR_WIDTH = 2.0;

// A low-poly street car from boxes: body, dark glass cabin, four
// wheels on pivot groups (so they can spin), headlights and tail
// lights. Vans get a taller body; police cars a roof light bar.
export function makeCarMesh(color, isVan = false, isPolice = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.2, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  const bodyLen = isVan ? VAN_LENGTH : CAR_LENGTH;
  const bodyH = isVan ? 1.5 : 0.85;
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, bodyH, bodyLen), paint);
  body.position.y = isVan ? 1.0 : 0.75;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.75, isVan ? 2.8 : 2.2),
    isVan ? paint : glass,
  );
  cabin.position.set(0, isVan ? 1.9 : 1.5, isVan ? -0.3 : -0.2);
  cabin.castShadow = true;
  group.add(cabin);

  if (isVan) {
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 0.15), glass);
    windshield.position.set(0, 1.85, bodyLen / 2 - 0.15);
    windshield.rotation.x = -0.25;
    group.add(windshield);
  }

  // Wheels: a pivot group per wheel, tyre mesh child turned sideways,
  // so spinning the pivot turns the wheel around its axle.
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.42, wz);
    const tyre = new THREE.Mesh(wheelGeo, dark);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    pivot.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.7 }));
    hub.rotation.z = Math.PI / 2;
    pivot.add(hub);
    group.add(pivot);
    wheels.push(pivot);
  }

  // Headlights (front, +z) and tail lights (rear, -z).
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0x555533, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.08), lampMat);
    head.position.set(s * 0.65, 0.75, bodyLen / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0x440000, roughness: 0.3 }),
    );
    tail.position.set(s * 0.65, 0.75, -bodyLen / 2 - 0.02);
    group.add(tail);
  }

  if (isPolice) {
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.35), dark);
    barBase.position.set(0, isVan ? 2.35 : 1.95, -0.2);
    group.add(barBase);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xaa0000 }),
    );
    red.position.set(-0.28, 1.98, -0.2);
    group.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x0000aa }),
    );
    blue.position.set(0.28, 1.98, -0.2);
    group.add(blue);
  }

  return { group, wheels };
}

export function createCar(world, opts = {}) {
  const color = opts.color ?? pick(CAR_COLORS);
  const isVan = !!opts.isVan;
  const isPolice = !!opts.isPolice;
  const { group, wheels } = makeCarMesh(color, isVan, isPolice);
  const car = {
    pos: new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0),
    speed: 0,
    heading: opts.heading ?? 0,
    health: opts.health ?? 100,
    maxHealth: 100,
    mesh: group,
    wheels,
    length: isVan ? VAN_LENGTH : CAR_LENGTH,
    width: CAR_WIDTH,
    roadAxis: opts.roadAxis ?? null,
    roadLine: opts.roadLine ?? null,
    traffic: !!opts.traffic,
    cruise: opts.cruise ?? rand(9, 13),
    turnCooldown: 0,
    smokeTimer: 0,
    parked: !!opts.parked,
    owned: !!opts.owned,
    name: opts.name ?? pick(CAR_NAMES),
    dir: opts.dir ?? 1,
    model: opts.model ?? (isVan ? 'van' : 'sedan'),
    isPolice,
    isVan,
    color,
    special: opts.special ?? null,
  };
  group.position.copy(car.pos);
  group.rotation.y = car.heading;
  world.scene.add(group);
  world.cars.push(car);
  if (car.traffic) world.traffic.push(car);
  return car;
}

// Parked cars along the road edges, clear of intersections so a stolen
// car always has a clean pull-out.
export function spawnParkedCars(world) {
  const placed = [];
  let guard = 0;
  while (placed.length < 26 && guard < 400) {
    guard++;
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(GRID_LINES);
    const along = pick(GRID_LINES.slice(0, -1)) + rand(14, 46);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = side * 6.8;
    const x = axis === 'x' ? along : line + off;
    const z = axis === 'x' ? line + off : along;
    let tooClose = false;
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.z - z) < 9) { tooClose = true; break; }
    }
    if (tooClose) continue;
    for (const key of Object.keys(world.markers)) {
      const m = world.markers[key];
      if (Math.hypot(m.x - x, m.z - z) < 10) { tooClose = true; break; }
    }
    if (tooClose) continue;
    const heading = axis === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
    placed.push({ x, z });
    createCar(world, {
      x, z, heading,
      parked: true,
      isVan: Math.random() < 0.12,
    });
  }
  return placed.length;
}

export function spawnTraffic(world, count = 12) {
  for (let i = 0; i < count; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(GRID_LINES);
    const along = rand(-180, 180);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const heading = axis === 'x'
      ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (dir > 0 ? 0 : Math.PI);
    createCar(world, {
      x: axis === 'x' ? along : line,
      z: axis === 'x' ? line : along,
      heading,
      traffic: true,
      roadAxis: axis,
      roadLine: line,
      dir,
      cruise: rand(9, 13),
    });
  }
}

// Speed/acceleration multiplier from damage: full strength above 60,
// sluggish below it, crawling below 35, dead at 0.
export function damageFactor(car) {
  if (car.health <= 0) return 0;
  if (car.health < 35) return 0.45;
  if (car.health < 60) return 0.7;
  return 1;
}

export function damageCar(world, car, amount) {
  if (!car || amount <= 0) return car ? car.health : 0;
  const wasAlive = car.health > 0;
  car.health = Math.max(0, car.health - amount);
  if (world.fx) {
    world.fx.burst(car.pos, 0xffc860, 6, 4, 0.16);
    if (wasAlive && car.health === 0) {
      world.fx.burst(car.pos, 0xff7b24, 14, 7, 0.25);
      world.fx.smokePuff(car.pos);
    }
  }
  return car.health;
}

// Distance from a ground point to the car's oriented body box — 0 when
// the point is under the car. Measuring to the box (not the centre) is
// what makes stealing work from the nose or tail as well as the doors.
export function carBoxDistance(car, x, z) {
  const dx = x - car.pos.x;
  const dz = z - car.pos.z;
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  const along = dx * sh + dz * ch;
  const lateral = -dx * ch + dz * sh;
  const overLen = Math.max(Math.abs(along) - car.length / 2, 0);
  const overWid = Math.max(Math.abs(lateral) - car.width / 2 - 0.1, 0);
  return Math.hypot(overLen, overWid);
}

export function nearestCar(world, pos, maxDist = STEAL_REACH) {
  let best = null;
  let bestD = maxDist;
  for (const car of world.cars) {
    const d = carBoxDistance(car, pos.x, pos.z);
    if (d <= bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

// Put the player in the driver's seat. This only performs the enter:
// the caller decides whether it counts as a steal (wanted stars) by
// checking `car.owned` before calling.
export function enterCar(world, car) {
  const p = world.player;
  p.car = car;
  car.parked = false;
  if (car.traffic) {
    car.traffic = false;
    const ti = world.traffic.indexOf(car);
    if (ti >= 0) world.traffic.splice(ti, 1);
  }
  p.pos.copy(car.pos);
  p.mesh.visible = false;
  if (world.audio) world.audio.setEngine(0, true);
  return car;
}

export function exitCar(world) {
  const p = world.player;
  const car = p.car;
  if (!car) return null;
  p.car = null;
  car.speed = 0;
  // Step out on the car's right side, facing the way it points.
  const rx = -Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  p.pos.set(car.pos.x + rx * 2.4, 0, car.pos.z + rz * 2.4);
  p.heading = car.heading;
  p.mesh.visible = true;
  if (world.audio) world.audio.setEngine(0, false);
  return car;
}

function syncCarMesh(car) {
  car.mesh.position.set(car.pos.x, 0, car.pos.z);
  car.mesh.rotation.y = car.heading;
}

// The driven car: W builds speed, S brakes or reverses, A/D steer
// (A turns toward increasing heading), Space is the handbrake. Hard
// building hits cost health; a dead car does not move at all.
export function drivePlayerCar(world, dt) {
  const car = world.player.car;
  if (!car) return;
  const keys = world.input.keys;
  const df = damageFactor(car);

  if (car.health <= 0) {
    car.speed = 0;
    syncCarMesh(car);
    if (world.audio) world.audio.setEngine(0, false);
    return;
  }

  const maxSpeed = 38 * df;
  const accel = 16 * df;
  if (keys.has('KeyW')) car.speed += accel * dt;
  else if (keys.has('KeyS')) {
    car.speed -= (car.speed > 0.5 ? 24 : 9) * dt;
  } else {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);
  }
  if (keys.has('Space')) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 30 * dt);
  }
  car.speed = clamp(car.speed, -10, maxSpeed);

  // A steers toward increasing heading — the same sign the driving
  // helper in the test harness expects.
  const steerInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  const steerRate = 1.9 * clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed >= 0 ? 1 : -1);
  car.heading += steerInput * steerRate * dt;

  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const res = collideCircle(world, nx, nz, 1.6);
  if (res.hit && Math.abs(car.speed) > 6) {
    damageCar(world, car, Math.abs(car.speed) * 1.2);
    if (world.audio) world.audio.crash();
    if (world.fx) world.fx.shake(0.35);
    car.speed *= -0.25;
  } else if (res.hit) {
    car.speed *= 0.5;
  }
  car.pos.x = clamp(res.x, -238, 238);
  car.pos.z = clamp(res.z, -238, 238);

  // Shunt other cars instead of driving through them.
  for (const other of world.cars) {
    if (other === car) continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 3.4 && d > 0.01) {
      const push = (3.4 - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      other.pos.x += ux * push;
      other.pos.z += uz * push;
      car.pos.x -= ux * push;
      car.pos.z -= uz * push;
      if (Math.abs(car.speed) > 8) {
        damageCar(world, other, Math.abs(car.speed) * 0.5);
        damageCar(world, car, Math.abs(car.speed) * 0.3);
        car.speed *= 0.6;
      }
      other.mesh.position.set(other.pos.x, 0, other.pos.z);
    }
  }

  // A hurt car trails smoke from the hood.
  if (car.health < 35) {
    car.smokeTimer -= dt;
    if (car.smokeTimer <= 0) {
      car.smokeTimer = 0.16;
      if (world.fx) {
        const hx = car.pos.x + Math.sin(car.heading) * 1.8;
        const hz = car.pos.z + Math.cos(car.heading) * 1.8;
        world.fx.smokePuff(new THREE.Vector3(hx, 1.1, hz));
      }
    }
  }

  syncCarMesh(car);
  const spin = (car.speed * dt) / 0.42;
  for (const w of car.wheels) w.rotation.x += spin;
  world.player.pos.copy(car.pos);
  if (world.audio) world.audio.setEngine(Math.abs(car.speed) / 38, true);
}

// Traffic cruises its own road and brakes for whatever is ahead —
// another cruiser, a parked car, or the player's car. At the edge of
// the map it turns around and comes back the other way.
export function updateTraffic(world, dt) {
  for (const car of world.traffic) {
    if (car.health <= 0) continue;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let targetSpeed = car.cruise;
    for (const other of world.cars) {
      if (other === car) continue;
      const ox = other.pos.x - car.pos.x;
      const oz = other.pos.z - car.pos.z;
      const d = Math.hypot(ox, oz);
      if (d < 12 && d > 0.01) {
        const ahead = (ox * fx + oz * fz) / d;
        if (ahead > 0.6) targetSpeed = Math.min(targetSpeed, Math.max(0, (d - 6) * 1.2));
      }
    }
    car.speed += clamp(targetSpeed - car.speed, -14 * dt, 8 * dt);
    let nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
    let nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
    if (Math.abs(nx) > 186 || Math.abs(nz) > 186) {
      car.heading += Math.PI;
      car.dir *= -1;
      nx = car.pos.x;
      nz = car.pos.z;
    }
    const res = collideCircle(world, nx, nz, 1.6);
    if (res.hit) {
      // Roads are clear of buildings by construction; if something is
      // in the way, nudge the heading and carry on next frame.
      car.heading += (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.5;
      car.speed *= 0.5;
    }
    car.pos.x = res.x;
    car.pos.z = res.z;
    syncCarMesh(car);
    const spin = (car.speed * dt) / 0.42;
    for (const w of car.wheels) w.rotation.x += spin;
  }
}
