// Neon Harbor — localStorage save / continue.
//
// One record holds everything a reload needs to put Cole back exactly
// where he was: which mission and which beat inside it, cash, health,
// where he stood — and, crucially, the car he was driving (model,
// colour, spot, heading, health), because a stolen car is progress.
// main.js drives the flow: load() -> apply() -> restoreCar() ->
// restorePlayer(), re-asserting mission/step from the record itself.
import { clamp, collideCircle } from './state.js';
import { createCar, enterCar } from './vehicles.js';

const SAVE_KEY = 'neon-harbor-save-v1';
const SAVE_VERSION = 1;

export class SaveData {
  constructor() {
    this.key = SAVE_KEY;
  }

  // -- packing ------------------------------------------------------------

  packPlayer(cole) {
    if (!cole) return null;
    return {
      x: cole.pos ? cole.pos.x : 0,
      z: cole.pos ? cole.pos.z : 0,
      heading: cole.heading || 0,
      health: Math.max(1, Math.round(cole.health || 100)),
      weapon: cole.weapon || 'fists',
      ammo: cole.ammo || 0,
    };
  }

  packCar(ride) {
    if (!ride) return null;
    return {
      name: ride.name || '',
      model: ride.model || 'sedan',
      color: ride.color ?? null,
      x: ride.pos ? ride.pos.x : 0,
      z: ride.pos ? ride.pos.z : 0,
      heading: ride.heading || 0,
      hp: Math.max(0, Math.round(ride.health ?? 100)),
      isVan: !!ride.isVan,
      special: ride.special ?? null,
    };
  }

  // -- writing ------------------------------------------------------------

  save(game) {
    const record = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      missionIndex: game.missionIndex || 0,
      missionStep: game.missionStep || 0,
      missionActive: !!game.missionActive,
      missionTimer: game.missionTimer || 0,
      cash: Math.max(0, Math.round(game.cash || 0)),
      wanted: 0, // a fresh load starts clean; heat does not survive a reload
      player: this.packPlayer(game.player),
      car: this.packCar(game.player ? game.player.car : null),
    };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(record));
    } catch (err) {
      console.warn('save failed', err);
      return null;
    }
    return record;
  }

  // -- reading ------------------------------------------------------------

  load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    if (data.version !== SAVE_VERSION) return null;
    if (typeof data.missionIndex !== 'number') return null;
    return data;
  }

  // -- applying -----------------------------------------------------------

  // Sets the record's fields on the game exactly as given. main.js
  // re-asserts missionIndex/missionStep around this call, so this must
  // not second-guess them — apply, don't interpret.
  apply(game, data) {
    if (!data) return false;
    if (typeof data.cash === 'number') game.cash = Math.max(0, data.cash);
    if (typeof data.missionIndex === 'number') game.missionIndex = data.missionIndex;
    if (typeof data.missionStep === 'number') game.missionStep = data.missionStep;
    if (typeof data.missionActive === 'boolean') game.missionActive = data.missionActive;
    else game.missionActive = true;
    if (typeof data.missionTimer === 'number') game.missionTimer = data.missionTimer;
    game.wanted = 0;
    if (game.police) game.police.clearWanted(game);
    if (data.player && game.player) {
      game.player.health = Math.max(1, data.player.health || 100);
      if (data.player.weapon) game.player.weapon = data.player.weapon;
      if (typeof data.player.ammo === 'number') game.player.ammo = data.player.ammo;
    }
    return true;
  }

  restorePlayer(game, saved) {
    const p = game.player;
    const rec = saved && saved.player;
    if (!p || !rec) return false;
    if (typeof rec.x === 'number' && typeof rec.z === 'number') {
      p.pos.set(rec.x, 0, rec.z);
    }
    if (typeof rec.heading === 'number') {
      p.heading = rec.heading;
      p.camYaw = rec.heading;
    }
    if (typeof rec.health === 'number') p.health = Math.max(1, rec.health);
    return true;
  }

  restoreCar(game, saved) {
    const rec = saved && saved.car;
    if (!rec || !game.player) return false;
    // The exact saved spot may be occupied after a fresh page load
    // (parked cars respawn randomly), so settle for the nearest clear
    // patch of road instead of spawning inside another car.
    const spot = this.findCarSpot(game, rec.x || 0, rec.z || 0);
    const car = createCar(game, {
      x: spot.x,
      z: spot.z,
      heading: rec.heading || 0,
      health: typeof rec.hp === 'number' ? rec.hp : 100,
      model: rec.model || 'sedan',
      name: rec.name || undefined,
      color: rec.color ?? undefined,
      isVan: !!rec.isVan,
      parked: false,
      special: rec.special ?? null,
    });
    enterCar(game, car);
    return true;
  }

  // Nearest clear patch of ground to (x, z): not inside a building and
  // not on top of another car. Tries the spot itself, then rings out.
  findCarSpot(game, x, z) {
    const tries = [[0, 0]];
    for (const r of [6, 12, 18, 30]) {
      tries.push([r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]);
    }
    for (const [dx, dz] of tries) {
      const tx = clamp(x + dx, -230, 230);
      const tz = clamp(z + dz, -230, 230);
      if (this.spotBlocked(game, tx, tz)) continue;
      return { x: tx, z: tz };
    }
    return { x: clamp(x, -230, 230), z: clamp(z, -230, 230) };
  }

  spotBlocked(game, x, z) {
    if (game.colliders) {
      const hit = collideCircle(game, x, z, 3);
      if (hit && hit.hit) return true;
    }
    for (const c of game.cars || []) {
      if (game.player && game.player.car === c) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < 5) return true;
    }
    return false;
  }
}
