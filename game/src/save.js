// Neon Harbor — saving to localStorage. A save is a full snapshot of the
// playable situation, not a bookmark: the job in progress and the beat
// inside it, where Cole stands, his health, ammo and cash, and — the part
// that used to be lost — the car he is driving, down to model, colour,
// spot, heading and health. Continue rebuilds that situation. If a piece
// genuinely cannot be rebuilt (the car is gone from the world, the beat
// no longer exists), Continue says so on screen and restarts the current
// job from its first beat instead of silently dropping the player mid-job
// with no car and no explanation.
import { collideCircle } from './state.js';
import { MISSIONS } from './missions.js';
import { enterCar } from './vehicles.js';

const SAVE_KEY = 'neon-harbor-save-v1';
const SAVE_VERSION = 1;

// A beat that is a countdown restarts its countdown from the full
// allowance when reloaded mid-beat; a half-spent timer restored from a save
// would strand the player with no time to finish.
function needsFreshTimer(index, step) {
  const job = MISSIONS[index];
  if (!job) return false;
  const beat = job.steps[step];
  return !!beat && beat.type === 'timed';
}

function snapshotCar(car) {
  return {
    x: car.pos.x,
    z: car.pos.z,
    heading: car.heading,
    name: car.name,
    color: car.color,
    isVan: !!car.isVan,
    special: car.special || null,
    stolen: !!car.stolen,
    health: car.health,
  };
}

export class SaveData {
  read() {
    let raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
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

  load() {
    return this.read();
  }

  write(G) {
    const p = G.player;
    const snap = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      cash: G.cash,
      missionIndex: Math.min(G.missionIndex, MISSIONS.length - 1),
      missionStep: G.missionStep || 0,
      missionTimer: G.missionTimer || 0,
      pos: { x: p.pos.x, z: p.pos.z },
      heading: p.heading || 0,
      health: p.health,
      ammo: p.ammo,
      weapon: p.weapon,
      wanted: G.wanted,
    };
    if (p.car) snap.car = snapshotCar(p.car);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
      return true;
    } catch (e) {
      return false;
    }
  }

  save(G) {
    return this.write(G);
  }

  // Rebuild the saved situation. Returns what Continue needs to know:
  // the job and beat to resume, whether the saved car came back, and a
  // plain-language note when anything fell short, so the caller can put
  // that note on screen instead of pretending the restore was perfect.
  restore(G, data) {
    this.restoreVitals(G, data);
    const jobResult = this.restoreJob(G, data);
    const { index, step, note: carNote, carRestored } = jobResult;
    this.restorePosition(G, data);
    const timerNote = this.restoreTimer(G, data, index, step);
    const notes = [carNote, timerNote].filter(Boolean).join(' ');
    return { index, step, carRestored, carLost: !carRestored && !!data.car, note: notes };
  }

  // Health, ammo, weapon and cash, and a clean slate on the heat: reloading
  // into an active police chase the player cannot see yet reads as an
  // ambush, not a continuation.
  restoreVitals(G, data) {
    G.cash = data.cash || 0;
    G.player.health = data.health > 0 ? data.health : 100;
    G.player.ammo = typeof data.ammo === 'number' ? data.ammo : G.player.ammo;
    if (data.weapon === 'fists' || data.weapon === 'pistol') G.player.weapon = data.weapon;
    G.wanted = 0;
    G.heatTimer = 0;
  }

  // Which job and beat to resume, and the saved car if there was one. A
  // beat that needs the car (drive / deliver) cannot resume on foot, so a
  // lost car restarts the job from its first beat — and the player is told
  // why.
  restoreJob(G, data) {
    const index = Math.max(0, Math.min(data.missionIndex || 0, MISSIONS.length - 1));
    const job = MISSIONS[index];
    const lastBeat = job ? job.steps.length - 1 : 0;
    let step = Number.isInteger(data.missionStep) ? data.missionStep : 0;
    step = Math.max(0, Math.min(step, lastBeat));
    let note = '';
    let carRestored = false;
    if (data.car) {
      carRestored = this.recoverCar(G, data.car);
      if (!carRestored) {
        step = 0;
        note = "Your car couldn't be recovered — mission restarted from the top.";
      }
    }
    return { index, step, note, carRestored };
  }

  // Where Cole stands: never reload inside a wall — nudge the saved spot
  // out of any building footprint before standing the player there.
  restorePosition(G, data) {
    if (!data.pos) return;
    const clear = collideCircle(G, data.pos.x, data.pos.z, 0.6);
    G.player.pos.set(clear.x, 0, clear.z);
    G.player.heading = typeof data.heading === 'number' ? data.heading : 0;
    G.player.mesh.position.copy(G.player.pos);
    G.player.mesh.rotation.y = G.player.heading;
  }

  restoreTimer(G, data, index, step) {
    const job = MISSIONS[index];
    if (needsFreshTimer(index, step)) {
      G.missionTimer = job.steps[step].seconds;
      return 'The pickup timer restarted at 90 seconds.';
    }
    if (typeof data.missionTimer === 'number') {
      G.missionTimer = data.missionTimer;
    }
    return '';
  }

  apply(G, data) {
    return this.restore(G, data);
  }

  // Put the player back into the car they were driving when they saved.
  // Special cars (the Comet GT, the bank van) are matched by identity;
  // ordinary cars by the same model and colour parked near the saved spot,
  // then any parked car nearby, then any parked car at all. The car is
  // moved to the exact saved spot and heading, and marked already stolen
  // so getting back in does not raise the wanted level a second time.
  recoverCar(G, saved) {
    let car = null;
    if (saved.special) car = G.cars.find((c) => c.special === saved.special) || null;
    if (!car) car = this.findParked(G, saved, true) || this.findParked(G, saved, false);
    if (!car) car = G.cars.find((c) => c.parked && !c.isPolice) || null;
    if (!car) return false;
    car.pos.set(saved.x, 0, saved.z);
    car.heading = saved.heading || 0;
    car.speed = 0;
    car.health = typeof saved.health === 'number' ? saved.health : 100;
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.heading;
    enterCar(G, car);
    car.stolen = true;
    return true;
  }

  findParked(G, saved, sameModel) {
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
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      // Storage unavailable — nothing to clear.
    }
  }
}
