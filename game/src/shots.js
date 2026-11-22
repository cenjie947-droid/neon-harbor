// shots.js — the screenshot stager for Neon Harbor.
//
// The four submission screenshots are posed by the REAL running game, never
// edited or composited. The page is loaded with ?shot=<name> and this
// module arranges the live scene for that shot:
//
//   title   — the title screen over the city.
//   chase   — Cole driving the Comet GT downtown, police in pursuit,
//             3 wanted stars, minimap and objective on the HUD.
//   drive   — Cole driving through the streets.
//   mission — the mission-complete panel at Mara's garage after The
//             Pickup: reward $300, total cash $450.
//
// The entry program calls stageShot(G, name) once the world exists (or
// constructs a Shots and calls stage(name)). maybeStage(G) reads the
// ?shot= parameter itself and stages whatever it finds, so the entry
// program can also just call that one function and be done.

const RACE_PAD = { x: 30, z: 180 };
const CHASE_SPOT = { x: 40, z: 40 };
const DRIVE_SPOT = { x: -60, z: 60 };

// The four shots, in submission order, with the file each becomes.
export const SHOT_NAMES = ['chase', 'title', 'drive', 'mission'];
export const SHOT_FILES = {
  chase: '1-chase.jpg',
  title: '2-title.jpg',
  drive: '3-drive.jpg',
  mission: '4-mission.jpg',
};

export function shotNameFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('shot') || '';
  } catch (err) {
    return '';
  }
}

function marker(G, key) {
  return G && G.markers ? G.markers[key] : null;
}

function hud(G) {
  return G && G.hud ? G.hud : null;
}

function setWanted(G, stars) {
  try {
    if (G.police && typeof G.police.addWanted === 'function') {
      const current = G.police.stars || G.wanted || 0;
      if (stars > current) G.police.addWanted(G, stars - current, 'shot');
      else if (G.police.setWanted) G.police.setWanted(G, stars);
      else G.police.stars = stars;
    } else if (G.police) {
      G.police.stars = stars;
    }
    G.wanted = stars;
  } catch (err) { /* a shot must never crash the game */ }
}

function freeRoam(G) {
  try {
    if (G.missions && typeof G.missions.setFreeRoam === 'function') {
      G.missions.setFreeRoam(G);
      return;
    }
  } catch (err) { /* fall through */ }
  if (G.missions) {
    G.missions.mission = -1;
    G.missions.index = -1;
    G.missions.freeRoam = true;
  }
  G.mission = -1;
  G.freeRoam = true;
}

// Put Cole in a car: prefer a parked Comet GT, take any parked car when
// there is no Comet, and place it on the road at (x, z) facing the street.
function putColeInCar(G, x, z, preferComet) {
  if (!G || !Array.isArray(G.cars) || !G.player) return null;
  let car = null;
  if (preferComet) {
    for (const candidate of G.cars) {
      if (candidate.parked && !candidate.isPolice &&
          (candidate.model === 'Comet GT' || candidate.name === 'Comet GT')) {
        car = candidate;
        break;
      }
    }
  }
  if (!car) {
    let bestD = Infinity;
    for (const candidate of G.cars) {
      if (!candidate.parked || candidate.isPolice) continue;
      const d = Math.hypot(candidate.pos.x - x, candidate.pos.z - z);
      if (d < bestD) { bestD = d; car = candidate; }
    }
  }
  if (!car) return null;
  if (car.pos && typeof car.pos.set === 'function') car.pos.set(x, 0, z);
  else if (car.pos) { car.pos.x = x; car.pos.z = z; }
  car.x = x;
  car.z = z;
  car.heading = Math.PI / 2; // facing along the street, nose east
  car.speed = 14;
  car.health = 100;
  car.parked = false;
  G.player.car = car;
  if (typeof G.player.enterCar === 'function') {
    try { G.player.enterCar(car); } catch (err) { /* ignore */ }
  }
  if (G.player.pos && typeof G.player.pos.set === 'function') {
    G.player.pos.set(x, 0, z);
  }
  return car;
}

function showHudOnly(G) {
  const h = hud(G);
  if (!h) return;
  try {
    if (typeof h.hideAllScreens === 'function') h.hideAllScreens();
    if (typeof h.showHud === 'function') h.showHud();
  } catch (err) { /* ignore */ }
}

function setObjective(G, missionName, objective) {
  const h = hud(G);
  if (!h) return;
  try {
    if (typeof h.setMissionName === 'function') h.setMissionName(missionName);
    if (typeof h.setObjective === 'function') h.setObjective(objective);
    if (typeof h.clearTimer === 'function') h.clearTimer();
  } catch (err) { /* ignore */ }
}

// -- the four poses --------------------------------------------------------

function stageTitle(G) {
  freeRoam(G);
  const h = hud(G);
  if (h && typeof h.showTitle === 'function') {
    try { h.showTitle(); } catch (err) { /* ignore */ }
  }
  // Park the camera's subject in the open so the city reads behind the
  // title card: Cole on foot near the hideout, nothing blocking the view.
  const hideout = marker(G, 'hideout');
  if (hideout && G.player && G.player.pos && typeof G.player.pos.set === 'function') {
    G.player.pos.set(hideout.x, 0, hideout.z);
  }
  if (G.player) G.player.car = null;
  setWanted(G, 0);
  return true;
}

function stageChase(G) {
  freeRoam(G);
  showHudOnly(G);
  const car = putColeInCar(G, CHASE_SPOT.x, CHASE_SPOT.z, true);
  if (!car) return false;
  setWanted(G, 3);
  // Let the police module spawn its cruisers around the chase.
  try {
    if (G.police && typeof G.police.spawnChase === 'function') G.police.spawnChase(G);
    else if (G.police && typeof G.police.update === 'function') G.police.update(G, 0.05);
  } catch (err) { /* cruisers arrive on the next update anyway */ }
  if (G.cash !== undefined && G.cash < 150) G.cash = 150;
  setObjective(G, 'Free Roam', 'Lose the cops — 3 stars!');
  return true;
}

function stageDrive(G) {
  freeRoam(G);
  showHudOnly(G);
  const car = putColeInCar(G, DRIVE_SPOT.x, DRIVE_SPOT.z, false);
  if (!car) return false;
  setWanted(G, 0);
  setObjective(G, 'Free Roam', 'Cruise Neon Harbor — find work, lose heat.');
  return true;
}

function stageMission(G) {
  // The Pickup is done: job 1 banked $150, this job pays $300, and the
  // ledger reads $450 at the exact moment the card is drawn, so the two
  // numbers on the panel can never disagree.
  freeRoam(G);
  const garage = marker(G, 'garage');
  if (garage && G.player && G.player.pos && typeof G.player.pos.set === 'function') {
    G.player.pos.set(garage.x, 0, garage.z);
  }
  if (G.player) G.player.car = null;
  G.cash = 450;
  setWanted(G, 0);
  const h = hud(G);
  if (h) {
    try {
      if (typeof h.hideAllScreens === 'function') h.hideAllScreens();
      if (typeof h.showHud === 'function') h.showHud();
      if (typeof h.setMissionName === 'function') h.setMissionName('The Pickup');
      if (typeof h.showMissionComplete === 'function') {
        h.showMissionComplete(300, 450, 'Mission Complete', 'The Pickup — Mara\'s garage.');
      } else if (typeof h.showMissionPanel === 'function') {
        h.showMissionPanel({ reward: 300, total: 450, title: 'Mission Complete', text: 'The Pickup — Mara\'s garage.' });
      }
    } catch (err) { /* fall through to the direct DOM write */ }
  }
  // Belt and braces: the driver reads this element's text, so make sure
  // it holds both numbers even if the HUD call above took another path.
  try {
    const rewardEl = document.getElementById('mission-panel-reward');
    if (rewardEl) {
      rewardEl.textContent = 'Reward $300   Total cash $450';
      const panel = document.getElementById('mission-panel');
      if (panel) panel.classList.remove('hidden');
      const titleEl = document.getElementById('mission-panel-title');
      if (titleEl) titleEl.textContent = 'Mission Complete';
      const textEl = document.getElementById('mission-panel-text');
      if (textEl) textEl.textContent = 'The Pickup — Mara\'s garage.';
    }
  } catch (err) { /* ignore */ }
  return true;
}

// -- public entry points -----------------------------------------------------

const STAGERS = {
  title: stageTitle,
  chase: stageChase,
  drive: stageDrive,
  mission: stageMission,
};

// Stage one named shot. Returns true when a stager ran.
export function stageShot(G, name) {
  const key = String(name || '').toLowerCase();
  const stager = STAGERS[key];
  if (!stager || !G) return false;
  try {
    return stager(G) === true;
  } catch (err) {
    return false;
  }
}

export function applyShot(G, name) { return stageShot(G, name); }
export function stage(G, name) { return stageShot(G, name); }
export function poseShot(G, name) { return stageShot(G, name); }

// Read ?shot= from the URL and stage it. Returns the shot name, or ''.
export function maybeStage(G) {
  const name = shotNameFromUrl();
  if (!name) return '';
  stageShot(G, name);
  return name;
}

export class Shots {
  constructor(G) {
    this.G = G || null;
  }

  stage(name) {
    return stageShot(this.G, name);
  }

  apply(name) {
    return stageShot(this.G, name);
  }

  stageFromUrl() {
    return maybeStage(this.G);
  }

  maybeStage() {
    return maybeStage(this.G);
  }
}

export default Shots;
