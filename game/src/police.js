// Neon Harbor — the wanted system: 0–5 stars, chasing cruisers,
// foot officers who can bust Cole, and roadblocks at 3+ stars.
// Heat only cools after a full minute genuinely unseen.
// Fresh rewrite for the gta6-01 resubmission.
import * as THREE from 'three';
import {
  clamp, rand, randInt, dist2D, angleLerp,
  collideCircle, segmentBlocked, vec3,
} from './state.js';
import { createCar, damageCar } from './vehicles.js';
import { scarePedestrians } from './pedestrians.js';

const CRUISER_SPEED = 24;
const CRUISER_SPAWN_MIN = 28;
const CRUISER_SPAWN_MAX = 42;
const OFFICER_SPEED = 3.6;
const OFFICER_BUST_RANGE = 2.4;
const OFFICER_BUST_SECONDS = 2.5;
const HEAT_COOL_SECONDS = 60;
const SEEN_RANGE = 70;
const WITNESS_RANGE = 20;

export class Police {
  constructor(game) {
    this.game = game;
    this.roadblockTimer = 0;
    this.witnessTimer = 0;
  }

  // ------------------------------------------------------------ heat
  addWanted(w, stars, message) {
    const before = w.wanted;
    w.wanted = clamp(w.wanted + stars, 0, 5);
    w.heatTimer = 0;
    if (w.wanted > before) {
      const label = w.wanted === 1 ? 'star' : 'stars';
      w.hud.showMessage(`Wanted level ${w.wanted} ${label} — Harbor PD is on you.`);
      if (message === 'steal') w.hud.showMessage('Someone saw you take that car!');
      if (message === 'bankvan') w.hud.showMessage('Every unit in the harbor is rolling!');
      // A fresh star means a fresh cruiser on the road, right now.
      if (!w.policeCars.length) this.spawnCruiser(w);
    }
    return w.wanted;
  }

  clearWanted(w) {
    w.wanted = 0;
    w.heatTimer = 0;
  }

  clearUnits(w) {
    for (const u of [...w.policeCars]) this.removeCruiser(w, u);
    for (const o of [...w.officers]) this.removeOfficer(w, o);
    w.policeCars.length = 0;
    w.officers.length = 0;
  }

  // ------------------------------------------------------------ seeing
  spotWitness(w) {
    // A pedestrian close enough with a clear line of sight who sees Cole
    // while he is wanted. Returns the witness, or null.
    for (const p of w.peds) {
      if (p.state === 'flee') continue;
      const d = dist2D(p.pos.x, p.pos.z, w.player.pos.x, w.player.pos.z);
      if (d > WITNESS_RANGE) continue;
      if (segmentBlocked(w, p.pos.x, p.pos.z, w.player.pos.x, w.player.pos.z)) continue;
      return p;
    }
    return null;
  }

  isSeen(w) {
    const px = w.player.pos.x;
    const pz = w.player.pos.z;
    for (const u of w.policeCars) {
      if (u.roadblock) continue;
      const d = dist2D(u.pos.x, u.pos.z, px, pz);
      if (d < SEEN_RANGE && !segmentBlocked(w, u.pos.x, u.pos.z, px, pz)) return true;
    }
    for (const o of w.officers) {
      const d = dist2D(o.pos.x, o.pos.z, px, pz);
      if (d < SEEN_RANGE && !segmentBlocked(w, o.pos.x, o.pos.z, px, pz)) return true;
    }
    return false;
  }

  coolDown(w, dt) {
    if (w.wanted <= 0) { w.heatTimer = 0; return; }
    if (this.isSeen(w)) { w.heatTimer = 0; return; }
    // A witness on the street keeps the heat alive too.
    this.witnessTimer -= dt;
    if (this.witnessTimer <= 0) {
      this.witnessTimer = 2;
      const witness = this.spotWitness(w);
      if (witness) {
        w.heatTimer = 0;
        scarePedestrians(w, w.player.pos.x, w.player.pos.z, 25);
        return;
      }
    }
    w.heatTimer += dt;
    if (w.heatTimer >= HEAT_COOL_SECONDS) {
      w.wanted -= 1;
      w.heatTimer = 0;
      w.hud.showMessage(
        w.wanted > 0
          ? `The heat is dying down… ${w.wanted} ${w.wanted === 1 ? 'star' : 'stars'} left.`
          : 'You lost them. The heat is off.',
      );
    }
  }

  // ------------------------------------------------------------ spawns
  snapAxis(w, x, z, axis) {
    // Snap a point onto the nearest road line on one axis.
    if (axis === 'x') {
      let best = w.roads.xs[0];
      let bd = Infinity;
      for (const gx of w.roads.xs) {
        const d = Math.abs(gx - x);
        if (d < bd) { bd = d; best = gx; }
      }
      return { x: best, z };
    }
    let best = w.roads.zs[0];
    let bd = Infinity;
    for (const gz of w.roads.zs) {
      const d = Math.abs(gz - z);
      if (d < bd) { bd = d; best = gz; }
    }
    return { x, z: best };
  }

  findSpawn(w) {
    const p = w.player.pos;
    const angle = rand(0, Math.PI * 2);
    const radius = CRUISER_SPAWN_MIN + rand(0, CRUISER_SPAWN_MAX - CRUISER_SPAWN_MIN);
    let x = p.x + Math.sin(angle) * radius;
    let z = p.z + Math.cos(angle) * radius;
    x = clamp(x, -225, 225);
    z = clamp(z, -225, 225);
    // Put the spawn on a road: snap the nearer axis, keep the other.
    if (Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle))) {
      return this.snapAxis(w, x, z, 'x');
    }
    return this.snapAxis(w, x, z, 'z');
  }

  spawnCruiser(w, spot) {
    const at = spot || this.findSpawn(w);
    const heading = Math.atan2(
      w.player.pos.x - at.x, w.player.pos.z - at.z,
    );
    const car = createCar(w, {
      x: at.x, z: at.z, heading,
      color: 0x1d2f45, isPolice: true, name: 'Harbor PD',
    });
    car.isPolice = true;
    car.roadblock = false;
    car.parked = false;
    car.cruise = CRUISER_SPEED;
    if (!w.cars.includes(car)) w.cars.push(car);
    w.policeCars.push(car);
    return car;
  }

  removeCruiser(w, car) {
    if (car.mesh && w.scene) w.scene.remove(car.mesh);
    const i = w.policeCars.indexOf(car);
    if (i >= 0) w.policeCars.splice(i, 1);
    const j = w.cars.indexOf(car);
    if (j >= 0) w.cars.splice(j, 1);
  }

  spawnOfficer(w, spot) {
    const at = spot || this.findSpawn(w);
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1c2f4a });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a986 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), navy);
    body.position.y = 1.05;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
    head.position.y = 1.68;
    head.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.38), navy);
    cap.position.y = 1.9;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), navy);
    legL.position.set(-0.14, 0.35, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    group.add(body, head, cap, legL, legR);
    group.position.set(at.x, 0, at.z);
    w.scene.add(group);
    const officer = {
      pos: vec3(at.x, 0, at.z),
      heading: 0,
      speed: OFFICER_SPEED,
      mesh: group,
      legL,
      legR,
      grabTimer: 0,
      walkPhase: rand(0, Math.PI * 2),
    };
    w.officers.push(officer);
    return officer;
  }

  removeOfficer(w, officer) {
    if (officer.mesh && w.scene) w.scene.remove(officer.mesh);
    const i = w.officers.indexOf(officer);
    if (i >= 0) w.officers.splice(i, 1);
  }

  staffStreets(w, dt) {
    // Foot officers only once the heat is real: wanted 2 and up.
    const want = w.wanted >= 2 ? Math.min(w.wanted - 1, 3) : 0;
    while (w.officers.length < want) this.spawnOfficer(w);
    while (w.officers.length > want) {
      this.removeOfficer(w, w.officers[w.officers.length - 1]);
    }
    for (const o of [...w.officers]) {
      const dx = w.player.pos.x - o.pos.x;
      const dz = w.player.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) {
        const wantHeading = Math.atan2(dx, dz);
        o.heading = angleLerp(o.heading, wantHeading, Math.min(1, dt * 6));
      }
      if (d > OFFICER_BUST_RANGE * 0.6) {
        const step = o.speed * dt;
        const nx = o.pos.x + Math.sin(o.heading) * step;
        const nz = o.pos.z + Math.cos(o.heading) * step;
        const hit = collideCircle(w, nx, nz, 0.5);
        o.pos.set(hit.x, 0, hit.z);
        // Decay, don't wipe: a single step of separation — e.g. a
        // collision shove pushing Cole out of a building while the
        // officer closes in — must not erase a nearly finished grab.
        o.grabTimer = Math.max(0, o.grabTimer - dt);
      } else {
        o.grabTimer += dt;
        if (o.grabTimer >= OFFICER_BUST_SECONDS) {
          w.hud.showMessage('Harbor PD grabbed you!');
          if (typeof w.onBusted === 'function') w.onBusted();
          return;
        }
      }
      o.walkPhase += dt * 9;
      const swing = Math.sin(o.walkPhase) * 0.45;
      if (o.legL) o.legL.rotation.x = swing;
      if (o.legR) o.legR.rotation.x = -swing;
      o.mesh.position.set(o.pos.x, 0, o.pos.z);
      o.mesh.rotation.y = o.heading;
    }
  }

  // --------------------------------------------------------- roadblocks
  updateRoadblocks(w, dt) {
    const active = w.policeCars.filter((c) => c.roadblock);
    if (w.wanted < 3) {
      for (const c of [...active]) this.removeCruiser(w, c);
      return;
    }
    this.roadblockTimer -= dt;
    if (active.length >= 2 && this.roadblockTimer > 0) return;
    this.roadblockTimer = 2;
    // Cole's current road: the nearest grid line to his position.
    const p = w.player.pos;
    let onX = null;
    let bd = Infinity;
    for (const gx of w.roads.xs) {
      const d = Math.abs(gx - p.x);
      if (d < bd) { bd = d; onX = gx; }
    }
    let onZ = null;
    bd = Infinity;
    for (const gz of w.roads.zs) {
      const d = Math.abs(gz - p.z);
      if (d < bd) { bd = d; onZ = gz; }
    }
    const alongX = bd !== null && Math.abs(p.x - onX) <= Math.abs(p.z - onZ);
    const ahead = 60;
    let ax;
    let az;
    let heading;
    if (alongX) {
      const dir = Math.abs(Math.sin(w.player.heading)) > 0.5
        ? Math.sign(Math.sin(w.player.heading)) || 1
        : 1;
      ax = onX;
      az = clamp(p.z + dir * ahead, -225, 225);
      heading = Math.PI / 2;
    } else {
      const dir = Math.abs(Math.cos(w.player.heading)) > 0.5
        ? Math.sign(Math.cos(w.player.heading)) || 1
        : 1;
      ax = clamp(p.x + dir * ahead, -225, 225);
      az = onZ;
      heading = 0;
    }
    for (const c of [...active]) this.removeCruiser(w, c);
    for (let i = 0; i < 2; i++) {
      const off = (i === 0 ? -3.2 : 3.2);
      const cx = alongX ? ax + off : ax;
      const cz = alongX ? az : az + off;
      const car = createCar(w, {
        x: cx, z: cz, heading,
        color: 0x1d2f45, isPolice: true, name: 'Harbor PD',
      });
      car.isPolice = true;
      car.roadblock = true;
      car.parked = true;
      car.speed = 0;
      car.cruise = 0;
      if (!w.cars.includes(car)) w.cars.push(car);
      w.policeCars.push(car);
    }
    w.hud.showMessage('Roadblock ahead — Harbor PD has the road sealed.');
  }

  // -------------------------------------------------------------- chase
  updateCruisers(w, dt) {
    const want = Math.min(w.wanted, 3);
    while (w.policeCars.filter((c) => !c.roadblock).length < want) {
      this.spawnCruiser(w);
    }
    for (const c of [...w.policeCars]) {
      if (c.roadblock) continue;
      const dx = w.player.pos.x - c.pos.x;
      const dz = w.player.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const wantHeading = Math.atan2(dx, dz);
      c.heading = angleLerp(c.heading, wantHeading, Math.min(1, dt * 2.2));
      const target = d > 12 ? CRUISER_SPEED : CRUISER_SPEED * 0.75;
      c.speed += clamp(target - c.speed, -30 * dt, 14 * dt);
      const step = c.speed * dt;
      const nx = c.pos.x + Math.sin(c.heading) * step;
      const nz = c.pos.z + Math.cos(c.heading) * step;
      const hit = collideCircle(w, nx, nz, 1.4);
      c.pos.set(hit.x, 0, hit.z);
      if (hit.hit) c.speed *= 0.55;
      if (c.mesh) {
        c.mesh.position.set(c.pos.x, 0, c.pos.z);
        c.mesh.rotation.y = c.heading;
      }
      // A cruiser that catches Cole's car rams it: damage and a shove.
      const ride = w.player.car;
      if (ride) {
        const rd = dist2D(c.pos.x, c.pos.z, ride.pos.x, ride.pos.z);
        if (rd < 4.6) {
          damageCar(w, ride, 6 * dt);
          ride.speed *= (1 - Math.min(0.5, 1.2 * dt));
          if (c.speed > 4) {
            const push = 2.5 * dt;
            const px = ride.pos.x + Math.sin(c.heading) * push;
            const pz = ride.pos.z + Math.cos(c.heading) * push;
            const ph = collideCircle(w, px, pz, 1.4);
            ride.pos.set(ph.x, 0, ph.z);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- tick
  update(w, dt) {
    if (w.wanted <= 0) {
      if (w.policeCars.length || w.officers.length) this.clearUnits(w);
      return;
    }
    this.coolDown(w, dt);
    if (w.wanted <= 0) {
      this.clearUnits(w);
      return;
    }
    this.updateCruisers(w, dt);
    this.staffStreets(w, dt);
    this.updateRoadblocks(w, dt);
  }
}
