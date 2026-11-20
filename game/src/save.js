// Neon Harbor — saving and continuing.
//
// The save is one JSON blob in localStorage: the wallet, the job and the
// beat inside it, Cole's spot and condition, and the car he was driving
// (model, colour, spot, heading, health). Continuing puts all of that
// back — including rebuilding the car in a fresh world, since a reload
// deals a new set of parked cars. If the saved car genuinely cannot be
// placed (its spot and every spot near it are blocked), the job restarts
// from its first beat and the note says why; anything else restores
// exactly where Cole left off.

import { collideCircle } from './state.js';
import { createCar } from './vehicles.js';

const SAVE_KEY = 'neon-harbor-save-v1';

// Rings of fallback spots around a saved position, tried in order when
// the exact spot is blocked. A car is about four metres long, so the
// rings step out in fives.
const FALLBACK_RINGS = [
  [3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0], [-3, -3], [0, -3], [3, -3],
  [6, 0], [6, 6], [0, 6], [-6, 6], [-6, 0], [-6, -6], [0, -6], [6, -6],
  [9, 0], [9, 9], [0, 9], [-9, 9], [-9, 0], [-9, -9], [0, -9], [9, -9],
];

export class SaveData {
  save(game) {
    try {
      const cole = game.player;
      const ride = cole ? cole.car : null;
      const data = {
        v: 1,
        cash: game.cash,
        missionIndex: game.missionIndex,
        missionStep: game.missionStep,
        wanted: game.wanted,
        player: cole
          ? {
              x: cole.pos.x,
              z: cole.pos.z,
              heading: cole.heading,
              health: cole.health,
              ammo: cole.ammo,
              weapon: cole.weapon,
            }
          : null,
        car: ride
          ? {
              name: ride.name,
              color: ride.color,
              x: ride.pos.x,
              z: ride.pos.z,
              heading: ride.heading,
              health: ride.health,
              special: ride.special || null,
              isVan: !!ride.isVan,
            }
          : null,
        at: Date.now(),
      };
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  load() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.v !== 1) return null;
      if (typeof data.cash !== 'number' || typeof data.missionIndex !== 'number') return null;
      return data;
    } catch {
      return null;
    }
  }

  // Put a saved run back. Returns where the story resumes: the job, the
  // beat, and a note when something could not be restored.
  apply(game, data) {
    const cole = game.player;
    game.cash = data.cash || 0;
    game.wanted = data.wanted || 0;
    let index = data.missionIndex | 0;
    let step = data.missionStep | 0;
    let note = '';
    if (data.player && cole) {
      cole.pos.set(data.player.x || 0, 0, data.player.z || 0);
      cole.heading = data.player.heading || 0;
      cole.health = data.player.health ?? cole.maxHealth;
      cole.ammo = data.player.ammo ?? cole.ammo;
      cole.weapon = data.player.weapon || cole.weapon;
      cole.mesh.position.copy(cole.pos);
      cole.mesh.rotation.y = cole.heading;
    }
    if (data.car && cole) {
      const spot = this.findCarSpot(game, data.car.x, data.car.z);
      if (!spot) {
        // The car is gone for good: restart its job from the first beat
        // and say so, instead of stranding Cole on foot mid-job.
        step = 0;
        note = 'Your car could not be recovered, so the job restarts from the beginning.';
      } else {
        const ride = createCar(game, {
          x: spot.x,
          z: spot.z,
          heading: data.car.heading || 0,
          color: data.car.color,
          name: data.car.name,
          isVan: !!data.car.isVan,
          parked: true,
        });
        ride.health = data.car.health ?? ride.maxHealth;
        ride.special = data.car.special || undefined;
        if (ride.special === 'comet') game.cometGT = ride;
        if (ride.special === 'bankvan') game.bankVan = ride;
        ride.parked = false;
        cole.car = ride;
        cole.pos.copy(ride.pos);
        cole.pos.y = 0;
        cole.heading = ride.heading;
      }
    }
    return { index, step, note };
  }

  // The saved spot if it is clear, else the nearest clear ring position.
  // Null only when every ring is blocked too.
  findCarSpot(game, x, z) {
    if (!collideCircle(game, x, z, 2.1).hit) return { x, z };
    for (const [dx, dz] of FALLBACK_RINGS) {
      if (!collideCircle(game, x + dx, z + dz, 2.1).hit) {
        return { x: x + dx, z: z + dz };
      }
    }
    return null;
  }
}
