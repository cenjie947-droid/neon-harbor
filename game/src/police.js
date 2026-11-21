// Neon Harbor — police.js
//
// The 0–5 star wanted system. Cruisers spawn 28–42 m away on the roads
// and chase Cole; foot officers run him down on foot and grab him.
// Heat only fades when nobody can see him for a full minute.
//
// Two rules that cost a round each, built in from the start:
//   - An officer's grab timer DECAYS on separation (Math.max(0, t - dt)),
//     never hard-resets to 0: one collision shove separating them for a
//     single step used to wipe a nearly-complete grab forever, so the
//     busted flow could never trigger.
//   - Cruisers that lose sight of Cole fall back to patrolling the roads
//     instead of homing in on him forever, or hiding would never work.
import * as THREE from 'three';
import {
  clamp, rand, randInt, dist2D, angleLerp,
  collideCircle, segmentBlocked,
} from './state.js';
import { createCar, damageCar } from './vehicles.js';

const MAX_STARS = 5;
const HEAT_FADE_SECONDS = 60;   // unseen this long, lose one star
const SPAWN_MIN = 28;           // cruisers spawn this far away, at least
const SPAWN_MAX = 42;
const CRUISER_SPEED = 24;       // m/s flat out, same pace as a fast getaway
const PATROL_SPEED = 9;
const SIGHT_RANGE = 80;         // a unit this far away can still spot Cole
const GRAB_RANGE = 1.8;         // an officer this close starts grabbing
const GRAB_SECONDS = 2.5;       // held this long on foot and Cole is busted
const ROADBLOCK_STARS = 3;      // roadblocks appear at this wanted level
const ROADBLOCK_AHEAD = 60;     // metres ahead of Cole, on his road

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Police {
  constructor(game) {
    this.g = game;
    this._lastSeen = -1e9;   // game time a unit last had eyes on Cole
    this._spawnTimer = 0;    // throttle between cruiser spawns
    this._officerTimer = 0;  // throttle between officer spawns
    this._rbTimer = 0;       // throttle between roadblock moves
    this._roadblocks = [];   // parked cruisers blocking the road ahead
  }

  // -- HUD helpers ---------------------------------------------------------
  say(w, msg) {
    try { w.hud.showMessage(msg); } catch (err) { /* hud optional */ }
  }

  renderStars(w) {
    try { w.hud.renderStars(w.wanted); } catch (err) { /* hud optional */ }
  }

  // -- Wanted level --------------------------------------------------------
  addWanted(w, stars, reason) {
    w.wanted = Math.min(MAX_STARS, (w.wanted || 0) + stars);
    this._lastSeen = w.time;
    if (reason === 'steal') this.say(w, 'Car theft reported — the Harbor PD is on you.');
    this.renderStars(w);
  }

  clearWanted(w) {
    w.wanted = 0;
    this._lastSeen = -1e9;
    this.clearUnits(w);
    this.renderStars(w);
  }

  clearUnits(w) {
    for (const u of w.policeCars || []) this.removeCar(w, u);
    w.policeCars = [];
    for (const o of w.officers || []) {
      try { if (o.mesh) w.scene.remove(o.mesh); } catch (err) { /* scene */ }
    }
    w.officers = [];
    this.clearRoadblocks(w);
  }

  removeCar(w, car) {
    try { if (car.mesh) w.scene.remove(car.mesh); } catch (err) { /* scene */ }
    const at = w.cars.indexOf(car);
    if (at !== -1) w.cars.splice(at, 1);
  }

  // -- Spawning ------------------------------------------------------------
  // A point on a road, 28–42 m from Cole: close enough to be a threat,
  // far enough that the player gets a head start.
  findSpawn(w) {
    const p = w.player.pos;
    for (let tries = 0; tries < 12; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const d = rand(SPAWN_MIN, SPAWN_MAX);
      const x = p.x + Math.sin(angle) * d;
      const z = p.z + Math.cos(angle) * d;
      if (Math.abs(x) > 225 || Math.abs(z) > 225) continue;
      const snapped = this.snapToRoad(w, x, z);
      if (dist2D(snapped.x, snapped.z, p.x, p.z) < 24) continue;
      return snapped;
    }
    return { x: p.x + 30, z: p.z };
  }

  // Nearest road line to a point: north-south roads hold x, east-west hold z.
  snapToRoad(w, x, z) {
    let bx = w.roads.xs[0];
    let bd = Infinity;
    for (const rx of w.roads.xs) {
      const d = Math.abs(rx - x);
      if (d < bd) { bd = d; bx = rx; }
    }
    let bz = w.roads.zs[0];
    let bd2 = Infinity;
    for (const rz of w.roads.zs) {
      const d = Math.abs(rz - z);
      if (d < bd2) { bd2 = d; bz = rz; }
    }
    return bd <= bd2 ? { x: bx, z } : { x, z: bz };
  }

  // Snap a point onto the nearest road running along the given axis:
  // 'x' means the road runs along X (constant z), 'z' along Z (constant x).
  snapAxis(w, x, z, axis) {
    if (axis === 'x') {
      let bz = w.roads.zs[0];
      let bd = Infinity;
      for (const rz of w.roads.zs) {
        const d = Math.abs(rz - z);
        if (d < bd) { bd = d; bz = rz; }
      }
      return { x, z: bz };
    }
    let bx = w.roads.xs[0];
    let bd = Infinity;
    for (const rx of w.roads.xs) {
      const d = Math.abs(rx - x);
      if (d < bd) { bd = d; bx = rx; }
    }
    return { x: bx, z };
  }

  spawnCruiser(w) {
    const at = this.findSpawn(w);
    const p = w.player.pos;
    const car = createCar(w, {
      x: at.x, z: at.z,
      heading: Math.atan2(p.x - at.x, p.z - at.z),
      color: 0x222831, name: 'Police Cruiser', isPolice: true, parked: false,
    });
    car.isPolice = true;
    car.name = 'Police Cruiser';
    car.cruise = CRUISER_SPEED;
    car.traffic = false;
    car.parked = false;
    car.ramCooldown = 0;
    car.patrolTimer = 0;
    car.patrolTarget = null;
    car.lastKnown = { x: p.x, z: p.z };
    if (!w.cars.includes(car)) w.cars.push(car);
    w.policeCars.push(car);
    return car;
  }

  makeOfficerMesh() {
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1c2f57 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x101c33 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a066 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.0, 0.32), navy);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
    head.position.y = 1.65;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), dark);
    cap.position.y = 1.85;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), dark);
    legL.position.set(-0.14, 0.3, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), dark);
    legR.position.set(0.14, 0.3, 0);
    group.add(body, head, cap, legL, legR);
    return { group, legL, legR };
  }

  spawnOfficer(w) {
    const p = w.player.pos;
    const angle = Math.random() * Math.PI * 2;
    const d = rand(15, 25);
    let x = p.x + Math.sin(angle) * d;
    let z = p.z + Math.cos(angle) * d;
    x = clamp(x, -225, 225);
    z = clamp(z, -225, 225);
    const res = collideCircle(w, x, z, 0.6);
    if (res.hit) { x = res.x; z = res.z; }
    const { group, legL, legR } = this.makeOfficerMesh();
    group.position.set(x, 0, z);
    w.scene.add(group);
    const officer = {
      pos: new THREE.Vector3(x, 0, z),
      heading: Math.atan2(p.x - x, p.z - z),
      grabTimer: 0,
      walkPhase: 0,
      mesh: group,
      legL,
      legR,
    };
    w.officers.push(officer);
    return officer;
  }

  // -- Staffing ------------------------------------------------------------
  staffStreets(w, dt) {
    if (w.wanted <= 0) return;
    this._spawnTimer -= dt;
    this._officerTimer -= dt;
    const wantCruisers = Math.min(w.wanted, 3);
    if (w.policeCars.length < wantCruisers && this._spawnTimer <= 0) {
      this._spawnTimer = 1.5;
      this.spawnCruiser(w);
    }
    const wantOfficers = w.wanted >= 2 ? Math.min(w.wanted - 1, 2) : 0;
    if (w.officers.length < wantOfficers && this._officerTimer <= 0) {
      this._officerTimer = 2;
      this.spawnOfficer(w);
    }
  }

  trimUnits(w) {
    const wantCruisers = Math.min(Math.max(w.wanted, 0), 3);
    while (w.policeCars.length > wantCruisers) {
      const p = w.player.pos;
      let far = 0;
      let farD = -1;
      for (let i = 0; i < w.policeCars.length; i++) {
        const u = w.policeCars[i];
        const d = dist2D(u.pos.x, u.pos.z, p.x, p.z);
        if (d > farD) { farD = d; far = i; }
      }
      this.removeCar(w, w.policeCars[far]);
      w.policeCars.splice(far, 1);
    }
    const wantOfficers = w.wanted >= 2 ? Math.min(w.wanted - 1, 2) : 0;
    while (w.officers.length > wantOfficers) {
      const o = w.officers.pop();
      try { if (o.mesh) w.scene.remove(o.mesh); } catch (err) { /* scene */ }
    }
  }

  // -- Line of sight: any unit with a clear view refreshes the heat clock.
  spotWitness(w) {
    const p = w.player.pos;
    const seenBy = (x, z) => {
      if (dist2D(x, z, p.x, p.z) > SIGHT_RANGE) return false;
      return !segmentBlocked(w, x, z, p.x, p.z);
    };
    for (const u of w.policeCars) {
      if (seenBy(u.pos.x, u.pos.z)) { this._lastSeen = w.time; return; }
    }
    for (const o of w.officers) {
      if (seenBy(o.pos.x, o.pos.z)) { this._lastSeen = w.time; return; }
    }
    for (const b of this._roadblocks) {
      if (seenBy(b.pos.x, b.pos.z)) { this._lastSeen = w.time; return; }
    }
  }

  // One star fades after a full minute genuinely unseen.
  coolDown(w, dt) {
    if (w.wanted <= 0) return;
    if (w.time - this._lastSeen < HEAT_FADE_SECONDS) return;
    w.wanted -= 1;
    this._lastSeen = w.time;
    this.renderStars(w);
    if (w.wanted <= 0) {
      this.clearWanted(w);
      return;
    }
    this.say(w, 'The heat is dying down… lay low.');
    this.trimUnits(w);
  }

  // -- Cruisers ------------------------------------------------------------
  patrolPoint(w, u) {
    const p = w.player.pos;
    const angle = Math.random() * Math.PI * 2;
    const d = rand(20, 50);
    const x = clamp(p.x + Math.sin(angle) * d, -220, 220);
    const z = clamp(p.z + Math.cos(angle) * d, -220, 220);
    return this.snapToRoad(w, x, z);
  }

  updateCruiser(w, u, dt) {
    const p = w.player.pos;
    const d = dist2D(u.pos.x, u.pos.z, p.x, p.z);
    if (d < SIGHT_RANGE && !segmentBlocked(w, u.pos.x, u.pos.z, p.x, p.z)) {
      u.lastKnown = { x: p.x, z: p.z };
      this._lastSeen = w.time;
    }
    let tx;
    let tz;
    let targetSpeed;
    if (w.time - this._lastSeen < 8) {
      // Fresh trail: chase the last place Cole was seen.
      tx = u.lastKnown.x;
      tz = u.lastKnown.z;
      targetSpeed = CRUISER_SPEED;
    } else {
      // Cold trail: patrol the roads instead of homing in forever.
      u.patrolTimer -= dt;
      if (!u.patrolTarget || u.patrolTimer <= 0) {
        u.patrolTarget = this.patrolPoint(w, u);
        u.patrolTimer = 6;
      }
      tx = u.patrolTarget.x;
      tz = u.patrolTarget.z;
      targetSpeed = PATROL_SPEED;
    }
    const want = Math.atan2(tx - u.pos.x, tz - u.pos.z);
    u.heading = angleLerp(u.heading, want, Math.min(1, dt * 2.2));
    const turn = Math.abs(wrapAngle(want - u.heading));
    const speedTarget = turn > 0.7 ? targetSpeed * 0.4 : targetSpeed;
    u.speed += (speedTarget - u.speed) * Math.min(1, dt * 1.5);
    // Never run Cole over while he is on foot: slow to a crawl up close.
    if (!w.player.car && d < 5) u.speed = Math.min(u.speed, 2);
    const nx = u.pos.x + Math.sin(u.heading) * u.speed * dt;
    const nz = u.pos.z + Math.cos(u.heading) * u.speed * dt;
    const res = collideCircle(w, nx, nz, 2.2);
    if (res.hit) {
      u.pos.x = res.x;
      u.pos.z = res.z;
      u.heading += 0.9 * dt * 4;
      u.speed *= 0.6;
    } else {
      u.pos.x = nx;
      u.pos.z = nz;
    }
    // Ram the player's car: a shunt, not an execution.
    if (w.player.car) {
      u.ramCooldown = Math.max(0, (u.ramCooldown || 0) - dt);
      const cd = dist2D(u.pos.x, u.pos.z, w.player.car.pos.x, w.player.car.pos.z);
      if (cd < 5 && u.ramCooldown <= 0) {
        try { damageCar(w, w.player.car, 4); } catch (err) { /* vehicles */ }
        u.ramCooldown = 1;
        try { w.fx.shake(0.12); } catch (err) { /* effects */ }
      }
    }
    if (u.mesh) {
      u.mesh.position.set(u.pos.x, 0, u.pos.z);
      u.mesh.rotation.y = u.heading;
    }
  }

  // -- Foot officers -------------------------------------------------------
  moveToward(w, o, x, z, speed, dt) {
    const want = Math.atan2(x - o.pos.x, z - o.pos.z);
    o.heading = angleLerp(o.heading, want, Math.min(1, dt * 4));
    const nx = o.pos.x + Math.sin(o.heading) * speed * dt;
    const nz = o.pos.z + Math.cos(o.heading) * speed * dt;
    const res = collideCircle(w, nx, nz, 0.6);
    o.pos.x = res.x;
    o.pos.z = res.z;
    o.walkPhase += dt * 9;
    const swing = Math.sin(o.walkPhase) * 0.5;
    if (o.legL) o.legL.rotation.x = swing;
    if (o.legR) o.legR.rotation.x = -swing;
  }

  updateOfficer(w, o, dt) {
    const p = w.player.pos;
    const d = dist2D(o.pos.x, o.pos.z, p.x, p.z);
    if (d < SIGHT_RANGE && !segmentBlocked(w, o.pos.x, o.pos.z, p.x, p.z)) {
      this._lastSeen = w.time;
    }
    if (w.player.car) {
      // Cannot grab a driver: close in and wait by the door.
      if (d > 3) this.moveToward(w, o, p.x, p.z, 5.5, dt);
      o.grabTimer = Math.max(0, o.grabTimer - dt);
    } else if (d < GRAB_RANGE) {
      o.grabTimer += dt;
      if (o.grabTimer >= GRAB_SECONDS) {
        if (typeof w.onBusted === 'function') w.onBusted();
        return;
      }
    } else {
      // Separated for a step: the grab DECAYS, it is never wiped.
      // A collision shove used to hard-reset this to 0 and the busted
      // flow could never complete.
      o.grabTimer = Math.max(0, o.grabTimer - dt);
      this.moveToward(w, o, p.x, p.z, 5.8, dt);
    }
    if (o.mesh) {
      o.mesh.position.set(o.pos.x, 0, o.pos.z);
      o.mesh.rotation.y = o.heading;
    }
  }

  // -- Roadblocks: at 3+ stars, two cruisers park across the road ahead ---
  clearRoadblocks(w) {
    for (const b of this._roadblocks) this.removeCar(w, b);
    this._roadblocks = [];
  }

  roadblockSpots(w) {
    const p = w.player.pos;
    const heading = w.player.car ? w.player.car.heading : (w.player.heading || 0);
    let bx = w.roads.xs[0];
    let bd = Infinity;
    for (const rx of w.roads.xs) {
      const d = Math.abs(rx - p.x);
      if (d < bd) { bd = d; bx = rx; }
    }
    let bz = w.roads.zs[0];
    let bd2 = Infinity;
    for (const rz of w.roads.zs) {
      const d = Math.abs(rz - p.z);
      if (d < bd2) { bd2 = d; bz = rz; }
    }
    if (bd > 7 && bd2 > 7) return null; // Cole is not on a road
    if (bd <= bd2) {
      // North-south road at x = bx; block it ahead along z.
      const sign = Math.cos(heading) >= 0 ? 1 : -1;
      const az = clamp(p.z + sign * ROADBLOCK_AHEAD, -220, 220);
      return [
        { x: bx - 3.2, z: az, heading: Math.PI / 2 },
        { x: bx + 3.2, z: az, heading: Math.PI / 2 },
      ];
    }
    // East-west road at z = bz; block it ahead along x.
    const sign = Math.sin(heading) >= 0 ? 1 : -1;
    const ax = clamp(p.x + sign * ROADBLOCK_AHEAD, -220, 220);
    return [
      { x: ax, z: bz - 3.2, heading: 0 },
      { x: ax, z: bz + 3.2, heading: 0 },
    ];
  }

  updateRoadblocks(w, dt) {
    if (w.wanted < ROADBLOCK_STARS) {
      this.clearRoadblocks(w);
      return;
    }
    this._rbTimer -= dt;
    if (this._roadblocks.length >= 2 && this._rbTimer > 0) return;
    this._rbTimer = 2;
    const spots = this.roadblockSpots(w);
    if (!spots) return;
    if (this._roadblocks.length === 0) {
      for (const s of spots) {
        const car = createCar(w, {
          x: s.x, z: s.z, heading: s.heading,
          color: 0x222831, name: 'Police Cruiser', isPolice: true, parked: true,
        });
        car.isPolice = true;
        car.name = 'Police Cruiser';
        car.speed = 0;
        car.cruise = 0;
        car.parked = true;
        if (!w.cars.includes(car)) w.cars.push(car);
        this._roadblocks.push(car);
      }
      return;
    }
    // Reposition the existing pair ahead of Cole as he moves.
    for (let i = 0; i < this._roadblocks.length && i < spots.length; i++) {
      const car = this._roadblocks[i];
      const s = spots[i];
      car.pos.set(s.x, 0, s.z);
      car.heading = s.heading;
      if (car.mesh) {
        car.mesh.position.set(s.x, 0, s.z);
        car.mesh.rotation.y = s.heading;
      }
    }
  }

  // -- Per-frame -----------------------------------------------------------
  update(w, dt) {
    if (w.wanted <= 0) {
      if ((w.policeCars && w.policeCars.length)
        || (w.officers && w.officers.length)
        || this._roadblocks.length) {
        this.clearUnits(w);
      }
      return;
    }
    this.spotWitness(w);
    this.staffStreets(w, dt);
    for (const u of [...w.policeCars]) this.updateCruiser(w, u, dt);
    for (const o of [...w.officers]) {
      this.updateOfficer(w, o, dt);
      if (w.mode !== 'playing') return; // busted mid-tick: stop here
    }
    this.updateRoadblocks(w, dt);
    this.coolDown(w, dt);
  }
}
