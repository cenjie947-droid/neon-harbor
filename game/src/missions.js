// Neon Harbor — the story arc.
//
// Cole Vance runs five jobs for his fixer Mara Quinn while rival boss
// Dario Venn tries to shut him down. Each job is a short chain of beats
// — steal, drive, pick up, survive, deliver — and every beat knows how
// to tell when it is done. The chain drives the beacon, the briefing
// card, the countdown and the payout. Payouts are fixed per job, and the
// completion card reads its two numbers from the same ledger at the same
// moment, so the reward and the running total can never disagree with
// each other.
//
// Free roam also has a taxi side job (the Taxi section at the bottom):
// pick up a marked walker, drive them where they want to go, collect
// the fare. It repeats and never blocks the story.
import { dist2D, randInt, pick } from './state.js';
import {
  markTaxiClient,
  unmarkTaxiClient,
} from './pedestrians.js';

const byId = (id) => document.getElementById(id);

// Builders for the job table below. A step carries everything its
// checker needs: the kind of test, the objective line, the marker to
// aim at, how close counts, a countdown in seconds, a wanted floor, and
// the special car it is about.
function beat(type, text, target, radius, seconds, wanted, car) {
  const step = {};
  step.type = type;
  step.text = text;
  step.target = target;
  step.radius = radius;
  step.seconds = seconds;
  step.wanted = wanted;
  step.car = car;
  return step;
}

function job(name, reward, briefing, steps) {
  const entry = {};
  entry.name = name;
  entry.reward = reward;
  entry.briefing = briefing;
  entry.steps = steps;
  return entry;
}

// One entry per job, in story order. `reward` is what the job pays on top
// of whatever Cole already holds; `steps` run in order and the chain ends
// when the last one reports done.
export const MISSIONS = [
  job(
    'First Wheels',
    150,
    'Mara Quinn: "Cole, welcome to Neon Harbor. First job is simple — grab any car on the street and bring it to the paint shop on Harbor Row. Don\'t scratch it. Actually, scratch it. I don\'t care."',
    [
      beat('steal', 'Steal any car — walk up to one and press E', null, 0, 0, 0, null),
      beat('drive', 'Drive the car to the paint shop', 'paintShop', 8, 0, 0, null),
    ],
  ),
  job(
    'The Pickup',
    300,
    'Mara Quinn: "A package is waiting at the docks, Pier 9. Pick it up on foot, then get it back to my garage. Fast. The harbor cops get nosy after dark."',
    [
      beat('drive', 'Drive to the docks', 'docks', 9, 0, 0, null),
      beat('pickup', 'Get out and grab the package', 'docks', 5, 0, 0, null),
      beat('timed', "Get the package to Mara's garage — 90 seconds!", 'garage', 9, 90, 0, null),
    ],
  ),
  job(
    'Grand Theft Harbor',
    600,
    'Mara Quinn: "A yellow Comet GT is sitting in the showroom lot on Meridian. Dario Venn wants it too, so the cops will be all over you the second you take it. Steal it. Bring it to the garage."',
    [
      beat('stealSpecific', 'Steal the yellow Comet GT from the showroom lot', null, 0, 0, 0, 'comet'),
      beat('drive', 'Lose the heat and deliver the Comet GT to the garage', 'garage', 9, 0, 2, null),
    ],
  ),
  job(
    'Dockside Heat',
    900,
    'Mara Quinn: "Venn\'s crew is holding my warehouse on the east docks. Go in loud. Take them all down, then get back to the hideout before the PD locks the whole pier down."',
    [
      beat('goto', 'Go to the warehouse on the east docks', 'warehouse', 10, 0, 0, null),
      beat('ambush', "Take down Venn's crew", null, 0, 0, 0, null),
      beat('goto', 'Escape to the hideout', 'hideout', 9, 0, 0, null),
    ],
  ),
  job(
    'The Big One',
    2500,
    'Mara Quinn: "This is it, Cole. The Harbor Bank van leaves at dusk. Take the van, punch through every roadblock Venn bought, and bring it to the hideout. Do this and we own this city."',
    [
      beat('enterSpecific', 'Take the armored bank van', null, 0, 0, 0, 'bankvan'),
      beat('drive', 'Drive the van to the hideout — through the roadblocks!', 'hideout', 10, 0, 4, null),
    ],
  ),
];

// How close Cole (or his car) has to be to a marker for a beat to count.
function isNearSpot(w, key, radius) {
  const spot = w.markers[key];
  if (!spot) return false;
  return dist2D(w.player.pos.x, w.player.pos.z, spot.x, spot.z) < radius;
}

// What getting caught or killed costs: a tenth of the wallet, at least
// $25, never more than what Cole is carrying.
function bailCut(w) {
  const loss = Math.min(w.cash, Math.max(25, Math.round(w.cash * 0.1)));
  w.cash -= loss;
  return loss;
}

// Test the current beat. Returns 'done' when its beat is complete,
// 'fail' when it has blown its condition (only the timed beat can fail),
// and null while it is still in progress. The per-frame driver in
// Missions.update runs exactly one test per frame.
function testBeat(w, phase, dt) {
  switch (phase.type) {
    case 'steal':
      return w.player.car ? 'done' : null;
    case 'stealSpecific':
    case 'enterSpecific': {
      const car = w.player.car;
      return car && car.special === phase.car ? 'done' : null;
    }
    case 'goto':
      return isNearSpot(w, phase.target, phase.radius) ? 'done' : null;
    case 'drive':
      return w.player.car && isNearSpot(w, phase.target, phase.radius) ? 'done' : null;
    case 'pickup': {
      if (w.player.car) return null;
      if (!isNearSpot(w, phase.target, phase.radius)) return null;
      w.hud.showMessage('Package secured. The cops noticed — go!');
      w.police.addWanted(w, 1, 'You grabbed the package!');
      return 'done';
    }
    case 'timed': {
      w.missionTimer -= dt;
      const left = Math.max(0, Math.ceil(w.missionTimer));
      w.hud.setObjective(`${phase.text} — ${left}s`);
      if (w.missionTimer <= 0) return 'fail';
      return w.player.car && isNearSpot(w, phase.target, phase.radius) ? 'done' : null;
    }
    case 'ambush':
      // The ambush beat is armed by setupBeat; it ends when the last
      // gunman is down. The live enemy list is the source of truth.
      return w.enemies.length === 0 ? 'done' : null;
    default:
      return null;
  }
}

// Taxi destinations: named markers a fare might ask for, with the label
// the HUD shows.
const TAXI_STOPS = [
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

const ROAM_LINE = 'Neon Harbor is yours — explore, steal cars, stay out of trouble.';

export class Missions {
  constructor(game) {
    this.game = game;
    this.ambushArmed = false;
  }

  current() {
    const idx = this.game.missionIndex;
    if (idx < 0 || idx >= MISSIONS.length) return null;
    return MISSIONS[idx];
  }

  currentBeat() {
    const task = this.current();
    if (!task) return null;
    return task.steps[this.game.missionStep] || null;
  }

  update(w, dt) {
    if (!w.missionActive || w.mode !== 'playing') return;
    const phase = this.currentBeat();
    if (!phase) return;
    const result = testBeat(w, phase, dt);
    if (result === 'done') this.advance(w);
    if (result === 'fail') this.failMission(w, 'Too slow — the package window closed');
  }

  // (Re)start a job, optionally mid-chain. `showBriefing` pops Mara's card
  // and pauses the world until the player hits GO; staged screenshots and
  // restarts skip it.
  startMission(w, index, showBriefing = true, startStep = 0) {
    const task = MISSIONS[index];
    if (!task) {
      this.setFreeRoam(w);
      return;
    }
    w.missionIndex = index;
    let step = startStep | 0;
    if (step < 0) step = 0;
    const lastBeat = task.steps.length - 1;
    if (step > lastBeat) step = lastBeat;
    w.missionStep = step;
    w.missionActive = true;
    w.missionDone = false;
    w.missionTimer = 0;
    this.ambushArmed = false;
    w.hud.setMissionName(`Mission ${index + 1}: ${task.name}`);
    if (showBriefing) {
      w.mode = 'briefing';
      byId('briefing-title').textContent = `MISSION ${index + 1} — ${task.name}`;
      byId('briefing-text').textContent = task.briefing;
      byId('briefing').classList.remove('hidden');
    }
    this.setupBeat(w);
  }

  // Point the HUD and the beacon at the current beat, and run the beat's
  // one-time setup: spawn the ambush crew, floor the wanted level, arm the
  // countdown. Called on start and on every advance.
  setupBeat(w) {
    const phase = this.currentBeat();
    if (!phase) return;
    w.hud.setObjective(phase.text);
    const spot = phase.target ? w.markers[phase.target] : null;
    if (spot) {
      w.beacon.position.copy(spot);
      w.beacon.visible = true;
      w.beaconTarget = spot;
    } else {
      w.beacon.visible = false;
      w.beaconTarget = null;
    }
    if (phase.type === 'ambush' && !this.ambushArmed) {
      this.ambushArmed = true;
      const warehouse = w.markers.warehouse;
      const crew = [
        [8, 4],
        [-8, 6],
        [4, -8],
        [-6, -6],
      ];
      crew.forEach(([dx, dz]) => {
        w.combat.spawnEnemy(w, warehouse.x + dx, warehouse.z + dz);
      });
      w.hud.showMessage("Ambush! Venn's crew is here — take them down!");
      w.audio.fail();
    }
    if (phase.wanted > 0 && w.wanted < phase.wanted) {
      w.police.addWanted(w, phase.wanted - w.wanted, 'The heat is on!');
    }
    if (phase.type === 'timed') w.missionTimer = phase.seconds;
  }

  applyStep(w) {
    this.setupBeat(w);
  }

  setFreeRoam(w) {
    w.missionActive = false;
    w.missionIndex = MISSIONS.length;
    w.missionStep = 0;
    w.beacon.visible = false;
    w.beaconTarget = null;
    w.hud.setMissionName('Free Roam');
    w.hud.setObjective(ROAM_LINE);
  }

  // Move to the next beat, or pay out when the chain is finished.
  advance(w) {
    const task = this.current();
    if (!task) return;
    w.missionStep++;
    if (w.missionStep >= task.steps.length) {
      this.completeMission(w);
      return;
    }
    this.setupBeat(w);
    w.audio.chime();
  }

  // The one place the payout numbers are written. Cash is credited first,
  // then the card reads the reward from the job and the total from the live
  // cash balance — both from the same moment, so the card can never show a
  // reward that does not add up to the total beside it.
  completeMission(w) {
    const task = this.current();
    if (!task) return;
    const finishedIndex = w.missionIndex;
    w.cash += task.reward;
    w.stats.missionsDone++;
    w.missionActive = false;
    w.beacon.visible = false;
    w.beaconTarget = null;
    w.audio.missionComplete();
    w.missionIndex++;
    w.missionStep = 0;
    w.save.save(w);
    if (w.missionIndex < MISSIONS.length) {
      this.showCompletionCard(w, task, finishedIndex);
      w.mode = 'mission-complete';
      return;
    }
    w.missionDone = true;
    w.mode = 'ending';
    byId('ending-stats').textContent =
      `Total earned: $${w.cash}  •  Cars stolen: ${w.stats.carsStolen}  •  Crimes: ${w.stats.crimes}`;
    byId('ending-screen').classList.remove('hidden');
    w.hud.setMissionName('Free Roam');
    w.hud.setObjective(ROAM_LINE);
  }

  // Fill the mission-complete card from the job and the live cash balance.
  // Exposed so screenshot staging can render the exact same card the real
  // payout path renders, instead of hand-writing its numbers.
  showCompletionCard(w, task, index = w.missionIndex) {
    byId('mission-panel-title').textContent = 'MISSION COMPLETE';
    byId('mission-panel-text').textContent = `${task.name} — nicely driven, Cole.`;
    byId('mission-panel-reward').textContent =
      `Reward: $${task.reward}  •  Total cash: $${w.cash}`;
    byId('mission-panel').classList.remove('hidden');
    w.hud.setMissionName(`Mission ${index + 1}: ${task.name}`);
  }

  // A blown beat restarts its job from the first beat, with the reason on
  // screen so the player knows why they are back at the start.
  failMission(w, reason) {
    w.hud.showMessage(`${reason} — mission restarted.`);
    w.audio.fail();
    this.startMission(w, w.missionIndex, false);
    w.mode = 'playing';
  }

  onEnemyKilled(w) {
    // Ambush progress is read live from game.enemies in update(); nothing
    // to bookkeep here.
  }

  // Busted and wasted share the same shape: lose a slice of the wallet,
  // stop the siren, show the screen. The respawn button does the rest.
  onBusted(w) {
    const loss = bailCut(w);
    w.mode = 'busted';
    w.audio.fail();
    w.audio.setSiren(false);
    byId('busted-screen').classList.remove('hidden');
    w.hud.showMessage(`Busted! Bail cost you $${loss}.`);
  }

  onWasted(w) {
    const loss = bailCut(w);
    w.mode = 'wasted';
    w.audio.fail();
    w.audio.setSiren(false);
    byId('wasted-screen').classList.remove('hidden');
    w.hud.showMessage(`Wasted! The hospital bill was $${loss}.`);
  }

  respawn(w) {
    const hero = w.player;
    if (hero.car) {
      hero.car.speed = 0;
      hero.car = null;
    }
    hero.pos.set(w.markers.hideout.x, 0, w.markers.hideout.z);
    hero.heading = 0;
    hero.health = hero.maxHealth;
    hero.ammo = Math.max(6, hero.ammo);
    w.police.clearWanted(w);
    this.cancelFare(w);
    w.save.save(w);
    byId('busted-screen').classList.add('hidden');
    byId('wasted-screen').classList.add('hidden');
    w.mode = 'playing';
    w.hud.showMessage('Back on the street. Stay sharp, Cole.');
  }

  // ----- Taxi side job (free roam only) -----

  // Called every frame while playing in free roam. When no fare is waiting
  // and none is riding, a short wait timer runs and then a nearby walker
  // is marked as the next fare.
  updateTaxi(w, dt) {
    const taxi = w.taxi;
    if (w.missionActive || w.mode !== 'playing') return;
    if (taxi.phase === 'ride') {
      // Arrival: the car has to be at the destination, not just Cole.
      if (taxi.dest && w.player.car && isNearSpot(w, taxi.dest.key, 9)) {
        this.dropFare(w);
      }
      return;
    }
    if (taxi.phase !== 'none') return;
    taxi.waitTimer -= dt;
    if (taxi.waitTimer > 0) return;
    this.offerFare(w);
  }

  offerFare(w) {
    const taxi = w.taxi;
    const nearby = [];
    let i = 0;
    while (i < w.peds.length) {
      const ped = w.peds[i];
      i++;
      if (ped.state !== 'walk') continue;
      const d = dist2D(ped.pos.x, ped.pos.z, w.player.pos.x, w.player.pos.z);
      if (d >= 70) continue;
      nearby.push(ped);
    }
    if (nearby.length === 0) {
      taxi.waitTimer = 5;
      return;
    }
    const client = markTaxiClient(w, pick(nearby));
    if (!client) {
      taxi.waitTimer = 5;
      return;
    }
    taxi.client = client;
    taxi.phase = 'wait';
    taxi.fare = 0;
    taxi.dest = null;
    w.hud.showMessage('A fare is waiting — look for the yellow marker. Walk up and press T.');
  }

  // The player pressed T next to the waiting fare. The walker climbs in
  // (their mesh leaves the street), a destination is picked, and the
  // beacon points the way.
  pickupFare(w) {
    const taxi = w.taxi;
    if (taxi.phase !== 'wait' || !taxi.client) return false;
    const client = taxi.client;
    if (dist2D(client.pos.x, client.pos.z, w.player.pos.x, w.player.pos.z) > 4) return false;
    const stop = pick(TAXI_STOPS);
    taxi.dest = stop;
    taxi.fare = Math.round(randInt(40, 80) / 5) * 5;
    taxi.phase = 'ride';
    w.scene.remove(client.mesh);
    w.peds = w.peds.filter((ped) => ped !== client);
    const destPos = w.markers[stop.key];
    w.beacon.position.copy(destPos);
    w.beacon.visible = true;
    w.beaconTarget = destPos;
    w.hud.setObjective(`Taxi fare: drop your passenger at ${stop.label} — $${taxi.fare}`);
    w.hud.showMessage(`Fare picked up. Take them to ${stop.label}.`);
    return true;
  }

  dropFare(w) {
    const taxi = w.taxi;
    w.cash += taxi.fare;
    w.audio.cash();
    w.hud.showMessage(`Fare paid: $${taxi.fare}.`);
    w.beacon.visible = false;
    w.beaconTarget = null;
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 8;
    w.hud.setObjective(ROAM_LINE);
  }

  // A fare waiting too long, or a busted/wasted respawn, cancels the job
  // cleanly so the next offer can come up fresh.
  cancelFare(w) {
    const taxi = w.taxi;
    if (taxi.client) unmarkTaxiClient(w, taxi.client);
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 10;
    w.beacon.visible = false;
    w.beaconTarget = null;
  }
}
