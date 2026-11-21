// Neon Harbor — story missions, taxi fares and courier runs.
// Five jobs in order, then free roam. A job's steps run in order; a step
// that is already satisfied the moment play resumes advances at once,
// so a save/continue that restores the player mid-step never stalls.
// Fresh rewrite for the gta6-01 resubmission.
import { dist2D, randInt, pick, clamp } from './state.js';
import { markTaxiClient, unmarkTaxiClient } from './pedestrians.js';

const MARKER_KEYS = [
  'bank', 'beach', 'docks', 'garage', 'hideout',
  'hospital', 'paintShop', 'showroom', 'warehouse',
];
const TAXI_OFFER_RANGE = 50;
const TAXI_PICKUP_RANGE = 8;
const TAXI_WAIT_SECONDS = 8;
const COURIER_TAKE_RANGE = 6;
const COURIER_TIME_LIMIT = 90;

function job(name, reward, briefing, completeText, steps) {
  return { name, reward, briefing, completeText, steps };
}

function nearMarker(w, key, range) {
  const m = w.markers[key];
  if (!m) return false;
  return dist2D(w.player.pos.x, w.player.pos.z, m.x, m.z) < range;
}

function drivingNear(w, key, range) {
  return !!w.player.car && nearMarker(w, key, range);
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.taxiCooldown = 2;
    if (!game.courier) {
      game.courier = { phase: 'none', pay: 0, dest: null, timeLeft: 0 };
    }
    this.jobs = [
      job(
        'First Wheels', 150,
        'Mara Quinn needs a car, no questions asked. Steal any parked car ' +
        'and bring it to her paint shop. The cops will notice — drive like it.',
        'First car delivered. Mara paid in full, no questions asked.',
        [
          {
            text: 'Steal a car',
            check: (w) => !!w.player.car,
          },
          {
            text: "Deliver the car to Mara's paint shop",
            target: 'paintShop',
            check: (w) => drivingNear(w, 'paintShop', 8),
            done: (w) => {
              if (w.player.car) w.player.car.owned = true;
              w.hud.showMessage('Mara: "Clean work. She is yours now."');
            },
          },
        ],
      ),
      job(
        'The Pickup', 300,
        'A buyer is waiting at Mara\'s garage and the car has to be ' +
        'spotless. Steal a car and deliver it to the garage — ' +
        'in one piece, if you can.',
        'The Pickup is done. Mara is already counting the buyer\'s money.',
        [
          {
            text: 'Steal a car',
            check: (w) => !!w.player.car,
          },
          {
            text: "Deliver the car to Mara's garage",
            target: 'garage',
            check: (w) => drivingNear(w, 'garage', 8),
            done: (w) => {
              if (w.player.car) w.player.car.owned = true;
            },
          },
        ],
      ),
      job(
        'Dockside Run', 250,
        'Crates came in at the docks and Dario Venn\'s crew is sniffing ' +
        'around them. Get to the docks, load up, and run the cargo to ' +
        'the warehouse before they do.',
        'Cargo delivered. The warehouse crew owes you one.',
        [
          {
            text: 'Drive to the docks',
            target: 'docks',
            check: (w) => nearMarker(w, 'docks', 10),
            done: (w) => w.hud.showMessage('Cargo loaded — go, before Venn\'s crew shows up.'),
          },
          {
            text: 'Deliver the cargo to the warehouse',
            target: 'warehouse',
            check: (w) => nearMarker(w, 'warehouse', 10),
          },
        ],
      ),
      job(
        'Hospital Run', 400,
        'One of Mara\'s drivers got clipped and Venn\'s boys are circling ' +
        'St. Aurelia Hospital. Get there, pick up the package, and bring ' +
        'it to the hideout. Expect company.',
        'Package delivered. Mara\'s driver is safe — for now.',
        [
          {
            text: 'Get to St. Aurelia Hospital',
            target: 'hospital',
            check: (w) => nearMarker(w, 'hospital', 10),
            done: (w) => {
              w.hud.showMessage('Package collected — Venn\'s crew is on you!');
              const hx = w.markers.hospital.x;
              const hz = w.markers.hospital.z;
              w.combat.spawnEnemy(w, hx + 12, hz + 6);
              w.combat.spawnEnemy(w, hx - 10, hz + 12);
              if (w.wanted < 1) w.police.addWanted(w, 1, 'hospital');
            },
          },
          {
            text: 'Bring the package to the hideout',
            target: 'hideout',
            check: (w) => nearMarker(w, 'hideout', 10),
          },
        ],
      ),
      job(
        'The Big One', 1000,
        'The Harbor Bank van runs the same route every night, and tonight ' +
        'it is ours. Get to the bank, take the van, run it to the ' +
        'warehouse — and lose the heat before you park it.',
        'The bank van is ours. Dario Venn just lost the harbor.',
        [
          {
            text: 'Get to the Harbor Bank',
            target: 'bank',
            check: (w) => nearMarker(w, 'bank', 10),
            done: (w) => {
              this.tagBankVan(w);
              w.hud.showMessage('There it is — take the van!');
            },
          },
          {
            text: 'Steal the bank van',
            target: 'bank',
            check: (w) => !!w.player.car && w.player.car === this.bankVan,
            done: (w) => {
              w.police.addWanted(w, 3, 'bankvan');
              w.hud.showMessage('The whole harbor is coming. Drive!');
            },
          },
          {
            text: 'Deliver the van to the warehouse',
            target: 'warehouse',
            check: (w) => !!w.player.car && w.player.car === this.bankVan &&
              nearMarker(w, 'warehouse', 10),
          },
          {
            text: 'Lose the heat',
            check: (w) => w.wanted === 0,
          },
        ],
      ),
    ];
    this.bankVan = null;
  }

  // ---------------------------------------------------------- story flow
  current(w) {
    return this.jobs[w.missionIndex] || null;
  }

  startMission(w, index) {
    w.missionIndex = index;
    w.missionStep = 0;
    w.missionActive = true;
    w.missionDone = false;
    w.missionTimer = 0;
    this.bankVan = null;
    const j = this.current(w);
    if (j) {
      this.enterStep(w);
      if (typeof w.showBriefing === 'function') w.showBriefing(j.name, j.briefing);
    }
  }

  restartMission(w) {
    const j = this.current(w);
    if (!j) return;
    if (w.player.car) {
      const exit = w.player.car;
      w.player.car = null;
      if (exit) exit.parked = true;
    }
    w.player.pos.set(w.markers.hideout.x, 0, w.markers.hideout.z);
    w.player.heading = 0;
    w.missionStep = 0;
    w.missionActive = true;
    w.missionDone = false;
    w.missionTimer = 0;
    this.bankVan = null;
    this.enterStep(w);
    if (typeof w.showBriefing === 'function') w.showBriefing(j.name, j.briefing);
  }

  enterStep(w) {
    const j = this.current(w);
    if (!j) return;
    const s = j.steps[w.missionStep];
    if (!s) return;
    w.hud.setMissionName(j.name);
    w.hud.setObjective(s.text);
    if (s.target && w.markers[s.target]) {
      w.beaconTarget = w.markers[s.target];
      w.beacon = w.markers[s.target];
    } else {
      w.beacon = null;
      w.beaconTarget = null;
    }
    if (typeof s.enter === 'function') s.enter(w);
  }

  activate(w) {
    // A mission that is current but not active starts the moment play
    // resumes — this is what picks a continued game back up.
    if (w.missionIndex >= this.jobs.length) return;
    if (w.missionActive) return;
    w.missionActive = true;
    w.missionDone = false;
    this.enterStep(w);
  }

  advanceStep(w) {
    const j = this.current(w);
    if (!j) return;
    const s = j.steps[w.missionStep];
    if (s && typeof s.done === 'function') s.done(w);
    w.missionStep += 1;
    if (w.missionStep >= j.steps.length) this.completeMission(w, j);
    else this.enterStep(w);
  }

  completeMission(w, j) {
    w.cash += j.reward;
    const total = w.cash;
    w.stats.missionsDone += 1;
    w.missionActive = false;
    w.missionDone = true;
    w.missionStep = 0;
    w.missionIndex += 1;
    w.beacon = null;
    w.beaconTarget = null;
    w.audio.missionComplete();
    w.hud.showMessage(`${j.name} complete — $${j.reward} banked.`);
    if (typeof w.showMissionCard === 'function') {
      w.showMissionCard('MISSION COMPLETE', j.completeText, j.reward, total);
    }
  }

  endingStats(w) {
    return `Missions complete: ${w.stats.missionsDone}/5  •  ` +
      `Cash: $${w.cash}  •  Cars stolen: ${w.stats.carsStolen}`;
  }

  setFreeRoam(w) {
    w.freeRoam = true;
    w.missionActive = false;
    w.beacon = null;
    w.beaconTarget = null;
    w.hud.setMissionName('Free Roam');
    w.hud.setObjective('Neon Harbor is yours — take fares, run parcels, stay loose.');
  }

  update(w, dt) {
    if (w.missionIndex < this.jobs.length && !w.freeRoam) this.activate(w);
    if (w.missionActive && w.mode === 'playing') {
      const j = this.current(w);
      if (j) {
        // A step already satisfied advances at once, up to a few steps a tick.
        for (let n = 0; n < 5; n++) {
          const s = j.steps[w.missionStep];
          if (!s) break;
          let ok = false;
          try { ok = !!s.check(w); } catch (err) { ok = false; }
          if (!ok) break;
          this.advanceStep(w);
          if (!w.missionActive) break;
        }
      }
    }
    this.updateTaxi(w, dt);
    this.updateCourier(w, dt);
  }

  // ------------------------------------------------------------ taxi job
  updateTaxi(w, dt) {
    const t = w.taxi;
    if (!t || !w.freeRoam) return;
    if (t.phase === 'none') {
      this.taxiCooldown -= dt;
      if (this.taxiCooldown > 0) return;
      this.taxiCooldown = 3;
      const client = this.findWalkerNear(w, TAXI_OFFER_RANGE);
      if (!client) return;
      t.client = client;
      t.phase = 'wait';
      t.waitTimer = TAXI_WAIT_SECONDS;
      t.fare = 0;
      t.dest = null;
      markTaxiClient(w, client);
      w.hud.showHint('Taxi fare waiting nearby — get a car and press T', 6);
      return;
    }
    if (t.phase === 'wait') {
      t.waitTimer -= dt;
      if (!t.client || t.waitTimer <= 0) this.cancelTaxi(w, 'The fare gave up and walked off.');
      return;
    }
    if (t.phase === 'ride') {
      if (!t.dest) return;
      const m = w.markers[t.dest.key];
      if (!m) return;
      if (w.player.car && dist2D(w.player.pos.x, w.player.pos.z, m.x, m.z) < 8) {
        const fare = t.fare;
        w.cash += fare;
        w.audio.cash();
        w.hud.showMessage(`Fare paid: $${fare}. Nice driving.`);
        w.beacon = null;
        w.beaconTarget = null;
        t.phase = 'none';
        t.client = null;
        t.dest = null;
        t.fare = 0;
        this.taxiCooldown = 4;
      }
    }
  }

  findWalkerNear(w, range) {
    let best = null;
    let bd = Infinity;
    for (const p of w.peds) {
      if (p.state !== 'walk') continue;
      const d = dist2D(p.pos.x, p.pos.z, w.player.pos.x, w.player.pos.z);
      if (d < range && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  tryTaxiPickup(w) {
    const t = w.taxi;
    if (!t || t.phase !== 'wait' || !t.client) return;
    if (!w.player.car) {
      w.hud.showMessage('You need a car to take the fare.');
      return;
    }
    const c = t.client;
    if (dist2D(w.player.pos.x, w.player.pos.z, c.pos.x, c.pos.z) > TAXI_PICKUP_RANGE) {
      w.hud.showMessage('Get closer to the fare first.');
      return;
    }
    unmarkTaxiClient(w, c);
    const destKey = pick(MARKER_KEYS.filter((k) => w.markers[k]));
    t.dest = { key: destKey };
    t.fare = 40 + randInt(0, 40);
    t.phase = 'ride';
    const m = w.markers[destKey];
    w.beaconTarget = m;
    w.beacon = m;
    w.hud.showMessage(`Fare: $${t.fare} — take them to ${destKey}. Follow the beacon.`);
    w.audio.chime();
  }

  cancelTaxi(w, message) {
    const t = w.taxi;
    if (!t) return;
    if (t.client) {
      try { unmarkTaxiClient(w, t.client); } catch (err) { /* already gone */ }
    }
    t.phase = 'none';
    t.client = null;
    t.dest = null;
    t.fare = 0;
    if (message) w.hud.showMessage(message);
  }

  // --------------------------------------------------------- courier job
  courierNear(w) {
    const c = w.courier;
    return !!c && c.phase === 'none' && !w.player.car &&
      nearMarker(w, 'docks', COURIER_TAKE_RANGE);
  }

  tryCourierTake(w) {
    const c = w.courier;
    if (!c || !this.courierNear(w)) return;
    const destKey = pick(MARKER_KEYS.filter((k) => k !== 'docks' && w.markers[k]));
    const dest = w.markers[destKey];
    const docks = w.markers.docks;
    const dist = dist2D(docks.x, docks.z, dest.x, dest.z);
    c.pay = clamp(60 + Math.round(dist / 6), 60, 120);
    c.dest = { key: destKey };
    c.phase = 'carry';
    c.timeLeft = COURIER_TIME_LIMIT;
    w.beaconTarget = dest;
    w.beacon = dest;
    w.missionTimer = COURIER_TIME_LIMIT;
    w.hud.showMessage(`Parcel taken — ${destKey} in 90 seconds, pays $${c.pay}.`);
    w.audio.chime();
  }

  updateCourier(w, dt) {
    const c = w.courier;
    if (!c || c.phase !== 'carry' || !c.dest) return;
    c.timeLeft -= dt;
    w.missionTimer = Math.max(0, c.timeLeft);
    if (c.timeLeft <= 0) {
      c.phase = 'none';
      c.dest = null;
      c.pay = 0;
      w.beacon = null;
      w.beaconTarget = null;
      w.missionTimer = 0;
      w.hud.showMessage('Courier run failed — the parcel went to someone else.');
      return;
    }
    const m = w.markers[c.dest.key];
    if (m && dist2D(w.player.pos.x, w.player.pos.z, m.x, m.z) < 8) {
      const pay = c.pay;
      w.cash += pay;
      w.audio.cash();
      w.hud.showMessage(`Parcel delivered — $${pay} earned.`);
      c.phase = 'none';
      c.dest = null;
      c.pay = 0;
      w.beacon = null;
      w.beaconTarget = null;
      w.missionTimer = 0;
    }
  }

  cancelCourier(w) {
    const c = w.courier;
    if (!c) return;
    c.phase = 'none';
    c.dest = null;
    c.pay = 0;
    c.timeLeft = 0;
    w.missionTimer = 0;
  }

  cancelSideJobs(w) {
    this.cancelTaxi(w);
    this.cancelCourier(w);
    w.beacon = null;
    w.beaconTarget = null;
  }

  // ------------------------------------------------------------ bank van
  tagBankVan(w) {
    let best = null;
    let bd = Infinity;
    for (const c of w.cars) {
      if (c.isPolice || c.parked === false) continue;
      const d = dist2D(c.pos.x, c.pos.z, w.markers.bank.x, w.markers.bank.z);
      if (c.isVan && d < bd) { bd = d; best = c; }
    }
    if (!best) {
      for (const c of w.cars) {
        if (c.isPolice) continue;
        const d = dist2D(c.pos.x, c.pos.z, w.markers.bank.x, w.markers.bank.z);
        if (d < bd) { bd = d; best = c; }
      }
    }
    if (best) {
      best.name = 'Bank Van';
      best.special = 'bankvan';
      this.bankVan = best;
    } else {
      this.bankVan = null;
    }
  }
}
