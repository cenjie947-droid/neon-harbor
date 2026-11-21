// Neon Harbor — story missions and side jobs.
//
// Five jobs in order, each built from small steps that run one after
// another: steal a car, reach a place, race a clock, survive an ambush,
// take out a crew. The reward and the running total on the mission
// card are read from the same ledger at the same moment, so the card
// can never show a reward that disagrees with the cash.
//
// Two repeatable side jobs run in free roam and never touch the story:
// the taxi fares (walk up to a waiting walker, press T, drive them
// over) and the new courier runs (walk up to the dispatcher at the
// docks, press C, carry a parcel against a 90-second clock). Getting
// busted or wasted cancels both cleanly.

import * as THREE from 'three';
import { clamp, rand, randInt, pick, dist2D } from './state.js';

const FREE_ROAM_INDEX = 5;
const TAXI_OFFER_RANGE = 14;
const TAXI_PICKUP_RANGE = 6;
const TAXI_DROPOFF_RANGE = 7;
const TAXI_OFFER_SECONDS = 8;
const COURIER_PICKUP_RANGE = 4.5;
const COURIER_DROPOFF_RANGE = 7;
const COURIER_SECONDS = 90;

// A job is a name, a cash reward, a briefing paragraph and a list of
// steps. A step is one beat: steal any car, steal one particular car,
// reach a marker, reach one before a clock runs out, walk into an
// ambush, or clear out the crew that ambushed you.
function job(name, reward, briefing, steps) {
  return { name, reward, briefing, steps };
}

export const MISSIONS = [
  job(
    'First Wheels',
    150,
    'Mara needs wheels for a job tonight, and she needs them cheap. Steal any car off the street and bring it to the paint shop so her crew can strip it down.',
    [
      { kind: 'steal', objective: 'Steal any car' },
      { kind: 'reach', marker: 'paintShop', radius: 7, objective: 'Deliver the car to the paint shop' },
    ],
  ),
  job(
    'The Pickup',
    300,
    'A package is waiting at the docks. Go get it, then race it back to Mara\u2019s garage. Venn\u2019s people know the route, so don\u2019t dawdle — ninety seconds from the docks to the garage.',
    [
      { kind: 'reach', marker: 'docks', radius: 8, objective: 'Pick up the package at the docks' },
      { kind: 'timed-reach', marker: 'garage', radius: 7, timer: 90, objective: 'Race the package to Mara\u2019s garage' },
    ],
  ),
  job(
    'Grand Theft Harbor',
    500,
    'The yellow Comet GT in the showroom lot is the fastest car in the city, and Dario Venn wants it too. Take it. The cops will not like it — expect company — and bring it to Mara\u2019s garage in one piece.',
    [
      { kind: 'stealModel', car: 'cometGT', objective: 'Steal the yellow Comet GT from the showroom' },
      { kind: 'reach', marker: 'garage', radius: 7, objective: 'Bring the Comet GT to Mara\u2019s garage' },
    ],
  ),
  job(
    'Dockside Heat',
    600,
    'Venn\u2019s crew is waiting for you at the warehouse. Walk in ready — they will not talk first. Deal with them, then get clear to the hideout before the rest of them show up.',
    [
      { kind: 'ambush', marker: 'warehouse', radius: 8, objective: 'Reach the warehouse' },
      { kind: 'eliminate', objective: 'Take out Venn\u2019s crew' },
      { kind: 'reach', marker: 'hideout', radius: 8, objective: 'Escape to the hideout' },
    ],
  ),
  job(
    'The Big One',
    1000,
    'This is the score. The Harbor Bank van is parked behind the bank, and the hideout is waiting. Take the van, drive it through whatever Venn throws at you, and bring it home.',
    [
      { kind: 'stealModel', car: 'bankVan', objective: 'Take the Harbor Bank van' },
      { kind: 'reach', marker: 'hideout', radius: 8, objective: 'Drive the van to the hideout' },
    ],
  ),
];

const TAXI_DESTS = ['bank', 'beach', 'garage', 'hideout', 'hospital', 'paintShop', 'showroom', 'spray', 'warehouse'];
const COURIER_DESTS = ['bank', 'beach', 'garage', 'hideout', 'hospital', 'paintShop', 'showroom', 'spray', 'warehouse'];

function el(id) {
  return document.getElementById(id);
}

function show(id) {
  const node = el(id);
  if (node) node.classList.remove('hidden');
}

function hide(id) {
  const node = el(id);
  if (node) node.classList.add('hidden');
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.taxiDiamond = null;
    this.courierDiamond = null;
    this.courierNpc = null;
    this.ambushFoes = [];
    this.lastCourierSecond = -1;
    if (!game.courier) {
      game.courier = { phase: 'none', pay: 0, client: null, dest: null, timer: 0, waitTimer: 0, npcPos: null };
    }
    this.buildCourierPost(game);
  }

  // The courier dispatcher stands by the docks with a green diamond
  // over his head and a parcel under his arm. He never moves, so the
  // job is always there when free roam starts.
  buildCourierPost(game) {
    const docks = game.markers && game.markers.docks;
    if (!docks || !game.scene) return;
    const x = docks.x + 8;
    const z = docks.z + 8;
    const group = new THREE.Group();
    const green = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8a878 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.1, 8), green);
    body.position.y = 0.95;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
    head.position.y = 1.75;
    head.castShadow = true;
    group.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 10), green);
    cap.position.y = 1.97;
    group.add(cap);
    const parcel = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xa8825a }),
    );
    parcel.position.set(0.42, 1.1, 0.2);
    parcel.castShadow = true;
    group.add(parcel);
    group.position.set(x, 0, z);
    game.scene.add(group);
    this.courierNpc = group;
    game.courier.npcPos = { x, z };
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      new THREE.MeshBasicMaterial({ color: 0x2eff8a }),
    );
    diamond.position.set(x, 3, z);
    game.scene.add(diamond);
    this.courierDiamond = diamond;
  }

  // -- story ---------------------------------------------------------------

  currentJob(w) {
    return MISSIONS[w.missionIndex] || null;
  }

  isFreeRoam(w) {
    return w.missionIndex >= FREE_ROAM_INDEX || !w.missionActive;
  }

  startMission(w, index) {
    const jobDef = MISSIONS[index];
    if (!jobDef) return;
    w.missionIndex = index;
    w.missionStep = 0;
    w.missionActive = true;
    w.missionDone = false;
    w.missionTimer = 0;
    this.ambushFoes = [];
    this.cancelSideJobs(w);
    if (w.hud) w.hud.setMissionName(jobDef.name);
    this.beginStep(w);
    this.showBriefing(w);
  }

  // Show the briefing for the mission in progress without resetting
  // the step — used when resuming from a save.
  showBriefing(w) {
    const jobDef = this.currentJob(w);
    if (!jobDef) return;
    const title = el('briefing-title');
    if (title) title.textContent = jobDef.name;
    const text = el('briefing-text');
    if (text) text.textContent = jobDef.briefing;
    show('briefing');
    w.mode = 'briefing';
  }

  beginStep(w) {
    const jobDef = this.currentJob(w);
    if (!jobDef) return;
    const step = jobDef.steps[w.missionStep];
    if (!step) return;
    w.missionTimer = step.timer || 0;
    if (step.marker && w.markers[step.marker]) {
      w.beaconTarget = { x: w.markers[step.marker].x, z: w.markers[step.marker].z };
    } else if (step.car && w[step.car]) {
      const car = w[step.car];
      w.beaconTarget = { x: car.pos.x, z: car.pos.z };
    } else {
      w.beaconTarget = null;
    }
    if (w.hud) w.hud.setObjective(step.objective);
  }

  stepDone(w, step) {
    const p = w.player;
    if (step.kind === 'steal') return !!p.car;
    if (step.kind === 'stealModel') return !!p.car && p.car === w[step.car];
    if (step.kind === 'reach' || step.kind === 'timed-reach' || step.kind === 'ambush') {
      const m = w.markers[step.marker];
      if (!m) return false;
      return dist2D(p.pos.x, p.pos.z, m.x, m.z) < (step.radius || 7);
    }
    if (step.kind === 'eliminate') {
      if (this.ambushFoes.length) {
        return this.ambushFoes.every((foe) => !w.enemies.includes(foe));
      }
      return w.enemies.length === 0;
    }
    return false;
  }

  onStepComplete(w, step) {
    if (step.kind === 'ambush') {
      // Venn's crew was waiting in the warehouse.
      const m = w.markers.warehouse;
      this.ambushFoes = [];
      const spots = [[-10, -8], [10, -10], [-12, 8], [12, 10]];
      for (const [dx, dz] of spots) {
        const foe = w.combat && w.combat.spawnEnemy(w, m.x + dx, m.z + dz);
        if (foe) this.ambushFoes.push(foe);
      }
      if (w.hud) w.hud.showMessage('Ambush! Venn\u2019s crew is here!');
      if (w.audio) w.audio.fail();
    }
    if (step.kind === 'stealModel' && w.missionIndex === 2) {
      // Lifting the Comet GT brings the whole department down.
      if (w.police) w.police.addWanted(w, 2, 'The cops are onto the Comet GT!');
    }
  }

  completeMission(w) {
    const jobDef = this.currentJob(w);
    if (!jobDef) return;
    w.cash += jobDef.reward;
    if (w.stats) w.stats.missionsDone += 1;
    // The job is done: the index moves on to the next job right away,
    // so the outside world reads the new mission the moment the card
    // appears. The card's CONTINUE button starts that job's briefing.
    w.missionIndex += 1;
    w.missionStep = 0;
    w.missionActive = false;
    w.missionTimer = 0;
    w.beaconTarget = null;
    if (w.audio) w.audio.missionComplete();
    if (w.audio) w.audio.cash();
    const title = el('mission-panel-title');
    if (title) title.textContent = 'MISSION COMPLETE';
    const text = el('mission-panel-text');
    if (text) text.textContent = `${jobDef.name} — nice driving, Cole. Mara has the take.`;
    const reward = el('mission-panel-reward');
    if (reward) reward.textContent = `Reward $${jobDef.reward} — Total cash $${w.cash}`;
    show('mission-panel');
    if (w.hud) w.hud.setObjective('Mission complete');
    w.mode = 'complete';
  }

  // The CONTINUE button on the mission card: next job, or the ending.
  // completeMission already moved the index on, so start that job.
  advanceMission(w) {
    hide('mission-panel');
    if (w.missionIndex < MISSIONS.length) {
      this.startMission(w, w.missionIndex);
      return;
    }
    w.missionIndex = FREE_ROAM_INDEX;
    w.missionStep = 0;
    w.missionActive = false;
    const stats = el('ending-stats');
    if (stats) {
      stats.textContent = `Missions completed: ${w.stats ? w.stats.missionsDone : 5} — Cash: $${w.cash} — Cars stolen: ${w.stats ? w.stats.carsStolen : 0}`;
    }
    show('ending-screen');
    w.mode = 'ending';
  }

  failMission(w, reason) {
    if (w.hud) w.hud.showMessage(reason);
    if (w.audio) w.audio.fail();
    this.startMission(w, w.missionIndex);
  }

  setFreeRoam(w) {
    w.missionIndex = FREE_ROAM_INDEX;
    w.missionStep = 0;
    w.missionActive = false;
    w.missionDone = true;
    w.missionTimer = 0;
    w.beaconTarget = null;
    if (w.hud) {
      w.hud.setMissionName('Free Roam');
      w.hud.setObjective('Free roam — taxi fares and courier runs pay cash.');
    }
  }

  // -- side jobs ------------------------------------------------------------

  cancelSideJobs(w) {
    const taxi = w.taxi;
    if (taxi) {
      if (taxi.client && taxi.phase === 'ride') taxi.client.state = 'walk';
      taxi.phase = 'none';
      taxi.client = null;
      taxi.dest = null;
      taxi.fare = 0;
    }
    if (this.taxiDiamond) this.taxiDiamond.visible = false;
    const courier = w.courier;
    if (courier) {
      courier.phase = 'none';
      courier.dest = null;
      courier.timer = 0;
      courier.pay = 0;
    }
    if (this.courierDiamond && this.courierNpc) this.courierDiamond.visible = true;
    if (!w.missionActive) w.beaconTarget = null;
  }

  // Taxi: a walker near the player starts waiting for a ride.
  updateTaxi(w, dt) {
    const taxi = w.taxi;
    if (!taxi) return;
    if (taxi.phase === 'none') {
      if (!this.isFreeRoam(w)) return;
      let best = null;
      let bestD = TAXI_OFFER_RANGE;
      for (const ped of w.peds) {
        if (ped.state !== 'walk') continue;
        const d = dist2D(ped.pos.x, ped.pos.z, w.player.pos.x, w.player.pos.z);
        if (d < bestD) {
          bestD = d;
          best = ped;
        }
      }
      if (best) {
        taxi.client = best;
        taxi.phase = 'wait';
        taxi.waitTimer = TAXI_OFFER_SECONDS;
        this.showTaxiDiamond(w);
        if (w.hud) w.hud.showMessage('Someone needs a ride — drive up and press T.');
      }
      return;
    }
    if (taxi.phase === 'wait') {
      taxi.waitTimer -= dt;
      this.moveTaxiDiamond(w);
      if (taxi.waitTimer <= 0) {
        taxi.phase = 'none';
        taxi.client = null;
        if (this.taxiDiamond) this.taxiDiamond.visible = false;
        if (w.hud) w.hud.showMessage('The fare found another ride.');
      }
      return;
    }
    if (taxi.phase === 'ride') {
      const dest = taxi.dest && w.markers[taxi.dest.key];
      if (taxi.client && w.player.car) {
        taxi.client.pos.copy(w.player.car.pos);
      }
      this.moveTaxiDiamond(w);
      if (dest && dist2D(w.player.pos.x, w.player.pos.z, dest.x, dest.z) < TAXI_DROPOFF_RANGE) {
        w.cash += taxi.fare;
        if (w.audio) w.audio.cash();
        if (w.hud) w.hud.showMessage(`Fare paid: $${taxi.fare}.`);
        if (taxi.client) {
          taxi.client.state = 'walk';
          taxi.client.pos.set(dest.x + 3, 0, dest.z + 2);
        }
        taxi.phase = 'done';
        taxi.doneTimer = 2;
        taxi.client = null;
        taxi.dest = null;
        w.beaconTarget = null;
        if (this.taxiDiamond) this.taxiDiamond.visible = false;
        if (w.hud) w.hud.setObjective('Free roam — taxi fares and courier runs pay cash.');
      }
      return;
    }
    if (taxi.phase === 'done') {
      taxi.doneTimer = (taxi.doneTimer || 0) - dt;
      if (taxi.doneTimer <= 0) taxi.phase = 'none';
    }
  }

  showTaxiDiamond(w) {
    if (!this.taxiDiamond) {
      this.taxiDiamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.7),
        new THREE.MeshBasicMaterial({ color: 0xffd23c }),
      );
      w.scene.add(this.taxiDiamond);
    }
    this.taxiDiamond.visible = true;
    this.moveTaxiDiamond(w);
  }

  moveTaxiDiamond(w) {
    if (!this.taxiDiamond || !w.taxi.client) return;
    const c = w.taxi.client;
    const bob = Math.sin(w.time * 3) * 0.25;
    this.taxiDiamond.position.set(c.pos.x, 3.1 + bob, c.pos.z);
    this.taxiDiamond.rotation.y += 0.05;
  }

  // Press T next to the waiting client, while driving, to pick them up.
  tryTaxiPickup(w) {
    const taxi = w.taxi;
    if (!taxi || taxi.phase !== 'wait' || !taxi.client) return false;
    if (!w.player.car) {
      if (w.hud) w.hud.showMessage('You need a car to take the fare.');
      return false;
    }
    if (dist2D(w.player.pos.x, w.player.pos.z, taxi.client.pos.x, taxi.client.pos.z) > TAXI_PICKUP_RANGE) {
      return false;
    }
    taxi.fare = 40 + randInt(0, 40);
    const key = pick(TAXI_DESTS);
    taxi.dest = { key };
    const dest = w.markers[key];
    w.beaconTarget = { x: dest.x, z: dest.z };
    taxi.client.state = 'riding';
    taxi.phase = 'ride';
    if (this.taxiDiamond) this.taxiDiamond.visible = false;
    if (w.hud) {
      w.hud.setObjective(`Taxi: drop the fare at ${dest.name} ($${taxi.fare})`);
      w.hud.showMessage(`Fare picked up — take them to ${dest.name}.`);
    }
    return true;
  }

  // Courier: a parcel from the docks, ninety seconds, pay by distance.
  updateCourier(w, dt) {
    const courier = w.courier;
    if (!courier) return;
    if (this.courierDiamond && this.courierNpc) {
      const bob = Math.sin(w.time * 2.4) * 0.3;
      this.courierDiamond.position.y = 3 + bob;
      this.courierDiamond.rotation.y += 0.04;
      this.courierDiamond.visible = courier.phase === 'none';
    }
    if (!this.isFreeRoam(w)) return;
    if (courier.phase !== 'carry') return;
    courier.timer -= dt;
    const dest = courier.dest && w.markers[courier.dest.key];
    const whole = Math.max(0, Math.ceil(courier.timer));
    if (whole !== this.lastCourierSecond && dest && w.hud) {
      this.lastCourierSecond = whole;
      w.hud.setObjective(`Courier: deliver to ${dest.name} — ${whole}s ($${courier.pay})`);
    }
    if (dest && dist2D(w.player.pos.x, w.player.pos.z, dest.x, dest.z) < COURIER_DROPOFF_RANGE) {
      w.cash += courier.pay;
      if (w.audio) w.audio.cash();
      if (w.hud) {
        w.hud.showMessage(`Parcel delivered: $${courier.pay}.`);
        w.hud.setObjective('Free roam — taxi fares and courier runs pay cash.');
      }
      courier.phase = 'none';
      courier.dest = null;
      courier.timer = 0;
      courier.pay = 0;
      w.beaconTarget = null;
      return;
    }
    if (courier.timer <= 0) {
      if (w.hud) w.hud.showMessage('Delivery failed — the parcel went back to the docks.');
      courier.phase = 'none';
      courier.dest = null;
      courier.timer = 0;
      courier.pay = 0;
      w.beaconTarget = null;
    }
  }

  // Press C on foot next to the dispatcher to take a parcel.
  tryCourierPickup(w) {
    const courier = w.courier;
    if (!courier || courier.phase !== 'none' || !courier.npcPos) return false;
    if (!this.isFreeRoam(w)) return false;
    if (w.player.car) {
      if (w.hud) w.hud.showMessage('Get out of the car to take the parcel.');
      return false;
    }
    if (dist2D(w.player.pos.x, w.player.pos.z, courier.npcPos.x, courier.npcPos.z) > COURIER_PICKUP_RANGE) {
      return false;
    }
    const key = pick(COURIER_DESTS);
    const dest = w.markers[key];
    const run = dist2D(courier.npcPos.x, courier.npcPos.z, dest.x, dest.z);
    courier.pay = 60 + Math.min(60, Math.round(run * 0.15));
    courier.dest = { key };
    courier.timer = COURIER_SECONDS;
    courier.phase = 'carry';
    this.lastCourierSecond = COURIER_SECONDS;
    w.beaconTarget = { x: dest.x, z: dest.z };
    if (w.hud) {
      w.hud.setObjective(`Courier: deliver to ${dest.name} — ${COURIER_SECONDS}s ($${courier.pay})`);
      w.hud.showMessage(`Parcel taken — ${dest.name} in ${COURIER_SECONDS} seconds for $${courier.pay}.`);
    }
    return true;
  }

  // -- per-frame --------------------------------------------------------------

  update(w, dt) {
    if (w.missionActive) {
      const jobDef = this.currentJob(w);
      const step = jobDef && jobDef.steps[w.missionStep];
      if (jobDef && step) {
        if (step.kind === 'timed-reach') {
          w.missionTimer -= dt;
          if (w.missionTimer <= 0) {
            this.failMission(w, 'Out of time — Mara gave the package to someone else.');
            return;
          }
        }
        if (this.stepDone(w, step)) {
          this.onStepComplete(w, step);
          w.missionStep += 1;
          if (w.missionStep >= jobDef.steps.length) {
            this.completeMission(w);
          } else {
            this.beginStep(w);
          }
        }
      }
    }
    this.updateTaxi(w, dt);
    this.updateCourier(w, dt);
  }
}
