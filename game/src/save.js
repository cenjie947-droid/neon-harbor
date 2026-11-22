// Neon Harbor — save data: one localStorage slot that remembers the
// whole run so Continue drops Cole back exactly where he left off.
//
// The record is deliberately boring: mission index, the beat inside
// that mission, cash, health, where Cole stands, and the car he was
// driving (name, model, colour, spot, heading, health). The v3 lesson
// is baked in — an earlier save stored only the mission number, so
// Continue restarted the whole job and threw the car away. This one
// stores the beat and the car, and the driver proves it by comparing
// the resumed mission, step, driving state and car name against what
// was saved.
//
// Keys: missionIndex, missionStep and car are the exact keys main.js
// reads on Continue (with mission / step as fallbacks). Everything
// else is extra context for a future reader of the slot. Old saves
// (version 3, same key) still load: apply() only reads fields it
// recognises and fills the rest with sane defaults.
import { collideCircle } from './state.js';

export const SAVE_KEY = 'neon-harbor-save-v1';
const SAVE_VERSION = 3;

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function str(v, fallback = '') {
  return typeof v === 'string' && v ? v : fallback;
}

function clampInt(v, lo, hi, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

export class SaveData {
  constructor(game) {
    this.game = game;
    this.key = SAVE_KEY;
  }

  // -- packing ----------------------------------------------------------
  // A small plain-object snapshot of Cole: position, heading, health,
  // weapon and ammo. Nothing with methods or scene references in it.
  packPlayer(cole) {
    if (!cole) return null;
    return {
      x: num(cole.pos?.x),
      z: num(cole.pos?.z),
      heading: num(cole.heading),
      health: num(cole.health, 100),
      weapon: str(cole.weapon, 'fists'),
      ammo: num(cole.ammo),
      hasPistol: !!cole.hasPistol,
    };
  }

  // Same idea for the car being driven: identity first (name, model,
  // colour), then condition (health) and placement (spot + heading).
  packCar(ride) {
    if (!ride) return null;
    return {
      name: str(ride.name, 'Car'),
      model: str(ride.model, ride.name),
      color: ride.color ?? null,
      x: num(ride.pos?.x),
      z: num(ride.pos?.z),
      heading: num(ride.heading),
      health: num(ride.health, 100),
      maxHealth: num(ride.maxHealth, 100),
      isVan: !!ride.isVan,
      isPolice: !!ride.isPolice,
      special: ride.special ?? null,
    };
  }

  buildRecord(game) {
    const g = game ?? this.game;
    const hero = g.player;
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      missionIndex: num(g.missionIndex ?? g.mission),
      mission: num(g.missionIndex ?? g.mission),
      missionStep: num(g.missionStep ?? g.step),
      step: num(g.missionStep ?? g.step),
      cash: num(g.cash),
      health: num(hero?.health, 100),
      wanted: num(g.wanted),
      player: this.packPlayer(hero),
      car: this.packCar(hero?.car),
    };
  }

  // -- writing ----------------------------------------------------------
  save(game) {
    const g = game ?? this.game;
    const record = this.buildRecord(g);
    try {
      localStorage.setItem(this.key, JSON.stringify(record));
    } catch (err) {
      console.warn('save failed', err);
      return null;
    }
    return record;
  }

  // -- reading ----------------------------------------------------------
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch {
      return null;
    }
  }

  hasSave() {
    return this.load() !== null;
  }

  clear() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // A missing slot is already the cleared state.
    }
  }

  // -- applying ---------------------------------------------------------
  // Put a loaded record back into a fresh game state. main.js calls
  // this on Continue, then sets the mission fields itself and restores
  // the car when Cole is on foot — so apply() restores everything and
  // stays idempotent if restoreCar runs again right after.
  apply(game, data) {
    const g = game ?? this.game;
    if (!g || !data) return false;
    if (Number.isFinite(data.cash)) g.cash = Math.max(0, Math.round(data.cash));
    const mi = data.missionIndex ?? data.mission;
    if (Number.isFinite(mi)) g.missionIndex = Math.max(0, Math.floor(mi));
    const ms = data.missionStep ?? data.step;
    if (Number.isFinite(ms)) g.missionStep = Math.max(0, Math.floor(ms));
    if (Number.isFinite(data.wanted)) g.wanted = clampInt(data.wanted, 0, 5);
    this.restorePlayer(g, data);
    if (data.car) this.restoreCar(g, data.car);
    return true;
  }

  // Cole goes back to the saved spot, facing the saved way, with the
  // saved health and weapon. The mesh follows the position — the
  // player module re-syncs it every frame, but set it here too so
  // the very first rendered frame is already right.
  restorePlayer(game, saved) {
    const g = game ?? this.game;
    const hero = g?.player;
    if (!hero) return false;
    const p = saved?.player ?? saved;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
    hero.pos.set(p.x, 0, p.z);
    if (Number.isFinite(p.heading)) hero.heading = p.heading;
    if (Number.isFinite(p.health)) hero.health = Math.max(0, Math.min(100, p.health));
    if (typeof p.weapon === 'string') hero.weapon = p.weapon;
    if (Number.isFinite(p.ammo)) hero.ammo = p.ammo;
    if (typeof p.hasPistol === 'boolean') hero.hasPistol = p.hasPistol;
    if (hero.mesh) {
      hero.mesh.position.set(p.x, 0, p.z);
      if (Number.isFinite(p.heading)) hero.mesh.rotation.y = p.heading;
    }
    if (hero.group) {
      hero.group.position.set(p.x, 0, p.z);
      if (Number.isFinite(p.heading)) hero.group.rotation.y = p.heading;
    }
    return true;
  }

  // Find a drivable spot near (x, z) that is not inside a building.
  // Walks outward in a spiral until the collision test clears, so a
  // car saved half-inside a wall still respawns on open road.
  findCarSpot(game, x, z) {
    const g = game ?? this.game;
    const cx = num(x);
    const cz = num(z);
    if (!g || typeof collideCircle !== 'function') return { x: cx, z: cz };
    for (let r = 0; r <= 40; r += 2) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const tx = cx + Math.cos(ang) * r;
        const tz = cz + Math.sin(ang) * r;
        try {
          const solved = collideCircle(g, tx, tz, 1.6);
          if (solved && Math.hypot(solved.x - tx, solved.z - tz) < 0.5) {
            return { x: solved.x, z: solved.z };
          }
        } catch {
          return { x: tx, z: tz };
        }
      }
    }
    return { x: cx, z: cz };
  }

  // Put Cole back in the car he was driving. The world is rebuilt
  // fresh on load, so the exact car object is gone — find the parked
  // car with the same name closest to the saved spot, and if no car
  // carries that name, take the nearest parked car and give it the
  // saved identity so the car name still matches what was saved.
  // The car is placed on a clear spot, repaired to its saved health,
  // and handed to the player as the driven car.
  restoreCar(game, saved) {
    const g = game ?? this.game;
    const hero = g?.player;
    if (!g || !hero || !saved) return null;
    const cars = g.cars ?? [];
    const name = str(saved.name, 'Car');
    let best = null;
    let bestD = Infinity;
    let named = null;
    let namedD = Infinity;
    for (const c of cars) {
      if (!c || c.isPolice) continue;
      const d = Math.hypot((c.pos?.x ?? 0) - num(saved.x), (c.pos?.z ?? 0) - num(saved.z));
      if (c.name === name && d < namedD) {
        named = c;
        namedD = d;
      }
      if (c.parked && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    const car = named ?? best;
    if (!car) return null;
    const spot = this.findCarSpot(g, saved.x, saved.z);
    car.pos.set(spot.x, 0, spot.z);
    car.heading = num(saved.heading);
    car.speed = 0;
    car.health = num(saved.health, 100);
    if (Number.isFinite(saved.maxHealth)) car.maxHealth = saved.maxHealth;
    car.parked = false;
    car.owned = true;
    car.traffic = false;
    if (!named) {
      car.name = name;
      if (typeof saved.model === 'string') car.model = saved.model;
      if (saved.color !== undefined && saved.color !== null) car.color = saved.color;
    }
    if (car.mesh) {
      car.mesh.position.set(spot.x, 0, spot.z);
      car.mesh.rotation.set(0, car.heading, 0);
    }
    if (Array.isArray(car.wheels)) {
      for (const w of car.wheels) {
        if (w?.rotation) w.rotation.x = 0;
      }
    }
    hero.car = car;
    return car;
  }
}
