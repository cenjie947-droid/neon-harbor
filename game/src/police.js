// Neon Harbor — the wanted system. Stars run 0–5; police cars chase and
// ram, foot officers run Cole down and grab him. Two lessons from
// playtesting drive the numbers here. First, heat has to feel like a
// pursuit rather than a flicker: a star used to die about fourteen seconds
// after Cole slipped out of sight, before any cruiser had even arrived.
// Second, the response has to be visible — units spawn close enough to
// see and hear, on a road, heading in. So a star now only drops after a
// full minute genuinely unseen, and any fresh crime restarts that clock.
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
const SIGHT_RANGE = 60;
const UNSEEN_SECONDS = 60;
const SPAWN_NEAR = 28;
const SPAWN_FAR = 42;
const OFFICER_SPAWN_RANGE = 30;
const GRAB_HOLD_SECONDS = 2.0;
const SIREN_HEARING = 90;
const CHASE_CRUISE = 24;
const RAM_REACH = 4.6;
const RAM_COOLDOWN = 1.0;
const GRAB_REACH = 1.7;
const OFFICER_FOOT_SPEED = 5.6;
const OFFICER_CHASE_SPEED = 6.4;
const SPAWN_TRIES = 12;

// Small helper: a box mesh placed in one call.
function cuboid(width, height, depth, mat, x, y, z) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  piece.position.set(x, y, z);
  return piece;
}

export class Police {
  constructor(game) {
    this.game = game;
    this.grabTime = 0;
    this.spawnWait = 0;
  }

  update(game, dt) {
    this.coolDown(game, dt);
    this.staffStreets(game, dt);
    this.runSiren(game);
    this.runChase(game, dt);
    this.runOfficers(game, dt);
  }

  addWanted(game, stars, message) {
    if (stars <= 0) return;
    const before = game.wanted;
    game.wanted = clamp(game.wanted + stars, 0, 5);
    // Any fresh crime restarts the unseen clock: stealing a second car
    // while the heat is already fading must not let the star drop anyway.
    game.heatTimer = 0;
    game.stats.crimes++;
    if (game.wanted > before) {
      if (message) game.hud.showMessage(message);
      game.hud.showMessage(`Wanted level ${game.wanted} — Harbor PD is on you.`);
    }
  }

  clearWanted(game) {
    game.wanted = 0;
    game.heatTimer = 0;
    this.grabTime = 0;
    this.clearUnits(game);
  }

  clearUnits(game) {
    for (const ride of game.policeCars) {
      game.scene.remove(ride.mesh);
      game.cars = game.cars.filter((c) => c !== ride);
    }
    game.policeCars = [];
    for (const officer of game.officers) game.scene.remove(officer.mesh);
    game.officers = [];
    this.grabTime = 0;
  }

  coolDown(game, dt) {
    if (game.wanted <= 0) return;
    if (this.spotWitness(game)) {
      game.heatTimer = 0;
      return;
    }
    game.heatTimer += dt;
    if (game.heatTimer <= UNSEEN_SECONDS) return;
    game.heatTimer = 0;
    game.wanted = Math.max(0, game.wanted - 1);
    if (game.wanted === 0) {
      this.clearUnits(game);
      game.hud.showMessage('You lost the cops. Heat is off.');
    } else {
      game.hud.showMessage(`Heat dropping — wanted level ${game.wanted}.`);
    }
  }

  // Is any police unit looking straight at Cole right now? Close is not
  // enough — a building between them breaks the sight line, which is what
  // makes hiding behind a block a real way to cool off.
  spotWitness(game) {
    const cole = game.player.pos;
    let nearest = Infinity;
    let nearestPos = null;
    const units = [...game.policeCars, ...game.officers];
    for (const unit of units) {
      const d = dist2D(unit.pos.x, unit.pos.z, cole.x, cole.z);
      if (d < nearest) {
        nearest = d;
        nearestPos = unit.pos;
      }
    }
    if (!nearestPos || nearest > SIGHT_RANGE) return null;
    if (segmentBlocked(game, cole.x, cole.z, nearestPos.x, nearestPos.z)) return null;
    return { dist: nearest, pos: nearestPos };
  }

  // One more cruiser than the star count (capped at four) so a chase looks
  // like a chase, and foot officers from two stars up. Spawns are paced so
  // the street fills over a few seconds instead of all at once.
  staffStreets(game, dt) {
    const wantCars = game.wanted >= 1 ? Math.min(4, game.wanted + 1) : 0;
    const wantOfficers = game.wanted >= 2 ? Math.min(4, game.wanted) : 0;
    this.spawnWait -= dt;
    if (this.spawnWait > 0) return;
    if (game.policeCars.length < wantCars) this.sendCruiser(game);
    else if (game.officers.length < wantOfficers) this.sendOfficer(game);
    this.spawnWait = game.wanted >= 3 ? 0.7 : 1.2;
  }

  // Pick a spawn spot on a road 28–42 m from Cole. The road snap can drag
  // the point in or out, so several angles are tried and the first that
  // really lands in the band wins; the best miss is the fallback.
  findSpawn(game) {
    const cole = game.player.pos;
    let fallback = null;
    let fallbackScore = Infinity;
    let attempt = 0;
    while (attempt < SPAWN_TRIES) {
      attempt++;
      const angle = rand(0, Math.PI * 2);
      const dist = rand(SPAWN_NEAR, SPAWN_FAR);
      let x = clamp(cole.x + Math.cos(angle) * dist, -230, 230);
      let z = clamp(cole.z + Math.sin(angle) * dist, -230, 190);
      x = this.snapAxis(game, x, z, 'x');
      z = this.snapAxis(game, x, z, 'z');
      const d = Math.hypot(x - cole.x, z - cole.z);
      const miss = d < SPAWN_NEAR ? SPAWN_NEAR - d : d > SPAWN_FAR ? d - SPAWN_FAR : 0;
      if (miss === 0) return { x, z };
      if (miss < fallbackScore) {
        fallbackScore = miss;
        fallback = { x, z };
      }
    }
    return fallback || { x: cole.x + SPAWN_NEAR, z: cole.z };
  }

  // Move one axis onto its nearest road centre line, but only when that
  // road is the closer of the two — otherwise the snap drags the point
  // sideways along the street instead of onto it.
  snapAxis(game, x, z, axis) {
    const closestIn = (list, value) => {
      let bestLine = list[0];
      let bestGap = Infinity;
      for (const line of list) {
        const gap = Math.abs(value - line);
        if (gap < bestGap) {
          bestGap = gap;
          bestLine = line;
        }
      }
      return { line: bestLine, gap: bestGap };
    };
    const byX = closestIn(game.roads.xs, x);
    const byZ = closestIn(game.roads.zs, z);
    if (axis === 'x') return byX.gap <= byZ.gap ? byX.line : x;
    return byZ.gap < byX.gap ? byZ.line : z;
  }

  sendCruiser(game) {
    const spot = this.findSpawn(game);
    const ride = createCar(game, {
      x: spot.x,
      z: spot.z,
      heading: 0,
      color: 0xf5f5f5,
      name: 'Harbor PD',
      isPolice: true,
    });
    ride.maxSpeed = 36;
    game.policeCars.push(ride);
    return ride;
  }

  spawnPoliceCar(game) {
    return this.sendCruiser(game);
  }

  sendOfficer(game) {
    const cole = game.player.pos;
    const angle = rand(0, Math.PI * 2);
    const x = clamp(cole.x + Math.cos(angle) * OFFICER_SPAWN_RANGE, -230, 230);
    const z = clamp(cole.z + Math.sin(angle) * OFFICER_SPAWN_RANGE, -230, 190);
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.6 });
    const torso = cuboid(0.6, 0.85, 0.36, navy, 0, 1.05, 0);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    group.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.14, 10), capMat);
    cap.position.y = 1.88;
    group.add(cap);
    const legs = [
      cuboid(0.22, 0.6, 0.24, dark, -0.15, 0.3, 0),
      cuboid(0.22, 0.6, 0.24, dark, 0.15, 0.3, 0),
    ];
    group.add(legs[0], legs[1]);
    group.position.set(x, 0, z);
    game.scene.add(group);
    const officer = {
      mesh: group,
      legL: legs[0],
      legR: legs[1],
      pos: group.position,
      heading: 0,
      phase: 0,
      speed: OFFICER_FOOT_SPEED,
    };
    game.officers.push(officer);
    return officer;
  }

  spawnOfficer(game) {
    return this.sendOfficer(game);
  }

  runSiren(game) {
    const cole = game.player.pos;
    let close = false;
    for (const ride of game.policeCars) {
      if (dist2D(ride.pos.x, ride.pos.z, cole.x, cole.z) < SIREN_HEARING) close = true;
    }
    game.audio.setSiren(close && game.wanted > 0);
  }

  runChase(game, dt) {
    const cole = game.player;
    for (const ride of game.policeCars) {
      const dx = cole.pos.x - ride.pos.x;
      const dz = cole.pos.z - ride.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const wantHeading = Math.atan2(dx / d, dz / d);
      ride.heading = angleLerp(ride.heading, wantHeading, Math.min(1, dt * 1.6));
      const cruise = d > 60 ? ride.maxSpeed : CHASE_CRUISE;
      ride.speed += clamp(cruise - ride.speed, -14 * dt, 12 * dt);
      const nextX = ride.pos.x + Math.sin(ride.heading) * ride.speed * dt;
      const nextZ = ride.pos.z + Math.cos(ride.heading) * ride.speed * dt;
      const moved = collideCircle(game, nextX, nextZ, 2.1);
      if (!moved.hit && inWorldBounds(moved.x, moved.z)) {
        ride.pos.x = moved.x;
        ride.pos.z = moved.z;
      } else {
        ride.speed *= 0.5;
      }
      this.ram(game, ride, d, dt);
      for (const other of game.traffic) {
        if (dist2D(ride.pos.x, ride.pos.z, other.pos.x, other.pos.z) < 5) other.stuck = 0.8;
      }
      ride.mesh.position.copy(ride.pos);
      ride.mesh.rotation.y = ride.heading;
      for (const wheel of ride.wheels) wheel.rotation.x += ride.speed * dt * 2.4;
      this.blinkBar(game, ride);
    }
  }

  // A ram lands at most once a second per car, so a cruiser parked on Cole
  // cannot machine-gun him to death before an officer can arrive and make
  // the arrest.
  ram(game, ride, dist, dt) {
    ride.ramCooldown = Math.max(0, (ride.ramCooldown || 0) - dt);
    if (dist >= RAM_REACH || ride.ramCooldown > 0) return;
    ride.ramCooldown = RAM_COOLDOWN;
    const cole = game.player;
    if (cole.car) {
      cole.car.speed *= 0.7;
      ride.speed *= 0.5;
      damageCar(game, cole.car, 8);
      game.audio.crash();
      game.fx.burst(ride.pos.clone().setY(1), 0xffaa33, 5, 3, 2);
      damagePlayer(game, 3, 'ram');
    } else {
      damagePlayer(game, 8, 'ram');
      ride.speed *= 0.3;
    }
    game.fx.shake(0.3);
  }

  blinkBar(game, ride) {
    const lamps = ride.mesh.userData.policeLights;
    if (!lamps) return;
    const redOn = Math.floor(game.time * 6) % 2 === 0;
    lamps[0].material.color.setHex(redOn ? 0xff2222 : 0x551111);
    lamps[1].material.color.setHex(redOn ? 0x112255 : 0x2266ff);
  }

  // Foot officers run Cole down; one holding on for two seconds on foot
  // makes the arrest. Officers cannot grab a driver — they chase the car
  // instead, waiting for him to step out.
  runOfficers(game, dt) {
    const cole = game.player;
    let grabbing = false;
    for (const officer of game.officers) {
      const dx = cole.pos.x - officer.pos.x;
      const dz = cole.pos.z - officer.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      officer.heading = Math.atan2(dx / d, dz / d);
      const pace = cole.car ? OFFICER_CHASE_SPEED : OFFICER_FOOT_SPEED;
      officer.pos.x += (dx / d) * pace * dt;
      officer.pos.z += (dz / d) * pace * dt;
      officer.phase += dt * pace * 2;
      const swing = Math.sin(officer.phase) * 0.6;
      officer.legL.rotation.x = swing;
      officer.legR.rotation.x = -swing;
      officer.mesh.position.copy(officer.pos);
      officer.mesh.rotation.y = officer.heading;
      if (!cole.car && d < GRAB_REACH) grabbing = true;
    }
    if (grabbing) {
      this.grabTime += dt;
      game.hud.showHint('The officer is grabbing you — move!');
      if (this.grabTime > GRAB_HOLD_SECONDS) {
        this.grabTime = 0;
        game.missions.onBusted(game);
      }
    } else {
      this.grabTime = Math.max(0, this.grabTime - dt * 2);
    }
  }
}
