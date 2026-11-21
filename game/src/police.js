// Neon Harbor — the Harbor PD.
//
// The wanted system: crimes add stars (0–5), cruisers and foot
// officers hunt the player while any star is lit, and the heat only
// fades after a full minute genuinely unseen — a cruiser or an officer
// with a clear line of sight resets the clock. Get grabbed on foot and
// it is BUSTED. At three stars or more the department also throws up a
// roadblock across the road ahead of the player.
//
// Cruisers spawn 28–42 m away on a road and chase at up to 24 m/s,
// ramming the player's car when they catch it. Officers spawn closer,
// run the player down on foot, and make the arrest.

import * as THREE from 'three';
import {
  clamp, rand, randInt, pick, dist2D, angleLerp,
  inWorldBounds, collideCircle, segmentBlocked, vec3,
} from './state.js';
import { createCar, damageCar } from './vehicles.js';

const GRID = [-180, -120, -60, 0, 60, 120, 180];
const CRUISER_TOP = 24;
const OFFICER_SPEED = 4.6;
const HEAT_SECONDS = 60;
const BUST_RANGE = 2.5;
const BUST_TIME = 0.8;

function nearestGrid(v) {
  let best = GRID[0];
  for (const g of GRID) if (Math.abs(g - v) < Math.abs(best - v)) best = g;
  return best;
}

// A foot officer: dark uniform, cap, badge dot.
function makeOfficerMesh() {
  const group = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1a2a4a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a878 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.05, 8), navy);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 10), navy);
  cap.position.y = 1.94;
  group.add(cap);
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xffd23c }),
  );
  badge.position.set(0.14, 1.25, 0.38);
  group.add(badge);
  return group;
}

export class Police {
  constructor(game) {
    this.game = game;
    this.bustTimer = 0;
    this.roadblock = null;
  }

  // -- wanted level -------------------------------------------------------

  addWanted(w, stars, message) {
    w.wanted = Math.min(5, (w.wanted || 0) + stars);
    w.heatTimer = 0;
    if (w.audio) w.audio.setSiren(w.wanted > 0);
    if (message && w.hud) w.hud.showMessage(message);
  }

  clearWanted(w) {
    w.wanted = 0;
    w.heatTimer = 0;
    if (w.audio) w.audio.setSiren(false);
    this.clearUnits(w);
  }

  clearUnits(w) {
    this.removeRoadblock(w);
    for (const car of [...w.policeCars]) {
      w.scene.remove(car.mesh);
      const ci = w.cars.indexOf(car);
      if (ci >= 0) w.cars.splice(ci, 1);
    }
    w.policeCars.length = 0;
    for (const officer of [...w.officers]) {
      w.scene.remove(officer.mesh);
    }
    w.officers.length = 0;
    this.bustTimer = 0;
  }

  // -- sight and heat ------------------------------------------------------

  // True when any unit has the player in sight: close enough and no
  // building between them. Being inside a block, behind a wall, is
  // what makes the heat fade.
  spotWitness(w) {
    const px = w.player.pos.x;
    const pz = w.player.pos.z;
    const seenBy = (x, z) => {
      if (dist2D(x, z, px, pz) > 70) return false;
      return !segmentBlocked(w, x, z, px, pz);
    };
    for (const car of w.policeCars) {
      if (seenBy(car.pos.x, car.pos.z)) return true;
    }
    for (const officer of w.officers) {
      if (seenBy(officer.pos.x, officer.pos.z)) return true;
    }
    return false;
  }

  // Heat only falls after a full minute with nobody watching. One
  // sighting resets the clock; one star falls at a time.
  coolDown(w, dt) {
    if (w.wanted <= 0) return;
    if (this.spotWitness(w)) {
      w.heatTimer = 0;
      return;
    }
    w.heatTimer += dt;
    if (w.heatTimer >= HEAT_SECONDS) {
      w.wanted -= 1;
      w.heatTimer = 0;
      if (w.hud) w.hud.showMessage(w.wanted > 0 ? 'The heat is dying down…' : 'You lost the cops.');
      if (w.wanted === 0) {
        if (w.audio) w.audio.setSiren(false);
        this.clearUnits(w);
      }
    }
  }

  // -- spawning -------------------------------------------------------------

  // Snap one coordinate onto the nearest road line on that axis.
  snapAxis(w, x, z, axis) {
    if (axis === 'x') return nearestGrid(x);
    return nearestGrid(z);
  }

  // A road point 28–42 m from the player: pick a random road line and
  // a random spot along it until the distance fits.
  findSpawn(w) {
    const px = w.player.pos.x;
    const pz = w.player.pos.z;
    for (let tries = 0; tries < 24; tries++) {
      const alongRoad = Math.random() < 0.5;
      const line = pick(GRID);
      const along = rand(-180, 180);
      const x = alongRoad ? along : line;
      const z = alongRoad ? line : along;
      const d = Math.hypot(x - px, z - pz);
      if (d >= 28 && d <= 42) return { x, z };
    }
    return { x: clamp(px + 32, -175, 175), z: pz };
  }

  spawnCruiser(w) {
    const spot = this.findSpawn(w);
    const heading = Math.atan2(w.player.pos.x - spot.x, w.player.pos.z - spot.z);
    const car = createCar(w, {
      x: spot.x, z: spot.z, heading,
      color: 0x14161e, name: 'Police Cruiser',
      isPolice: true, parked: false,
    });
    car.speed = 14;
    w.policeCars.push(car);
    return car;
  }

  spawnOfficer(w) {
    const spot = this.findSpawn(w);
    const mesh = makeOfficerMesh();
    mesh.position.set(spot.x, 0, spot.z);
    w.scene.add(mesh);
    const officer = {
      pos: vec3(spot.x, 0, spot.z),
      heading: 0,
      speed: OFFICER_SPEED,
      mesh,
    };
    w.officers.push(officer);
    return officer;
  }

  // Keep the streets staffed: up to three cruisers for the star count,
  // and two officers whenever there is any heat at all.
  staffStreets(w, dt) {
    if (w.wanted <= 0) return;
    const wantCruisers = Math.min(3, w.wanted);
    if (w.policeCars.length < wantCruisers) this.spawnCruiser(w);
    const wantOfficers = 2;
    if (w.officers.length < wantOfficers) this.spawnOfficer(w);
    // Officers run the player down on foot.
    const px = w.player.pos.x;
    const pz = w.player.pos.z;
    for (const officer of w.officers) {
      const d = dist2D(officer.pos.x, officer.pos.z, px, pz);
      if (d < 1.2) continue;
      const want = Math.atan2(px - officer.pos.x, pz - officer.pos.z);
      officer.heading = angleLerp(officer.heading, want, Math.min(1, 5 * dt));
      const nx = officer.pos.x + Math.sin(officer.heading) * OFFICER_SPEED * dt;
      const nz = officer.pos.z + Math.cos(officer.heading) * OFFICER_SPEED * dt;
      if (!collideCircle(w, nx, nz, 0.5).hit) {
        officer.pos.x = nx;
        officer.pos.z = nz;
      } else if (!collideCircle(w, nx, officer.pos.z, 0.5).hit) {
        officer.pos.x = nx;
      } else if (!collideCircle(w, officer.pos.x, nz, 0.5).hit) {
        officer.pos.z = nz;
      }
      officer.mesh.position.copy(officer.pos);
      officer.mesh.rotation.y = officer.heading;
    }
  }

  // -- roadblocks ------------------------------------------------------------

  // Two cruisers parked across the road about 60 m ahead of the
  // player, on the road the player is travelling. Only at 3+ stars.
  placeRoadblock(w) {
    const car = w.player.car;
    const hx = car ? car.heading : w.player.heading;
    const px = car ? car.pos.x : w.player.pos.x;
    const pz = car ? car.pos.z : w.player.pos.z;
    const alongX = Math.abs(Math.sin(hx)) > Math.abs(Math.cos(hx));
    let ax;
    let az;
    if (alongX) {
      ax = clamp(px + Math.sin(hx) * 60, -175, 175);
      az = this.snapAxis(w, px, pz, 'z');
    } else {
      ax = this.snapAxis(w, px, pz, 'x');
      az = clamp(pz + Math.cos(hx) * 60, -175, 175);
    }
    const made = [];
    const spots = alongX
      ? [{ x: ax, z: az - 2.6, h: 0 }, { x: ax, z: az + 2.6, h: Math.PI }]
      : [{ x: ax - 2.6, z: az, h: Math.PI / 2 }, { x: ax + 2.6, z: az, h: -Math.PI / 2 }];
    for (const s of spots) {
      if (collideCircle(w, s.x, s.z, 2).hit) continue;
      const blocker = createCar(w, {
        x: s.x, z: s.z, heading: s.h,
        color: 0x14161e, name: 'Police Cruiser',
        isPolice: true, parked: true, roadblock: true,
      });
      blocker.speed = 0;
      w.policeCars.push(blocker);
      made.push(blocker);
    }
    if (made.length) {
      this.roadblock = { cars: made, x: ax, z: az };
      if (w.hud) w.hud.showMessage('Roadblock ahead — find another way!');
    }
  }

  removeRoadblock(w) {
    if (!this.roadblock) return;
    for (const car of this.roadblock.cars) {
      w.scene.remove(car.mesh);
      const pi = w.policeCars.indexOf(car);
      if (pi >= 0) w.policeCars.splice(pi, 1);
      const ci = w.cars.indexOf(car);
      if (ci >= 0) w.cars.splice(ci, 1);
    }
    this.roadblock = null;
  }

  // -- per-frame --------------------------------------------------------------

  update(w, dt) {
    if (w.wanted > 0) {
      this.staffStreets(w, dt);
      if (w.wanted >= 3 && !this.roadblock) this.placeRoadblock(w);
      if (w.wanted < 3 && this.roadblock) this.removeRoadblock(w);
    } else if (this.roadblock) {
      this.removeRoadblock(w);
    }
    this.coolDown(w, dt);

    // Cruisers chase. Roadblock cars stay parked.
    const target = w.player.car || null;
    const tx = target ? target.pos.x : w.player.pos.x;
    const tz = target ? target.pos.z : w.player.pos.z;
    for (const cruiser of [...w.policeCars]) {
      if (cruiser.roadblock) continue;
      const d = dist2D(cruiser.pos.x, cruiser.pos.z, tx, tz);
      if (d > 260) {
        // Lost the trail entirely — pull it off the street.
        w.scene.remove(cruiser.mesh);
        let i = w.policeCars.indexOf(cruiser);
        if (i >= 0) w.policeCars.splice(i, 1);
        i = w.cars.indexOf(cruiser);
        if (i >= 0) w.cars.splice(i, 1);
        continue;
      }
      const want = Math.atan2(tx - cruiser.pos.x, tz - cruiser.pos.z);
      const diff = Math.abs(((want - cruiser.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      cruiser.heading = angleLerp(cruiser.heading, want, Math.min(1, 2.6 * dt));
      // Ease off for a hard turn, and never run down a player on foot.
      let top = CRUISER_TOP;
      if (diff > 0.6) top = 13;
      if (!target && d < 9) top = 0;
      if (cruiser.speed < top) cruiser.speed = Math.min(top, cruiser.speed + 11 * dt);
      else if (cruiser.speed > top) cruiser.speed = Math.max(top, cruiser.speed - 16 * dt);
      const nx = cruiser.pos.x + Math.sin(cruiser.heading) * cruiser.speed * dt;
      const nz = cruiser.pos.z + Math.cos(cruiser.heading) * cruiser.speed * dt;
      if (!collideCircle(w, nx, nz, 1.7).hit && inWorldBounds(nx, nz)) {
        cruiser.pos.x = nx;
        cruiser.pos.z = nz;
      } else if (!collideCircle(w, nx, cruiser.pos.z, 1.7).hit) {
        cruiser.pos.x = nx;
        cruiser.speed *= 0.6;
      } else if (!collideCircle(w, cruiser.pos.x, nz, 1.7).hit) {
        cruiser.pos.z = nz;
        cruiser.speed *= 0.6;
      } else {
        cruiser.speed *= 0.4;
      }
      cruiser.mesh.position.copy(cruiser.pos);
      cruiser.mesh.rotation.y = cruiser.heading;
      for (const wheel of cruiser.wheels) {
        wheel.rotation.x += (cruiser.speed * dt) / 0.38;
      }
      if (cruiser.ramCooldown > 0) cruiser.ramCooldown -= dt;
      // Ram the player's car when close enough.
      if (target && d < 3.6 && cruiser.ramCooldown <= 0) {
        damageCar(w, target, 3);
        target.speed *= 0.85;
        cruiser.speed *= 0.55;
        cruiser.ramCooldown = 1.5;
        const ox = (target.pos.x - cruiser.pos.x) / (d || 1);
        const oz = (target.pos.z - cruiser.pos.z) / (d || 1);
        if (!collideCircle(w, target.pos.x + ox, target.pos.z + oz, 1.7).hit) {
          target.pos.x += ox * 0.9;
          target.pos.z += oz * 0.9;
        }
        if (w.audio) w.audio.crash();
        if (w.fx) w.fx.shake(0.25);
      }
    }

    // Busted: an officer close to Cole on foot, held for a moment.
    if (w.wanted > 0 && !w.player.car) {
      let near = false;
      for (const officer of w.officers) {
        if (dist2D(officer.pos.x, officer.pos.z, w.player.pos.x, w.player.pos.z) < BUST_RANGE) {
          near = true;
          break;
        }
      }
      if (near) {
        this.bustTimer += dt;
        if (this.bustTimer >= BUST_TIME) {
          this.bustTimer = 0;
          this.doBusted(w);
        }
      } else {
        this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
      }
    } else {
      this.bustTimer = 0;
    }
  }

  doBusted(w) {
    if (w.missions) w.missions.cancelSideJobs(w);
    w.mode = 'busted';
    if (w.audio) w.audio.fail();
    if (w.audio) w.audio.setSiren(false);
    const screen = document.getElementById('busted-screen');
    if (screen) screen.classList.remove('hidden');
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.classList.add('hidden');
    if (w.onBusted) w.onBusted();
  }
}
