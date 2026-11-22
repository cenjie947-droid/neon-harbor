// Neon Harbor — vehicles (round 6 fresh rewrite).
// Owns every car: the record shape, the box-built meshes, traffic AI,
// driving physics, the damage model and the steal reach. The save system
// restores cars by the model / color / special / name fields on the
// record, so those four names are part of the public contract.
//
// Damage model: a bump costs 4 health, with a 1 s cooldown per car, so a
// long scrape is one bump, never per-frame drain. Below 60 health the car
// loses top speed and acceleration; below 35 it trails smoke from the
// hood; at 0 it is disabled and will not move until the Pay N Spray
// repairs it (health back to 100).

export const MODEL_DEFS = [
  { model: 'Comet GT', color: 0xf2c200, special: 'comet', length: 4.4, width: 1.9, topSpeed: 34, accel: 16 },
  { model: 'Blista', color: 0x4a7ac8, special: '', length: 4.0, width: 1.8, topSpeed: 26, accel: 12 },
  { model: 'Prairie', color: 0xc84a4a, special: '', length: 4.2, width: 1.85, topSpeed: 27, accel: 12 },
  { model: 'Sentinel', color: 0x3a3f45, special: '', length: 4.3, width: 1.85, topSpeed: 28, accel: 13 },
  { model: 'Cab', color: 0xf2a200, special: 'taxi', length: 4.2, width: 1.85, topSpeed: 26, accel: 12 },
  { model: 'Mule', color: 0x8a8a7a, special: 'van', length: 5.2, width: 2.1, topSpeed: 22, accel: 9 },
  { model: 'Cruiser', color: 0x1a1a1a, special: 'police', length: 4.5, width: 1.95, topSpeed: 30, accel: 15 },
];

const BUMP_DAMAGE = 4;
const BUMP_COOLDOWN = 1; // seconds between damage events on one car
// Road grid lines this module needs for traffic spawns (same grid the
// city module builds; expressed here as its own list).
const GRID_LINES = [-180, -120, -60, 0, 60, 120, 180];

function defFor(modelName) {
  return MODEL_DEFS.find((d) => d.model === modelName) || MODEL_DEFS[1];
}

export function createVehicleSystem(G, THREE, scene) {
  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
    return matCache.get(key);
  }

  // Distance from a point to the car's oriented body box (0 when inside).
  // Steal reach is measured against this box, not the car centre, so the
  // prompt appears from the nose or tail as well as from the side.
  function distanceToCarBox(px, pz, car) {
    const dx = px - car.pos.x, dz = pz - car.pos.z;
    const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
    const fwd = dx * sh + dz * ch; // along the car
    const side = dx * ch - dz * sh; // across the car
    const hl = car.length / 2, hw = car.width / 2;
    const cf = Math.max(-hl, Math.min(hl, fwd));
    const cs = Math.max(-hw, Math.min(hw, side));
    return Math.hypot(fwd - cf, side - cs);
  }

  function buildCarMesh(def) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(def.width, 0.75, def.length), mat(def.color));
    body.position.y = 0.65;
    body.castShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(def.width - 0.3, 0.65, def.length * 0.45),
      mat(0x1c2836)
    );
    cabin.position.set(0, 1.3, -def.length * 0.08);
    cabin.castShadow = true;
    group.add(cabin);
    // Headlights / taillights.
    for (const s of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), mat(0xfff2b0, { emissive: 0x887733 }));
      head.position.set(s * (def.width / 2 - 0.35), 0.7, def.length / 2 + 0.01);
      group.add(head);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), mat(0xcc2222, { emissive: 0x550000 }));
      tail.position.set(s * (def.width / 2 - 0.35), 0.7, -def.length / 2 - 0.01);
      group.add(tail);
    }
    // Taxi checker band.
    if (def.special === 'taxi') {
      const band = new THREE.Mesh(new THREE.BoxGeometry(def.width + 0.02, 0.2, def.length * 0.5), mat(0x222222));
      band.position.set(0, 1.05, 0);
      group.add(band);
    }
    // Police light bar.
    if (def.special === 'police') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.5), mat(0x2244cc, { emissive: 0x1133aa }));
      bar.position.set(0, 1.72, -def.length * 0.08);
      group.add(bar);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 1.6), mat(0xffffff));
      door.position.set(def.width / 2 + 0.01, 0.65, 0);
      group.add(door);
      const door2 = door.clone();
      door2.position.x = -def.width / 2 - 0.01;
      group.add(door2);
    }
    const wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
    const wheelMat = mat(0x181818);
    for (const [wx, wz] of [
      [-def.width / 2, def.length / 2 - 0.8],
      [def.width / 2, def.length / 2 - 0.8],
      [-def.width / 2, -def.length / 2 + 0.8],
      [def.width / 2, -def.length / 2 + 0.8],
    ]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.36, wz);
      group.add(wheel);
      wheels.push(wheel);
    }
    return { group, wheels };
  }

  let serial = 0;
  function makeCar(modelName, x, z, heading, opts = {}) {
    const def = defFor(modelName);
    const { group, wheels } = buildCarMesh(def);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    scene.add(group);
    const car = {
      model: def.model,
      color: def.color,
      special: def.special,
      name: opts.name || (def.special === 'comet' ? 'Comet GT' : def.model + ' #' + (++serial)),
      pos: new THREE.Vector3(x, 0, z),
      heading,
      speed: 0,
      steer: 0,
      health: opts.health ?? 100,
      parked: opts.parked ?? false,
      isPolice: def.special === 'police',
      length: def.length,
      width: def.width,
      topSpeed: def.topSpeed,
      accel: def.accel,
      driver: opts.driver || null, // 'player' | 'traffic' | 'police' | null
      mesh: group,
      wheels,
      bumpAt: -99, // game time of the last damage bump
      smokeAt: 0,
      stuckAt: 0,
    };
    if (!opts.skipRegister) G.cars.push(car);
    return car;
  }

  // One bump of damage, gated by the per-car cooldown. Returns true when
  // health actually dropped.
  function applyBump(car, cause = 'hit') {
    if (G.time - car.bumpAt < BUMP_COOLDOWN) return false;
    car.bumpAt = G.time;
    car.health = Math.max(0, car.health - BUMP_DAMAGE);
    if (G.fx) {
      const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
      G.fx.burst(car.pos.x, 1, car.pos.z, 6, 0xd8d8d8, 5);
      if (car.health === 0) G.fx.explosion(car.pos.x, 1, car.pos.z);
    }
    if (G.audio) G.audio.crash();
    if (car.health === 0 && G.hud) G.hud.feed && G.hud.feed('Car disabled — visit the Pay N Spray.');
    return true;
  }

  function repair(car) {
    car.health = 100;
    car.bumpAt = -99;
  }

  // Nearest car the player could steal / enter from (px, pz).
  // STEAL_REACH is 5 m to the oriented body box.
  function nearestStealable(px, pz) {
    let best = null, bestD = 5;
    for (const car of G.cars) {
      if (car.driver === 'player') continue;
      const d = distanceToCarBox(px, pz, car);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  function nearestCar(px, pz, maxD = 999) {
    let best = null, bestD = maxD;
    for (const car of G.cars) {
      const d = Math.hypot(car.pos.x - px, car.pos.z - pz);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  // Effective performance for a damaged car.
  function perf(car) {
    if (car.health <= 0) return { top: 0, acc: 0 };
    if (car.health < 60) return { top: car.topSpeed * 0.62, acc: car.accel * 0.68 };
    return { top: car.topSpeed, acc: car.accel };
  }

  function moveCar(car, dt, forward, back, left, right) {
    const p = perf(car);
    if (p.top <= 0) {
      car.speed = 0;
      return;
    }
    if (forward) car.speed += p.acc * dt;
    else if (back) car.speed -= p.acc * 0.9 * dt;
    else {
      // Rolling drag.
      car.speed -= car.speed * 0.5 * dt;
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
    }
    if (car.speed > p.top) car.speed = p.top;
    if (car.speed < -9) car.speed = -9;
    const steerDir = car.speed >= 0 ? 1 : -1;
    if (left) car.heading += 1.9 * dt * steerDir * Math.min(1, Math.abs(car.speed) / 8 + 0.25);
    if (right) car.heading -= 1.9 * dt * steerDir * Math.min(1, Math.abs(car.speed) / 8 + 0.25);

    const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
    const nx = car.pos.x + sh * car.speed * dt;
    const nz = car.pos.z + ch * car.speed * dt;
    const city = G.city;
    const blocked = city ? city.hitsBuilding(nx, nz, 1.5) : null;
    if (!blocked) {
      car.pos.x = nx;
      car.pos.z = nz;
    } else {
      // Try sliding along one axis only before giving up the move.
      if (!city.hitsBuilding(nx, car.pos.z, 1.5)) car.pos.x = nx;
      else if (!city.hitsBuilding(car.pos.x, nz, 1.5)) car.pos.z = nz;
      else {
        if (Math.abs(car.speed) > 6) applyBump(car, 'building');
        car.speed *= -0.25;
      }
    }
    // Keep inside the world.
    car.pos.x = Math.max(-250, Math.min(250, car.pos.x));
    car.pos.z = Math.max(-250, Math.min(250, car.pos.z));
  }

  // Traffic: cruise the grid, turn at intersections, brake for the car ahead.
  function driveTraffic(car, dt) {
    const city = G.city;
    const onAxisX = Math.abs(Math.sin(car.heading)) > 0.7;
    const p = perf(car);
    let wantSpeed = Math.min(11, p.top);
    // Brake for traffic ahead.
    const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
    for (const other of G.cars) {
      if (other === car) continue;
      const ox = other.pos.x - car.pos.x, oz = other.pos.z - car.pos.z;
      const ahead = ox * sh + oz * ch;
      const lat = Math.abs(ox * ch - oz * sh);
      if (ahead > 0 && ahead < 12 && lat < 3) { wantSpeed = 0; break; }
    }
    if (car.speed < wantSpeed) car.speed += car.accel * 0.5 * dt;
    else if (car.speed > wantSpeed) car.speed -= car.accel * dt;
    // At an intersection, sometimes turn.
    const nearX = city ? city.ROAD_LINES.reduce((a, b) => (Math.abs(b - car.pos.x) < Math.abs(a - car.pos.x) ? b : a)) : 0;
    const nearZ = city ? city.ROAD_LINES.reduce((a, b) => (Math.abs(b - car.pos.z) < Math.abs(a - car.pos.z) ? b : a)) : 0;
    const atCross = Math.abs(car.pos.x - nearX) < 1.5 && Math.abs(car.pos.z - nearZ) < 1.5;
    if (atCross && Math.random() < 0.35) {
      car.heading += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    }
    // Turn back at the world edge instead of driving into the sea.
    if (Math.abs(car.pos.x) > 235 || Math.abs(car.pos.z) > 235) car.heading += Math.PI;
    moveCar(car, dt, true, false, false, false);
  }

  function syncMesh(car) {
    car.mesh.position.set(car.pos.x, 0, car.pos.z);
    car.mesh.rotation.y = car.heading;
    const spin = car.speed * 0.12;
    for (const w of car.wheels) w.rotation.x += spin;
  }

  function update(dt, keys) {
    for (const car of G.cars) {
      if (car.driver === 'player') {
        moveCar(
          car, dt,
          keys.has('KeyW') || keys.has('ArrowUp'),
          keys.has('KeyS') || keys.has('ArrowDown'),
          keys.has('KeyA') || keys.has('ArrowLeft'),
          keys.has('KeyD') || keys.has('ArrowRight')
        );
      } else if (car.driver === 'traffic') {
        driveTraffic(car, dt);
      }
      // Smoke from a battered hood.
      if (car.health > 0 && car.health < 35 && G.fx && G.time - car.smokeAt > 0.16) {
        car.smokeAt = G.time;
        const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
        G.fx.smokePuff(car.pos.x + sh * car.length * 0.4, 1.3, car.pos.z + ch * car.length * 0.4);
      }
      // Car-car shunts: push apart, one bump of damage.
      for (const other of G.cars) {
        if (other === car || other._shuntChecked) continue;
        const d = Math.hypot(other.pos.x - car.pos.x, other.pos.z - car.pos.z);
        const minD = (car.length + other.length) / 2 - 0.6;
        if (d < minD && d > 0.01) {
          const push = (minD - d) / 2;
          const nx = (other.pos.x - car.pos.x) / d, nz = (other.pos.z - car.pos.z) / d;
          car.pos.x -= nx * push; car.pos.z -= nz * push;
          other.pos.x += nx * push; other.pos.z += nz * push;
          const rel = Math.abs(car.speed - other.speed);
          if (rel > 4) {
            applyBump(car, 'car');
            applyBump(other, 'car');
            car.speed *= 0.5; other.speed *= 0.5;
          }
        }
      }
      car._shuntChecked = true;
      syncMesh(car);
    }
    for (const car of G.cars) car._shuntChecked = false;
    if (G.audio && G.player.car) {
      const c = G.player.car;
      G.audio.setEngine(Math.abs(c.speed) / Math.max(1, c.topSpeed), c.health <= 0);
    } else if (G.audio) {
      G.audio.setEngine(0, false);
    }
  }

  function spawnInitial() {
    // Parked cars near the spots the missions and the driver use.
    const parkedSpots = [
      ['Blista', 54, 112, 3.14], ['Prairie', 66, 128, -0.4], ['Sentinel', 48, 126, 1.4],
      ['Blista', -114, 52, 0.1], ['Prairie', -126, 68, 1.8], ['Sentinel', -108, 66, -1.2],
      ['Blista', 114, -112, 0.6], ['Prairie', 126, -126, 2.2], ['Sentinel', -54, -52, 0.9],
      ['Blista', -6, -172, 0], ['Prairie', 12, -174, 3.1], ['Sentinel', 174, 52, 1.57],
      ['Cab', 60, 108, 0.5], ['Mule', -174, 112, 1.57], ['Blista', 30, 206, 0.3],
    ];
    for (const [model, x, z, h] of parkedSpots) {
      makeCar(model, x, z, h, { parked: true });
    }
    // Showroom lot row: all facing heading 0.
    const lots = (G.city && G.city.SHOWROOM_LOTS) || [];
    const lotModels = ['Comet GT', 'Sentinel', 'Prairie', 'Blista', 'Cab'];
    lots.forEach((spot, i) => {
      makeCar(lotModels[i % lotModels.length], spot.x, spot.z, spot.heading, { parked: true });
    });
    // The hero car: a yellow Comet GT by the hideout.
    makeCar('Comet GT', 8, -168, 0.3, { parked: true, name: 'Comet GT' });
    // Moving traffic on the grid.
    const trafficModels = ['Blista', 'Prairie', 'Sentinel', 'Cab', 'Mule'];
    for (let i = 0; i < 10; i++) {
      const line = GRID_LINES[Math.floor(Math.random() * GRID_LINES.length)];
      const along = -180 + Math.floor(Math.random() * 7) * 60;
      const horizontal = Math.random() < 0.5;
      const x = horizontal ? along : line;
      const z = horizontal ? line : along;
      const heading = horizontal ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() < 0.5 ? 0 : Math.PI);
      const car = makeCar(trafficModels[i % trafficModels.length], x, z, heading, { driver: 'traffic' });
      car.speed = 8 + Math.random() * 3;
    }
  }

  const api = {
    MODEL_DEFS,
    makeCar,
    spawnInitial,
    update,
    nearestStealable,
    nearestCar,
    distanceToCarBox,
    applyBump,
    repair,
    perf,
    STEAL_REACH: 5,
  };
  G.vehicles = api;
  return api;
}

export default createVehicleSystem;
