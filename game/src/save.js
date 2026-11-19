// Neon Harbor — save game in localStorage. A save records the whole
// playable situation, not just a bookmark: which job is running and which
// beat inside it, where Cole stands, how much health and cash he has, what
// he is carrying, and — the part that used to be lost — the car he is
// driving, down to its model, colour, spot and heading. Continue rebuilds
// that situation. When a piece of it genuinely cannot be rebuilt (the car
// is gone from the world, the beat no longer exists), Continue says so on
// screen and restarts the current job cleanly from its first beat instead
// of silently dropping the player mid-job with no car and no explanation.
import { collideCircle } from './state.js';
import { MISSIONS } from './missions.js';
import { enterCar } from './vehicles.js';

const KEY = 'neon-harbor-save-v1';
const SAVE_VERSION = 1;

// Jobs whose final beat is a countdown restart that countdown from the full
// allowance when reloaded mid-beat; a half-spent timer restored from a save
// would strand the player with no time to finish.
function beatNeedsFullTimer(index, step) {
  const job = MISSIONS[index];
  if (!job) return false;
  const beat = job.steps[step];
  return !!beat && beat.type === 'timed';
}

export class SaveData {
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!data || typeof data.cash !== 'number' || typeof data.missionIndex !== 'number') return null;
    return data;
  }

  save(G) {
    const snapshot = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      cash: G.cash,
      missionIndex: Math.min(G.missionIndex, MISSIONS.length - 1),
      missionStep: G.missionStep || 0,
      missionTimer: G.missionTimer || 0,
      pos: { x: G.player.pos.x, z: G.player.pos.z },
      heading: G.player.heading || 0,
      health: G.player.health,
      ammo: G.player.ammo,
      weapon: G.player.weapon,
      wanted: G.wanted,
    };
    const car = G.player.car;
    if (car) {
      snapshot.car = {
        x: car.pos.x,
        z: car.pos.z,
        heading: car.heading,
        name: car.name,
        color: car.color,
        isVan: !!car.isVan,
        special: car.special || null,
        stolen: !!car.stolen,
      };
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Rebuild the saved situation. Returns what Continue needs to know:
  // the job and beat to resume, whether the saved car came back, and a
  // plain-language note when anything fell short, so the caller can put
  // that note on screen instead of pretending the restore was perfect.
  apply(G, data) {
    G.cash = data.cash || 0;
    G.player.health = data.health > 0 ? data.health : 100;
    G.player.ammo = typeof data.ammo === 'number' ? data.ammo : G.player.ammo;
    if (data.weapon === 'fists' || data.weapon === 'pistol') G.player.weapon = data.weapon;
    // Always come back clean: reloading into an active police chase the
    // player cannot see yet reads as an ambush, not a continuation.
    G.wanted = 0;
    G.heatTimer = 0;

    const index = Math.max(0, Math.min(data.missionIndex || 0, MISSIONS.length - 1));
    const job = MISSIONS[index];
    const lastBeat = job ? job.steps.length - 1 : 0;
    let step = Number.isInteger(data.missionStep) ? data.missionStep : 0;
    step = Math.max(0, Math.min(step, lastBeat));

    const notes = [];
    let carRestored = false;
    let carLost = false;
    if (data.car) {
      carRestored = this.restoreCar(G, data.car);
      if (!carRestored) {
        carLost = true;
        // A beat that needs the car (drive / deliver) cannot resume on
        // foot, so the job restarts from its first beat and the player is
        // told why.
        step = 0;
        notes.push("Your car couldn't be recovered — mission restarted from the top.");
      }
    }

    if (data.pos) {
      // Never reload inside a wall: nudge the saved spot out of any
      // building footprint before standing the player there.
      const clear = collideCircle(G, data.pos.x, data.pos.z, 0.6);
      G.player.pos.set(clear.x, 0, clear.z);
      G.player.heading = typeof data.heading === 'number' ? data.heading : 0;
      G.player.mesh.position.copy(G.player.pos);
      G.player.mesh.rotation.y = G.player.heading;
    }

    if (beatNeedsFullTimer(index, step)) {
      G.missionTimer = job.steps[step].seconds;
      notes.push('The pickup timer restarted at 90 seconds.');
    } else if (typeof data.missionTimer === 'number') {
      G.missionTimer = data.missionTimer;
    }

    return { index, step, carRestored, carLost, note: notes.join(' ') };
  }

  // Put the player back into the car they were driving when they saved.
  // Special cars (the Comet GT, the bank van) are matched by identity;
  // ordinary cars by the same model and colour parked near the saved spot,
  // then any parked car nearby, then any parked car at all. The car is
  // moved to the exact saved spot and heading, and marked already stolen
  // so getting back in does not raise the wanted level a second time.
  restoreCar(G, saved) {
    let car = null;
    if (saved.special) car = G.cars.find((c) => c.special === saved.special) || null;
    if (!car) car = this.findParkedNear(G, saved, true) || this.findParkedNear(G, saved, false);
    if (!car) car = G.cars.find((c) => c.parked && !c.isPolice) || null;
    if (!car) return false;
    car.pos.set(saved.x, 0, saved.z);
    car.heading = saved.heading || 0;
    car.speed = 0;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    enterCar(G, car);
    car.stolen = true;
    return true;
  }

  findParkedNear(G, saved, sameModel) {
    let best = null;
    let bestDist = 80;
    for (const c of G.cars) {
      if (c.isPolice || G.policeCars.includes(c) || !c.parked) continue;
      if (sameModel && (c.name !== saved.name || c.color !== saved.color)) continue;
      const d = Math.hypot(c.pos.x - saved.x, c.pos.z - saved.z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  exists() {
    try {
      return !!localStorage.getItem(KEY);
    } catch (e) {
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      // Storage unavailable — nothing to clear.
    }
  }
}
