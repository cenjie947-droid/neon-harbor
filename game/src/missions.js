// Neon Harbor — the story arc: five jobs Cole Vance runs for his fixer
// Mara Quinn while rival boss Dario Venn tries to shut him down. Every job
// is a short chain of beats (steal, drive, pick up, survive, deliver); each
// beat knows how to tell when it is done, and the chain drives the beacon,
// the briefing card, the timer and the payout. Payouts are fixed per job
// and the completion card always reads its two numbers from the same
// ledger, so the reward and the running total can never disagree.
//
// Free roam also has a taxi side job (see the Taxi section at the bottom):
// pick up a marked walker, drive them where they want to go, collect the
// fare. It is repeatable and never blocks the story.
import { dist2D, randInt, pick } from './state.js';
import { markTaxiClient, unmarkTaxiClient } from './pedestrians.js';

// Job data is written as compact rows — [name, reward, briefing, beats] —
// and normalised into objects at load time, so the story table stays
// readable without a wall of object literals. A beat row is
// [type, text, target, radius, seconds, wanted, car]; unused slots are null.
const JOB_ROWS = [
  [
    'First Wheels',
    150,
    'Mara Quinn: "Cole, welcome to Neon Harbor. First job is simple — grab any car on the street and bring it to the paint shop on Harbor Row. Don\'t scratch it. Actually, scratch it. I don\'t care."',
    [
      ['steal', 'Steal any car — walk up to one and press E', null, 0, 0, 0, null],
      ['drive', 'Drive the car to the paint shop', 'paintShop', 8, 0, 0, null],
    ],
  ],
  [
    'The Pickup',
    300,
    'Mara Quinn: "A package is waiting at the docks, Pier 9. Pick it up on foot, then get it back to my garage. Fast. The harbor cops get nosy after dark."',
    [
      ['drive', 'Drive to the docks', 'docks', 9, 0, 0, null],
      ['pickup', 'Get out and grab the package', 'docks', 5, 0, 0, null],
      ['timed', "Get the package to Mara's garage — 90 seconds!", 'garage', 9, 90, 0, null],
    ],
  ],
  [
    'Grand Theft Harbor',
    600,
    'Mara Quinn: "A yellow Comet GT is sitting in the showroom lot on Meridian. Dario Venn wants it too, so the cops will be all over you the second you take it. Steal it. Bring it to the garage."',
    [
      ['stealSpecific', 'Steal the yellow Comet GT from the showroom lot', null, 0, 0, 0, 'comet'],
      ['drive', 'Lose the heat and deliver the Comet GT to the garage', 'garage', 9, 0, 2, null],
    ],
  ],
  [
    'Dockside Heat',
    900,
    'Mara Quinn: "Venn\'s crew is holding my warehouse on the east docks. Go in loud. Take them all down, then get back to the hideout before the PD locks the whole pier down."',
    [
      ['goto', 'Go to the warehouse on the east docks', 'warehouse', 10, 0, 0, null],
      ['ambush', "Take down Venn's crew", null, 0, 0, 0, null],
      ['goto', 'Escape to the hideout', 'hideout', 9, 0, 0, null],
    ],
  ],
  [
    'The Big One',
    2500,
    'Mara Quinn: "This is it, Cole. The Harbor Bank van leaves at dusk. Take the van, punch through every roadblock Venn bought, and bring it to the hideout. Do this and we own this city."',
    [
      ['enterSpecific', 'Take the armored bank van', null, 0, 0, 0, 'bankvan'],
      ['drive', 'Drive the van to the hideout — through the roadblocks!', 'hideout', 10, 0, 4, null],
    ],
  ],
];

function normaliseJobs(rows) {
  return rows.map(([name, reward, briefing, beats]) => ({
    name,
    reward,
    briefing,
    steps: beats.map(([type, text, target, radius, seconds, wanted, car]) => ({
      type,
      text,
      target,
      radius,
      seconds,
      wanted,
      car,
    })),
  }));
}

// One entry per job, in story order. `reward` is what the job pays on top
// of whatever Cole already holds; `steps` run in order and the chain ends
// when the last one reports done.
export const MISSIONS = normaliseJobs(JOB_ROWS);

// How close Cole (or his car) has to be to a marker for a beat to count.
function atSpot(G, name, radius) {
  const spot = G.markers[name];
  if (!spot) return false;
  return dist2D(G.player.pos.x, G.player.pos.z, spot.x, spot.z) < radius;
}

// One checker per beat type. Returns 'done' when the beat is complete,
// 'fail' when it has blown its condition (only the timed beat can fail),
// anything else means "still in progress". The per-frame driver in
// Missions.update calls exactly one checker per frame.
const BEAT_RULES = {
  steal(G) {
    return G.player.car ? 'done' : null;
  },
  stealSpecific(G, step) {
    const car = G.player.car;
    return car && car.special === step.car ? 'done' : null;
  },
  enterSpecific(G, step) {
    const car = G.player.car;
    return car && car.special === step.car ? 'done' : null;
  },
  goto(G, step) {
    return atSpot(G, step.target, step.radius) ? 'done' : null;
  },
  drive(G, step) {
    return G.player.car && atSpot(G, step.target, step.radius) ? 'done' : null;
  },
  pickup(G, step) {
    if (G.player.car || !atSpot(G, step.target, step.radius)) return null;
    G.hud.showMessage('Package secured. The cops noticed — go!');
    G.police.addWanted(G, 1, 'You grabbed the package!');
    return 'done';
  },
  timed(G, step, dt) {
    G.missionTimer -= dt;
    const left = Math.max(0, Math.ceil(G.missionTimer));
    G.hud.setObjective(`${step.text} — ${left}s`);
    if (G.missionTimer <= 0) return 'fail';
    return G.player.car && atSpot(G, step.target, step.radius) ? 'done' : null;
  },
  ambush(G) {
    // The ambush beat is armed by setupBeat; it ends when the last gunman
    // is down. The live enemy list is the source of truth.
    return G.enemies.length === 0 ? 'done' : null;
  },
};

// Taxi destinations: named markers a fare might ask for, with the label
// the HUD shows.
const TAXI_SPOTS = [
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

export class Missions {
  constructor(G) {
    this.G = G;
    this.ambushArmed = false;
  }

  current() {
    return MISSIONS[this.G.missionIndex] || null;
  }

  currentBeat() {
    const job = this.current();
    return job ? job.steps[this.G.missionStep] || null : null;
  }

  update(G, dt) {
    if (!G.missionActive || G.mode !== 'playing') return;
    const beat = this.currentBeat();
    if (!beat) return;
    const check = BEAT_RULES[beat.type];
    if (!check) return;
    const result = check(G, beat, dt);
    if (result === 'done') this.advance(G);
    else if (result === 'fail') this.failMission(G, 'Too slow — the package window closed');
  }

  // (Re)start a job, optionally mid-chain. `showBriefing` pops Mara's card
  // and pauses the world until the player hits GO; staged screenshots and
  // restarts skip it.
  startMission(G, index, showBriefing = true, startStep = 0) {
    const job = MISSIONS[index];
    if (!job) {
      this.setFreeRoam(G);
      return;
    }
    G.missionIndex = index;
    G.missionStep = Math.max(0, Math.min(startStep | 0, job.steps.length - 1));
    G.missionActive = true;
    G.missionDone = false;
    G.missionTimer = 0;
    this.ambushArmed = false;
    G.hud.setMissionName(`Mission ${index + 1}: ${job.name}`);
    if (showBriefing) {
      G.mode = 'briefing';
      document.getElementById('briefing-title').textContent = `MISSION ${index + 1} — ${job.name}`;
      document.getElementById('briefing-text').textContent = job.briefing;
      document.getElementById('briefing').classList.remove('hidden');
    }
    this.setupBeat(G);
  }

  // Point the HUD and the beacon at the current beat, and run the beat's
  // one-time setup: spawn the ambush crew, floor the wanted level, arm the
  // countdown. Called on start and on every advance.
  setupBeat(G) {
    const beat = this.currentBeat();
    if (!beat) return;
    G.hud.setObjective(beat.text);
    const spot = beat.target ? G.markers[beat.target] : null;
    if (spot) {
      G.beacon.position.copy(spot);
      G.beacon.visible = true;
      G.beaconTarget = spot;
    } else {
      G.beacon.visible = false;
      G.beaconTarget = null;
    }
    if (beat.type === 'ambush' && !this.ambushArmed) {
      this.ambushArmed = true;
      const w = G.markers.warehouse;
      const posts = [
        [w.x + 8, w.z + 4],
        [w.x - 8, w.z + 6],
        [w.x + 4, w.z - 8],
        [w.x - 6, w.z - 6],
      ];
      for (const [x, z] of posts) G.combat.spawnEnemy(G, x, z);
      G.hud.showMessage("Ambush! Venn's crew is here — take them down!");
      G.audio.fail();
    }
    if (beat.wanted && G.wanted < beat.wanted) {
      G.police.addWanted(G, beat.wanted - G.wanted, 'The heat is on!');
    }
    if (beat.type === 'timed') G.missionTimer = beat.seconds;
  }

  applyStep(G) {
    this.setupBeat(G);
  }

  setFreeRoam(G) {
    G.missionActive = false;
    G.missionIndex = MISSIONS.length;
    G.missionStep = 0;
    G.beacon.visible = false;
    G.beaconTarget = null;
    G.hud.setMissionName('Free Roam');
    G.hud.setObjective('Neon Harbor is yours — explore, steal cars, stay out of trouble.');
  }

  // Move to the next beat, or pay out when the chain is finished.
  advance(G) {
    const job = this.current();
    if (!job) return;
    G.missionStep++;
    if (G.missionStep >= job.steps.length) {
      this.completeMission(G);
    } else {
      this.setupBeat(G);
      G.audio.chime();
    }
  }

  // The one place the payout numbers are written. Cash is credited first,
  // then the card reads the reward from the job and the total from the live
  // cash balance — both from the same moment, so the card can never show a
  // reward that does not add up to the total beside it.
  completeMission(G) {
    const job = this.current();
    if (!job) return;
    G.cash += job.reward;
    G.stats.missionsDone++;
    G.missionActive = false;
    G.beacon.visible = false;
    G.beaconTarget = null;
    G.audio.missionComplete();
    const finishedIndex = G.missionIndex;
    G.missionIndex++;
    G.missionStep = 0;
    G.save.save(G);
    if (G.missionIndex >= MISSIONS.length) {
      G.missionDone = true;
      G.mode = 'ending';
      document.getElementById('ending-stats').textContent =
        `Total earned: $${G.cash}  •  Cars stolen: ${G.stats.carsStolen}  •  Crimes: ${G.stats.crimes}`;
      document.getElementById('ending-screen').classList.remove('hidden');
      G.hud.setMissionName('Free Roam');
      G.hud.setObjective('Neon Harbor is yours — explore, steal cars, stay out of trouble.');
      return;
    }
    this.showCompletionCard(G, job, finishedIndex);
    G.mode = 'mission-complete';
  }

  // Fill the mission-complete card from the job and the live cash balance.
  // Exposed so screenshot staging can render the exact same card the real
  // payout path renders, instead of hand-writing its numbers.
  showCompletionCard(G, job, index = G.missionIndex) {
    document.getElementById('mission-panel-title').textContent = 'MISSION COMPLETE';
    document.getElementById('mission-panel-text').textContent = `${job.name} — nicely driven, Cole.`;
    document.getElementById('mission-panel-reward').textContent =
      `Reward: $${job.reward}  •  Total cash: $${G.cash}`;
    document.getElementById('mission-panel').classList.remove('hidden');
    G.hud.setMissionName(`Mission ${index + 1}: ${job.name}`);
  }

  // A blown beat restarts its job from the first beat, with the reason on
  // screen so the player knows why they are back at the start.
  failMission(G, reason) {
    G.hud.showMessage(`${reason} — mission restarted.`);
    G.audio.fail();
    this.startMission(G, G.missionIndex, false);
    G.mode = 'playing';
  }

  onEnemyKilled(G) {
    // Ambush progress is read live from G.enemies in update(); nothing to
    // bookkeep here.
  }

  // Busted and wasted share the same shape: lose a slice of the wallet,
  // stop the siren, show the screen. The respawn button does the rest.
  onBusted(G) {
    const loss = Math.min(G.cash, Math.max(25, Math.round(G.cash * 0.1)));
    G.cash -= loss;
    G.mode = 'busted';
    G.audio.fail();
    G.audio.setSiren(false);
    document.getElementById('busted-screen').classList.remove('hidden');
    G.hud.showMessage(`Busted! Bail cost you $${loss}.`);
  }

  onWasted(G) {
    const loss = Math.min(G.cash, Math.max(25, Math.round(G.cash * 0.1)));
    G.cash -= loss;
    G.mode = 'wasted';
    G.audio.fail();
    G.audio.setSiren(false);
    document.getElementById('wasted-screen').classList.remove('hidden');
    G.hud.showMessage(`Wasted! The hospital bill was $${loss}.`);
  }

  respawn(G) {
    const p = G.player;
    if (p.car) {
      p.car.speed = 0;
      p.car = null;
    }
    p.pos.set(G.markers.hideout.x, 0, G.markers.hideout.z);
    p.heading = 0;
    p.health = p.maxHealth;
    p.ammo = Math.max(6, p.ammo);
    G.police.clearWanted(G);
    this.cancelFare(G);
    G.save.save(G);
    document.getElementById('busted-screen').classList.add('hidden');
    document.getElementById('wasted-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.showMessage('Back on the street. Stay sharp, Cole.');
  }

  // ----- Taxi side job (free roam only) -----

  // Called every frame while playing in free roam. When no fare is waiting
  // and none is riding, a short wait timer runs and then a nearby walker
  // is marked as the next fare.
  updateTaxi(G, dt) {
    const taxi = G.taxi;
    if (G.missionActive || G.mode !== 'playing') return;
    if (taxi.phase === 'none') {
      taxi.waitTimer -= dt;
      if (taxi.waitTimer > 0) return;
      this.offerFare(G);
      return;
    }
    if (taxi.phase === 'ride' && taxi.dest) {
      // Arrival: the car has to be at the destination, not just Cole.
      if (G.player.car && atSpot(G, taxi.dest.key, 9)) {
        this.dropFare(G);
      }
    }
  }

  offerFare(G) {
    const taxi = G.taxi;
    const near = G.peds.filter(
      (ped) =>
        ped.state === 'walk' &&
        dist2D(ped.pos.x, ped.pos.z, G.player.pos.x, G.player.pos.z) < 70,
    );
    if (near.length === 0) {
      taxi.waitTimer = 5;
      return;
    }
    const client = markTaxiClient(G, pick(near));
    if (!client) {
      taxi.waitTimer = 5;
      return;
    }
    taxi.client = client;
    taxi.phase = 'wait';
    taxi.fare = 0;
    taxi.dest = null;
    G.hud.showMessage('A fare is waiting — look for the yellow marker. Walk up and press T.');
  }

  // The player pressed T next to the waiting fare. The walker climbs in
  // (their mesh leaves the street), a destination is picked, and the
  // beacon points the way.
  pickupFare(G) {
    const taxi = G.taxi;
    if (taxi.phase !== 'wait' || !taxi.client) return false;
    const client = taxi.client;
    if (dist2D(client.pos.x, client.pos.z, G.player.pos.x, G.player.pos.z) > 4) return false;
    const spot = pick(TAXI_SPOTS);
    taxi.dest = spot;
    taxi.fare = Math.round(randInt(40, 80) / 5) * 5;
    taxi.phase = 'ride';
    G.scene.remove(client.mesh);
    G.peds = G.peds.filter((ped) => ped !== client);
    const destPos = G.markers[spot.key];
    G.beacon.position.copy(destPos);
    G.beacon.visible = true;
    G.beaconTarget = destPos;
    G.hud.setObjective(`Taxi fare: drop your passenger at ${spot.label} — $${taxi.fare}`);
    G.hud.showMessage(`Fare picked up. Take them to ${spot.label}.`);
    return true;
  }

  dropFare(G) {
    const taxi = G.taxi;
    G.cash += taxi.fare;
    G.audio.cash();
    G.hud.showMessage(`Fare paid: $${taxi.fare}.`);
    G.beacon.visible = false;
    G.beaconTarget = null;
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 8;
    G.hud.setObjective('Neon Harbor is yours — explore, steal cars, stay out of trouble.');
  }

  // A fare waiting too long, or a busted/wasted respawn, cancels the job
  // cleanly so the next offer can come up fresh.
  cancelFare(G) {
    const taxi = G.taxi;
    if (taxi.client) unmarkTaxiClient(G, taxi.client);
    taxi.phase = 'none';
    taxi.client = null;
    taxi.dest = null;
    taxi.fare = 0;
    taxi.waitTimer = 10;
    G.beacon.visible = false;
    G.beaconTarget = null;
  }
}
