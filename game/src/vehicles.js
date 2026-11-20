// Neon Harbor — cars.
//
// Every four-wheeled thing in the city is built and driven from here:
// the meshes themselves, the parked cars along the curbs, the traffic
// cruising the grid, the arcade driving model for whatever Cole is
// sitting in, the damage a car takes when it hits something, and the
// steal test — is Cole close enough to this car, measured against its
// bodywork instead of its middle, so that a bumper or a door counts
// just like the driver's window?
//
// The driving model forgives a lot: hold W and the car keeps pulling
// toward its top speed, S brakes and backs up, Space is the handbrake.
// Damage does not forgive — hard knocks cost health, a battered car
// loses pace and starts smoking, and a dead car sits still until the
// Pay N Spray brings it back.
import * as THREE from 'three';
import {
  rand,
  pick,
  clamp,
  collideCircle,
  angleLerp,
  inWorldBounds,
} from './state.js';

// How far past the bodywork the steal prompt still reaches, in metres.
export const STEAL_REACH = 5;

const COATS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xdddddd, 0x222222, 0x1abc9c, 0xe67e22, 0x95a5a6];
const MODELS = ['Stallion', 'Comet', 'Breeze', 'Harbor Cruiser', 'Sunset GT', 'Pelican', 'Marlin', 'Gullwing'];

const BODY_W = 2.0;
const BODY_Y = 0.75;
const TOP_W = 1.8;
const TYRE_R = 0.42;
const TYRE_Y = 0.42;
const AXLE_X = 0.95;
const AXLE_Z = 1.45;
const LAMP_HEX = 0xffe9a8;
const BEAM_FAR = 26;
const CAR_LEN = 4.4;
const VAN_LEN = 5.6;
const CAR_H = 0.85;
const VAN_H = 1.5;
const SHUNT_R = 4.4;

// Half the body length and width, for the steal check and for bumping
// into things. Vans run longer than the rest of the fleet.
function halfExtents(car) {
  if (car.isVan) return { hl: 2.8, hw: 1.0 };
  return { hl: 2.2, hw: 1.0 };
}

// One box, placed. Every car part goes through here so the builder below
// reads as a list of pieces rather than a run of constructor calls.
function boxPart(width, height, depth, material, x, y, z) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  piece.position.set(x, y, z);
  return piece;
}

// Build the visible car and hand back its group plus the wheels, so the
// driving code can spin them. Painted body, glass or tall van cabin,
// headlights with a real beam; Harbor PD cars get a light bar, a stripe
// and red/blue lamps that the police code flashes.
export function makeCarMesh(color, isVan = false, isPolice = false) {
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glaze = new THREE.MeshStandardMaterial({ color: 0x101c2c, roughness: 0.15, metalness: 0.8 });
  const len = isVan ? VAN_LEN : CAR_LEN;
  const ht = isVan ? VAN_H : CAR_H;
  const shell = boxPart(BODY_W, ht, len, coat, 0, BODY_Y, 0);
  shell.castShadow = true;
  group.add(shell);
  const topH = isVan ? 0.9 : 0.7;
  const topD = isVan ? 3.4 : 2.0;
  const topZ = isVan ? -0.3 : -0.2;
  const top = boxPart(TOP_W, topH, topD, isVan ? coat : glaze, 0, ht + 0.35, topZ);
  top.castShadow = true;
  group.add(top);
  const tyreGeo = new THREE.CylinderGeometry(TYRE_R, TYRE_R, 0.3, 12);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (let s = -1; s <= 1; s += 2) {
    for (let e = 0; e < 2; e++) {
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(s * AXLE_X, TYRE_Y, e === 0 ? AXLE_Z : -AXLE_Z);
      group.add(tyre);
      wheels.push(tyre);
    }
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: LAMP_HEX });
  group.add(boxPart(0.35, 0.18, 0.1, glowMat, -0.6, 0.8, len / 2 + 0.02));
  group.add(boxPart(0.35, 0.18, 0.1, glowMat, 0.6, 0.8, len / 2 + 0.02));
  const beam = new THREE.SpotLight(LAMP_HEX, 0, BEAM_FAR, 0.5, 0.5, 1.2);
  beam.position.set(0, 0.9, len / 2);
  const aimPoint = new THREE.Object3D();
  aimPoint.position.set(0, 0, len / 2 + 12);
  group.add(aimPoint);
  beam.target = aimPoint;
  group.add(beam);
  group.userData.beam = beam;
  if (isPolice) {
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    group.add(boxPart(BODY_W + 0.02, 0.3, len + 0.02, bandMat, 0, 0.85, 0));
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    group.add(boxPart(1.2, 0.22, 0.5, dark, 0, ht + 0.75, -0.2));
    const lightSpecs = [
      [0xff2222, -0.3],
      [0x2266ff, 0.3],
    ];
    const lights = [];
    for (let k = 0; k < lightSpecs.length; k++) {
      const hue = lightSpecs[k][0];
      const ox = lightSpecs[k][1];
      const lamp = boxPart(0.5, 0.2, 0.4, new THREE.MeshBasicMaterial({ color: hue }), ox, ht + 0.9, -0.2);
      group.add(lamp);
      lights.push(lamp);
    }
    group.userData.policeLights = lights;
  }
  return { group, wheels };
}

export function createCar(world, opts) {
  const built = makeCarMesh(opts.color, opts.isVan, opts.isPolice);
  const group = built.group;
  group.position.set(opts.x, 0, opts.z);
  group.rotation.y = opts.heading || 0;
  world.scene.add(group);
  const car = {
    mesh: group,
    wheels: built.wheels,
    name: opts.name || pick(MODELS),
    pos: group.position,
    heading: opts.heading || 0,
    speed: 0,
    color: opts.color,
    isVan: !!opts.isVan,
    isPolice: !!opts.isPolice,
    parked: !!opts.parked,
    traffic: !!opts.traffic,
    maxSpeed: opts.isVan ? 26 : opts.isPolice ? 36 : 30 + rand(0, 6),
    accel: opts.isVan ? 11 : 16,
    health: 100,
    maxHealth: 100,
    smokeTimer: 0,
    laneRoad: null,
    laneAxis: null,
    laneDir: 1,
    laneOffset: 0,
    aiSpeed: 0,
    stuck: 0,
    ramCooldown: 0,
  };
  if (car.traffic) giveTrafficLane(world, car);
  world.cars.push(car);
  if (car.traffic) world.traffic.push(car);
  return car;
}

// Pick a lane for a traffic car — a road, a direction along it, and which
// side of the road it drives on — then drop it on that lane with a
// matching heading so it never starts sideways across traffic.
function giveTrafficLane(world, car) {
  car.aiSpeed = rand(10, 14);
  car.laneAxis = Math.random() < 0.5 ? 'x' : 'z';
  car.laneRoad = pick(world.roads.xs);
  car.laneDir = Math.random() < 0.5 ? 1 : -1;
  car.laneOffset = [-3.5, 3.5][Math.random() < 0.5 ? 0 : 1];
  car.speed = car.aiSpeed;
  if (car.laneAxis === 'x') {
    car.pos.set(car.laneRoad + car.laneOffset, 0, rand(-220, 150));
    car.heading = car.laneDir > 0 ? 0 : Math.PI;
  } else {
    car.pos.set(rand(-220, 220), 0, car.laneRoad + car.laneOffset);
    car.heading = car.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  car.mesh.rotation.y = car.heading;
}

// One random curbside candidate: a road, a spot along it, a side to park
// on, and a heading along the road. roadX/roadZ is the point on the road
// the spot gets nudged toward.
function randomCurbSpot(world) {
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const line = pick(world.roads.xs);
  const along = rand(-210, 140);
  const sideways = [-8.5, 8.5][Math.random() < 0.5 ? 0 : 1];
  if (axis === 'x') {
    return { x: line + sideways, z: along, heading: Math.random() < 0.5 ? 0 : Math.PI, roadX: line, roadZ: along };
  }
  return { x: along, z: line + sideways, heading: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2, roadX: along, roadZ: line };
}

// True when a car parked here could drive away: sample the road ahead
// every four metres out to 28 m and make sure no building is in the way.
// A spot whose own circle is clear can still face a wall three metres
// out, which leaves a stolen car grinding against brick from the moment
// Cole gets in — so the run ahead is checked, not just the spot.
function roadAheadClear(world, x, z, heading) {
  for (let d = 4; d <= 28; d += 4) {
    const px = x + Math.sin(heading) * d;
    const pz = z + Math.cos(heading) * d;
    if (collideCircle(world, px, pz, 2.1).hit) return false;
  }
  return true;
}

// Walk a spot toward its road target in half-metre steps until a car
// circle of radius 2.1 no longer overlaps any building. (tx, tz) is the
// point on the road to walk toward.
function nudgeToRoad(world, x, z, tx, tz) {
  let steps = 0;
  while (steps < 14) {
    steps++;
    if (!collideCircle(world, x, z, 2.1).hit) return { x, z };
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) return { x, z };
    x += (dx / d) * 0.5;
    z += (dz / d) * 0.5;
  }
  return { x, z };
}

// Try up to eight curbside candidates and keep the first one the car can
// actually drive away from, in either direction. Falls back to the first
// candidate tried, nudged onto the road, if none of them has a clear run.
function findCurbSpot(world) {
  let first = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const cand = randomCurbSpot(world);
    const open = nudgeToRoad(world, cand.x, cand.z, cand.roadX, cand.roadZ);
    const place = { x: open.x, z: open.z, heading: cand.heading };
    if (!first) first = place;
    if (roadAheadClear(world, place.x, place.z, place.heading)) return place;
    if (roadAheadClear(world, place.x, place.z, place.heading + Math.PI)) {
      return { x: place.x, z: place.z, heading: place.heading + Math.PI };
    }
  }
  return first;
}

export function spawnParkedCars(world) {
  // Curbside cars all over the city, then the three the story needs: the
  // yellow Comet GT in the showroom lot, the armored bank van, and a red
  // Stallion by Mara's garage so the first job is always doable. A
  // curbside spot can sit inside a building footprint — blocks run right
  // up to the road edge — so every spot is nudged toward the road until
  // the car's circle is clear, otherwise the stolen car would be stuck
  // against a wall from the moment Cole gets in.
  for (let i = 0; i < 22; i++) {
    const spot = findCurbSpot(world);
    createCar(world, { x: spot.x, z: spot.z, heading: spot.heading, color: pick(COATS), parked: true });
  }
  const story = [
    {
      x: world.markers.showroom.x,
      z: world.markers.showroom.z,
      heading: Math.PI / 2,
      color: 0xffd23e,
      name: 'Comet GT',
      parked: true,
      special: 'comet',
      slot: 'cometGT',
    },
    {
      x: world.markers.bank.x + 7,
      z: world.markers.bank.z + 6,
      heading: -Math.PI / 2,
      color: 0x3a3f4a,
      name: 'Harbor Bank Van',
      isVan: true,
      parked: true,
      special: 'bankvan',
      slot: 'bankVan',
    },
  ];
  for (let k = 0; k < story.length; k++) {
    const item = story[k];
    const car = createCar(world, item);
    car.special = item.special;
    world[item.slot] = car;
  }
  const starter = createCar(world, {
    x: world.markers.garage.x + 7,
    z: world.markers.garage.z,
    heading: 0,
    color: 0xc0392b,
    name: 'Stallion',
    parked: true,
  });
  const clearSpot = nudgeToRoad(world, starter.pos.x, starter.pos.z, world.markers.garage.x, world.markers.garage.z);
  starter.pos.set(clearSpot.x, 0, clearSpot.z);
  starter.mesh.position.copy(starter.pos);
}

export function spawnTraffic(world, count) {
  for (let i = 0; i < count; i++) {
    createCar(world, { x: 0, z: 0, color: pick(COATS), traffic: true });
  }
}

// How much of its top speed and acceleration a car keeps at its current
// health: full while healthy, sagging below 60, crawling below 35, and
// nothing at all once it is disabled.
export function damageFactor(car) {
  if (car.health <= 0) return 0;
  if (car.health < 35) return 0.45;
  if (car.health < 60) return 0.7;
  return 1;
}

export function damageCar(world, car, amount) {
  if (!car || car.health <= 0) return;
  car.health = Math.max(0, car.health - amount);
  if (car.health > 0) return;
  car.speed = 0;
  world.fx.burst(car.pos.clone().setY(1), 0x555555, 14, 4, 3);
  if (car === world.player.car) {
    world.hud.showMessage('Car disabled! Get it to the Pay N Spray — or steal another one.');
    world.audio.crash();
  }
}

// Distance from a point to a car's body, measured in the car's own frame:
// project the offset onto the car's forward and side axes, subtract the
// half-extents, and measure what is left. Zero means the point is touching
// the body; the value grows in every direction alike, so the nose, the
// tail and both doors all count.
export function carBoxDistance(car, x, z) {
  const ex = x - car.pos.x;
  const ez = z - car.pos.z;
  const s = Math.sin(car.heading);
  const c = Math.cos(car.heading);
  const fwd = ex * s + ez * c;
  const lat = ex * c - ez * s;
  const ext = halfExtents(car);
  const overLen = Math.max(Math.abs(fwd) - ext.hl, 0);
  const overWid = Math.max(Math.abs(lat) - ext.hw, 0);
  return Math.hypot(overLen, overWid);
}

export function nearestCar(world, pos, maxDist) {
  let near = null;
  let nearD = maxDist;
  for (let i = 0; i < world.cars.length; i++) {
    const car = world.cars[i];
    if (car.isPolice && world.policeCars.includes(car)) continue;
    const d = carBoxDistance(car, pos.x, pos.z);
    if (d >= nearD) continue;
    nearD = d;
    near = car;
  }
  return near;
}

export function enterCar(world, car) {
  const hero = world.player;
  hero.car = car;
  car.parked = false;
  car.traffic = false;
  world.traffic = world.traffic.filter((c) => c !== car);
  world.hud.showMessage(`You took the ${car.name}.`);
  world.audio.chime();
  return car;
}

export function exitCar(world) {
  const hero = world.player;
  const car = hero.car;
  if (!car) return;
  car.speed = 0;
  hero.car = null;
  // Step out to the driver's side, clear of any wall.
  hero.pos.set(car.pos.x + Math.cos(car.heading) * 2.6, 0, car.pos.z - Math.sin(car.heading) * 2.6);
  const open = collideCircle(world, hero.pos.x, hero.pos.z, 0.55);
  hero.pos.x = open.x;
  hero.pos.z = open.z;
  world.audio.setEngine(0, false);
}

// Arcade driving for the car Cole is in. W accelerates toward top speed,
// S brakes and reverses, Space is the handbrake (with a drift kick at
// speed), A/D steer — weaker when slow, reversed when reversing. A hard
// hit on a building dents the car and the driver; a gentle bump just
// crunches and bounces the car back.
export function drivePlayerCar(world, dt) {
  const hero = world.player;
  const car = hero.car;
  if (!car) return;
  const held = world.input.keys;
  const wear = damageFactor(car);
  const gas = held.has('KeyS') ? -1 : held.has('KeyW') ? 1 : 0;
  const brake = held.has('Space');
  const cap = car.maxSpeed * wear;
  const push = gas !== 0 ? car.accel * wear : 8;
  car.speed += clamp(gas * cap - car.speed, -push * dt, push * dt);
  if (brake) car.speed *= Math.max(0, 1 - dt * 2.2);
  const turn = held.has('KeyD') ? -1 : held.has('KeyA') ? 1 : 0;
  const bite = clamp(Math.abs(car.speed) / 12, 0, 1);
  const yaw = turn * 1.9 * bite * Math.sign(car.speed || 1);
  car.heading += yaw * dt;
  if (brake && Math.abs(car.speed) > 6 && turn !== 0) {
    car.heading += turn * 0.9 * dt;
    if (Math.random() < dt * 6) world.fx.burst(car.pos.clone().setY(0.3), 0xcccccc, 2, 2, 1);
  }
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const shift = collideCircle(world, nx, nz, 2.1);
  if (shift.hit) {
    const smash = Math.abs(car.speed) > 10;
    const tap = !smash && Math.abs(car.speed) > 4;
    if (smash) {
      world.fx.explosion(car.pos.clone().setY(1));
      world.audio.crash();
      damageCar(world, car, 12);
      if (world.player.health > 0) world.player.health = Math.max(1, world.player.health - 4);
    } else if (tap) {
      world.audio.crash();
      damageCar(world, car, 3);
    }
    car.speed *= -0.25;
  }
  if (!inWorldBounds(shift.x, shift.z)) {
    car.speed *= -0.3;
  } else {
    car.pos.x = shift.x;
    car.pos.z = shift.z;
  }
  shoveTraffic(world, car);
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  for (let i = 0; i < car.wheels.length; i++) car.wheels[i].rotation.x += car.speed * dt * 2.4;
  const lamp = car.mesh.userData.beam;
  if (lamp) lamp.intensity = 22;
  // A badly damaged car smokes from under the hood.
  if (car.health > 0 && car.health < 35) {
    car.smokeTimer -= dt;
    if (car.smokeTimer <= 0) {
      car.smokeTimer = 0.12;
      const bonnet = car.pos.clone();
      bonnet.x += Math.sin(car.heading) * 1.6;
      bonnet.z += Math.cos(car.heading) * 1.6;
      bonnet.y = 1.2;
      world.fx.smokePuff(bonnet);
    }
  }
  hero.speed = Math.abs(car.speed);
  world.audio.setEngine(Math.abs(car.speed) / car.maxSpeed, true);
}

// Simple circle push between Cole's car and every other car, so traffic
// does not ghost through him and a shunt slows both cars.
function shoveTraffic(world, car) {
  for (let i = 0; i < world.cars.length; i++) {
    const near = world.cars[i];
    if (near === car) continue;
    const dx = car.pos.x - near.pos.x;
    const dz = car.pos.z - near.pos.z;
    const space = Math.hypot(dx, dz);
    if (space >= SHUNT_R || space <= 0.01) continue;
    const shove = (SHUNT_R - space) / 2;
    car.pos.x += (dx / space) * shove;
    car.pos.z += (dz / space) * shove;
    near.pos.x -= (dx / space) * shove;
    near.pos.z -= (dz / space) * shove;
    if (Math.abs(car.speed) <= 8) continue;
    car.speed *= 0.55;
    if (near.traffic) {
      near.speed *= 0.4;
      near.stuck = 1.5;
    }
    damageCar(world, car, 6);
    world.audio.crash();
    world.fx.burst(car.pos.clone().setY(1), 0xffaa33, 6, 4, 2);
  }
}

// The road centre line nearest to a point along the car's travel axis, or
// null when the car is mid-block. Traffic uses it to decide when a turn
// is possible at an intersection.
function closestRoadLine(world, alongPos) {
  for (let i = 0; i < world.roads.xs.length; i++) {
    const line = world.roads.xs[i];
    if (Math.abs(alongPos - line) < 4) return line;
  }
  return null;
}

function tryTurnAtCrossing(world, car) {
  const along = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
  const line = closestRoadLine(world, along);
  if (line === null || Math.random() >= 0.35) return;
  car.laneAxis = car.laneAxis === 'x' ? 'z' : 'x';
  car.laneRoad = line;
  car.laneDir = Math.random() < 0.5 ? 1 : -1;
  car.laneOffset = [-3.5, 3.5][Math.random() < 0.5 ? 0 : 1];
}

export function updateTraffic(world, dt) {
  for (let i = 0; i < world.traffic.length; i++) {
    const car = world.traffic[i];
    if (car === world.player.car) continue;
    moveTrafficCar(world, car, dt);
  }
}

// Distance to the nearest car directly ahead in this car's lane, or null
// when the road ahead is clear. Traffic slows for it instead of driving
// through it.
function gapInFront(world, car) {
  let best = null;
  for (let i = 0; i < world.cars.length; i++) {
    const near = world.cars[i];
    if (near === car) continue;
    const dx = near.pos.x - car.pos.x;
    const dz = near.pos.z - car.pos.z;
    let ahead;
    if (car.laneAxis === 'x') {
      ahead = Math.sign(dz) === car.laneDir && Math.abs(dx) < 5 && dz * car.laneDir > 0;
    } else {
      ahead = Math.sign(dx) === car.laneDir && Math.abs(dz) < 5 && dx * car.laneDir > 0;
    }
    if (!ahead) continue;
    const space = Math.hypot(dx, dz);
    if (best === null || space < best) best = space;
  }
  return best;
}

function moveTrafficCar(world, car, dt) {
  car.stuck = Math.max(0, car.stuck - dt);
  const along = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
  const edge = car.laneAxis === 'x' ? 150 : 220;
  if (car.laneDir > 0 && along > edge) car.laneDir = -1;
  if (car.laneDir < 0 && along < -220) car.laneDir = 1;
  let pace = car.aiSpeed;
  const front = gapInFront(world, car);
  if (front !== null && front < 11) pace = Math.min(pace, Math.max(0, (front - 5) * 1.2));
  if (car.stuck > 0) pace = 0;
  car.speed += clamp(pace - car.speed, -10 * dt, 8 * dt);
  const side = car.laneAxis === 'x' ? car.pos.x : car.pos.z;
  const drift = car.laneRoad + car.laneOffset - side;
  let aim;
  if (car.laneAxis === 'x') aim = car.laneDir > 0 ? 0 : Math.PI;
  else aim = car.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  aim += clamp(drift * 0.06, -0.35, 0.35);
  car.heading = angleLerp(car.heading, aim, Math.min(1, dt * 2.2));
  const crossPos = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
  if (closestRoadLine(world, crossPos) !== null && Math.random() < dt * 0.25) {
    tryTurnAtCrossing(world, car);
  }
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const shift = collideCircle(world, nx, nz, 2.1);
  if (!shift.hit && inWorldBounds(shift.x, shift.z)) {
    car.pos.x = shift.x;
    car.pos.z = shift.z;
  } else {
    car.speed *= 0.4;
    car.heading += Math.PI * 0.5 * dt;
  }
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  for (let i = 0; i < car.wheels.length; i++) car.wheels[i].rotation.x += car.speed * dt * 2.4;
}
