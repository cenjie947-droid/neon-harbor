// Neon Harbor — missions: five story jobs + taxi / courier / street race.
// Written fresh for round 6 (v12). Owns the story-mission state machine,
// the repeatable free-roam side jobs, the beacon + objective feed, the
// mission-complete card, briefings and the ending screen. Money always
// moves through the one cash ledger on G; the card reads the reward and
// the total from that ledger at the same moment.
import * as THREE from 'three';
import * as cityMod from './city.js';

// Race start: the city module draws the checkered pad on the harbour
// straight and exposes it as RACE_PAD. A14 moved it to (30, 180); the
// gates are re-plotted from there — east along the straight, then south.
const FALLBACK_PAD = { x: 30, z: 180 };
const PAD = (cityMod.RACE_PAD && typeof cityMod.RACE_PAD.x === 'number')
  ? { x: cityMod.RACE_PAD.x, z: cityMod.RACE_PAD.z } : FALLBACK_PAD;
const GATES = [
  { x: 120, z: 180, tilt: Math.PI / 2 },
  { x: 180, z: 180, tilt: Math.PI / 2 },
  { x: 180, z: 60, tilt: 0 },
];
const RACE_SECONDS = 90;
const RACE_BASE_PAY = 100;
const RACE_PER_SECOND = 10;
const RACE_PAY_CAP = 200;

const MISSIONS = [
  {
    name: 'First Wheels',
    reward: 150,
    brief: 'Mara needs wheels. Steal any car off the street and bring it to the paint shop — no questions, no scratches if you can help it.',
  },
  {
    name: 'The Pickup',
    reward: 300,
    brief: 'A package is waiting at the docks. Grab it and race it back to Mara\'s garage before the clock runs out.',
  },
  {
    name: 'Grand Theft Harbor',
    reward: 400,
    brief: 'The yellow Comet GT is sitting in the showroom lot. Take it — and expect the whole harbor to notice.',
  },
  {
    name: 'Dockside Heat',
    reward: 500,
    brief: 'Dario\'s crew is waiting at the warehouse. Walk in, survive the ambush, and get out alive.',
  },
  {
    name: 'The Big One',
    reward: 800,
    brief: 'The Harbor Bank van. Take it, punch through the roadblocks, and bring it to the hideout. This is the one that sets us up.',
  },
];

const DEST_KEYS = ['bank', 'beach', 'garage', 'hideout', 'hospital', 'paintShop', 'showroom', 'warehouse', 'docks'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const $ = (id) => document.getElementById(id);
const showEl = (el) => { if (el) el.classList.remove('hidden'); };
const hideEl = (el) => { if (el) el.classList.add('hidden'); };

export function createMissions(G) {
  // ---- job state -------------------------------------------------------
  G.taxi = { phase: 'none', client: null, dest: null, destKey: '', fare: 0, offerTimer: 6, waitTimer: 0 };
  G.courier = { phase: 'none', dest: null, destKey: '', pay: 0, timer: 0 };
  G.race = { phase: 'none', gate: 0, timer: 0, pay: 0, countdown: 0 };
  G.racePad = { x: PAD.x, z: PAD.z };
  G.beacon = null;
  G.missionTimer = 0;
  G.mission = G.mission || 0;
  G.missionStep = G.missionStep || 0;
  G.missionActive = !!G.missionActive;

  // ---- race visuals ----------------------------------------------------
  let flagMesh = null;
  const ringMeshes = [];
  if (G.scene) {
    const flagGeo = new THREE.OctahedronGeometry(0.9);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x777777 });
    flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.position.set(PAD.x, 3.4, PAD.z);
    G.scene.add(flagMesh);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6),
      new THREE.MeshLambertMaterial({ color: 0xdddddd })
    );
    pole.position.set(PAD.x, 1.7, PAD.z);
    G.scene.add(pole);
    for (const g of GATES) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(4.2, 0.35, 10, 28),
        new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x8a6300 })
      );
      ring.position.set(g.x, 2.6, g.z);
      ring.rotation.y = g.tilt;
      ring.visible = false;
      G.scene.add(ring);
      ringMeshes.push(ring);
    }
  }

  // ---- small helpers ---------------------------------------------------
  function say(msg) {
    if (G.hud && typeof G.hud.addFeed === 'function') {
      try { G.hud.addFeed(msg); return; } catch (e) { /* fall through */ }
    }
    if (Array.isArray(G.feed)) G.feed.push(msg);
    else G.feed = [msg];
  }
  function callHud(name, ...args) {
    if (G.hud && typeof G.hud[name] === 'function') {
      try { G.hud[name](...args); } catch (e) { /* ignore */ }
    }
  }
  function setObjective(text) {
    G.objective = text;
    callHud('setObjective', text);
  }
  function setTimer(seconds) {
    G.missionTimer = seconds;
    callHud('setTimer', seconds);
  }
  function sfx(name, ...args) {
    if (G.audio && typeof G.audio[name] === 'function') {
      try { G.audio[name](...args); } catch (e) { /* cosmetic */ }
    }
  }
  function markerPos(key) {
    const m = G.markers[key];
    return m ? { x: m.x, z: m.z } : null;
  }
  function setBeacon(target) {
    if (!target) { G.beacon = null; return; }
    if (target.key) { const m = markerPos(target.key); G.beacon = m ? { x: m.x, z: m.z } : null; return; }
    if (typeof target.x === 'number' && typeof target.z === 'number') {
      G.beacon = { x: target.x, z: target.z };
    }
  }
  function nearPlayer(x, z, r) {
    return dist2(G.player.pos.x, G.player.pos.z, x, z) <= r;
  }
  function nearMarker(key, r) {
    const m = markerPos(key);
    return m ? nearPlayer(m.x, m.z, r) : false;
  }
  function inCar() { return !!G.player.car; }
  function isComet(car) {
    if (!car) return false;
    return !!car.special || /comet/i.test(car.name || '') || /comet/i.test(car.model || '');
  }
  function isVan(car) {
    if (!car) return false;
    return /van/i.test(car.name || '') || /van/i.test(car.model || '');
  }
  function addWanted(n, why) {
    if (G.police && typeof G.police.addWanted === 'function') {
      try { G.police.addWanted(G, n, why); } catch (e) { /* ignore */ }
    } else {
      G.wanted = clamp((G.wanted || 0) + n, 0, 5);
    }
  }
  function showBriefing(title, text) {
    if (typeof G.showBriefing === 'function') { G.showBriefing(title, text); return; }
    const t = $('briefing-title'), x = $('briefing-text');
    if (t) t.textContent = title;
    if (x) x.textContent = text;
    showEl($('briefing'));
    G.mode = 'briefing';
  }

  // ---- mission flow ----------------------------------------------------
  function armStep(mission, step) {
    // Re-arm beacon + objective for a mission/step without paying out or
    // re-showing the briefing (used on start and on Continue restores).
    switch (mission) {
      case 0:
        if (step === 0) { setObjective('Steal any car'); setBeacon(null); }
        else { setObjective('Deliver the car to the paint shop'); setBeacon({ key: 'paintShop' }); }
        break;
      case 1:
        if (step === 0) { setObjective('Grab the package at the docks'); setBeacon({ key: 'docks' }); }
        else { setObjective('Race the package to Mara\'s garage'); setBeacon({ key: 'garage' }); }
        break;
      case 2:
        if (step === 0) { setObjective('Steal the yellow Comet GT from the showroom'); setBeacon({ key: 'showroom' }); }
        else { setObjective('Deliver the Comet to Mara\'s garage'); setBeacon({ key: 'garage' }); }
        break;
      case 3:
        if (step === 0) { setObjective('Head to the warehouse'); setBeacon({ key: 'warehouse' }); }
        else if (step === 1) { setObjective('Survive the ambush'); setBeacon({ key: 'warehouse' }); }
        else { setObjective('Escape to the hideout'); setBeacon({ key: 'hideout' }); }
        break;
      case 4:
        if (step === 0) { setObjective('Get to the Harbor Bank'); setBeacon({ key: 'bank' }); }
        else { setObjective('Take the van to the hideout'); setBeacon({ key: 'hideout' }); }
        break;
      default:
        setObjective('Free roam — find work around the city');
        setBeacon(null);
    }
    setTimer(0);
  }

  function startMission(i) {
    G.mission = i;
    G.missionStep = 0;
    G.missionActive = true;
    G.freeRoam = false;
    G.missionTimer = 0;
    cancelSideJobs(true);
    armStep(i, 0);
    showBriefing(MISSIONS[i].name, MISSIONS[i].brief);
  }

  function restartMission() {
    cancelSideJobs(true);
    startMission(G.mission);
  }

  function completeMission(index, reward) {
    // Reward and total come from the same ledger at the same moment.
    G.cash = (G.cash || 0) + reward;
    const total = G.cash;
    G.mission = index + 1;
    G.missionStep = 0;
    G.missionActive = false;
    G.missionTimer = 0;
    setBeacon(null);
    setTimer(0);
    sfx('missionComplete');
    sfx('cash');
    say(`Job done — $${reward} banked`);
    showMissionCard(reward, total);
  }

  function showMissionCard(reward, total) {
    const title = MISSIONS[Math.max(0, Math.min(G.mission - 1, MISSIONS.length - 1))].name;
    if (G.hud && typeof G.hud.showMissionCard === 'function') {
      try { G.hud.showMissionCard(reward, total); } catch (e) { /* fall through to DOM */ }
    }
    const panel = $('mission-panel');
    if (panel && panel.classList.contains('hidden')) {
      const t = $('mission-panel-title');
      const x = $('mission-panel-text');
      const r = $('mission-panel-reward');
      if (t) t.textContent = `Mission complete — ${title}`;
      if (x) x.textContent = 'Mara is pleased. Take the next job when you are ready.';
      if (r) r.textContent = `Reward $${reward}   Total cash $${total}`;
      showEl(panel);
    }
    G.mode = 'card';
  }

  function advanceToNext() {
    if (G.mission >= MISSIONS.length) {
      const stats = $('ending-stats');
      if (stats) stats.textContent = `All five jobs done. Final cash: $${G.cash}. Neon Harbor is yours, Cole.`;
      showEl($('ending-screen'));
      hideEl($('hud'));
      G.mode = 'ending';
      setObjective('');
      return;
    }
    startMission(G.mission);
  }

  function failMission(msg) {
    say(msg);
    sfx('fail');
    restartMission();
  }

  // ---- story update ----------------------------------------------------
  let ambushSpawned = false;
  let ambushTimer = 0;

  function updateStory(dt) {
    const m = G.mission, s = G.missionStep;
    if (m === 0) {
      if (s === 0 && inCar()) { G.missionStep = 1; armStep(0, 1); say('Nice wheels — get it to the paint shop'); }
      else if (s === 1 && inCar() && nearMarker('paintShop', 7)) completeMission(0, MISSIONS[0].reward);
    } else if (m === 1) {
      if (s === 0 && nearMarker('docks', 9)) {
        G.missionStep = 1;
        G.missionTimer = 75;
        armStep(1, 1);
        say('Package grabbed — 75 seconds to the garage!');
      } else if (s === 1) {
        G.missionTimer -= dt;
        setTimer(Math.max(0, Math.ceil(G.missionTimer)));
        if (G.missionTimer <= 0) { failMission('Too slow — the package went cold. Mara wants another run.'); return; }
        if (nearMarker('garage', 7)) completeMission(1, MISSIONS[1].reward);
      }
    } else if (m === 2) {
      if (s === 0 && inCar() && isComet(G.player.car)) {
        G.missionStep = 1;
        armStep(2, 1);
        addWanted(2, 'comet');
        say('The Comet is yours — now lose the heat!');
        sfx('chime');
      } else if (s === 1 && inCar() && isComet(G.player.car) && nearMarker('garage', 7)) {
        completeMission(2, MISSIONS[2].reward);
      }
    } else if (m === 3) {
      if (s === 0 && nearMarker('warehouse', 10)) {
        G.missionStep = 1;
        armStep(3, 1);
        ambushSpawned = false;
        ambushTimer = 60;
        // Ask combat to plant the ambush crew; if it cannot, the timer
        // below still carries the beat as a straight survival hold.
        const spawned = trySpawnGang(4);
        ambushSpawned = spawned;
        say(spawned ? 'Ambush! Dario\'s crew is on you!' : 'It is quiet in here. Too quiet — hold on!');
        sfx('fail');
      } else if (s === 1) {
        ambushTimer -= dt;
        setTimer(Math.max(0, Math.ceil(ambushTimer)));
        const left = gangRemaining();
        if (left === 0 && ambushSpawned) {
          G.missionStep = 2;
          armStep(3, 2);
          say('Crew down — get to the hideout!');
        } else if (ambushTimer <= 0) {
          G.missionStep = 2;
          armStep(3, 2);
          say('You are still breathing — get to the hideout!');
        }
      } else if (s === 2 && nearMarker('hideout', 8)) {
        completeMission(3, MISSIONS[3].reward);
      }
    } else if (m === 4) {
      if (s === 0) {
        if (inCar() && isVan(G.player.car)) {
          G.missionStep = 1;
          armStep(4, 1);
          addWanted(3, 'bank van');
          say('The van is rolling — punch through to the hideout!');
        } else if (nearMarker('bank', 10)) {
          setObjective('Take the bank van');
        }
      } else if (s === 1 && inCar() && isVan(G.player.car) && nearMarker('hideout', 8)) {
        completeMission(4, MISSIONS[4].reward);
      }
    }
  }

  function trySpawnGang(count) {
    const w = markerPos('warehouse');
    if (!w || !G.combat) return false;
    const methods = ['spawnGang', 'spawnGunmen', 'spawnEnemies'];
    for (const name of methods) {
      if (typeof G.combat[name] === 'function') {
        try { G.combat[name](G, count, w); return true; } catch (e) { /* try next */ }
        try { G.combat[name](count, w.x, w.z); return true; } catch (e) { /* try next */ }
      }
    }
    return false;
  }
  function gangRemaining() {
    if (!G.combat || !Array.isArray(G.combat.enemies)) return -1;
    return G.combat.enemies.filter((e) => e && e.health > 0 && e.alive !== false).length;
  }

  // ---- taxi ------------------------------------------------------------
  function updateTaxi(dt) {
    const t = G.taxi;
    if (G.missionActive) return;
    if (t.phase === 'none') {
      t.offerTimer -= dt;
      if (t.offerTimer > 0) return;
      const walkers = (G.peds || []).filter((p) => p && p.state === 'walk' && !p.taxiClient);
      if (!walkers.length) { t.offerTimer = 5; return; }
      const client = pick(walkers);
      client.taxiClient = true;
      t.client = client;
      t.phase = 'wait';
      t.waitTimer = 8;
      say('Someone is hailing a cab — drive over');
    } else if (t.phase === 'wait') {
      t.waitTimer -= dt;
      if (!t.client || t.client.state === 'down') { clearTaxi(); t.offerTimer = 15; return; }
      if (t.waitTimer <= 0) {
        say('The customer gave up and walked off');
        clearTaxi();
        t.offerTimer = 15;
      }
    } else if (t.phase === 'ride') {
      if (!inCar()) { say('You left the car — fare cancelled'); clearTaxi(); t.offerTimer = 10; return; }
      const d = markerPos(t.destKey);
      if (d && nearPlayer(d.x, d.z, 7)) {
        G.cash = (G.cash || 0) + t.fare;
        say(`Fare paid — $${t.fare}`);
        sfx('cash');
        const fare = t.fare;
        clearTaxi();
        t.offerTimer = 12;
        setObjective('Free roam — find work around the city');
        return fare;
      }
    }
    return undefined;
  }
  function clearTaxi() {
    const t = G.taxi;
    if (t.client) t.client.taxiClient = false;
    t.client = null; t.dest = null; t.destKey = ''; t.fare = 0;
    t.phase = 'none';
    if (!G.missionActive && !(G.courier && G.courier.phase === 'run') &&
        !(G.race && (G.race.phase === 'run' || G.race.phase === 'countdown'))) {
      setBeacon(null);
    }
  }
  function tryTaxi() {
    const t = G.taxi;
    if (G.missionActive) return;
    if (t.phase !== 'wait' || !t.client) return;
    if (G.race && (G.race.phase === 'run' || G.race.phase === 'countdown')) return;
    if (G.courier && G.courier.phase === 'run') return;
    if (!inCar()) { say('You need a car to take the fare'); return; }
    if (dist2(G.player.pos.x, G.player.pos.z, t.client.pos.x, t.client.pos.z) > 7) return;
    const destKey = pick(DEST_KEYS.filter((k) => k !== 'docks'));
    const d = markerPos(destKey);
    if (!d) return;
    t.destKey = destKey;
    // The driver (and any reader) looks the destination up by key, so
    // the record carries it — a bare {x, z} leaves dest.key undefined
    // and the drop-off can never be found.
    t.dest = { x: d.x, z: d.z, key: destKey };
    const trip = dist2(t.client.pos.x, t.client.pos.z, d.x, d.z);
    t.fare = clamp(40 + Math.round(trip / 12), 40, 80);
    t.phase = 'ride';
    setBeacon({ key: destKey });
    setObjective(`Taxi fare — take them to ${destKey} ($${t.fare})`);
    say(`Taxi fare — take them to ${destKey}`);
  }

  // ---- courier ---------------------------------------------------------
  function dispatcherPosition() {
    const d = markerPos('docks');
    return d ? { x: d.x + 20, z: d.z } : null;
  }
  function updateCourier(dt) {
    const c = G.courier;
    if (c.phase !== 'run') return;
    c.timer -= dt;
    setTimer(Math.max(0, Math.ceil(c.timer)));
    if (c.timer <= 0) {
      say('Parcel run failed — out of time');
      sfx('fail');
      c.phase = 'none'; c.dest = null; c.destKey = '';
      setBeacon(null);
      setObjective('Free roam — find work around the city');
      return;
    }
    const d = markerPos(c.destKey);
    if (d && nearPlayer(d.x, d.z, 7)) {
      G.cash = (G.cash || 0) + c.pay;
      say(`Parcel delivered — $${c.pay}`);
      sfx('cash');
      c.phase = 'none'; c.dest = null; c.destKey = '';
      setBeacon(null);
      setObjective('Free roam — find work around the city');
    }
  }
  function tryCourier() {
    const c = G.courier;
    if (G.missionActive) return;
    if (c.phase !== 'none') return;
    if (G.race && (G.race.phase === 'run' || G.race.phase === 'countdown')) return;
    if (G.taxi && G.taxi.phase === 'ride') return;
    const dp = dispatcherPosition();
    if (!dp) return;
    if (dist2(G.player.pos.x, G.player.pos.z, dp.x, dp.z) > 6) return;
    const destKey = pick(DEST_KEYS.filter((k) => k !== 'docks'));
    const d = markerPos(destKey);
    if (!d) return;
    const trip = dist2(dp.x, dp.z, d.x, d.z);
    c.destKey = destKey;
    c.dest = d;
    c.pay = clamp(60 + Math.round(trip / 6), 60, 120);
    c.timer = 90;
    c.phase = 'run';
    setBeacon({ key: destKey });
    setObjective(`Courier run — deliver the parcel ($${c.pay})`);
    say('Parcel run — 90 seconds, follow the beacon');
  }

  // ---- street race -----------------------------------------------------
  function racePadNear() {
    const car = G.player.car;
    if (!car) return false;
    return dist2(car.pos.x, car.pos.z, PAD.x, PAD.z) <= 9;
  }
  function showGateRing(index) {
    ringMeshes.forEach((ring, i) => { ring.visible = i === index; });
  }
  function hideGateRings() {
    ringMeshes.forEach((ring) => { ring.visible = false; });
  }
  function tryRace() {
    const r = G.race;
    if (G.missionActive) return; // story missions: no hint, G does nothing
    if (r.phase !== 'none') return;
    if (!inCar()) return;
    if (!racePadNear()) return;
    if (G.taxi && G.taxi.phase === 'ride') return;
    if (G.courier && G.courier.phase === 'run') return;
    r.phase = 'countdown';
    r.countdown = 3.2;
    r.gate = 0;
    r.timer = 0;
    setObjective('Race starting in 3…');
    say('Street race — get ready!');
  }
  function cancelRace(msg) {
    const r = G.race;
    if (r.phase === 'none') return;
    r.phase = 'none';
    r.gate = 0;
    r.timer = 0;
    r.countdown = 0;
    hideGateRings();
    setBeacon(null);
    setObjective('Free roam — find work around the city');
    if (msg) say(msg);
  }
  function updateRace(dt) {
    const r = G.race;
    if (flagMesh) {
      flagMesh.rotation.y += dt * 1.8;
      flagMesh.position.y = 3.4 + Math.sin((G.time || 0) * 2) * 0.15;
    }
    const ring = ringMeshes[r.gate - 1];
    if (ring && ring.visible) {
      const pulse = 1 + Math.sin((G.time || 0) * 4) * 0.05;
      ring.scale.set(pulse, pulse, pulse);
    }
    if (r.phase === 'countdown') {
      if (!inCar()) { cancelRace('Race cancelled — you left the car'); return; }
      r.countdown -= dt;
      setObjective(`Race starting in ${Math.max(1, Math.ceil(r.countdown))}…`);
      if (r.countdown > 0) return;
      // GO: line the car up facing gate 1 so nobody starts backwards.
      const car = G.player.car;
      const g1 = GATES[0];
      car.heading = Math.atan2(g1.x - car.pos.x, g1.z - car.pos.z);
      G.player.camYaw = car.heading;
      r.phase = 'run';
      r.timer = RACE_SECONDS;
      r.gate = 1;
      setBeacon({ x: g1.x, z: g1.z });
      showGateRing(0);
      setObjective('Gate 1/3 — 90s');
      say('Race started — 3 gates, 90 seconds');
    } else if (r.phase === 'run') {
      if (!inCar()) { cancelRace('Race cancelled — you left the car'); return; }
      r.timer -= dt;
      const car = G.player.car;
      if (r.timer <= 0) {
        say('Race failed — out of time');
        sfx('fail');
        cancelRace(null);
        return;
      }
      const target = GATES[r.gate - 1];
      setObjective(`Gate ${r.gate}/3 — ${Math.ceil(r.timer)}s`);
      callHud('setTimer', Math.ceil(r.timer));
      if (target && dist2(car.pos.x, car.pos.z, target.x, target.z) < 10) {
        if (r.gate >= 3) {
          const left = Math.max(0, Math.ceil(r.timer));
          const pay = Math.min(RACE_PAY_CAP, RACE_BASE_PAY + RACE_PER_SECOND * left);
          G.cash = (G.cash || 0) + pay;
          r.pay = pay;
          say(`Race complete — $${pay}`);
          sfx('cash');
          r.phase = 'none';
          r.gate = 0;
          r.timer = 0;
          hideGateRings();
          setBeacon(null);
          setTimer(0);
          setObjective('Free roam — find work around the city');
        } else {
          say(`Gate ${r.gate}/3`);
          r.gate += 1;
          const next = GATES[r.gate - 1];
          setBeacon({ x: next.x, z: next.z });
          showGateRing(r.gate - 1);
          setObjective(`Gate ${r.gate}/3 — ${Math.ceil(r.timer)}s`);
        }
      }
    }
  }

  // ---- shared lifecycle ------------------------------------------------
  function cancelSideJobs(silent) {
    if (G.taxi) {
      if (G.taxi.client) G.taxi.client.taxiClient = false;
      G.taxi.client = null; G.taxi.dest = null; G.taxi.destKey = '';
      G.taxi.fare = 0; G.taxi.phase = 'none'; G.taxi.offerTimer = 8;
    }
    if (G.courier) {
      G.courier.phase = 'none'; G.courier.dest = null; G.courier.destKey = '';
      G.courier.pay = 0; G.courier.timer = 0;
    }
    if (G.race && G.race.phase !== 'none') {
      G.race.phase = 'none'; G.race.gate = 0; G.race.timer = 0; G.race.countdown = 0;
      hideGateRings();
    }
    setBeacon(null);
    setTimer(0);
    if (!silent) say('Side jobs cancelled');
    if (G.missionActive) armStep(G.mission, G.missionStep);
    else setObjective('Free roam — find work around the city');
  }

  function onExitCar() {
    if (G.race && (G.race.phase === 'run' || G.race.phase === 'countdown')) {
      cancelRace('Race cancelled — you left the car');
    }
    if (G.taxi && G.taxi.phase === 'ride') {
      say('You left the car — fare cancelled');
      clearTaxi();
      G.taxi.offerTimer = 10;
      setObjective('Free roam — find work around the city');
    }
  }

  function setFreeRoam(g) {
    const state = g || G;
    state.missionActive = false;
    state.freeRoam = true;
    cancelSideJobs(true);
    state.taxi.offerTimer = 2;
    setObjective('Free roam — find work around the city');
    setBeacon(null);
  }

  function restoreForStep() {
    if (G.missionActive) armStep(G.mission, G.missionStep);
    else setObjective('Free roam — find work around the city');
  }

  function update(dt) {
    if (!G || G.mode !== 'playing') return;
    updateRace(dt);
    if (G.missionActive) updateStory(dt);
    updateTaxi(dt);
    updateCourier(dt);
  }

  return {
    update,
    startMission,
    restartMission,
    advanceToNext,
    completeMission,
    setFreeRoam,
    restoreForStep,
    cancelSideJobs,
    onExitCar,
    setBeacon,
    dispatcherPosition,
    tryTaxi,
    tryCourier,
    tryRace,
    cancelRace,
    racePadNear,
    missionName: (i) => MISSIONS[i] ? MISSIONS[i].name : '',
    racePad: { x: PAD.x, z: PAD.z },
    gates: GATES.map((g) => ({ x: g.x, z: g.z })),
  };
}
