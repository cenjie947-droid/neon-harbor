// Neon Harbor — missions.js
//
// Five story jobs in order, plus the two free-roam side jobs (taxi fares
// and courier parcels) and the Pay N Spray marker key. The story never
// blocks the side jobs and the side jobs never block the story: side jobs
// only run while no story job is active, and being busted or wasted
// cancels them cleanly.
//
// Every step is a small object: the line the HUD shows, the map marker
// the beacon points at, an optional countdown, an optional on-enter
// hook, and a check that runs every tick. A job pays out the moment its
// last step checks true; the reward and the new cash total are read from
// the same ledger at the same moment, so the mission-complete card can
// never disagree with the cash on the HUD.
import * as THREE from 'three';
import { dist2D, randInt, pick } from './state.js';
import { markTaxiClient, unmarkTaxiClient } from './pedestrians.js';

const NEAR = 9;          // arrival radius for a mission marker, metres
const TAXI_FARE_MIN = 40;
const TAXI_FARE_MAX = 80;
const TAXI_WAIT = 8;     // seconds a taxi offer waits for Cole
const TAXI_PICKUP = 8;   // metres from the client to pick them up
const COURIER_TIME = 90; // seconds to run a parcel
const COURIER_PAY_MIN = 60;
const COURIER_PAY_MAX = 120;
const COURIER_PICKUP = 5;

// Markers a side-job destination may point at.
const FARE_MARKERS = [
  'bank', 'beach', 'garage', 'hideout', 'hospital', 'showroom', 'warehouse', 'docks',
];

// A story job: name, cash reward, briefing text, ordered steps.
function job(name, reward, briefing, steps) {
  return { name, reward, briefing, steps };
}

function step(text, marker, check, extra = {}) {
  return { text, marker, check, ...extra };
}

const nearMarker = (key, radius = NEAR) => (w) => {
  const m = w.markers[key];
  if (!m) return false;
  return dist2D(w.player.pos.x, w.player.pos.z, m.x, m.z) < radius;
};

const driving = (w) => !!w.player.car;
const drivingCar = (car) => (w) => w.player.car === car;

const JOBS = [
  job(
    'First Wheels', 150,
    'Mara Quinn has your first job, Cole. Steal any car off the street and '
    + 'bring it to the paint shop on the east side. No questions, no scratches '
    + 'you cannot explain. The shop pays $150 for clean wheels.',
    [
      step('Steal any car', null, driving),
      step('Deliver the car to the paint shop', 'paintShop',
        (w) => driving(w) && nearMarker('paintShop', 8)(w)),
    ],
  ),
  job(
    'The Pickup', 300,
    'A package is waiting at the docks and Mara wants it at her garage '
    + 'fast. Get in a car, grab the package, then race it back — you have '
    + 'two minutes once it is in your hands. $300 if it arrives in one piece.',
    [
      step('Get in a car', null, driving),
      step('Pick up the package at the docks', 'docks', nearMarker('docks')),
      step('Race the package back to Mara’s garage', 'garage',
        (w) => nearMarker('garage')(w), { timer: 120 }),
    ],
  ),
  job(
    'Grand Theft Harbor', 400,
    'Dario Venn keeps his yellow Comet GT on the showroom lot like a trophy. '
    + 'Steal it, lose the heat, and bring it to the hideout. The alarm will '
    + 'scream — drive like it. $400 for the Comet.',
    [
      step('Steal the yellow Comet GT from the showroom', 'showroom',
        (w) => drivingCar(w.cometGT)(w),
        {
          onEnter(w) {
            w.police.addWanted(w, 2, 'alarm');
            this.say(w, 'The showroom alarm is screaming — the cops are coming!');
          },
        }),
      step('Bring the Comet GT to the hideout', 'hideout',
        (w) => drivingCar(w.cometGT)(w) && nearMarker('hideout')(w)),
    ],
  ),
  job(
    'Dockside Heat', 500,
    'Venn’s crew is waiting for you at the warehouse by the docks, and they '
    + 'brought guns. Get there, survive the ambush, then slip away to the '
    + 'hideout. $500 — hazard pay, obviously.',
    [
      step('Get to the warehouse at the docks', 'warehouse', nearMarker('warehouse', 12)),
      step('Survive Venn’s ambush', 'warehouse',
        (w) => this._ambushSpawned && w.enemies.length === 0,
        {
          onEnter(w) {
            this._ambushSpawned = true;
            const base = w.markers.warehouse;
            const spots = [[-8, -6], [8, -6], [-8, 8], [8, 8]];
            for (const [dx, dz] of spots) {
              try { w.combat.spawnEnemy(w, base.x + dx, base.z + dz); } catch (err) { /* combat */ }
            }
            this.say(w, 'Ambush! Venn’s crew is here — fight back!');
          },
        }),
      step('Escape to the hideout', 'hideout', nearMarker('hideout')),
    ],
  ),
  job(
    'The Big One', 1000,
    'The Harbor Bank van. Take it, drive it straight through whatever '
    + 'roadblocks Venn bought, and bring it home to the hideout. Pull this '
    + 'off and Neon Harbor is yours. $1,000.',
    [
      step('Take the Harbor Bank van', 'bank',
        (w) => drivingCar(w.bankVan)(w),
        {
          onEnter(w) {
            w.police.addWanted(w, 3, 'bank');
            this.say(w, 'The bank van is hot — every cruiser in the city is coming!');
          },
        }),
      step('Drive the van through the roadblocks to the hideout', 'hideout',
        (w) => drivingCar(w.bankVan)(w) && nearMarker('hideout', 10)(w)),
    ],
  ),
];

export class Missions {
  constructor(game) {
    this.g = game;
    this.jobs = JOBS;
    this._current = null;       // job being played or just completed
    this._entered = false;      // current step's onEnter already ran
    this._ambushSpawned = false;
    this._taxiCooldown = 4;     // seconds until the first taxi offer
    this._dispatcher = null;    // courier dispatcher figure at the docks
  }

  // The job being played, or the one just completed (for the card text).
  get current() {
    return this._current;
  }

  isFinished() {
    return this.g.missionIndex >= this.jobs.length;
  }

  briefingFor(index) {
    const j = this.jobs[index];
    if (!j) return { title: 'FREE ROAM', text: 'No more jobs. The city is yours — keep driving.' };
    return { title: `JOB ${index + 1} — ${j.name.toUpperCase()}`, text: j.briefing };
  }

  // -- HUD helpers (all guarded: the HUD must never break a mission) -----
  say(w, msg) {
    try { w.hud.showMessage(msg); } catch (err) { /* hud optional */ }
  }

  objective(w, text) {
    try { w.hud.setObjective(text); } catch (err) { /* hud optional */ }
  }

  setBeacon(w, key) {
    if (!key || !w.markers[key]) {
      w.beacon = null;
      w.beaconTarget = null;
      return;
    }
    const m = w.markers[key];
    w.beaconTarget = m;
    w.beacon = { x: m.x, z: m.z };
  }

  // -- Story flow ---------------------------------------------------------
  startMission(index, stepIndex = 0) {
    const w = this.g;
    const j = this.jobs[index];
    if (!j) return;
    this._current = j;
    w.missionIndex = index;
    w.missionStep = stepIndex;
    w.missionActive = true;
    w.missionDone = false;
    w.missionTimer = 0;
    w.freeRoam = false;
    this._entered = false;
    this._ambushSpawned = false;
    try { w.hud.setMissionName(j.name); } catch (err) { /* hud */ }
    this.showStep(w);
  }

  showStep(w) {
    const j = this.jobs[w.missionIndex];
    if (!j) return;
    const s = j.steps[w.missionStep];
    if (!s) return;
    this.objective(w, s.text);
    this.setBeacon(w, s.marker);
    if (s.timer) w.missionTimer = s.timer;
  }

  restartMission(w) {
    w = w || this.g;
    const j = this.jobs[w.missionIndex];
    if (!j) return;
    this.clearAmbush(w);
    w.missionStep = 0;
    w.missionActive = true;
    w.missionTimer = 0;
    this._entered = false;
    this._ambushSpawned = false;
    this.showStep(w);
    this.say(w, `${j.name} — starting over.`);
  }

  clearAmbush(w) {
    for (const e of w.enemies || []) {
      try { if (e.mesh) w.scene.remove(e.mesh); } catch (err) { /* scene */ }
    }
    w.enemies = [];
  }

  // Called by main.js when the CONTINUE button on the mission card is
  // pressed. The index was already advanced by completeMission.
  nextAfterComplete() {
    if (this.isFinished()) return null;
    return this.briefingFor(this.g.missionIndex);
  }

  completeMission(w) {
    const j = this.jobs[w.missionIndex];
    if (!j) return;
    const reward = j.reward;
    w.cash += reward; // reward and total read from the same ledger
    w.stats.missionsDone += 1;
    w.missionActive = false;
    w.missionDone = true;
    w.missionTimer = 0;
    this._current = j;
    w.missionIndex += 1; // now points at the next job
    w.missionStep = 0;
    this.setBeacon(w, null);
    try { w.hud.setObjective(''); } catch (err) { /* hud */ }
    if (typeof w.onMissionComplete === 'function') w.onMissionComplete(reward, w.cash);
  }

  failMission(w, reason) {
    this.say(w, reason);
    try { w.audio.fail(); } catch (err) { /* best-effort */ }
    this.restartMission(w);
  }

  update(w, dt) {
    // Side jobs run only in free roam, never during a story job.
    if (!w.missionActive) {
      this.updateTaxi(w, dt);
      this.updateCourier(w, dt);
      return;
    }
    const j = this.jobs[w.missionIndex];
    if (!j) return;
    const s = j.steps[w.missionStep];
    if (!s) return;
    if (!this._entered) {
      this._entered = true;
      if (s.timer) w.missionTimer = s.timer;
      if (typeof s.onEnter === 'function') s.onEnter.call(this, w);
    }
    if (s.timer) {
      w.missionTimer -= dt;
      this.objective(w, `${s.text} — ${Math.max(0, Math.ceil(w.missionTimer))}s`);
      if (w.missionTimer <= 0) {
        this.failMission(w, 'Too slow — the job fell through. Starting over.');
        return;
      }
    }
    let done = false;
    try { done = s.check(w); } catch (err) { done = false; }
    if (!done) return;
    w.missionStep += 1;
    this._entered = false;
    try { w.audio.chime(); } catch (err) { /* best-effort */ }
    if (w.missionStep >= j.steps.length) {
      this.completeMission(w);
      return;
    }
    this.say(w, 'Step done — next: ' + j.steps[w.missionStep].text);
    this.showStep(w);
  }

  // -- Free roam: pause the story without losing it -----------------------
  setFreeRoam(w) {
    w.missionActive = false;
    w.freeRoam = true;
    this.setBeacon(w, null);
    try { w.hud.setMissionName('FREE ROAM'); } catch (err) { /* hud */ }
    this.objective(w, 'Free roam — press T for a taxi fare, C for a courier parcel.');
  }

  cancelSideJobs(w) {
    // Taxi: send the client away, drop the fare.
    if (w.taxi) {
      if (w.taxi.client) {
        try { unmarkTaxiClient(w, w.taxi.client); } catch (err) { /* peds */ }
      }
      w.taxi.phase = 'none';
      w.taxi.fare = 0;
      w.taxi.client = null;
      w.taxi.dest = null;
      w.taxi.waitTimer = TAXI_WAIT;
    }
    // Courier: the parcel is gone.
    if (w.courier) {
      w.courier.phase = 'none';
      w.courier.pay = 0;
      w.courier.dest = null;
      w.courier.timer = 0;
      w.courier.client = null;
    }
    this._taxiCooldown = 6;
    this.setBeacon(w, null);
    // A timed story step restarts its countdown after a respawn.
    if (w.missionActive) {
      this._entered = false;
      w.missionTimer = 0;
    }
  }

  // -- Taxi side job ------------------------------------------------------
  // A walker with a yellow diamond is waiting for a ride. Walk up in a
  // car, press T, follow the beacon, collect a $40–$80 fare.
  updateTaxi(w, dt) {
    const t = w.taxi;
    if (!t) return;
    if (t.phase === 'wait') {
      t.waitTimer -= dt;
      if (t.waitTimer <= 0) {
        if (t.client) {
          try { unmarkTaxiClient(w, t.client); } catch (err) { /* peds */ }
        }
        t.phase = 'none';
        t.client = null;
        this._taxiCooldown = 6;
      }
      return;
    }
    if (t.phase === 'ride') {
      // Bail out of the car mid-fare and the fare is gone.
      if (!w.player.car) {
        t.phase = 'none';
        t.fare = 0;
        t.dest = null;
        this.setBeacon(w, null);
        this.say(w, 'Fare cancelled — you left the car.');
        this._taxiCooldown = 8;
        return;
      }
      if (t.dest) {
        const m = w.markers[t.dest.key];
        if (m && dist2D(w.player.pos.x, w.player.pos.z, m.x, m.z) < NEAR) {
          const fare = t.fare;
          w.cash += fare;
          try { w.audio.cash(); } catch (err) { /* best-effort */ }
          this.say(w, `Fare paid — $${fare}.`);
          t.phase = 'none';
          t.fare = 0;
          t.dest = null;
          this.setBeacon(w, null);
          this._taxiCooldown = randInt(8, 16);
        }
      }
      return;
    }
    // No offer yet: wait for the cooldown, then flag a nearby walker.
    if (t.phase !== 'none') return;
    this._taxiCooldown -= dt;
    if (this._taxiCooldown > 0) return;
    const p = w.player.pos;
    let best = null;
    let bestD = 120;
    for (const ped of w.peds) {
      if (ped.state !== 'walk') continue;
      const d = dist2D(ped.pos.x, ped.pos.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = ped; }
    }
    if (!best) {
      this._taxiCooldown = 4;
      return;
    }
    try { markTaxiClient(w, best); } catch (err) { /* peds */ }
    t.client = best;
    t.phase = 'wait';
    t.waitTimer = TAXI_WAIT;
    t.fare = 0;
    t.dest = null;
  }

  taxiAction(w) {
    const t = w.taxi;
    if (!t || t.phase !== 'wait' || !t.client) return;
    if (!w.player.car) {
      this.say(w, 'You need a car to pick up a fare.');
      return;
    }
    const c = t.client;
    if (dist2D(w.player.pos.x, w.player.pos.z, c.pos.x, c.pos.z) > TAXI_PICKUP) {
      this.say(w, 'Get closer to the waiting passenger.');
      return;
    }
    // Pick a destination far enough to be a real ride.
    let destKey = null;
    for (let tries = 0; tries < 8 && !destKey; tries++) {
      const key = pick(FARE_MARKERS);
      const m = w.markers[key];
      if (m && dist2D(c.pos.x, c.pos.z, m.x, m.z) > 40) destKey = key;
    }
    if (!destKey) destKey = pick(FARE_MARKERS);
    t.fare = randInt(TAXI_FARE_MIN, TAXI_FARE_MAX);
    t.dest = { key: destKey };
    t.phase = 'ride';
    this.setBeacon(w, destKey);
    // The client gets in: take them off the street.
    try {
      if (c.mesh) w.scene.remove(c.mesh);
      if (c.marker) w.scene.remove(c.marker);
    } catch (err) { /* scene */ }
    const at = w.peds.indexOf(c);
    if (at !== -1) w.peds.splice(at, 1);
    t.client = null;
    this.objective(w, `Taxi fare $${t.fare} — drop them at ${destKey}.`);
    this.say(w, `Passenger aboard — $${t.fare} to ${destKey}. Follow the beacon.`);
  }

  // -- Courier side job ---------------------------------------------------
  // A dispatcher waits at the docks with a green diamond. Walk up on
  // foot, press C, run the parcel to the beacon within 90 seconds.
  // Pay $60–$120, scaled by the distance.
  dispatcher(w) {
    if (this._dispatcher) return this._dispatcher;
    const docks = w.markers.docks;
    if (!docks || !w.scene) return null;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e8b6a });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, 0.32), bodyMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xd9a066 }),
    );
    head.position.y = 1.6;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.12, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1d5c46 }),
    );
    cap.position.y = 1.8;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55),
      new THREE.MeshBasicMaterial({ color: 0x2bff7a }),
    );
    diamond.position.y = 2.5;
    group.add(body, head, cap, diamond);
    group.position.set(docks.x + 20, 0, docks.z + 2);
    w.scene.add(group);
    this._dispatcher = { group, diamond, x: docks.x + 20, z: docks.z + 2 };
    return this._dispatcher;
  }

  updateCourier(w, dt) {
    const c = w.courier;
    if (!c) return;
    const d = this.dispatcher(w);
    if (d) {
      d.diamond.rotation.y += dt * 2;
      d.diamond.position.y = 2.5 + Math.sin(w.time * 2) * 0.15;
    }
    if (c.phase !== 'deliver') return;
    c.timer -= dt;
    const dest = c.dest ? w.markers[c.dest.key] : null;
    if (c.timer <= 0) {
      c.phase = 'none';
      c.pay = 0;
      c.dest = null;
      this.setBeacon(w, null);
      this.say(w, 'Too slow — the parcel run expired.');
      return;
    }
    if (dest && dist2D(w.player.pos.x, w.player.pos.z, dest.x, dest.z) < NEAR) {
      const pay = c.pay;
      w.cash += pay;
      try { w.audio.cash(); } catch (err) { /* best-effort */ }
      this.say(w, `Parcel delivered — $${pay}.`);
      c.phase = 'none';
      c.pay = 0;
      c.dest = null;
      this.setBeacon(w, null);
    }
  }

  courierAction(w) {
    const c = w.courier;
    if (!c) return;
    if (w.missionActive) return; // never blocks a story job
    if (c.phase === 'deliver') {
      this.say(w, 'Already carrying a parcel — follow the beacon.');
      return;
    }
    const d = this.dispatcher(w);
    if (!d) return;
    if (w.player.car) {
      this.say(w, 'Get out of the car to take a parcel.');
      return;
    }
    if (dist2D(w.player.pos.x, w.player.pos.z, d.x, d.z) > COURIER_PICKUP) {
      this.say(w, 'Find the dispatcher at the docks — look for the green diamond.');
      return;
    }
    let destKey = null;
    for (let tries = 0; tries < 8 && !destKey; tries++) {
      const key = pick(FARE_MARKERS);
      const m = w.markers[key];
      if (m && key !== 'docks' && dist2D(d.x, d.z, m.x, m.z) > 40) destKey = key;
    }
    if (!destKey) destKey = 'hideout';
    const dest = w.markers[destKey];
    const run = dist2D(d.x, d.z, dest.x, dest.z);
    c.pay = Math.max(COURIER_PAY_MIN, Math.min(COURIER_PAY_MAX, 60 + Math.round(run * 0.25)));
    c.dest = { key: destKey };
    c.timer = COURIER_TIME;
    c.phase = 'deliver';
    this.setBeacon(w, destKey);
    this.objective(w, `Courier parcel $${c.pay} — deliver to ${destKey} in ${COURIER_TIME}s.`);
    this.say(w, `Parcel taken — $${c.pay} if it reaches ${destKey} in ${COURIER_TIME} seconds.`);
  }
}
