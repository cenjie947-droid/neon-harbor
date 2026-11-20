// Neon Harbor — the wanted system.
//
// Stars run 0–5; police cars chase and ram, foot officers run Cole down
// and grab him. Two lessons from playtesting drive the numbers here.
// First, heat has to feel like a pursuit rather than a flicker: a star
// used to die about fourteen seconds after Cole slipped out of sight,
// before any cruiser had even arrived. Second, the response has to be
// visible — units spawn close enough to see and hear, on a road,
// heading in. So a star now only drops after a full minute genuinely
// unseen, and any fresh crime restarts that clock.
import * as THREE from 'three';
import {
  rand,
  clamp,
  dist2D,
  angleLerp,
  collideCircle,
  inWorldBounds,
  segmentBlocked,
} from './state.js';
import { createCar, damageCar } from './vehicles.js';
import { damagePlayer } from './player.js';

// How far away a witness counts as seeing Cole, how long he must stay
// unseen before one star drops, and where fresh units appear. The old
// spawn band (45–65 m) put the first police car a long drive away; the
// new band (28–42 m) puts headlights in the mirror.
const WITNESS_RANGE = 60;
const COOLOFF_SECONDS = 60;
const SPAWN_MIN = 28;
const SPAWN_MAX = 42;
const OFFICER_RANGE = 30;
const GRAB_SECONDS = 2.0;
const SIREN_RANGE = 90;
const CHASE_SPEED = 24;
const RAM_RANGE = 4.6;
const RAM_WAIT = 1.0;
const GRAB_RANGE = 1.7;
const OFFICER_WALK = 5.6;
const OFFICER_RUN = 6.4;
const SPAWN_ATTEMPTS = 12;

// Small helper: a box mesh placed in one call.
function boxPiece(width, height, depth, mat, x, y, z) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  piece.position.set(x, y, z);
  return piece;
}

export class Police {
  constructor(game) {
    this.game = game;
    this.holdClock = 0;
    this.spawnClock = 0;
  }

  update(w, dt) {
    this.coolDown(w, dt);
    this.staffStreets(w, dt);
    this.runSiren(w);
    this.runChase(w, dt);
    this.runOfficers(w, dt);
  }

  addWanted(w, stars, message) {
    if (stars <= 0) return;
    const before = w.wanted;
    w.wanted = clamp(w.wanted + stars, 0, 5);
    // Any fresh crime restarts the unseen clock: stealing a second car
    // while the heat is already fading must not let the star drop anyway.
    w.heatTimer = 0;
    w.stats.crimes++;
    if (w.wanted <= before) return;
    if (message) w.hud.showMessage(message);
    w.hud.showMessage(`Wanted level ${w.wanted} — Harbor PD is on you.`);
  }

  clearWanted(w) {
    w.wanted = 0;
    w.heatTimer = 0;
    this.holdClock = 0;
    this.clearUnits(w);
  }

  clearUnits(w) {
    for (let i = 0; i < w.policeCars.length; i++) {
      const cruiser = w.policeCars[i];
      w.scene.remove(cruiser.mesh);
      w.cars = w.cars.filter((c) => c !== cruiser);
    }
    w.policeCars = [];
    for (let i = 0; i < w.officers.length; i++) w.scene.remove(w.officers[i].mesh);
    w.officers = [];
    this.holdClock = 0;
  }

  coolDown(w, dt) {
    if (w.wanted <= 0) return;
    if (this.spotWitness(w)) {
      w.heatTimer = 0;
      return;
    }
    w.heatTimer += dt;
    if (w.heatTimer <= COOLOFF_SECONDS) return;
    w.heatTimer = 0;
    w.wanted = Math.max(0, w.wanted - 1);
    if (w.wanted > 0) {
      w.hud.showMessage(`Heat dropping — wanted level ${w.wanted}.`);
      return;
    }
    this.clearUnits(w);
    w.hud.showMessage('You lost the cops. Heat is off.');
  }

  // Is any police unit looking straight at Cole right now? Close is not
  // enough — a building between them breaks the sight line, which is what
  // makes hiding behind a block a real way to cool off.
  spotWitness(w) {
    const hero = w.player.pos;
    let closest = Infinity;
    let closestPos = null;
    const force = w.policeCars.concat(w.officers);
    for (let i = 0; i < force.length; i++) {
      const unit = force[i];
      const d = dist2D(unit.pos.x, unit.pos.z, hero.x, hero.z);
      if (d >= closest) continue;
      closest = d;
      closestPos = unit.pos;
    }
    if (!closestPos || closest > WITNESS_RANGE) return null;
    if (segmentBlocked(w, hero.x, hero.z, closestPos.x, closestPos.z)) return null;
    return { dist: closest, pos: closestPos };
  }

  // One more cruiser than the star count (capped at four) so a chase looks
  // like a chase, and foot officers from two stars up. Spawns are paced so
  // the street fills over a few seconds instead of all at once.
  staffStreets(w, dt) {
    const carsNeeded = w.wanted >= 1 ? Math.min(4, w.wanted + 1) : 0;
    const copsNeeded = w.wanted >= 2 ? Math.min(4, w.wanted) : 0;
    this.spawnClock -= dt;
    if (this.spawnClock > 0) return;
    if (w.policeCars.length < carsNeeded) this.sendCruiser(w);
    else if (w.officers.length < copsNeeded) this.sendOfficer(w);
    this.spawnClock = w.wanted >= 3 ? 0.7 : 1.2;
  }

  // Pick a spawn spot on a road 28–42 m from Cole. The road snap can drag
  // the point in or out, so several angles are tried and the first that
  // really lands in the band wins; the best miss is the fallback.
  findSpawn(w) {
    const hero = w.player.pos;
    let bestMiss = null;
    let bestScore = Infinity;
    for (let tryNo = 0; tryNo < SPAWN_ATTEMPTS; tryNo++) {
      const bearing = rand(0, Math.PI * 2);
      const range = rand(SPAWN_MIN, SPAWN_MAX);
      let x = clamp(hero.x + Math.cos(bearing) * range, -230, 230);
      let z = clamp(hero.z + Math.sin(bearing) * range, -230, 190);
      x = this.snapAxis(w, x, z, 'x');
      z = this.snapAxis(w, x, z, 'z');
      const d = Math.hypot(x - hero.x, z - hero.z);
      let miss = 0;
      if (d < SPAWN_MIN) miss = SPAWN_MIN - d;
      else if (d > SPAWN_MAX) miss = d - SPAWN_MAX;
      if (miss === 0) return { x, z };
      if (miss < bestScore) {
        bestScore = miss;
        bestMiss = { x, z };
      }
    }
    if (bestMiss) return bestMiss;
    return { x: hero.x + SPAWN_MIN, z: hero.z };
  }

  // Move one axis onto its nearest road centre line, but only when that
  // road is the closer of the two — otherwise the snap drags the point
  // sideways along the street instead of onto it.
  snapAxis(w, x, z, axis) {
    const nearestLine = (list, value) => {
      let line = list[0];
      let gap = Infinity;
      for (let i = 0; i < list.length; i++) {
        const g = Math.abs(value - list[i]);
        if (g < gap) {
          gap = g;
          line = list[i];
        }
      }
      return { line, gap };
    };
    const byX = nearestLine(w.roads.xs, x);
    const byZ = nearestLine(w.roads.zs, z);
    if (axis === 'x') return byX.gap <= byZ.gap ? byX.line : x;
    return byZ.gap < byX.gap ? byZ.line : z;
  }

  sendCruiser(w) {
    const place = this.findSpawn(w);
    const cruiser = createCar(w, {
      x: place.x,
      z: place.z,
      heading: 0,
      color: 0xf5f5f5,
      name: 'Harbor PD',
      isPolice: true,
    });
    cruiser.maxSpeed = 36;
    w.policeCars.push(cruiser);
    return cruiser;
  }

  spawnPoliceCar(w) {
    return this.sendCruiser(w);
  }

  sendOfficer(w) {
    const hero = w.player.pos;
    const bearing = rand(0, Math.PI * 2);
    const x = clamp(hero.x + Math.cos(bearing) * OFFICER_RANGE, -230, 230);
    const z = clamp(hero.z + Math.sin(bearing) * OFFICER_RANGE, -230, 190);
    const node = new THREE.Group();
    const uniform = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 });
    const flesh = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.6 });
    const chest = boxPiece(0.6, 0.85, 0.36, uniform, 0, 1.05, 0);
    chest.castShadow = true;
    node.add(chest);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), flesh);
    skull.position.y = 1.7;
    node.add(skull);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.14, 10), hatMat);
    hat.position.y = 1.88;
    node.add(hat);
    const limbs = [
      boxPiece(0.22, 0.6, 0.24, trousers, -0.15, 0.3, 0),
      boxPiece(0.22, 0.6, 0.24, trousers, 0.15, 0.3, 0),
    ];
    node.add(limbs[0], limbs[1]);
    node.position.set(x, 0, z);
    w.scene.add(node);
    const cop = {
      mesh: node,
      legL: limbs[0],
      legR: limbs[1],
      pos: node.position,
      heading: 0,
      phase: 0,
      speed: OFFICER_WALK,
    };
    w.officers.push(cop);
    return cop;
  }

  spawnOfficer(w) {
    return this.sendOfficer(w);
  }

  runSiren(w) {
    const hero = w.player.pos;
    let close = false;
    for (let i = 0; i < w.policeCars.length; i++) {
      const cruiser = w.policeCars[i];
      if (dist2D(cruiser.pos.x, cruiser.pos.z, hero.x, hero.z) < SIREN_RANGE) close = true;
    }
    w.audio.setSiren(close && w.wanted > 0);
  }

  runChase(w, dt) {
    const hero = w.player;
    for (let i = 0; i < w.policeCars.length; i++) {
      const cruiser = w.policeCars[i];
      const dx = hero.pos.x - cruiser.pos.x;
      const dz = hero.pos.z - cruiser.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const targetHeading = Math.atan2(dx / d, dz / d);
      cruiser.heading = angleLerp(cruiser.heading, targetHeading, Math.min(1, dt * 1.6));
      const pace = d > 60 ? cruiser.maxSpeed : CHASE_SPEED;
      cruiser.speed += clamp(pace - cruiser.speed, -14 * dt, 12 * dt);
      const nx = cruiser.pos.x + Math.sin(cruiser.heading) * cruiser.speed * dt;
      const nz = cruiser.pos.z + Math.cos(cruiser.heading) * cruiser.speed * dt;
      const shift = collideCircle(w, nx, nz, 2.1);
      if (!shift.hit && inWorldBounds(shift.x, shift.z)) {
        cruiser.pos.x = shift.x;
        cruiser.pos.z = shift.z;
      } else {
        cruiser.speed *= 0.5;
      }
      this.ram(w, cruiser, d, dt);
      for (let k = 0; k < w.traffic.length; k++) {
        const car = w.traffic[k];
        if (dist2D(cruiser.pos.x, cruiser.pos.z, car.pos.x, car.pos.z) < 5) car.stuck = 0.8;
      }
      cruiser.mesh.position.copy(cruiser.pos);
      cruiser.mesh.rotation.y = cruiser.heading;
      for (let k = 0; k < cruiser.wheels.length; k++) cruiser.wheels[k].rotation.x += cruiser.speed * dt * 2.4;
      this.blinkBar(w, cruiser);
    }
  }

  // A ram lands at most once a second per car, so a cruiser parked on Cole
  // cannot machine-gun him to death before an officer can arrive and make
  // the arrest.
  ram(w, cruiser, dist, dt) {
    cruiser.ramCooldown = Math.max(0, (cruiser.ramCooldown || 0) - dt);
    if (dist >= RAM_RANGE || cruiser.ramCooldown > 0) return;
    cruiser.ramCooldown = RAM_WAIT;
    const hero = w.player;
    if (hero.car) {
      hero.car.speed *= 0.7;
      cruiser.speed *= 0.5;
      damageCar(w, hero.car, 8);
      w.audio.crash();
      w.fx.burst(cruiser.pos.clone().setY(1), 0xffaa33, 5, 3, 2);
      damagePlayer(w, 3, 'ram');
    } else {
      damagePlayer(w, 8, 'ram');
      cruiser.speed *= 0.3;
    }
    w.fx.shake(0.3);
  }

  blinkBar(w, cruiser) {
    const lights = cruiser.mesh.userData.policeLights;
    if (!lights) return;
    const redLit = Math.floor(w.time * 6) % 2 === 0;
    lights[0].material.color.setHex(redLit ? 0xff2222 : 0x551111);
    lights[1].material.color.setHex(redLit ? 0x112255 : 0x2266ff);
  }

  // Foot officers run Cole down; one holding on for two seconds on foot
  // makes the arrest. Officers cannot grab a driver — they chase the car
  // instead, waiting for him to step out.
  runOfficers(w, dt) {
    const hero = w.player;
    let held = false;
    for (let i = 0; i < w.officers.length; i++) {
      const cop = w.officers[i];
      const dx = hero.pos.x - cop.pos.x;
      const dz = hero.pos.z - cop.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      cop.heading = Math.atan2(dx / d, dz / d);
      const speed = hero.car ? OFFICER_RUN : OFFICER_WALK;
      cop.pos.x += (dx / d) * speed * dt;
      cop.pos.z += (dz / d) * speed * dt;
      cop.phase += dt * speed * 2;
      const sway = Math.sin(cop.phase) * 0.6;
      cop.legL.rotation.x = sway;
      cop.legR.rotation.x = -sway;
      cop.mesh.position.copy(cop.pos);
      cop.mesh.rotation.y = cop.heading;
      if (!hero.car && d < GRAB_RANGE) held = true;
    }
    if (!held) {
      this.holdClock = Math.max(0, this.holdClock - dt * 2);
      return;
    }
    this.holdClock += dt;
    w.hud.showHint('The officer is grabbing you — move!');
    if (this.holdClock <= GRAB_SECONDS) return;
    this.holdClock = 0;
    w.missions.onBusted(w);
  }
}
