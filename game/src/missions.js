// Neon Harbor — the story arc: five jobs Cole Vance runs for his fixer Mara
// Quinn while rival boss Dario Venn tries to shut him down. Every job is a
// short chain of beats (steal, drive, pick up, survive, deliver); each beat
// knows how to tell when it is done, and the chain drives the beacon, the
// briefing card, the timer and the payout. Payouts are fixed per job and the
// completion card always reads its two numbers from the same ledger, so the
// reward and the running total can never disagree.
import { dist2D } from './state.js';

// One entry per job, in story order. `reward` is what the job pays on top of
// whatever the player already holds; `steps` run in order and the chain ends
// when the last one reports done.
export const MISSIONS = [
  {
    name: 'First Wheels',
    reward: 150,
    briefing:
      'Mara Quinn: "Cole, welcome to Neon Harbor. First job is simple — grab any car on the street and bring it to the paint shop on Harbor Row. Don\'t scratch it. Actually, scratch it. I don\'t care."',
    steps: [
      { type: 'steal', text: 'Steal any car — walk up to one and press E' },
      { type: 'drive', target: 'paintShop', radius: 8, text: 'Drive the car to the paint shop' },
    ],
  },
  {
    name: 'The Pickup',
    reward: 300,
    briefing:
      'Mara Quinn: "A package is waiting at the docks, Pier 9. Pick it up on foot, then get it back to my garage. Fast. The harbor cops get nosy after dark."',
    steps: [
      { type: 'drive', target: 'docks', radius: 9, text: 'Drive to the docks' },
      { type: 'pickup', target: 'docks', radius: 5, text: 'Get out and grab the package' },
      { type: 'timed', target: 'garage', radius: 9, seconds: 90, text: "Get the package to Mara's garage — 90 seconds!" },
    ],
  },
  {
    name: 'Grand Theft Harbor',
    reward: 600,
    briefing:
      'Mara Quinn: "A yellow Comet GT is sitting in the showroom lot on Meridian. Dario Venn wants it too, so the cops will be all over you the second you take it. Steal it. Bring it to the garage."',
    steps: [
      { type: 'stealSpecific', car: 'comet', text: 'Steal the yellow Comet GT from the showroom lot' },
      { type: 'drive', target: 'garage', radius: 9, text: 'Lose the heat and deliver the Comet GT to the garage', wanted: 2 },
    ],
  },
  {
    name: 'Dockside Heat',
    reward: 900,
    briefing:
      'Mara Quinn: "Venn\'s crew is holding my warehouse on the east docks. Go in loud. Take them all down, then get back to the hideout before the PD locks the whole pier down."',
    steps: [
      { type: 'goto', target: 'warehouse', radius: 10, text: 'Go to the warehouse on the east docks' },
      { type: 'ambush', text: "Take down Venn's crew" },
      { type: 'goto', target: 'hideout', radius: 9, text: 'Escape to the hideout' },
    ],
  },
  {
    name: 'The Big One',
    reward: 2500,
    briefing:
      'Mara Quinn: "This is it, Cole. The Harbor Bank van leaves at dusk. Take the van, punch through every roadblock Venn bought, and bring it to the hideout. Do this and we own this city."',
    steps: [
      { type: 'enterSpecific', car: 'bankvan', text: 'Take the armored bank van' },
      { type: 'drive', target: 'hideout', radius: 10, text: 'Drive the van to the hideout — through the roadblocks!', wanted: 4 },
    ],
  },
];

// How close the player (or their car) has to be to a marker for a beat to
// count. Kept on the step so a beat can ask for a wider net than the default.
function nearMarker(G, name, radius) {
  const spot = G.markers[name];
  if (!spot) return false;
  return dist2D(G.player.pos.x, G.player.pos.z, spot.x, spot.z) < radius;
}

// One checker per beat type. Returns 'done' when the beat is complete,
// 'fail' when it has blown its condition (only the timed beat can fail),
// anything else means "still in progress". The per-frame driver in
// Missions.update calls exactly one checker per frame.
const BEAT_CHECKS = {
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
    return nearMarker(G, step.target, step.radius) ? 'done' : null;
  },
  drive(G, step) {
    return G.player.car && nearMarker(G, step.target, step.radius) ? 'done' : null;
  },
  pickup(G, step) {
    if (G.player.car || !nearMarker(G, step.target, step.radius)) return null;
    G.hud.showMessage('Package secured. The cops noticed — go!');
    G.police.addWanted(G, 1, 'You grabbed the package!');
    return 'done';
  },
  timed(G, step, dt) {
    G.missionTimer -= dt;
    const left = Math.max(0, Math.ceil(G.missionTimer));
    G.hud.setObjective(`${step.text} — ${left}s`);
    if (G.missionTimer <= 0) return 'fail';
    return G.player.car && nearMarker(G, step.target, step.radius) ? 'done' : null;
  },
  ambush(G) {
    // The ambush beat is armed by applyStep; it ends when the last gunman
    // is down. The live enemy list is the source of truth.
    return G.enemies.length === 0 ? 'done' : null;
  },
};

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
    this.applyStep(G);
  }

  // Point the HUD and the beacon at the current beat, and run the beat's
  // one-time setup: spawn the ambush crew, floor the wanted level, arm the
  // countdown. Called on start and on every advance.
  applyStep(G) {
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
      this.applyStep(G);
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

  update(G, dt) {
    if (!G.missionActive || G.mode !== 'playing') return;
    const beat = this.currentBeat();
    if (!beat) return;
    const check = BEAT_CHECKS[beat.type];
    if (!check) return;
    const result = check(G, beat, dt);
    if (result === 'done') this.advance(G);
    else if (result === 'fail') this.failMission(G, 'Too slow — the package window closed');
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
    G.save.save(G);
    document.getElementById('busted-screen').classList.add('hidden');
    document.getElementById('wasted-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.showMessage('Back on the street. Stay sharp, Cole.');
  }
}
