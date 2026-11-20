// Neon Harbor — saving and continuing.
//
// The save is one JSON blob in localStorage: the wallet, the job and
// the beat inside it, Cole's spot and condition, and the car he was
// driving (model, colour, spot, heading, health). Continuing puts all
// of that back — including rebuilding the car in a fresh world, since
// a reload deals a new set of parked cars. If the saved car genuinely
// cannot be placed (its spot and every spot near it are blocked), the
// job restarts from its first beat and the note says why; anything else
// restores exactly where Cole left off.

import { collideCircle } from './state.js';
import { createCar } from './vehicles.js';

const SAVE_KEY = 'neon-harbor-save-v1';

// Rings of fallback spots around a saved position, tried in order
// when the exact spot is blocked. A car is about four metres long,
// so the rings step out in fives.
function ringOffsets() {
  const rings = [];
  const steps = [3, 6, 9];
  for (let s = 0; s < steps.length; s++) {
    const d = steps[s];
    rings.push([d, 0]);
    rings.push([d, d]);
    rings.push([0, d]);
    rings.push([-d, d]);
    rings.push([-d, 0]);
    rings.push([-d, -d]);
    rings.push([0, -d]);
    rings.push([d, -d]);
  }
  return rings;
}

const FALLBACK_RINGS = ringOffsets();

export class SaveData {
  packPlayer(cole) {
    if (!cole) return null;
    const p = {};
    p.x = cole.pos.x;
    p.z = cole.pos.z;
    p.heading = cole.heading;
    p.health = cole.health;
    p.ammo = cole.ammo;
    p.weapon = cole.weapon;
    return p;
  }

  packCar(ride) {
    if (!ride) return null;
    const c = {};
    c.name = ride.name;
    c.color = ride.color;
    c.x = ride.pos.x;
    c.z = ride.pos.z;
    c.heading = ride.heading;
    c.health = ride.health;
    c.special = ride.special || null;
    c.isVan = !!ride.isVan;
    return c;
  }

  save(game) {
    try {
      const cole = game.player;
      const ride = cole ? cole.car : null;
      const data = {};
      data.v = 1;
      data.cash = game.cash;
      data.missionIndex = game.missionIndex;
      data.missionStep = game.missionStep;
      data.wanted = game.wanted;
      data.player = this.packPlayer(cole);
      data.car = this.packCar(ride);
      data.at = Date.now();
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data) return null;
      if (typeof data !== 'object') return null;
      if (data.v !== 1) return null;
      if (typeof data.cash !== 'number') return null;
      if (typeof data.missionIndex !== 'number') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  restorePlayer(game, saved) {
    const cole = game.player;
    if (!saved || !cole) return;
    cole.pos.set(saved.x || 0, 0, saved.z || 0);
    cole.heading = saved.heading || 0;
    if (saved.health !== undefined && saved.health !== null) cole.health = saved.health;
    else cole.health = cole.maxHealth;
    if (saved.ammo !== undefined && saved.ammo !== null) cole.ammo = saved.ammo;
    if (saved.weapon) cole.weapon = saved.weapon;
    cole.mesh.position.copy(cole.pos);
    cole.mesh.rotation.y = cole.heading;
  }

  // Rebuild the saved car in the fresh world and seat Cole in it.
  // Returns false when the car cannot be placed anywhere.
  restoreCar(game, saved) {
    const cole = game.player;
    const spot = this.findCarSpot(game, saved.x, saved.z);
    if (!spot) return false;
    const ride = createCar(game, {
      x: spot.x,
      z: spot.z,
      heading: saved.heading || 0,
      color: saved.color,
      name: saved.name,
      isVan: !!saved.isVan,
      parked: true,
    });
    if (saved.health !== undefined && saved.health !== null) ride.health = saved.health;
    else ride.health = ride.maxHealth;
    if (saved.special) ride.special = saved.special;
    else ride.special = undefined;
    if (ride.special === 'comet') game.cometGT = ride;
    if (ride.special === 'bankvan') game.bankVan = ride;
    ride.parked = false;
    cole.car = ride;
    cole.pos.copy(ride.pos);
    cole.pos.y = 0;
    cole.heading = ride.heading;
    return true;
  }

  // Put a saved run back. Returns where the story resumes: the job,
  // the beat, and a note when something could not be restored.
  apply(game, data) {
    const cole = game.player;
    game.cash = data.cash || 0;
    game.wanted = data.wanted || 0;
    const index = data.missionIndex | 0;
    let step = data.missionStep | 0;
    let note = '';
    this.restorePlayer(game, data.player);
    if (data.car && cole) {
      const ok = this.restoreCar(game, data.car);
      if (!ok) {
        // The car is gone for good: restart its job from the first
        // beat and say so, instead of stranding Cole on foot mid-job.
        step = 0;
        note = 'Your car could not be recovered, so the job restarts from the beginning.';
      }
    }
    return { index, step, note };
  }

  // The saved spot if it is clear, else the nearest clear ring
  // position. Null only when every ring is blocked too.
  findCarSpot(game, x, z) {
    const probe = collideCircle(game, x, z, 2.1);
    if (!probe.hit) return { x, z };
    let i = 0;
    while (i < FALLBACK_RINGS.length) {
      const off = FALLBACK_RINGS[i];
      const nx = x + off[0];
      const nz = z + off[1];
      if (!collideCircle(game, nx, nz, 2.1).hit) {
        return { x: nx, z: nz };
      }
      i++;
    }
    return null;
  }
}
