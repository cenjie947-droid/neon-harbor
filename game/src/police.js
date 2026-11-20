// Neon Harbor — the wanted system. Stars 0–5, police cars that chase and
// ram, foot officers who can grab Cole and bust him. Two rules shape
// everything here, both learned from playtesting: heat must feel like a
// pursuit, not a flicker — a star used to vanish about fourteen seconds
// after Cole slipped out of sight, before a single police car had even
// arrived — and the response must be visible, so units spawn close enough
// to see and hear, on a road, heading in. Heat now only fades after a
// full minute genuinely unseen, and a fresh crime restarts that clock.
import * as THREE from 'three';
import { rand, clamp, dist2D, angleLerp, collideCircle, inWorldBounds, segmentBlocked } from './state.js';
import { createCar, damageCar } from './vehicles.js';
import { damagePlayer } from './player.js';

// How far away a witness counts as seeing Cole, how long he must stay
// unseen before one star drops, and where fresh units appear. The old
// spawn band (45–65 m) put the first police car a long drive away; the
// new band (28–42 m) puts headlights in the mirror.
const SEE_FAR = 60;
const UNSEEN_PER_STAR = 60;
const SPAWN_CLOSE = 28;
const SPAWN_FAR = 42;
const OFFICER_RANGE = 30;
const GRAB_SECONDS = 2.0;

// Small helper: a box mesh placed in one call.
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class Police {
  constructor(G) {
    this.G = G;
    this.grabTime = 0;
    this.spawnWait = 0;
  }

  update(G, dt) {
    this.coolDown(G, dt);
    this.staffStreets(G, dt);
    this.runSiren(G);
    this.runChase(G, dt);
    this.runOfficers(G, dt);
  }

  addWanted(G, stars, message) {
    if (stars <= 0) return;
    const before = G.wanted;
    G.wanted = clamp(G.wanted + stars, 0, 5);
    // Any fresh crime restarts the unseen clock: stealing a second car
    // while the heat is already fading must not let the star drop anyway.
    G.heatTimer = 0;
    G.stats.crimes++;
    if (G.wanted > before) {
      if (message) G.hud.showMessage(message);
      G.hud.showMessage(`Wanted level ${G.wanted} — Harbor PD is on you.`);
    }
  }

  clearWanted(G) {
    G.wanted = 0;
    G.heatTimer = 0;
    this.grabTime = 0;
    this.clearUnits(G);
  }

  clearUnits(G) {
    for (const car of G.policeCars) {
      G.scene.remove(car.mesh);
      G.cars = G.cars.filter((c) => c !== car);
    }
    G.policeCars = [];
    for (const officer of G.officers) G.scene.remove(officer.mesh);
    G.officers = [];
    this.grabTime = 0;
  }

  coolDown(G, dt) {
    if (G.wanted <= 0) return;
    if (this.spotWitness(G)) {
      G.heatTimer = 0;
      return;
    }
    G.heatTimer += dt;
    if (G.heatTimer <= UNSEEN_PER_STAR) return;
    G.heatTimer = 0;
    G.wanted = Math.max(0, G.wanted - 1);
    if (G.wanted === 0) {
      this.clearUnits(G);
      G.hud.showMessage('You lost the cops. Heat is off.');
    } else {
      G.hud.showMessage(`Heat dropping — wanted level ${G.wanted}.`);
    }
  }

  // Is any police unit looking straight at Cole right now? Close is not
  // enough — a building between them breaks the sight line, which is what
  // makes hiding behind a block a real way to cool off.
  spotWitness(G) {
    let nearest = Infinity;
    let nearestPos = null;
    const consider = (pos) => {
      const d = dist2D(pos.x, pos.z, G.player.pos.x, G.player.pos.z);
      if (d < nearest) {
        nearest = d;
        nearestPos = pos;
      }
    };
    for (const car of G.policeCars) consider(car.pos);
    for (const officer of G.officers) consider(officer.pos);
    if (!nearestPos || nearest > SEE_FAR) return null;
    if (segmentBlocked(G, G.player.pos.x, G.player.pos.z, nearestPos.x, nearestPos.z)) return null;
    return { dist: nearest, pos: nearestPos };
  }

  // One more cruiser than the star count (capped at four) so a chase looks
  // like a chase, and foot officers from two stars up. Spawns are paced so
  // the street fills over a few seconds instead of all at once.
  staffStreets(G, dt) {
    const wantCars = G.wanted >= 1 ? Math.min(4, G.wanted + 1) : 0;
    const wantOfficers = G.wanted >= 2 ? Math.min(4, G.wanted) : 0;
    this.spawnWait -= dt;
    if (this.spawnWait > 0) return;
    if (G.policeCars.length < wantCars) this.sendCruiser(G);
    else if (G.officers.length < wantOfficers) this.sendOfficer(G);
    this.spawnWait = G.wanted >= 3 ? 0.7 : 1.2;
  }

  // Pick a spawn spot on a road 28–42 m from Cole. The road snap can drag
  // the point in or out, so several angles are tried and the first that
  // really lands in the band wins; the best miss is the fallback.
  findSpawn(G) {
    const p = G.player.pos;
    let fallback = null;
    let fallbackScore = Infinity;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(SPAWN_CLOSE, SPAWN_FAR);
      let x = clamp(p.x + Math.cos(angle) * dist, -230, 230);
      let z = clamp(p.z + Math.sin(angle) * dist, -230, 190);
      x = this.snapAxis(G, x, z, 'x');
      z = this.snapAxis(G, x, z, 'z');
      const d = Math.hypot(x - p.x, z - p.z);
      const off = d < SPAWN_CLOSE ? SPAWN_CLOSE - d : d > SPAWN_FAR ? d - SPAWN_FAR : 0;
      if (off === 0) return { x, z };
      if (off < fallbackScore) {
        fallbackScore = off;
        fallback = { x, z };
      }
    }
    return fallback || { x: p.x + SPAWN_CLOSE, z: p.z };
  }

  // Move one axis onto its nearest road centre line, but only when that
  // road is the closer of the two — otherwise the snap drags the point
  // sideways along the street instead of onto it.
  snapAxis(G, x, z, axis) {
    const nearestLine = (list, value) => {
      let best = list[0];
      let bestD = Infinity;
      for (const line of list) {
        const d = Math.abs(value - line);
        if (d < bestD) {
          bestD = d;
          best = line;
        }
      }
      return { line: best, dist: bestD };
    };
    const rx = nearestLine(G.roads.xs, x);
    const rz = nearestLine(G.roads.zs, z);
    if (axis === 'x' && rx.dist <= rz.dist) return rx.line;
    if (axis === 'z' && rz.dist < rx.dist) return rz.line;
    return axis === 'x' ? x : z;
  }

  sendCruiser(G) {
    const spot = this.findSpawn(G);
    const car = createCar(G, {
      x: spot.x,
      z: spot.z,
      heading: 0,
      color: 0xf5f5f5,
      name: 'Harbor PD',
      isPolice: true,
    });
    car.maxSpeed = 36;
    G.policeCars.push(car);
    return car;
  }

  spawnPoliceCar(G) {
    return this.sendCruiser(G);
  }

  sendOfficer(G) {
    const p = G.player.pos;
    const angle = rand(0, Math.PI * 2);
    const x = clamp(p.x + Math.cos(angle) * OFFICER_RANGE, -230, 230);
    const z = clamp(p.z + Math.sin(angle) * OFFICER_RANGE, -230, 190);
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 });
    const torso = box(0.6, 0.85, 0.36, navy, 0, 1.05, 0);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    group.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.28, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.6 }),
    );
    cap.position.y = 1.88;
    group.add(cap);
    const legL = box(0.22, 0.6, 0.24, dark, -0.15, 0.3, 0);
    const legR = box(0.22, 0.6, 0.24, dark, 0.15, 0.3, 0);
    group.add(legL, legR);
    group.position.set(x, 0, z);
    G.scene.add(group);
    const officer = { mesh: group, legL, legR, pos: group.position, heading: 0, phase: 0, speed: 5.6 };
    G.officers.push(officer);
    return officer;
  }

  spawnOfficer(G) {
    return this.sendOfficer(G);
  }

  runSiren(G) {
    let close = false;
    for (const car of G.policeCars) {
      if (dist2D(car.pos.x, car.pos.z, G.player.pos.x, G.player.pos.z) < 90) close = true;
    }
    G.audio.setSiren(close && G.wanted > 0);
  }

  runChase(G, dt) {
    const p = G.player;
    for (const car of G.policeCars) {
      const dx = p.pos.x - car.pos.x;
      const dz = p.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const wantHeading = Math.atan2(dx / d, dz / d);
      car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 1.6));
      const targetSpeed = d > 60 ? car.maxSpeed : 24;
      car.speed += clamp(targetSpeed - car.speed, -14 * dt, 12 * dt);
      const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
      const moved = collideCircle(G, nx, nz, 2.1);
      if (!moved.hit && inWorldBounds(moved.x, moved.z)) {
        car.pos.x = moved.x;
        car.pos.z = moved.z;
      } else {
        car.speed *= 0.5;
      }
      this.ram(G, car, d, dt);
      for (const other of G.traffic) {
        if (dist2D(car.pos.x, car.pos.z, other.pos.x, other.pos.z) < 5) other.stuck = 0.8;
      }
      car.mesh.position.copy(car.pos);
      car.mesh.rotation.y = car.heading;
      for (const wheel of car.wheels) wheel.rotation.x += car.speed * dt * 2.4;
      this.blinkBar(G, car);
    }
  }

  // A ram lands at most once a second per car, so a cruiser parked on Cole
  // cannot machine-gun him to death before an officer can arrive and make
  // the arrest.
  ram(G, car, dist, dt) {
    car.ramCooldown = Math.max(0, (car.ramCooldown || 0) - dt);
    if (dist >= 4.6 || car.ramCooldown > 0) return;
    car.ramCooldown = 1.0;
    const p = G.player;
    if (p.car) {
      p.car.speed *= 0.7;
      car.speed *= 0.5;
      damageCar(G, p.car, 8);
      G.audio.crash();
      G.fx.burst(car.pos.clone().setY(1), 0xffaa33, 5, 3, 2);
      damagePlayer(G, 3, 'ram');
    } else {
      damagePlayer(G, 8, 'ram');
      car.speed *= 0.3;
    }
    G.fx.shake(0.3);
  }

  blinkBar(G, car) {
    const lights = car.mesh.userData.policeLights;
    if (!lights) return;
    const redOn = Math.floor(G.time * 6) % 2 === 0;
    lights[0].material.color.setHex(redOn ? 0xff2222 : 0x551111);
    lights[1].material.color.setHex(redOn ? 0x112255 : 0x2266ff);
  }

  // Foot officers run Cole down; one holding on for two seconds on foot
  // makes the arrest. Officers cannot grab a driver — they chase the car
  // instead, waiting for him to step out.
  runOfficers(G, dt) {
    const p = G.player;
    let grabbing = false;
    for (const officer of G.officers) {
      const dx = p.pos.x - officer.pos.x;
      const dz = p.pos.z - officer.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      officer.heading = Math.atan2(dx / d, dz / d);
      const speed = p.car ? 6.4 : 5.6;
      officer.pos.x += (dx / d) * speed * dt;
      officer.pos.z += (dz / d) * speed * dt;
      officer.phase += dt * speed * 2;
      const step = Math.sin(officer.phase) * 0.6;
      officer.legL.rotation.x = step;
      officer.legR.rotation.x = -step;
      officer.mesh.position.copy(officer.pos);
      officer.mesh.rotation.y = officer.heading;
      if (!p.car && d < 1.7) grabbing = true;
    }
    if (grabbing) {
      this.grabTime += dt;
      G.hud.showHint('The officer is grabbing you — move!');
      if (this.grabTime > GRAB_SECONDS) {
        this.grabTime = 0;
        G.missions.onBusted(G);
      }
    } else {
      this.grabTime = Math.max(0, this.grabTime - dt * 2);
    }
  }
}
