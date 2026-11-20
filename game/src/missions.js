// Neon Harbor — the story arc. Cole Vance runs five jobs for his fixer
// Mara Quinn while rival boss Dario Venn tries to shut him down. Each job
// is a short chain of beats — steal, drive, pick up, survive, deliver —
// and every beat knows how to tell when it is done. The chain drives the
// beacon, the briefing card, the countdown and the payout. Payouts are
// fixed per job, and the completion card reads its two numbers from the
// same ledger at the same moment, so the reward and the running total can
// never disagree with each other.
//
// Free roam also has a taxi side job (the Taxi section at the bottom):
// pick up a marked walker, drive them where they want to go, collect the
// fare. It repeats and never blocks the story.
import { dist2D, randInt, pick } from './state.js';
import {
  markTaxiClient,
  unmarkTaxiClient,
} from './pedestrians.js';

const el = (id) => document.getElementById(id);

// One entry per job, in story order. `reward` is what the job pays on top
// of whatever Cole already holds; `steps` run in order and the chain ends
// when the last one reports done. A step carries everything its checker
// needs: the kind of test, the objective line, the marker to aim at, how
// close counts, a countdown in seconds, a wanted floor, and the special
// car it is about.
export const MISSIONS = [
  {
    name: 'First Wheels',
    reward: 150,
    briefing:
      'Mara Quinn: "Cole, welcome to Neon Harbor. First job is simple — grab any car on the street and bring it to the paint shop on Harbor Row. Don\'t scratch it. Actually, scratch it. I don\'t care."',
    steps: [
      { type: 'steal', text: 'Steal any car — walk up to one and press E', target: null, radius: 0, seconds: 0, wanted: 0, car: null },
      { type: 'drive', text: 'Drive the car to the paint shop', target: 'paintShop', radius: 8, seconds: 0, wanted: 0, car: null },
    ],
  },
  {
    name: 'The Pickup',
    reward: 300,
    briefing:
      'Mara Quinn: "A package is waiting at the docks, Pier 9. Pick it up on foot, then get it back to my garage. Fast. The harbor cops get nosy after dark."',
    steps: [
      { type: 'drive', text: 'Drive to the docks', target: 'docks', radius: 9, seconds: 0, wanted: 0, car: null },
      { type: 'pickup', text: 'Get out and grab the package', target: 'docks', radius: 5, seconds: 0, wanted: 0, car: null },
      { type: 'timed', text: "Get the package to Mara's garage — 90 seconds!", target: 'garage', radius: 9, seconds: 90, wanted: 0, car: null },
    ],
  },
  {
    name: 'Grand Theft Harbor',
    reward: 600,
    briefing:
      'Mara Quinn: "A yellow Comet GT is sitting in the showroom lot on Meridian. Dario Venn wants it too, so the cops will be all over you the second you take it. Steal it. Bring it to the garage."',
    steps: [
      { type: 'stealSpecific', text: 'Steal the yellow Comet GT from the showroom lot', target: null, radius: 0, seconds: 0, wanted: 0, car: 'comet' },
      { type: 'drive', text: 'Lose the heat and deliver the Comet GT to the garage', target: 'garage', radius: 9, seconds: 0, wanted: 2, car: null },
    ],
  },
  {
    name: 'Dockside Heat',
    reward: 900,
    briefing:
      'Mara Quinn: "Venn\'s crew is holding my warehouse on the east docks. Go in loud. Take them all down, then get back to the hideout before the PD locks the whole pier down."',
    steps: [
      { type: 'goto', text: 'Go to the warehouse on the east docks', target: 'warehouse', radius: 10, seconds: 0, wanted: 0, car: null },
      { type: 'ambush', text: "Take down Venn's crew", target: null, radius: 0, seconds: 0, wanted: 0, car: null },
      { type: 'goto', text: 'Escape to the hideout', target: 'hideout', radius: 9, seconds: 0, wanted: 0, car: null },
    ],
  },
  {
    name: 'The Big One',
    reward: 2500,
    briefing:
      'Mara Quinn: "This is it, Cole. The Harbor Bank van leaves at dusk. Take the van, punch through every roadblock Venn bought, and bring it to the hideout. Do this and we own this city."',
    steps: [
      { type: 'enterSpecific', text: 'Take the armored bank van', target: null, radius: 0, seconds: 0, wanted: 0, car: 'bankvan' },
      { type: 'drive', text: 'Drive the van to the hideout — through the roadblocks!', target: 'hideout', radius: 10, seconds: 0, wanted: 4, car: null },
    ],
  },
];

// How close Cole (or his car) has to be to a marker for a beat to count.
function nearMarker(game, key, radius) {
  const spot = game.markers[key];
  if (!spot) return false;
  return dist2D(game.player.pos.x, game.player.pos.z, spot.x, spot.z) < radius;
}

// What getting caught or killed costs: a tenth of the wallet, at least
// $25, never more than what Cole is carrying.
function takeCut(game) {
  const loss = Math.min(game.cash, Math.max(25, Math.round(game.cash * 0.1)));
  game.cash -= loss;
  return loss;
}

// One checker per beat type. A checker answers 'done' when its beat is
// complete, 'fail' when it has blown its condition (only the timed beat
// can fail), and anything else while it is still in progress. The
// per-frame driver in Missions.update runs exactly one checker per frame.
const BEAT_CHECKS = {
  steal(game) {
    return game.player.car ? 'done' : null;
  },
  stealSpecific(game, step) {
    const ride = game.player.car;
    return ride && ride.special === step.car ? 'done' : null;
  },
  enterSpecific(game, step) {
    const ride = game.player.car;
    return ride && ride.special === step.car ? 'done' : null;
  },
  goto(game, step) {
    return nearMarker(game, step.target, step.radius) ? 'done' : null;
  },
  drive(game, step) {
    return game.player.car && nearMarker(game, step.target, step.radius) ? 'done' : null;
  },
  pickup(game, step) {
    if (game.player.car || !nearMarker(game, step.target, step.radius)) return null;
    game.hud.showMessage('Package secured. The cops noticed — go!');
    game.police.addWanted(game, 1, 'You grabbed the package!');
    return 'done';
  },
  timed(game, step, dt) {
    game.missionTimer -= dt;
    const left = Math.max(0, Math.ceil(game.missionTimer));
    game.hud.setObjective(`${step.text} — ${left}s`);
    if (game.missionTimer <= 0) return 'fail';
    return game.player.car && nearMarker(game, step.target, step.radius) ? 'done' : null;
  },
  ambush(game) {
    // The ambush beat is armed by setupBeat; it ends when the last gunman
    // is down. The live enemy list is the source of truth.
    return game.enemies.length === 0 ? 'done' : null;
  },
};

// Taxi destinations: named markers a fare might ask for, with the label
// the HUD shows.
const FARE_STOPS = [
  { key: 'garage', label: "Mara's garage" },
  { key: 'paintShop', label: 'the paint shop' },
  { key: 'docks', label: 'the docks' },
  { key: 'beach', label: 'the beach' },
  { key: 'hospital', label: 'St. Aurelia Hospital' },
  { key: 'bank', label: 'Harbor Bank' },
  { key: 'showroom', label: 'the showroom lot' },
  { key: 'hideout', label: 'the hideout' },
  { key: 'spray', label: 'the Pay N Spray' },
];

const FREE_ROAM_LINE = 'Neon Harbor is yours — explore, steal cars, stay out of trouble.';

export class Missions {
  constructor(game) {
    this.game = game;
    this.ambushArmed = false;
  }

  current() {
    const idx = this.game.missionIndex;
    return idx >= 0 && idx < MISSIONS.length ? MISSIONS[idx] : null;
  }

  currentBeat() {
    const job = this.current();
    if (!job) return null;
    const step = job.steps[this.game.missionStep];
    return step || null;
  }

  update(game, dt) {
    if (!game.missionActive || game.mode !== 'playing') return;
    const beat = this.currentBeat();
    if (!beat) return;
    const check = BEAT_CHECKS[beat.type];
    if (!check) return;
    const result = check(game, beat, dt);
    if (result === 'done') this.advance(game);
    else if (result === 'fail') this.failMission(game, 'Too slow — the package window closed');
  }

  // (Re)start a job, optionally mid-chain. `showBriefing` pops Mara's card
  // and pauses the world until the player hits GO; staged screenshots and
  // restarts skip it.
  startMission(game, index, showBriefing = true, startStep = 0) {
    const job = MISSIONS[index];
    if (!job) {
      this.setFreeRoam(game);
      return;
    }
    game.missionIndex = index;
    game.missionStep = Math.max(0, Math.min(startStep | 0, job.steps.length - 1));
    game.missionActive = true;
    game.missionDone = false;
    game.missionTimer = 0;
    this.ambushArmed = false;
    game.hud.setMissionName(`Mission ${index + 1}: ${job.name}`);
    if (showBriefing) {
      game.mode = 'briefing';
      el('briefing-title').textContent = `MISSION ${index + 1} — ${job.name}`;
      el('briefing-text').textContent = job.briefing;
      el('briefing').classList.remove('hidden');
    }
    this.setupBeat(game);
  }

  // Point the HUD and the beacon at the current beat, and run the beat's
  // one-time setup: spawn the ambush crew, floor the wanted level, arm the
  // countdown. Called on start and on every advance.
  setupBeat(game) {
    const beat = this.currentBeat();
    if (!beat) return;
    game.hud.setObjective(beat.text);
    const spot = beat.target ? game.markers[beat.target] : null;
    if (spot) {
      game.beacon.position.copy(spot);
      game.beacon.visible = true;
      game.beaconTarget = spot;
    } else {
      game.beacon.visible = false;
      game.beaconTarget = null;
    }
    if (beat.type === 'ambush' && !this.ambushArmed) {
      this.ambushArmed = true;
      const warehouse = game.markers.warehouse;
      const offsets = [
        [8, 4],
        [-8, 6],
        [4, -8],
        [-6, -6],
      ];
      for (const [dx, dz] of offsets) game.combat.spawnEnemy(game, warehouse.x + dx, warehouse.z + dz);
      game.hud.showMessage("Ambush! Venn's crew is here — take them down!");
      game.audio.fail();
    }
    if (beat.wanted && game.wanted < beat.wanted) {
      game.police.addWanted(game, beat.wanted - game.wanted, 'The heat is on!');
    }
    if (beat.type === 'timed') game.missionTimer = beat.seconds;
  }

  applyStep(game) {
    this.setupBeat(game);
  }

  setFreeRoam(game) {
    game.missionActive = false;
    game.missionIndex = MISSIONS.length;
    game.missionStep = 0;
    game.beacon.visible = false;
    game.beaconTarget = null;
    game.hud.setMissionName('Free Roam');
    game.hud.setObjective(FREE_ROAM_LINE);
  }

  // Move to the next beat, or pay out when the chain is finished.
  advance(game) {
    const job = this.current();
    if (!job) return;
    game.missionStep++;
    if (game.missionStep >= job.steps.length) {
      this.completeMission(game);
    } else {
      this.setupBeat(game);
      game.audio.chime();
    }
  }

  // The one place the payout numbers are written. Cash is credited first,
  // then the card reads the reward from the job and the total from the live
  // cash balance — both from the same moment, so the card can never show a
  // reward that does not add up to the total beside it.
  completeMission(game) {
    const job = this.current();
    if (!job) return;
    const finishedIndex = game.missionIndex;
    game.cash += job.reward;
    game.stats.missionsDone++;
    game.missionActive = false;
    game.beacon.visible = false;
    game.beaconTarget = null;
    game.audio.missionComplete();
    game.missionIndex++;
    game.missionStep = 0;
    game.save.save(game);
    if (game.missionIndex >= MISSIONS.length) {
      game.missionDone = true;
      game.mode = 'ending';
      el('ending-stats').textContent =
        `Total earned: $${game.cash}  •  Cars stolen: ${game.stats.carsStolen}  •  Crimes: ${game.stats.crimes}`;
      el('ending-screen').classList.remove('hidden');
      game.hud.setMissionName('Free Roam');
      game.hud.setObjective(FREE_ROAM_LINE);
      return;
    }
    this.showCompletionCard(game, job, finishedIndex);
    game.mode = 'mission-complete';
  }

  // Fill the mission-complete card from the job and the live cash balance.
  // Exposed so screenshot staging can render the exact same card the real
  // payout path renders, instead of hand-writing its numbers.
  showCompletionCard(game, job, index = game.missionIndex) {
    el('mission-panel-title').textContent = 'MISSION COMPLETE';
    el('mission-panel-text').textContent = `${job.name} — nicely driven, Cole.`;
    el('mission-panel-reward').textContent =
      `Reward: $${job.reward}  •  Total cash: $${game.cash}`;
    el('mission-panel').classList.remove('hidden');
    game.hud.setMissionName(`Mission ${index + 1}: ${job.name}`);
  }

  // A blown beat restarts its job from the first beat, with the reason on
  // screen so the player knows why they are back at the start.
  failMission(game, reason) {
    game.hud.showMessage(`${reason} — mission restarted.`);
    game.audio.fail();
    this.startMission(game, game.missionIndex, false);
    game.mode = 'playing';
  }

  onEnemyKilled(game) {
    // Ambush progress is read live from game.enemies in update(); nothing
    // to bookkeep here.
  }

  // Busted and wasted share the same shape: lose a slice of the wallet,
  // stop the siren, show the screen. The respawn button does the rest.
  onBusted(game) {
    const loss = takeCut(game);
    game.mode = 'busted';
    game.audio.fail();
    game.audio.setSiren(false);
    el('busted-screen').classList.remove('hidden');
    game.hud.showMessage(`Busted! Bail cost you $${loss}.`);
  }

  onWasted(game) {
    const loss = takeCut(game);
    game.mode = 'wasted';
    game.audio.fail();
    game.audio.setSiren(false);
    el('wasted-screen').classList.remove('hidden');
    game.hud.showMessage(`Wasted! The hospital bill was $${loss}.`);
  }

  respawn(game) {
    const cole = game.player;
    if (cole.car) {
      cole.car.speed = 0;
      cole.car = null;
    }
    cole.pos.set(game.markers.hideout.x, 0, game.markers.hideout.z);
    cole.heading = 0;
    cole.health = cole.maxHealth;
    cole.ammo = Math.max(6, cole.ammo);
    game.police.clearWanted(game);
    this.cancelFare(game);
    game.save.save(game);
    el('busted-screen').classList.add('hidden');
    el('wasted-screen').classList.add('hidden');
    game.mode = 'playing';
    game.hud.showMessage('Back on the street. Stay sharp, Cole.');
  }

  // ----- Taxi side job (free roam only) -----

  // Called every frame while playing in free roam. When no fare is waiting
  // and none is riding, a short wait timer runs and then a nearby walker
  // is marked as the next fare.
  updateTaxi(game, dt) {
    const taxi = game.taxi;
    if (game.missionActive || game.mode !== 'playing') return;
    if (taxi.phase === 'none') {
      taxi.waitTimer -= dt;
      if (taxi.waitTimer > 0) return;
      this.offerFare(game);
      return;
    }
    if (taxi.phase === 'ride' && taxi.dest) {
      // Arrival: the car has to be at the destination, not just Cole.
      if (game.player.car && nearMarker(game, taxi.dest.key, 9)) {
        this.dropFare(game);
      }
    }
  }

  offerFare(game) {
    const taxi = game.taxi;
    const nearby = [];
    for (const ped of game.peds) {
      if (ped.state !== 'walk') continue;
      if (dist2D(ped.pos.x, ped.pos.z, game.player.pos.x, game.player.pos.z) >= 70) continue;
      nearby.push(ped);
    }
    if (nearby.length === 0) {
      taxi.waitTimer = 5;
      return;
    }
    const client = markTaxiClient(game, pick(nearby));
    if (!client) {
      taxi.waitTimer = 5;
      return;
    }
    taxi.client = client;
    taxi.phase = 'wait';
    taxi.fare = 0;
    taxi.dest = null;
    game.hud.showMessage('A fare is waiting — look for the yellow marker. Walk up and press T.');
  }

  // The player pressed T next to the waiting fare. The walker climbs in
  // (their mesh leaves the street), a destination is picked, and the
  // beacon points the way.
  pickupFare(game) {
    const taxi = game.taxi;
    if (taxi.phase !== 'wait' || !taxi.client) return false;
    const client = taxi.client;
    if (dist2D(client.pos.x, client.pos.z, game.player.pos.x, game.player.pos.z) > 4) return false;
    const stop = pick(FARE_STOPS);
    taxi.dest = stop;
    taxi.fare = Math.round(randInt(40, 80) / 5) * 5;
    taxi.phase = 'ride';
    game.scene.remove(client.mesh);
    game.peds = game.peds.filter((ped) => ped !== client);
    const destPos = game.markers[stop.key];
    game.beacon.position.copy(destPos);
    game.beacon.visible = true;
    game.beaconTarget = destPos;
    game.hud.setObjective(`Taxi fare: drop your passenger at ${stop.label} — $${taxi.fare}`);
    game.hud.showMessage(`Fare picked up. Take them to ${stop.label}.`);
    return true;
  }

  dropFare(game) {
    const taxi = game.taxi;
    game.cash += taxi.fare;
    game.audio.cash();
    game.hud.showMessage(`Fare paid: $${taxi.fare}.`);
    game.beacon.visible = false;
    game.beaconTarget = null;
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 8;
    game.hud.setObjective(FREE_ROAM_LINE);
  }

  // A fare waiting too long, or a busted/wasted respawn, cancels the job
  // cleanly so the next offer can come up fresh.
  cancelFare(game) {
    const taxi = game.taxi;
    if (taxi.client) unmarkTaxiClient(game, taxi.client);
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 10;
    game.beacon.visible = false;
    game.beaconTarget = null;
  }
}
