// Neon Harbor — screenshot scenarios for ?shot= title/chase/drive/mission.
//
// main.js already does the heavy setup for each scenario (puts Cole in a
// car, sets the wanted level, fills the mission card). This stages the
// final frame: motion for the driving shots, cruisers in view for the
// chase, and the exact mission-complete card for the mission shot.
import { clamp } from './state.js';
import { enterCar } from './vehicles.js';

const $ = (id) => document.getElementById(id);
const showEl = (el) => el && el.classList.remove('hidden');
const hideEl = (el) => el && el.classList.add('hidden');

// The mission card must read exactly this: job 2 paid $300, and the
// $150 from job 1 was already banked, so the total is $450.
const MISSION_CARD_TEXT = 'Reward: $300  •  Total cash: $450';

// Put Cole in the nearest healthy parked car if he is on foot, facing
// down the closest road line so the shot reads as driving, not parked.
function ensureDrivingCar(w) {
  const p = w.player;
  if (!p) return null;
  if (p.car) return p.car;
  let best = null;
  let bestD = Infinity;
  for (const c of w.cars || []) {
    if (!c.parked || c.isPolice || c.health < 50) continue;
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  p.pos.set(best.pos.x + 2, 0, best.pos.z);
  enterCar(w, best);
  return best;
}

// Snap a heading to the nearest road axis so the car runs straight down
// a street instead of diagonally into a block.
function snapToRoad(heading) {
  const axes = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let best = axes[0];
  let bestD = Infinity;
  for (const a of axes) {
    let d = Math.abs(a - heading);
    while (d > Math.PI) d -= Math.PI * 2;
    d = Math.abs(d);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function stageDrive(w, chase) {
  const car = ensureDrivingCar(w);
  if (!car) return;
  car.heading = snapToRoad(car.heading);
  if (car.mesh) car.mesh.rotation.y = car.heading;
  // Rolling at a cruise so the frame shows a moving car, not a parked
  // one; the driver steps the world for six seconds after staging.
  car.speed = chase ? 17 : 13;
  if (w.player) w.player.camYaw = car.heading;
  if (w.hud) w.hud.show();
  if (chase) {
    if ((w.wanted || 0) < 3 && w.police) w.police.addWanted(w, 3, 'shot');
    // Two cruisers already on the road behind Cole, so the pursuit is
    // in the frame from the first stepped second.
    try {
      if (w.police && w.policeCars.length < 2) w.police.spawnCruiser(w);
      if (w.police && w.policeCars.length < 2) w.police.spawnCruiser(w);
    } catch (err) { /* cruisers arrive on their own during the drive */ }
  }
}

function stageMission(w) {
  // The card is the shot: reward and total from the same ledger.
  if (w.hud) w.hud.hide();
  const panel = $('mission-panel');
  const title = $('mission-panel-title');
  const reward = $('mission-panel-reward');
  if (title) title.textContent = 'MISSION COMPLETE';
  const text = $('mission-panel-text');
  if (text) text.textContent = 'The Comet GT is in Mara\'s garage. The Pickup is done.';
  if (reward) reward.textContent = MISSION_CARD_TEXT;
  showEl(panel);
  w.mode = 'card';
  // Frame the city behind the panel instead of a wall.
  if (w.camera) {
    w.camera.position.set(40, 34, 130);
    w.camera.lookAt(0, 0, 20);
  }
}

function stageTitle(w) {
  // The title screen orbits the city on its own; nothing to stage.
  if (w.hud) w.hud.hide();
}

export function stageShot(game, shot) {
  const w = game;
  if (!w || !shot) return;
  if (shot === 'chase') stageDrive(w, true);
  else if (shot === 'drive') stageDrive(w, false);
  else if (shot === 'mission') stageMission(w);
  else if (shot === 'title') stageTitle(w);
  // Clamp the camera inside the world whatever the scenario did.
  if (w.camera) {
    w.camera.position.x = clamp(w.camera.position.x, -260, 260);
    w.camera.position.z = clamp(w.camera.position.z, -260, 260);
  }
}
