// Neon Harbor — cars: building them, arcade driving, traffic AI, stealing.
import * as THREE from 'three';
import { WORLD, rand, randInt, pick, clamp, collideCircle, angleLerp, inWorldBounds } from './state.js';

const CAR_COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xdddddd, 0x222222, 0x1abc9c, 0xe67e22, 0x95a5a6];
const CAR_NAMES = ['Stallion', 'Comet', 'Breeze', 'Harbor Cruiser', 'Sunset GT', 'Pelican', 'Marlin', 'Gullwing'];

export function makeCarMesh(color, isVan = false, isPolice = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101c2c, roughness: 0.15, metalness: 0.8 });
  const bodyLen = isVan ? 5.6 : 4.4, bodyH = isVan ? 1.5 : 0.85;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, bodyLen), paint);
  body.position.y = 0.75; body.castShadow = true; group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, isVan ? 0.9 : 0.7, isVan ? 3.4 : 2.0),
    isVan ? paint : glass);
  cabin.position.set(0, bodyH + 0.35, isVan ? -0.3 : -0.2); cabin.castShadow = true; group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz); group.add(w); wheels.push(w);
  }
  // headlights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const hx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), lightMat);
    h.position.set(hx, 0.8, bodyLen / 2 + 0.02); group.add(h);
  }
  const beam = new THREE.SpotLight(0xffe9a8, 0, 26, 0.5, 0.5, 1.2);
  beam.position.set(0, 0.9, bodyLen / 2);
  const beamTarget = new THREE.Object3D(); beamTarget.position.set(0, 0, bodyLen / 2 + 12);
  group.add(beamTarget); beam.target = beamTarget; group.add(beam);
  group.userData.beam = beam;
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x111111 }));
    bar.position.set(0, bodyH + 0.75, -0.2); group.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.3, bodyH + 0.9, -0.2); group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.3, bodyH + 0.9, -0.2); group.add(blue);
    group.userData.policeLights = [red, blue];
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.3, bodyLen + 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111111 }));
    stripe.position.y = 0.85; group.add(stripe);
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
    mesh: group, wheels, name: name || pick(CAR_NAMES),
    pos: group.position, heading, speed: 0,
    color, isVan, isPolice, parked, traffic,
    maxSpeed: isVan ? 26 : isPolice ? 34 : 30 + rand(0, 6),
    accel: isVan ? 11 : 16,
    steer: 0, // current steering angle
    health: 100,
    // traffic AI
    laneRoad: null, laneAxis: null, laneDir: 1, laneOffset: 0, aiSpeed: 0,
    stuck: 0,
  };
  if (traffic) {
    car.aiSpeed = rand(10, 14);
    // pick a road lane
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(G.roads.xs);
    car.laneAxis = axis; car.laneRoad = line; car.laneDir = Math.random() < 0.5 ? 1 : -1;
    car.laneOffset = pick([-3.5, 3.5]);
    car.speed = car.aiSpeed;
    if (axis === 'x') { car.pos.set(line + car.laneOffset, 0, rand(-220, 150)); car.heading = car.laneDir > 0 ? 0 : Math.PI; }
    else { car.pos.set(rand(-220, 220), 0, line + car.laneOffset); car.heading = car.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    car.mesh.rotation.y = car.heading;
  }
  G.cars.push(car);
  if (traffic) G.traffic.push(car);
  return car;
}

export function spawnParkedCars(G) {
  // parked cars along roadsides, in lots, and the special Comet GT showroom
  const spots = [];
  for (let i = 0; i < 22; i++) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(G.roads.xs);
    const along = rand(-210, 140);
    if (axis === 'x') spots.push({ x: line + pick([-8.5, 8.5]), z: along, heading: Math.random() < 0.5 ? 0 : Math.PI });
    else spots.push({ x: along, z: line + pick([-8.5, 8.5]), heading: Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2 });
  }
  for (const s of spots) {
    createCar(G, { ...s, color: pick(CAR_COLORS), parked: true });
  }
  // showroom lot: the yellow Comet GT for mission 3
  const comet = createCar(G, {
    x: G.markers.showroom.x, z: G.markers.showroom.z, heading: Math.PI / 2,
    color: 0xffd23e, name: 'Comet GT', parked: true,
  });
  comet.special = 'comet';
  G.cometGT = comet;
  // armored van at the bank for mission 5
  const van = createCar(G, {
    x: G.markers.bank.x + 7, z: G.markers.bank.z + 6, heading: -Math.PI / 2,
    color: 0x3a3f4a, name: 'Harbor Bank Van', isVan: true, parked: true,
  });
  van.special = 'bankvan';
  G.bankVan = van;
  // a starter car near Mara's garage so mission 1 is always doable
  createCar(G, { x: G.markers.garage.x + 7, z: G.markers.garage.z, heading: 0, color: 0xc0392b, name: 'Stallion', parked: true });
}

export function spawnTraffic(G, count) {
  for (let i = 0; i < count; i++) createCar(G, { x: 0, z: 0, color: pick(CAR_COLORS), traffic: true });
}

// Arcade driving for the player's car.
export function drivePlayerCar(G, dt) {
  const p = G.player, car = p.car;
  if (!car) return;
  const input = G.input;
  const forward = Math.sin(car.heading), right = Math.cos(car.heading);
  let throttle = 0;
  if (input.keys.has('KeyW')) throttle = 1;
  if (input.keys.has('KeyS')) throttle = -1;
  const handbrake = input.keys.has('Space');
  const target = throttle * car.maxSpeed;
  const accelRate = throttle !== 0 ? car.accel : 8;
  car.speed += clamp(target - car.speed, -accelRate * dt, accelRate * dt);
  if (handbrake) car.speed *= Math.max(0, 1 - dt * 2.2);
  // steering, weaker at low speed, reversed when reversing
  let steerInput = 0;
  if (input.keys.has('KeyA')) steerInput = 1;
  if (input.keys.has('KeyD')) steerInput = -1;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  car.heading += steerInput * 1.9 * speedFactor * Math.sign(car.speed || 1) * dt;
  if (handbrake && Math.abs(car.speed) > 6 && steerInput !== 0) {
    car.heading += steerInput * 0.9 * dt; // drift kick
    if (Math.random() < dt * 6) G.fx.burst(car.pos.clone().setY(0.3), 0xcccccc, 2, 2, 1);
  }
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  // building collision
  const res = collideCircle(G, nx, nz, 2.1);
  if (res.hit) {
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
  if (!inWorldBounds(res.x, res.z)) { car.speed *= -0.3; }
  else { car.pos.x = res.x; car.pos.z = res.z; }
  // car-car collision (simple circle push)
  for (const other of G.cars) {
    if (other === car) continue;
    const dx = car.pos.x - other.pos.x, dz = car.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 4.4 && d > 0.01) {
      const push = (4.4 - d) / 2;
      car.pos.x += (dx / d) * push; car.pos.z += (dz / d) * push;
      other.pos.x -= (dx / d) * push; other.pos.z -= (dz / d) * push;
      if (Math.abs(car.speed) > 8) {
        car.speed *= 0.55;
        if (other.traffic) { other.speed *= 0.4; other.stuck = 1.5; }
        G.audio.crash();
        G.fx.burst(car.pos.clone().setY(1), 0xffaa33, 6, 4, 2);
      }
    }
  }
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.heading;
  // wheel spin + steering visual
  const spin = car.speed * dt * 2.4;
  for (const w of car.wheels) w.rotation.x += spin;
  // headlights on at dusk
  if (car.mesh.userData.beam) car.mesh.userData.beam.intensity = 22;
  p.speed = Math.abs(car.speed);
  G.audio.setEngine(Math.abs(car.speed) / car.maxSpeed, true);
}

function trafficTurn(car) {
  // at an intersection, sometimes turn onto the crossing road
  const axis = car.laneAxis;
  const pos = axis === 'x' ? car.pos.z : car.pos.x;
  const nearLine = G_ROADS_NEAR(car, pos);
  if (nearLine === null) return;
  if (Math.random() < 0.35) {
    // turn: switch axis
    car.laneAxis = axis === 'x' ? 'z' : 'x';
    car.laneRoad = nearLine;
    car.laneDir = Math.random() < 0.5 ? 1 : -1;
    car.laneOffset = pick([-3.5, 3.5]);
  }
}
function G_ROADS_NEAR(car, pos) {
  for (const line of [-180, -120, -60, 0, 60, 120, 180]) {
    if (Math.abs(pos - line) < 4) return line;
  }
  return null;
}

export function updateTraffic(G, dt) {
  for (const car of G.traffic) {
    if (car === G.player.car) continue;
    car.stuck = Math.max(0, car.stuck - dt);
    // turn around before the beach / map edge instead of piling up there
    const alongPos = car.laneAxis === 'x' ? car.pos.z : car.pos.x;
    const alongLimit = car.laneAxis === 'x' ? 150 : 220;
    if (car.laneDir > 0 && alongPos > alongLimit) car.laneDir = -1;
    if (car.laneDir < 0 && alongPos < -220) car.laneDir = 1;
    // slow down for a car ahead in the same lane
    let targetSpeed = car.aiSpeed;
    for (const other of G.cars) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x, dz = other.pos.z - car.pos.z;
      const ahead = car.laneAxis === 'x'
        ? (Math.sign(dz) === car.laneDir && Math.abs(dx) < 5 && dz * car.laneDir > 0)
        : (Math.sign(dx) === car.laneDir && Math.abs(dz) < 5 && dx * car.laneDir > 0);
      const dist = Math.hypot(dx, dz);
      if (ahead && dist < 11) { targetSpeed = Math.min(targetSpeed, Math.max(0, (dist - 5) * 1.2)); }
    }
    if (car.stuck > 0) targetSpeed = 0;
    car.speed += clamp(targetSpeed - car.speed, -10 * dt, 8 * dt);
    // steer toward lane centre, turn at intersections
    const axis = car.laneAxis;
    const lanePos = axis === 'x' ? car.pos.x : car.pos.z;
    const wantLane = car.laneRoad + car.laneOffset;
    const laneErr = wantLane - lanePos;
    let wantHeading;
    if (axis === 'x') wantHeading = car.laneDir > 0 ? 0 : Math.PI;
    else wantHeading = car.laneDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    wantHeading += clamp(laneErr * 0.06, -0.35, 0.35);
    car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 2.2));
    // maybe turn at an intersection
    const along = axis === 'x' ? car.pos.z : car.pos.x;
    if (G_ROADS_NEAR(car, along) !== null && Math.random() < dt * 0.25) trafficTurn(car);
    const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
    const res = collideCircle(G, nx, nz, 2.1);
    if (!res.hit && inWorldBounds(res.x, res.z)) { car.pos.x = res.x; car.pos.z = res.z; }
    else { car.speed *= 0.4; car.heading += Math.PI * 0.5 * dt; }
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    for (const w of car.wheels) w.rotation.x += car.speed * dt * 2.4;
  }
}

export function nearestCar(G, pos, maxDist) {
  let best = null, bestD = maxDist;
  for (const car of G.cars) {
    if (car.isPolice && G.policeCars.includes(car)) continue;
    const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export function enterCar(G, car) {
  const p = G.player;
  p.car = car;
  car.parked = false;
  car.traffic = false;
  G.traffic = G.traffic.filter(c => c !== car);
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
  // step out to the side
  p.pos.set(car.pos.x + Math.cos(car.heading) * 2.6, 0, car.pos.z - Math.sin(car.heading) * 2.6);
  const res = collideCircle(G, p.pos.x, p.pos.z, 0.55);
  p.pos.x = res.x; p.pos.z = res.z;
  G.audio.setEngine(0, false);
}
