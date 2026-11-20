// Neon Harbor — screenshot staging.
//
// The game reads `?shot=` from the URL at launch and hands it here, so a
// screenshot run can open the game already posed: the title screen, Cole
// driving, a police chase, or the mission-complete card. Each pose uses
// the real game paths — stealing a real parked car, adding real wanted
// stars, paying out a real mission — so the picture shows the game as it
// actually plays, not a mock-up. The numbers on the mission card come
// from the same payout the player gets: cash 150 in, job two pays 300,
// total 450 out.

import { nearestCar, enterCar } from './vehicles.js';

const el = (id) => document.getElementById(id);

// Put Cole in the closest parked car to a point: walk him up beside it
// and use the same entry the E key uses. Falls back to the nearest car
// anywhere when nothing is parked close by, so a staged shot always has
// a car to drive.
function seatCole(game, x, z) {
  const cole = game.player;
  cole.pos.set(x, 0, z);
  let ride = nearestCar(game, cole.pos, 30);
  if (!ride) ride = nearestCar(game, cole.pos, 500);
  if (!ride) return null;
  cole.pos.set(ride.pos.x + 3, 0, ride.pos.z);
  enterCar(game, ride);
  return ride;
}

// Leave the menus and get the HUD up for an in-game shot.
function startPlaying(game) {
  el('title-screen').classList.add('hidden');
  el('briefing').classList.add('hidden');
  el('pause-menu').classList.add('hidden');
  game.hud.show();
  game.mode = 'playing';
}

function poseTitle(game) {
  game.mode = 'title';
  el('title-screen').classList.remove('hidden');
  game.hud.hide();
}

function poseDrive(game) {
  // A car on the long east road, heading south into the city.
  seatCole(game, 120, -60);
  game.missions.startMission(game, 0, false);
  startPlaying(game);
}

function poseChase(game) {
  seatCole(game, 60, 0);
  game.missions.startMission(game, 0, false);
  startPlaying(game);
  // Three stars: the street fills with cruisers over the next seconds,
  // and the siren comes up as they close in.
  game.police.addWanted(game, 3, 'The cops are on you!');
}

function poseMission(game) {
  // Job one already paid: 150 in the wallet. Finish job two through the
  // real payout, so the card reads its reward and its total from the
  // same ledger at the same moment — 300 and 450.
  game.cash = 150;
  game.missionIndex = 1;
  game.missionStep = 2;
  startPlaying(game);
  game.missions.completeMission(game);
}

// `shot` is the raw `?shot=` value: a word, or the old 1-4 numbering.
export function stageShot(game, shot) {
  const key = String(shot || '').trim().toLowerCase();
  if (key === 'title' || key === '2') {
    poseTitle(game);
  } else if (key === 'drive' || key === '3') {
    poseDrive(game);
  } else if (key === 'chase' || key === '1') {
    poseChase(game);
  } else if (key === 'mission' || key === '4') {
    poseMission(game);
  }
}
