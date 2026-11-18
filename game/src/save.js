// Neon Harbor — save data in localStorage: cash, current mission and step,
// player position, health and wanted level, plus the car the player is in
// so Continue restores the mission mid-step instead of restarting it.
import { collideCircle } from './state.js';
import { MISSIONS } from './missions.js';
import { enterCar } from './vehicles.js';

const KEY = 'neon-harbor-save-v1';

export class SaveData {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (typeof data.cash !== 'number' || typeof data.missionIndex !== 'number') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  save(G) {
    try {
      const data = {
        cash: G.cash,
        missionIndex: Math.min(G.missionIndex, 4),
        missionStep: G.missionStep || 0,
        pos: { x: G.player.pos.x, z: G.player.pos.z },
        health: G.player.health,
        wanted: G.wanted,
        savedAt: Date.now(),
      };
      if (G.player.car) {
        const c = G.player.car;
        data.car = {
          x: c.pos.x, z: c.pos.z, heading: c.heading,
          name: c.name, color: c.color, isVan: !!c.isVan,
          special: c.special || null,
        };
      }
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  apply(G, data) {
    G.cash = data.cash || 0;
    G.player.health = data.health > 0 ? data.health : 100;
    G.wanted = 0; // always start clean after loading
    if (data.pos) {
      // never spawn inside a building: push the saved spot out of colliders
      const res = collideCircle(G, data.pos.x, data.pos.z, 0.6);
      G.player.pos.set(res.x, 0, res.z);
      G.player.mesh.position.copy(G.player.pos);
    }
    // restore the car the player was driving, if the save had one
    if (data.car) this.restoreCar(G, data.car);
    // clamp the saved step to the mission's real step count (old saves: 0)
    const index = data.missionIndex || 0;
    const steps = (MISSIONS[index] && MISSIONS[index].steps.length) || 1;
    const step = Number.isInteger(data.missionStep) ? data.missionStep : 0;
    return { index, step: Math.max(0, Math.min(step, steps - 1)) };
  }

  // Put the player back into the car they had when saving. Cars are
  // re-spawned fresh on load, so match the special car by identity and any
  // other car by the same model + colour parked nearby (the save records
  // both); fall back to the nearest parked car, then any parked car.
  restoreCar(G, saved) {
    let car = null;
    if (saved.special) car = G.cars.find(c => c.special === saved.special);
    if (!car) {
      const parkedNear = (match) => {
        let best = null, bestD = 60;
        for (const c of G.cars) {
          if (c.isPolice || G.policeCars.includes(c) || !c.parked) continue;
          if (match && (c.name !== saved.name || c.color !== saved.color)) continue;
          const d = Math.hypot(c.pos.x - saved.x, c.pos.z - saved.z);
          if (d < bestD) { bestD = d; best = c; }
        }
        return best;
      };
      car = parkedNear(true) || parkedNear(false) ||
        G.cars.find(c => c.parked && !c.isPolice);
    }
    if (!car) return false;
    car.pos.set(saved.x, 0, saved.z);
    car.heading = saved.heading || 0;
    car.speed = 0;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    enterCar(G, car);
    car.stolen = true; // already stolen when saved — do not re-trigger wanted
    return true;
  }

  exists() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }
}
