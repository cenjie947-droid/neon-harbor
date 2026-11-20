// Neon Harbor — cars. This module builds every four-wheeled thing in the
// city, seeds the parked cars and the traffic, runs the arcade driving
// model for the car Cole is in, tracks damage, and answers the steal
// question: is Cole close enough to this car, measured to its body rather
// than its centre, so that walking up to a bumper or a door counts the
// same as walking up to the driver's window?
//
// The driving model is deliberately forgiving: hold W and the car keeps
// pulling toward its top speed, S brakes and backs up, Space is the
// handbrake. Damage is honest — hard knocks cost health, a battered car
// loses pace and starts smoking, and a dead car goes nowhere until the
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

const CAR_PAINTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xdddddd, 0x222222, 0x1abc9c, 0xe67e22, 0x95a5a6];
const CAR_MODELS = ['Stallion', 'Comet', 'Breeze', 'Harbor Cruiser', 'Sunset GT', 'Pelican', 'Marlin', 'Gullwing'];

const BODY_WIDTH = 2.0;
const BODY_Y = 0.75;
const CABIN_WIDTH = 1.8;
const WHEEL_R = 0.42;
const WHEEL_Y = 0.42;
const WHEEL_X = 0.95;
const WHEEL_Z = 1.45;
const LAMP_COLOR = 0xffe9a8;
const BEAM_RANGE = 26;
const CAR_BODY_LEN = 4.4;
const VAN_BODY_LEN = 5.6;
const CAR_BODY_H = 0.85;
const VAN_BODY_H = 1.5;
const SHUNT_GAP = 4.4;

// Half the body length and width, for the steal check and for bumping
// into things. Vans run longer than the rest of the fleet.
function bodyHalfSizes(ride) {
  return ride.isVan ? { halfLen: 2.8, halfWid: 1.0 } : { halfLen: 2.2, halfWid: 1.0 };
}

// One box, placed. Every car part goes through here so the builder below
// reads as a list of pieces rather than a run of constructor calls.
function slab(width, height, depth, material, x, y, z) {
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
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c2c, roughness: 0.15, metalness: 0.8 });
  const length = isVan ? VAN_BODY_LEN : CAR_BODY_LEN;
  const bodyHeight = isVan ? VAN_BODY_H : CAR_BODY_H;
  const body = slab(BODY_WIDTH, bodyHeight, length, paint, 0, BODY_Y, 0);
  body.castShadow = true;
  group.add(body);
  const cabinHeight = isVan ? 0.9 : 0.7;
  const cabinDepth = isVan ? 3.4 : 2.0;
  const cabinZ = isVan ? -0.3 : -0.2;
  const cabin = slab(CABIN_WIDTH, cabinHeight, cabinDepth, isVan ? paint : glass, 0, bodyHeight + 0.35, cabinZ);
  cabin.castShadow = true;
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (const side of [-1, 1]) {
    for (const end of [WHEEL_Z, -WHEEL_Z]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * WHEEL_X, WHEEL_Y, end);
      group.add(wheel);
      wheels.push(wheel);
    }
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR });
  for (const side of [-0.6, 0.6]) group.add(slab(0.35, 0.18, 0.1, lampMat, side, 0.8, length / 2 + 0.02));
  const beam = new THREE.SpotLight(LAMP_COLOR, 0, BEAM_RANGE, 0.5, 0.5, 1.2);
  beam.position.set(0, 0.9, length / 2);
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, 0, length / 2 + 12);
  group.add(beamTarget);
  beam.target = beamTarget;
  group.add(beam);
  group.userData.beam = beam;
  if (isPolice) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    group.add(slab(BODY_WIDTH + 0.02, 0.3, length + 0.02, stripeMat, 0, 0.85, 0));
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    group.add(slab(1.2, 0.22, 0.5, dark, 0, bodyHeight + 0.75, -0.2));
    const lampSpecs = [
      [0xff2222, -0.3],
      [0x2266ff, 0.3],
    ];
    const lamps = lampSpecs.map(([lampColor, lampX]) => {
      const lamp = slab(0.5, 0.2, 0.4, new THREE.MeshBasicMaterial({ color: lampColor }), lampX, bodyHeight + 0.9, -0.2);
      group.add(lamp);
      return lamp;
    });
    group.userData.policeLights = lamps;
  }
  return { group, wheels };
}

export function createCar(game, opts) {
  const { group, wheels } = makeCarMesh(opts.color, opts.isVan, opts.isPolice);
  group.position.set(opts.x, 0, opts.z);
  group.rotation.y = opts.heading || 0;
  game.scene.add(group);
  const ride = {
    mesh: group,
    wheels,
    name: opts.name || pick(CAR_MODELS),
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
  if (ride.traffic) assignTrafficLane(game, ride);
  game.cars.push(ride);
  if (ride.traffic) game.traffic.push(ride);
  return ride;
}

// Pick a lane for a traffic car — a road, a direction along it, and which
// side of the road it drives on — then drop it on that lane with a
// matching heading so it never starts sideways across traffic.
function assignTrafficLane(game, ride) {
  ride.aiSpeed = rand(10, 14);
  ride.laneAxis = Math.random() < 0.5 ? 'x' : 'z';
  ride.laneRoad = pick(game.roads.xs);
  ride.laneDir = Math.random() < 0.5 ? 1 : -1;
  ride.laneOffset = pick([-3.5, 3.5]);
  ride.speed = ride.aiSpeed;
  if (ride.laneAxis === 'x') {
    ride.pos.set(ride.laneRoad + ride.laneOffset, 0, rand(-220, 150));
    ride.heading = ride.laneDir > 0 ? 0 : Math.PI;
  } else {
    ride.pos.set(rand(-220, 220), 0, ride.laneRoad + ride.laneOffset);
    ride.heading = ride.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  ride.mesh.rotation.y = ride.heading;
}

// One random curbside candidate: a road, a spot along it, a side to park
// on, and a heading along the road. roadX/roadZ is the point on the road
// the spot gets nudged toward.
function curbsideSpot(game) {
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const line = pick(game.roads.xs);
  const along = rand(-210, 140);
  const sideways = pick([-8.5, 8.5]);
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
function hasClearRun(game, x, z, heading) {
  for (let d = 4; d <= 28; d += 4) {
    const px = x + Math.sin(heading) * d;
    const pz = z + Math.cos(heading) * d;
    if (collideCircle(game, px, pz, 2.1).hit) return false;
  }
  return true;
}

export function spawnParkedCars(game) {
  // Curbside cars all over the city, then the three the story needs: the
  // yellow Comet GT in the showroom lot, the armored bank van, and a red
  // Stallion by Mara's garage so the first job is always doable. A
  // curbside spot can sit inside a building footprint — blocks run right
  // up to the road edge — so every spot is nudged toward the road until
  // the car's circle is clear, otherwise the stolen car would be stuck
  // against a wall from the moment Cole gets in.
  for (let i = 0; i < 22; i++) {
    let chosen = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = curbsideSpot(game);
      const clear = slideToRoad(game, candidate.x, candidate.z, candidate.roadX, candidate.roadZ);
      const spot = { x: clear.x, z: clear.z, heading: candidate.heading };
      if (!chosen) chosen = spot;
      if (hasClearRun(game, spot.x, spot.z, spot.heading)) {
        chosen = spot;
        break;
      }
      if (hasClearRun(game, spot.x, spot.z, spot.heading + Math.PI)) {
        chosen = { ...spot, heading: spot.heading + Math.PI };
        break;
      }
    }
    createCar(game, { ...chosen, color: pick(CAR_PAINTS), parked: true });
  }
  const specials = [
    {
      x: game.markers.showroom.x,
      z: game.markers.showroom.z,
      heading: Math.PI / 2,
      color: 0xffd23e,
      name: 'Comet GT',
      parked: true,
      special: 'comet',
      slot: 'cometGT',
    },
    {
      x: game.markers.bank.x + 7,
      z: game.markers.bank.z + 6,
      heading: -Math.PI / 2,
      color: 0x3a3f4a,
      name: 'Harbor Bank Van',
      isVan: true,
      parked: true,
      special: 'bankvan',
      slot: 'bankVan',
    },
  ];
  for (const spec of specials) {
    const ride = createCar(game, spec);
    ride.special = spec.special;
    game[spec.slot] = ride;
  }
  const garageCar = createCar(game, {
    x: game.markers.garage.x + 7,
    z: game.markers.garage.z,
    heading: 0,
    color: 0xc0392b,
    name: 'Stallion',
    parked: true,
  });
  const garageClear = slideToRoad(game, garageCar.pos.x, garageCar.pos.z, game.markers.garage.x, game.markers.garage.z);
  garageCar.pos.set(garageClear.x, 0, garageClear.z);
  garageCar.mesh.position.copy(garageCar.pos);
}

// Walk a spot toward its road target in half-metre steps until a car
// circle of radius 2.1 no longer overlaps any building. (tx, tz) is the
// point on the road to walk toward.
function slideToRoad(game, x, z, tx, tz) {
  for (let i = 0; i < 14; i++) {
    if (!collideCircle(game, x, z, 2.1).hit) return { x, z };
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) return { x, z };
    x += (dx / d) * 0.5;
    z += (dz / d) * 0.5;
  }
  return { x, z };
}

export function spawnTraffic(game, count) {
  for (let i = 0; i < count; i++) {
    createCar(game, { x: 0, z: 0, color: pick(CAR_PAINTS), traffic: true });
  }
}

// How much of its top speed and acceleration a car keeps at its current
// health: full while healthy, sagging below 60, crawling below 35, and
// nothing at all once it is disabled.
export function damageFactor(ride) {
  return ride.health <= 0 ? 0 : ride.health < 35 ? 0.45 : ride.health < 60 ? 0.7 : 1;
}

export function damageCar(game, ride, amount) {
  if (!ride || ride.health <= 0) return;
  ride.health = Math.max(0, ride.health - amount);
  if (ride.health > 0) return;
  ride.speed = 0;
  game.fx.burst(ride.pos.clone().setY(1), 0x555555, 14, 4, 3);
  if (ride === game.player.car) {
    game.hud.showMessage('Car disabled! Get it to the Pay N Spray — or steal another one.');
    game.audio.crash();
  }
}

// Distance from a point to a car's body, measured in the car's own frame:
// project the offset onto the car's forward and side axes, subtract the
// half-extents, and measure what is left. Zero means the point is touching
// the body; the value grows in every direction alike, so the nose, the
// tail and both doors all count.
export function carBoxDistance(ride, x, z) {
  const dx = x - ride.pos.x;
  const dz = z - ride.pos.z;
  const sinH = Math.sin(ride.heading);
  const cosH = Math.cos(ride.heading);
  const forward = dx * sinH + dz * cosH;
  const side = dx * cosH - dz * sinH;
  const { halfLen, halfWid } = bodyHalfSizes(ride);
  const pastLen = Math.max(Math.abs(forward) - halfLen, 0);
  const pastWid = Math.max(Math.abs(side) - halfWid, 0);
  return Math.hypot(pastLen, pastWid);
}

export function nearestCar(game, pos, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ride of game.cars) {
    if (ride.isPolice && game.policeCars.includes(ride)) continue;
    const d = carBoxDistance(ride, pos.x, pos.z);
    if (d < bestD) {
      bestD = d;
      best = ride;
    }
  }
  return best;
}

export function enterCar(game, ride) {
  const cole = game.player;
  cole.car = ride;
  ride.parked = false;
  ride.traffic = false;
  game.traffic = game.traffic.filter((c) => c !== ride);
  game.hud.showMessage(`You took the ${ride.name}.`);
  game.audio.chime();
  return ride;
}

export function exitCar(game) {
  const cole = game.player;
  const ride = cole.car;
  if (!ride) return;
  ride.speed = 0;
  cole.car = null;
  // Step out to the driver's side, clear of any wall.
  cole.pos.set(ride.pos.x + Math.cos(ride.heading) * 2.6, 0, ride.pos.z - Math.sin(ride.heading) * 2.6);
  const clear = collideCircle(game, cole.pos.x, cole.pos.z, 0.55);
  cole.pos.x = clear.x;
  cole.pos.z = clear.z;
  game.audio.setEngine(0, false);
}

// Arcade driving for the car Cole is in. W accelerates toward top speed,
// S brakes and reverses, Space is the handbrake (with a drift kick at
// speed), A/D steer — weaker when slow, reversed when reversing. A hard
// hit on a building dents the car and the driver; a gentle bump just
// crunches and bounces the car back.
export function drivePlayerCar(game, dt) {
  const cole = game.player;
  const ride = cole.car;
  if (!ride) return;
  const keys = game.input.keys;
  const grip = damageFactor(ride);
  let throttle = 0;
  if (keys.has('KeyW')) throttle = 1;
  if (keys.has('KeyS')) throttle = -1;
  const braking = keys.has('Space');
  const ceiling = ride.maxSpeed * grip;
  const pull = throttle !== 0 ? ride.accel * grip : 8;
  ride.speed += clamp(throttle * ceiling - ride.speed, -pull * dt, pull * dt);
  if (braking) ride.speed *= Math.max(0, 1 - dt * 2.2);
  let steer = 0;
  if (keys.has('KeyA')) steer = 1;
  if (keys.has('KeyD')) steer = -1;
  const pace = clamp(Math.abs(ride.speed) / 12, 0, 1);
  const turnRate = steer * 1.9 * pace * Math.sign(ride.speed || 1);
  ride.heading += turnRate * dt;
  if (braking && Math.abs(ride.speed) > 6 && steer !== 0) {
    ride.heading += steer * 0.9 * dt;
    if (Math.random() < dt * 6) game.fx.burst(ride.pos.clone().setY(0.3), 0xcccccc, 2, 2, 1);
  }
  const nextX = ride.pos.x + Math.sin(ride.heading) * ride.speed * dt;
  const nextZ = ride.pos.z + Math.cos(ride.heading) * ride.speed * dt;
  const moved = collideCircle(game, nextX, nextZ, 2.1);
  if (moved.hit) {
    const hard = Math.abs(ride.speed) > 10;
    const soft = !hard && Math.abs(ride.speed) > 4;
    if (hard) {
      game.fx.explosion(ride.pos.clone().setY(1));
      game.audio.crash();
      damageCar(game, ride, 12);
      if (game.player.health > 0) game.player.health = Math.max(1, game.player.health - 4);
    } else if (soft) {
      game.audio.crash();
      damageCar(game, ride, 3);
    }
    ride.speed *= -0.25;
  }
  if (!inWorldBounds(moved.x, moved.z)) {
    ride.speed *= -0.3;
  } else {
    ride.pos.x = moved.x;
    ride.pos.z = moved.z;
  }
  pushTrafficAside(game, ride);
  ride.mesh.position.copy(ride.pos);
  ride.mesh.rotation.y = ride.heading;
  for (const wheel of ride.wheels) wheel.rotation.x += ride.speed * dt * 2.4;
  const beam = ride.mesh.userData.beam;
  if (beam) beam.intensity = 22;
  // A badly damaged car smokes from under the hood.
  if (ride.health > 0 && ride.health < 35) {
    ride.smokeTimer -= dt;
    if (ride.smokeTimer <= 0) {
      ride.smokeTimer = 0.12;
      const hood = ride.pos.clone();
      hood.x += Math.sin(ride.heading) * 1.6;
      hood.z += Math.cos(ride.heading) * 1.6;
      hood.y = 1.2;
      game.fx.smokePuff(hood);
    }
  }
  cole.speed = Math.abs(ride.speed);
  game.audio.setEngine(Math.abs(ride.speed) / ride.maxSpeed, true);
}

// Simple circle push between Cole's car and every other car, so traffic
// does not ghost through him and a shunt slows both cars.
function pushTrafficAside(game, ride) {
  for (const other of game.cars) {
    if (other === ride) continue;
    const dx = ride.pos.x - other.pos.x;
    const dz = ride.pos.z - other.pos.z;
    const gap = Math.hypot(dx, dz);
    if (gap >= SHUNT_GAP || gap <= 0.01) continue;
    const shove = (SHUNT_GAP - gap) / 2;
    ride.pos.x += (dx / gap) * shove;
    ride.pos.z += (dz / gap) * shove;
    other.pos.x -= (dx / gap) * shove;
    other.pos.z -= (dz / gap) * shove;
    if (Math.abs(ride.speed) > 8) {
      ride.speed *= 0.55;
      if (other.traffic) {
        other.speed *= 0.4;
        other.stuck = 1.5;
      }
      damageCar(game, ride, 6);
      game.audio.crash();
      game.fx.burst(ride.pos.clone().setY(1), 0xffaa33, 6, 4, 2);
    }
  }
}

// The road centre line nearest to a point along the car's travel axis, or
// null when the car is mid-block. Traffic uses it to decide when a turn
// is possible at an intersection.
function nearestRoadLine(game, alongPos) {
  for (const line of game.roads.xs) {
    if (Math.abs(alongPos - line) < 4) return line;
  }
  return null;
}

function maybeTurnAtJunction(game, ride) {
  const along = ride.laneAxis === 'x' ? ride.pos.z : ride.pos.x;
  const line = nearestRoadLine(game, along);
  if (line === null || Math.random() >= 0.35) return;
  ride.laneAxis = ride.laneAxis === 'x' ? 'z' : 'x';
  ride.laneRoad = line;
  ride.laneDir = Math.random() < 0.5 ? 1 : -1;
  ride.laneOffset = pick([-3.5, 3.5]);
}

export function updateTraffic(game, dt) {
  for (const ride of game.traffic) {
    if (ride === game.player.car) continue;
    stepTrafficCar(game, ride, dt);
  }
}

// Distance to the nearest car directly ahead in this car's lane, or null
// when the road ahead is clear. Traffic slows for it instead of driving
// through it.
function gapAhead(game, ride) {
  let closest = null;
  for (const other of game.cars) {
    if (other === ride) continue;
    const dx = other.pos.x - ride.pos.x;
    const dz = other.pos.z - ride.pos.z;
    const inFront =
      ride.laneAxis === 'x'
        ? Math.sign(dz) === ride.laneDir && Math.abs(dx) < 5 && dz * ride.laneDir > 0
        : Math.sign(dx) === ride.laneDir && Math.abs(dz) < 5 && dx * ride.laneDir > 0;
    if (!inFront) continue;
    const gap = Math.hypot(dx, dz);
    if (closest === null || gap < closest) closest = gap;
  }
  return closest;
}

function stepTrafficCar(game, ride, dt) {
  ride.stuck = Math.max(0, ride.stuck - dt);
  const alongPos = ride.laneAxis === 'x' ? ride.pos.z : ride.pos.x;
  const farEdge = ride.laneAxis === 'x' ? 150 : 220;
  if (ride.laneDir > 0 && alongPos > farEdge) ride.laneDir = -1;
  if (ride.laneDir < 0 && alongPos < -220) ride.laneDir = 1;
  let cruise = ride.aiSpeed;
  const ahead = gapAhead(game, ride);
  if (ahead !== null && ahead < 11) cruise = Math.min(cruise, Math.max(0, (ahead - 5) * 1.2));
  if (ride.stuck > 0) cruise = 0;
  ride.speed += clamp(cruise - ride.speed, -10 * dt, 8 * dt);
  const lanePos = ride.laneAxis === 'x' ? ride.pos.x : ride.pos.z;
  const laneErr = ride.laneRoad + ride.laneOffset - lanePos;
  let wantHeading;
  if (ride.laneAxis === 'x') wantHeading = ride.laneDir > 0 ? 0 : Math.PI;
  else wantHeading = ride.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  wantHeading += clamp(laneErr * 0.06, -0.35, 0.35);
  ride.heading = angleLerp(ride.heading, wantHeading, Math.min(1, dt * 2.2));
  if (nearestRoadLine(game, ride.laneAxis === 'x' ? ride.pos.z : ride.pos.x) !== null && Math.random() < dt * 0.25) {
    maybeTurnAtJunction(game, ride);
  }
  const nextX = ride.pos.x + Math.sin(ride.heading) * ride.speed * dt;
  const nextZ = ride.pos.z + Math.cos(ride.heading) * ride.speed * dt;
  const moved = collideCircle(game, nextX, nextZ, 2.1);
  if (!moved.hit && inWorldBounds(moved.x, moved.z)) {
    ride.pos.x = moved.x;
    ride.pos.z = moved.z;
  } else {
    ride.speed *= 0.4;
    ride.heading += Math.PI * 0.5 * dt;
  }
  ride.mesh.position.copy(ride.pos);
  ride.mesh.rotation.y = ride.heading;
  for (const wheel of ride.wheels) wheel.rotation.x += ride.speed * dt * 2.4;
}
