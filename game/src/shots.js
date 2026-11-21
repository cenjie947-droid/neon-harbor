// Neon Harbor — screenshot staging: pose the live game for each of
// the four press shots (?shot=title|chase|drive|mission).
//
// These are real renders of the running game, never composites: the
// stager moves Cole, hands him a car, raises the heat or banks the
// mission cash, and then the normal frame loop draws the frame the
// camera captures. The mission card's own numbers are written by
// main.js from the same cash ledger, so the card and the staged cash
// can never disagree.
import { enterCar } from './vehicles.js';

function hideScreens() {
  for (const id of ['title-screen', 'briefing', 'pause-menu', 'busted-screen', 'wasted-screen', 'ending-screen']) {
    document.getElementById(id)?.classList.add('hidden');
  }
}

function nearestParkedCar(g, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const c of g.cars ?? []) {
    if (!c || !c.parked || c.isPolice) continue;
    const d = Math.hypot(c.pos.x - x, c.pos.z - z);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// Put Cole in the driver's seat of a parked car near (x, z), pointed
// down the nearest road, rolling at a gentle cruise so the shot has
// motion in it. Falls back to a direct assignment if the vehicles
// module's enter helper refuses the car.
function putColeInCar(g, x, z, speed = 11) {
  const car = nearestParkedCar(g, x, z);
  if (!car) return null;
  const hero = g.player;
  hero.pos.set(car.pos.x + 2.5, 0, car.pos.z);
  try {
    enterCar(g, car);
  } catch {
    hero.car = car;
    car.parked = false;
  }
  if (!hero.car) {
    hero.car = car;
    car.parked = false;
  }
  car.traffic = false;
  car.owned = true;
  // Point down the road the car sits on: roadAxis 'x' means the road
  // runs east-west, so head east; otherwise head north.
  car.heading = car.roadAxis === 'x' ? Math.PI / 2 : 0;
  car.speed = speed;
  if (car.mesh) {
    car.mesh.position.set(car.pos.x, 0, car.pos.z);
    car.mesh.rotation.set(0, car.heading, 0);
  }
  return car;
}

function startPlaying(g) {
  g.mode = 'playing';
  hideScreens();
  g.hud?.show?.();
  g.hud?.renderWeapon?.(g.player);
}

function stageTitle(g) {
  // The title screen over the orbiting city is already the shot; the
  // frame loop's title orbit does the camera work. Just make sure the
  // HUD is out of the way.
  g.hud?.hide?.();
}

function stageDrive(g) {
  startPlaying(g);
  const m = g.markers ?? {};
  const spot = m.showroom ?? m.garage ?? { x: 0, z: 0 };
  putColeInCar(g, spot.x, spot.z, 11);
  g.hud?.setMissionName?.('Free Roam');
  g.hud?.setObjective?.('Cruise Neon Harbor — the city is yours.');
  g.hud?.renderDrive?.(g.player);
}

function stageChase(g) {
  startPlaying(g);
  const m = g.markers ?? {};
  const spot = m.bank ?? { x: 0, z: 0 };
  putColeInCar(g, spot.x, spot.z, 13);
  // Three stars: cruisers spawn around Cole and close in while the
  // driver steps the world, so the shot catches the pursuit mid-chase.
  g.police?.addWanted?.(g, 3, 'shot');
  if (typeof g.wanted === 'number') g.wanted = Math.max(g.wanted, 3);
  g.hud?.setMissionName?.('The Big One');
  g.hud?.setObjective?.('Lose the heat — get to the hideout.');
  g.hud?.renderStars?.(g.wanted ?? 3);
  g.hud?.renderDrive?.(g.player);
}

function stageMission(g) {
  startPlaying(g);
  // Mission 2, The Pickup, is done: $300 on top of mission 1's $150.
  // The cash ledger is the single source for the card's total.
  g.cash = 450;
  g.missionIndex = 2;
  g.missionStep = 0;
  const m = g.markers ?? {};
  const spot = m.garage ?? { x: 0, z: 0 };
  putColeInCar(g, spot.x, spot.z, 0);
  const car = g.player.car;
  if (car) {
    car.speed = 0;
    car.health = car.maxHealth ?? 100;
  }
  g.hud?.setMissionName?.('The Pickup — Complete');
  g.hud?.setObjective?.('Package delivered to Mara’s garage.');
  g.hud?.renderCash?.(450);
  g.hud?.renderDrive?.(g.player);
}

export function stageShot(game, shot) {
  const g = game ?? null;
  if (!g) return;
  switch (shot) {
    case 'title':
      stageTitle(g);
      break;
    case 'drive':
      stageDrive(g);
      break;
    case 'chase':
      stageChase(g);
      break;
    case 'mission':
      stageMission(g);
      break;
    default:
      break;
  }
}
