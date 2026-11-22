// save.js — localStorage saves for Neon Harbor.
//
// One save slot, one key, plain JSON. A save records everything Continue
// needs to put Cole back exactly where he was:
//
//   - the mission index AND the step inside that mission,
//   - the stolen / driven car (model, colour, spot, heading, health),
//   - the player (position, health, cash),
//   - the wanted level, so a hot save stays hot.
//
// Continue restores all of it and spawns the car at a collision-clear
// spot, never inside a building. Old saves still load: any field that is
// missing is filled with a sane default instead of throwing the save away.

export const SAVE_KEY = 'neon-harbor-save-v1';
export const SAVE_VERSION = 3;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// The mission index, read from wherever the missions module keeps it.
function readMissionIndex(G) {
  if (!G) return 0;
  const m = G.missions;
  if (m) {
    if (isFiniteNumber(m.mission)) return m.mission;
    if (isFiniteNumber(m.index)) return m.index;
    if (isFiniteNumber(m.current)) return m.current;
  }
  if (isFiniteNumber(G.mission)) return G.mission;
  if (isFiniteNumber(G.missionIndex)) return G.missionIndex;
  return 0;
}

// The step inside the mission, same idea.
function readMissionStep(G) {
  if (!G) return 0;
  const m = G.missions;
  if (m) {
    if (isFiniteNumber(m.step)) return m.step;
    if (isFiniteNumber(m.missionStep)) return m.missionStep;
    if (isFiniteNumber(m.beat)) return m.beat;
  }
  if (isFiniteNumber(G.missionStep)) return G.missionStep;
  if (isFiniteNumber(G.step)) return G.step;
  return 0;
}

function readWanted(G) {
  if (!G) return 0;
  if (G.police && isFiniteNumber(G.police.stars)) return G.police.stars;
  if (isFiniteNumber(G.wanted)) return G.wanted;
  if (G.police && isFiniteNumber(G.police.wanted)) return G.police.wanted;
  return 0;
}

function writeMissionIndex(G, index) {
  if (!G) return;
  const m = G.missions;
  if (m) {
    if (typeof m.setMission === 'function') { m.setMission(index); }
    else if (typeof m.setIndex === 'function') { m.setIndex(index); }
    else {
      m.mission = index;
      m.index = index;
      m.current = index;
    }
  }
  G.mission = index;
  G.missionIndex = index;
}

function writeMissionStep(G, step) {
  if (!G) return;
  const m = G.missions;
  if (m) {
    if (typeof m.setStep === 'function') { m.setStep(step); }
    else {
      m.step = step;
      m.missionStep = step;
      m.beat = step;
    }
  }
  G.missionStep = step;
  G.step = step;
}

// Is (x, z) clear of every building collider? A car needs a little room.
function spotIsClear(G, x, z, margin) {
  const colliders = (G && Array.isArray(G.colliders)) ? G.colliders : [];
  const pad = (margin || 0) + 4;
  for (const box of colliders) {
    const hw = (box.hw || 0) + pad;
    const hd = (box.hd || 0) + pad;
    if (Math.abs(x - box.x) < hw && Math.abs(z - box.z) < hd) return false;
  }
  return true;
}

// Nudge (x, z) until it sits clear of buildings, spiralling outward.
function clearSpotNear(G, x, z) {
  if (spotIsClear(G, x, z, 0)) return { x, z };
  for (let radius = 6; radius <= 60; radius += 6) {
    const tries = [
      [x + radius, z], [x - radius, z], [x, z + radius], [x, z - radius],
      [x + radius, z + radius], [x - radius, z - radius],
      [x + radius, z - radius], [x - radius, z + radius],
    ];
    for (const [tx, tz] of tries) {
      if (spotIsClear(G, tx, tz, 0)) return { x: tx, z: tz };
    }
  }
  // Last resort: the hideout forecourt is open ground.
  const hideout = G && G.markers && G.markers.hideout;
  if (hideout) return { x: hideout.x, z: hideout.z };
  return { x, z };
}

function describeCar(car) {
  if (!car) return null;
  return {
    model: car.model || car.name || 'Sedan',
    // The name is what the debug surface and the restore path read back,
    // so it must survive the round trip — a model-only record restores a
    // nameless car.
    name: car.name || car.model || 'Sedan',
    special: !!car.special,
    color: car.color || car.colour || 0x888888,
    x: car.pos ? car.pos.x : (car.x || 0),
    z: car.pos ? car.pos.z : (car.z || 0),
    heading: isFiniteNumber(car.heading) ? car.heading : 0,
    health: isFiniteNumber(car.health) ? car.health : 100,
    speed: 0,
  };
}

export class SaveManager {
  constructor(G) {
    this.G = G || null;
    this.key = SAVE_KEY;
    // Wire the pause-menu buttons when the page is there. The entry
    // program may wire them too; both handlers are idempotent, so a
    // double wire saves (or continues) twice instead of breaking.
    if (typeof document !== 'undefined') {
      const saveBtn = document.getElementById('btn-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const data = this.save(this.G);
          this._note(data ? 'Saved.' : 'Save failed.');
        });
      }
      const continueBtn = document.getElementById('btn-continue');
      if (continueBtn) {
        continueBtn.addEventListener('click', () => {
          this.continueGame(this.G);
        });
      }
    }
  }

  _note(text) {
    if (typeof document !== 'undefined') {
      const note = document.getElementById('pause-save-note');
      if (note) note.textContent = text;
    }
    const hud = this.G && this.G.hud;
    if (hud && typeof hud.setSaveNote === 'function') hud.setSaveNote(text);
  }

  // Build the save record from the live game. Pure data, no DOM.
  buildSaveData(G) {
    const game = G || this.G || {};
    const player = game.player || {};
    const pos = player.pos || { x: 0, y: 0, z: 0 };
    const car = player.car || null;
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      mission: readMissionIndex(game),
      step: readMissionStep(game),
      wanted: readWanted(game),
      cash: isFiniteNumber(game.cash) ? Math.round(game.cash) : 0,
      // Top-level health: the entry program's restore reads obj.health,
      // not just player.health.
      health: isFiniteNumber(player.health) ? Math.round(player.health) : 100,
      player: {
        x: pos.x || 0,
        y: pos.y || 0,
        z: pos.z || 0,
        heading: isFiniteNumber(player.heading) ? player.heading : 0,
        health: isFiniteNumber(player.health) ? Math.round(player.health) : 100,
        ammo: isFiniteNumber(player.ammo) ? player.ammo : 0,
        weapon: player.weapon || 'fists',
      },
      car: describeCar(car),
      taxi: null,
      courier: null,
      race: null,
    };
  }

  // Write the save. Returns the record, or null when storage refused.
  save(G) {
    const game = G || this.G;
    if (!game) return null;
    const data = this.buildSaveData(game);
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (err) {
      return null;
    }
    this._note('Saved.');
    return data;
  }

  saveGame(G) { return this.save(G); }
  writeSave(G) { return this.save(G); }
  store(G) { return this.save(G); }

  // Read the save back. Tolerates old shapes: missing fields are
  // defaulted by normalise() instead of rejecting the whole save.
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    return this.normalise(parsed);
  }

  loadGame() { return this.load(); }
  readSave() { return this.load(); }

  normalise(data) {
    if (!data || typeof data !== 'object') return null;
    const clean = {
      version: isFiniteNumber(data.version) ? data.version : 1,
      savedAt: data.savedAt || 0,
      mission: isFiniteNumber(data.mission) ? data.mission : 0,
      step: isFiniteNumber(data.step) ? data.step : 0,
      wanted: isFiniteNumber(data.wanted) ? data.wanted : 0,
      cash: isFiniteNumber(data.cash) ? data.cash : 0,
      health: isFiniteNumber(data.health)
        ? data.health
        : (isFiniteNumber(data.player && data.player.health) ? data.player.health : 100),
      player: {
        x: isFiniteNumber(data.player && data.player.x) ? data.player.x : 0,
        y: isFiniteNumber(data.player && data.player.y) ? data.player.y : 0,
        z: isFiniteNumber(data.player && data.player.z) ? data.player.z : 0,
        heading: isFiniteNumber(data.player && data.player.heading) ? data.player.heading : 0,
        health: isFiniteNumber(data.player && data.player.health) ? data.player.health : 100,
        ammo: isFiniteNumber(data.player && data.player.ammo) ? data.player.ammo : 0,
        weapon: (data.player && data.player.weapon) || 'fists',
      },
      car: null,
    };
    if (data.car && typeof data.car === 'object') {
      clean.car = {
        model: data.car.model || data.car.name || 'Sedan',
        name: data.car.name || data.car.model || 'Sedan',
        special: !!data.car.special,
        color: data.car.color !== undefined ? data.car.color : (data.car.colour || 0x888888),
        x: isFiniteNumber(data.car.x) ? data.car.x : clean.player.x,
        z: isFiniteNumber(data.car.z) ? data.car.z : clean.player.z,
        heading: isFiniteNumber(data.car.heading) ? data.car.heading : 0,
        health: isFiniteNumber(data.car.health) ? data.car.health : 100,
      };
    }
    return clean;
  }

  hasSave() {
    try {
      return !!localStorage.getItem(this.key);
    } catch (err) {
      return false;
    }
  }

  clear() {
    try { localStorage.removeItem(this.key); } catch (err) { /* ignore */ }
  }
  clearSave() { this.clear(); }

  // Put a loaded save back into the live game. Returns true on success.
  applySave(G, data) {
    const game = G || this.G;
    const save = data || this.load();
    if (!game || !save) return false;

    writeMissionIndex(game, save.mission);
    writeMissionStep(game, save.step);
    game.cash = save.cash;

    const player = game.player;
    if (player) {
      if (player.pos && typeof player.pos.set === 'function') {
        player.pos.set(save.player.x, save.player.y || 0, save.player.z);
      } else if (player.pos) {
        player.pos.x = save.player.x;
        player.pos.y = save.player.y || 0;
        player.pos.z = save.player.z;
      }
      player.heading = save.player.heading;
      player.health = save.player.health;
      player.ammo = save.player.ammo;
      player.weapon = save.player.weapon;
      if (typeof player.setHealth === 'function') player.setHealth(save.player.health);
    }

    // Wanted level comes back exactly as saved.
    if (game.police) {
      if (typeof game.police.setWanted === 'function') game.police.setWanted(game, save.wanted);
      else if (isFiniteNumber(game.police.stars)) game.police.stars = save.wanted;
    }
    game.wanted = save.wanted;

    // The car: reuse a parked car of the same model when one exists,
    // otherwise rebuild it from the record and park it at a clear spot.
    if (save.car) {
      const spot = clearSpotNear(game, save.car.x, save.car.z);
      let car = null;
      if (Array.isArray(game.cars)) {
        for (const candidate of game.cars) {
          if (candidate.parked && !candidate.isPolice &&
              (candidate.model === save.car.model || candidate.name === save.car.model)) {
            car = candidate;
            break;
          }
        }
      }
      if (car) {
        if (car.pos && typeof car.pos.set === 'function') car.pos.set(spot.x, 0, spot.z);
        else if (car.pos) { car.pos.x = spot.x; car.pos.z = spot.z; }
        car.x = spot.x;
        car.z = spot.z;
        car.heading = save.car.heading;
        car.health = save.car.health;
        car.speed = 0;
        car.parked = false;
        if (typeof car.setColor === 'function') car.setColor(save.car.color);
        else car.color = save.car.color;
        car.name = save.car.name || save.car.model;
        car.special = !!save.car.special;
      } else if (typeof game.spawnCar === 'function') {
        car = game.spawnCar(save.car.model, spot.x, spot.z, save.car.heading, save.car.color);
        if (car) {
          car.health = save.car.health;
          car.parked = false;
        }
      } else {
        // No spawner available: build a plain car record and register it.
        car = {
          model: save.car.model,
          name: save.car.model,
          color: save.car.color,
          pos: { x: spot.x, y: 0, z: spot.z },
          x: spot.x,
          z: spot.z,
          heading: save.car.heading,
          speed: 0,
          health: save.car.health,
          parked: false,
          isPolice: false,
        };
        if (Array.isArray(game.cars)) game.cars.push(car);
      }
      if (player && car) {
        player.car = car;
        if (typeof player.enterCar === 'function') player.enterCar(car);
        else if (typeof game.enterCar === 'function') game.enterCar(car);
      }
      if (game.vehicles && typeof game.vehicles.refresh === 'function') {
        try { game.vehicles.refresh(); } catch (err) { /* ignore */ }
      }
    } else if (player) {
      player.car = null;
    }

    // A respawned side job would be stale, so cancel any running one.
    if (game.taxi && typeof game.taxi.cancel === 'function') {
      try { game.taxi.cancel(); } catch (err) { /* ignore */ }
    }
    if (game.courier && typeof game.courier.cancel === 'function') {
      try { game.courier.cancel(); } catch (err) { /* ignore */ }
    }
    if (game.race && typeof game.race.cancel === 'function') {
      try { game.race.cancel(); } catch (err) { /* ignore */ }
    }
    return true;
  }

  restore(G, data) { return this.applySave(G, data); }

  // Load the save and put it back: the Continue button's whole job.
  continueGame(G) {
    const game = G || this.G;
    const data = this.load();
    if (!data) return false;
    return this.applySave(game, data);
  }

  loadAndApply(G) { return this.continueGame(G); }
}

// Standalone functions for entry programs that prefer them to the class.
export function saveGame(G) {
  const manager = new SaveManager(G);
  return manager.save(G);
}

export function loadGame() {
  const manager = new SaveManager(null);
  return manager.load();
}

export function applySave(G, data) {
  const manager = new SaveManager(G);
  return manager.applySave(G, data);
}

export function hasSave() {
  const manager = new SaveManager(null);
  return manager.hasSave();
}

export { SaveManager as Save };
export default SaveManager;
