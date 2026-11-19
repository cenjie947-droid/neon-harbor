// Neon Harbor — cars: building them, arcade driving, traffic AI, stealing.
// The driving model is deliberately simple and stays that way: hold W and
// the car keeps accelerating toward its top speed, S brakes and reverses,
// A/D steer harder the faster the car goes. Stealing works the same way a
// player expects it to — walk up to any side of a car, nose or tail
// included, and the prompt appears. Distance is measured to the car's
// oriented body box, not its centre, so standing at the bumper counts the
// same as standing at the door.
import * as THREE from 'three';
import { WORLD, rand, randInt, pick, clamp, collideCircle, angleLerp, inWorldBounds } from './state.js';

// How far outside a car's body the steal prompt reaches, in metres.
export const STEAL_REACH = 5;

const PAINTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xdddddd, 0x222222, 0x1abc9c, 0xe67e22, 0x95a5a6];
const MODELS = ['Stallion', 'Comet', 'Breeze', 'Harbor Cruiser', 'Sunset GT', 'Pelican', 'Marlin', 'Gullwing'];

// Half-extents of a car body, used by the steal check and by collision.
function bodyHalfExtents(car) {
  return { halfLen: car.isVan ? 2.8 : 2.2, halfWid: 1.0 };
}

function boxMesh(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// Build the visible car: painted body, glass or tall van cabin, four
// spinning wheels, headlights with a real beam, and — for Harbor PD — a
// light bar, a stripe and flashing red/blue lamps.
export function makeCarMesh(color, isVan = false, isPolice = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c2c, roughness: 0.15, metalness: 0.8 });
  const bodyLen = isVan ? 5.6 : 4.4;
  const bodyH = isVan ? 1.5 : 0.85;
  const body = boxMesh(2.0, bodyH, bodyLen, paint, 0, 0.75, 0);
  body.castShadow = true;
  group.add(body);
  const cabin = boxMesh(
    1.8,
    isVan ? 0.9 : 0.7,
    isVan ? 3.4 : 2.0,
    isVan ? paint : glass,
    0,
    bodyH + 0.35,
    isVan ? -0.3 : -0.2,
  );
  cabin.castShadow = true;
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.42, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const hx of [-0.6, 0.6]) {
    group.add(boxMesh(0.35, 0.18, 0.1, lampMat, hx, 0.8, bodyLen / 2 + 0.02));
  }
  const beam = new THREE.SpotLight(0xffe9a8, 0, 26, 0.5, 0.5, 1.2);
  beam.position.set(0, 0.9, bodyLen / 2);
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, 0, bodyLen / 2 + 12);
  group.add(beamTarget);
  beam.target = beamTarget;
  group.add(beam);
  group.userData.beam = beam;
  if (isPolice) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    group.add(boxMesh(1.2, 0.22, 0.5, dark, 0, bodyH + 0.75, -0.2));
    const red = boxMesh(0.5, 0.2, 0.4, new THREE.MeshBasicMaterial({ color: 0xff2222 }), -0.3, bodyH + 0.9, -0.2);
    const blue = boxMesh(0.5, 0.2, 0.4, new THREE.MeshBasicMaterial({ color: 0x2266ff }), 0.3, bodyH + 0.9, -0.2);
    group.add(red);
    group.add(blue);
    group.userData.policeLights = [red, blue];
    const stripe = boxMesh(2.02, 0.3, bodyLen + 0.02, new THREE.MeshStandardMaterial({ color: 0x111111 }), 0, 0.85, 0);
    group.add(stripe);
  }
  return { group, wheels };
}

export function createCar(G, opts) {
  const { x, z, heading = 0, color, name, isVan = false, isPolice = false, parked = false, traffic = false } = opts;
  const { group, wheels } = makeCarMesh(color, isVan, isPolice);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  G.scene.add(group);
  const car = {
    mesh: group,
    wheels,
    name: name || pick(MODELS),
    pos: group.position,
    heading,
    speed: 0,
    color,
    isVan,
    isPolice,
    parked,
    traffic,
    maxSpeed: isVan ? 26 : isPolice ? 36 : 30 + rand(0, 6),
    accel: isVan ? 11 : 16,
    health: 100,
    // traffic AI state
    laneRoad: null,
    laneAxis: null,
    laneDir: 1,
    laneOffset: 0,
    aiSpeed: 0,
    stuck: 0,
    ramCooldown: 0,
  };
  if (traffic) {
    car.aiSpeed = rand(10, 14);
    car.laneAxis = Math.random() < 0.5 ? 'x' : 'z';
    car.laneRoad = pick(G.roads.xs);
    car.laneDir = Math.random() < 0.5 ? 1 : -1;
    car.laneOffset = pick([-3.5, 3.5]);
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
  G.cars.push(car);
  if (traffic) G.traffic.push(car);
  return car;
}

export function spawnParkedCars(G) {
  // Curbside cars all over the city, then the three cars the story needs:
  // the yellow Comet GT in the showroom lot, the armored bank van, and a
  // red Stallion by Mara's garage so the first job is always doable.
  for (let i = 0; i < 22; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(G.roads.xs);
    const along = rand(-210, 140);
    const spot =
      axis === 'x'
        ? { x: line + pick([-8.5, 8.5]), z: along, heading: Math.random() < 0.5 ? 0 : Math.PI }
        : { x: along, z: line + pick([-8.5, 8.5]), heading: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
    createCar(G, { ...spot, color: pick(PAINTS), parked: true });
  }
  const comet = createCar(G, {
    x: G.markers.showroom.x,
    z: G.markers.showroom.z,
    heading: Math.PI / 2,
    color: 0xffd23e,
    name: 'Comet GT',
    parked: true,
  });
  comet.special = 'comet';
  G.cometGT = comet;
  const van = createCar(G, {
    x: G.markers.bank.x + 7,
    z: G.markers.bank.z + 6,
    heading: -Math.PI / 2,
    color: 0x3a3f4a,
    name: 'Harbor Bank Van',
    isVan: true,
    parked: true,
  });
  van.special = 'bankvan';
  G.bankVan = van;
  createCar(G, {
    x: G.markers.garage.x + 7,
    z: G.markers.garage.z,
    heading: 0,
    color: 0xc0392b,
    name: 'Stallion',
    parked: true,
  });
}

export function spawnTraffic(G, count) {
  for (let i = 0; i < count; i++) {
    createCar(G, { x: 0, z: 0, color: pick(PAINTS), traffic: true });
  }
}

// Arcade driving for the car the player is in. W accelerates toward top
// speed, S brakes and reverses, Space is the handbrake (with a drift kick
// at speed), A/D steer — weaker when slow, reversed when reversing. A hard
// hit on a building dents the car and the driver; a gentle bump just
// crunches and bounces the car back.
export function drivePlayerCar(G, dt) {
  const p = G.player;
  const car = p.car;
  if (!car) return;
  const input = G.input;
  let throttle = 0;
  if (input.keys.has('KeyW')) throttle = 1;
  if (input.keys.has('KeyS')) throttle = -1;
  const handbrake = input.keys.has('Space');
  const target = throttle * car.maxSpeed;
  const accelRate = throttle !== 0 ? car.accel : 8;
  car.speed += clamp(target - car.speed, -accelRate * dt, accelRate * dt);
  if (handbrake) car.speed *= Math.max(0, 1 - dt * 2.2);
  let steerInput = 0;
  if (input.keys.has('KeyA')) steerInput = 1;
  if (input.keys.has('KeyD')) steerInput = -1;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  car.heading += steerInput * 1.9 * speedFactor * Math.sign(car.speed || 1) * dt;
  if (handbrake && Math.abs(car.speed) > 6 && steerInput !== 0) {
    car.heading += steerInput * 0.9 * dt;
    if (Math.random() < dt * 6) G.fx.burst(car.pos.clone().setY(0.3), 0xcccccc, 2, 2, 1);
  }
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const moved = collideCircle(G, nx, nz, 2.1);
  if (moved.hit) {
    if (Math.abs(car.speed) > 10) {
      G.fx.explosion(car.pos.clone().setY(1));
      G.audio.crash();
      car.health -= 12;
      if (G.player.health > 0) G.player.health = Math.max(1, G.player.health - 4);
    } else if (Math.abs(car.speed) > 4) {
      G.audio.crash();
    }
    car.speed *= -0.25;
  }
  if (!inWorldBounds(moved.x, moved.z)) {
    car.speed *= -0.3;
  } else {
    car.pos.x = moved.x;
    car.pos.z = moved.z;
  }
  pushOtherCars(G, car);
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  const spin = car.speed * dt * 2.4;
  for (const wheel of car.wheels) wheel.rotation.x += spin;
  if (car.mesh.userData.beam) car.mesh.userData.beam.intensity = 22;
  p.speed = Math.abs(car.speed);
  G.audio.setEngine(Math.abs(car.speed) / car.maxSpeed, true);
}

// Simple circle push between the player's car and every other car, so
// traffic does not ghost through the player and a shunt slows both cars.
function pushOtherCars(G, car) {
  for (const other of G.cars) {
    if (other === car) continue;
    const dx = car.pos.x - other.pos.x;
    const dz = car.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= 4.4 || d <= 0.01) continue;
    const push = (4.4 - d) / 2;
    car.pos.x += (dx / d) * push;
    car.pos.z += (dz / d) * push;
    other.pos.x -= (dx / d) * push;
    other.pos.z -= (dz / d) * push;
    if (Math.abs(car.speed) > 8) {
      car.speed *= 0.55;
      if (other.traffic) {
        other.speed *= 0.4;
        other.stuck = 1.5;
      }
      G.audio.crash();
      G.fx.burst(car.pos.clone().setY(1), 0xffaa33, 6, 4, 2);
    }
  }
}

// The road centre line nearest to a point along the car's travel axis, or
// null when the car is mid-block. Traffic uses it to decide when a turn is
// possible at an intersection.
function nearestRoadLine(G, alongPos) {
  for (const line of G.roads.xs) {
    if (Math.abs(alongPos - line) < 4) return line;
  }
  return null;
}

function maybeTurnAtIntersection(G, car) {
  const along = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
  const line = nearestRoadLine(G, along);
  if (line === null || Math.random() >= 0.35) return;
  car.laneAxis = car.laneAxis === 'x' ? 'z' : 'x';
  car.laneRoad = line;
  car.laneDir = Math.random() < 0.5 ? 1 : -1;
  car.laneOffset = pick([-3.5, 3.5]);
}

export function updateTraffic(G, dt) {
  for (const car of G.traffic) {
    if (car === G.player.car) continue;
    car.stuck = Math.max(0, car.stuck - dt);
    const alongPos = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
    const alongLimit = car.laneAxis === 'x' ? 150 : 220;
    if (car.laneDir > 0 && alongPos > alongLimit) car.laneDir = -1;
    if (car.laneDir < 0 && alongPos < -220) car.laneDir = 1;
    let targetSpeed = car.aiSpeed;
    for (const other of G.cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const ahead =
        car.laneAxis === 'x'
          ? Math.sign(dz) === car.laneDir && Math.abs(dx) < 5 && dz * car.laneDir > 0
          : Math.sign(dx) === car.laneDir && Math.abs(dz) < 5 && dx * car.laneDir > 0;
      const dist = Math.hypot(dx, dz);
      if (ahead && dist < 11) targetSpeed = Math.min(targetSpeed, Math.max(0, (dist - 5) * 1.2));
    }
    if (car.stuck > 0) targetSpeed = 0;
    car.speed += clamp(targetSpeed - car.speed, -10 * dt, 8 * dt);
    const lanePos = car.laneAxis === 'x' ? car.pos.x : car.pos.z;
    const laneErr = car.laneRoad + car.laneOffset - lanePos;
    let wantHeading;
    if (car.laneAxis === 'x') wantHeading = car.laneDir > 0 ? 0 : Math.PI;
    else wantHeading = car.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    wantHeading += clamp(laneErr * 0.06, -0.35, 0.35);
    car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 2.2));
    if (nearestRoadLine(G, car.laneAxis === 'x' ? car.pos.z : car.pos.x) !== null && Math.random() < dt * 0.25) {
      maybeTurnAtIntersection(G, car);
    }
    const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
    const moved = collideCircle(G, nx, nz, 2.1);
    if (!moved.hit && inWorldBounds(moved.x, moved.z)) {
      car.pos.x = moved.x;
      car.pos.z = moved.z;
    } else {
      car.speed *= 0.4;
      car.heading += Math.PI * 0.5 * dt;
    }
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    for (const wheel of car.wheels) wheel.rotation.x += car.speed * dt * 2.4;
  }
}

// Distance from a point to a car's body, measured in the car's own frame:
// project the offset onto the car's forward and side axes, subtract the
// half-extents, and measure what is left. Zero means the point is touching
// the body; the value grows in every direction alike, so the nose, the tail
// and both doors all count.
export function carBoxDistance(car, x, z) {
  const dx = x - car.pos.x;
  const dz = z - car.pos.z;
  const forward = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
  const side = dx * Math.cos(car.heading) - dz * Math.sin(car.heading);
  const { halfLen, halfWid } = bodyHalfExtents(car);
  const beyondLen = Math.max(Math.abs(forward) - halfLen, 0);
  const beyondWid = Math.max(Math.abs(side) - halfWid, 0);
  return Math.hypot(beyondLen, beyondWid);
}

export function nearestCar(G, pos, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    if (car.isPolice && G.policeCars.includes(car)) continue;
    const d = carBoxDistance(car, pos.x, pos.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function enterCar(G, car) {
  const p = G.player;
  p.car = car;
  car.parked = false;
  car.traffic = false;
  G.traffic = G.traffic.filter((c) => c !== car);
  G.hud.showMessage(`You took the ${car.name}.`);
  G.audio.chime();
  return car;
}

export function exitCar(G) {
  const p = G.player;
  const car = p.car;
  if (!car) return;
  car.speed = 0;
  p.car = null;
  // Step out to the driver's side, clear of any wall.
  p.pos.set(car.pos.x + Math.cos(car.heading) * 2.6, 0, car.pos.z - Math.sin(car.heading) * 2.6);
  const clear = collideCircle(G, p.pos.x, p.pos.z, 0.55);
  p.pos.x = clear.x;
  p.pos.z = clear.z;
  G.audio.setEngine(0, false);
}
