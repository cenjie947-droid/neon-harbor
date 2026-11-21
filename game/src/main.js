// Neon Harbor — entry point. Wires the world, the game loop, input,
// camera, screens and the save/continue flow, and exposes window.__game
// for the headless driver. Fresh rewrite for the gta6-01 resubmission.
import * as THREE from 'three';
import {
  makeGame, WORLD, clamp, rand, dist2D, angleLerp,
  collideCircle, segmentBlocked, vec3,
} from './state.js';
import { buildCity } from './city.js';
import {
  STEAL_REACH, createCar, spawnParkedCars, spawnTraffic,
  nearestCar, enterCar, exitCar, drivePlayerCar, updateTraffic,
} from './vehicles.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
import { spawnPedestrians, updatePedestrians } from './pedestrians.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { Combat } from './combat.js';
import { HUD } from './hud.js';
import { SaveData } from './save.js';
import { stageShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const showEl = (el) => el && el.classList.remove('hidden');
const hideEl = (el) => el && el.classList.add('hidden');
const SAVE_KEY = 'neon-harbor-save-v1';
const CAM_DIST = 7.5;
const CAM_HEIGHT = 3.4;

let g = null;
let renderer = null;
let clockLast = performance.now();
let dragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// ---------------------------------------------------------------- world
function buildWorld() {
  g = makeGame();
  g.mode = 'title';
  g.time = 0;

  renderer = new THREE.WebGLRenderer({
    canvas: $('scene'), antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  g.scene = new THREE.Scene();
  g.scene.background = new THREE.Color(0x8ec9ee);
  g.scene.fog = new THREE.Fog(0x9fd0ef, 120, 420);

  g.camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 900,
  );
  g.camera.position.set(0, 40, 90);
  g.camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.95);
  g.scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff2d0, 2.4);
  sunLight.position.set(120, 180, 60);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -260;
  sunLight.shadow.camera.right = 260;
  sunLight.shadow.camera.top = 260;
  sunLight.shadow.camera.bottom = -260;
  sunLight.shadow.camera.far = 600;
  sunLight.shadow.bias = -0.0004;
  g.scene.add(sunLight);
  g.sunLight = sunLight;

  buildCity(g);
  spawnParkedCars(g);
  spawnTraffic(g, 12);
  spawnPedestrians(g, 28);

  g.player = createPlayer(g);
  g.fx = new Effects(g);
  g.audio = new AudioEngine();
  g.police = new Police(g);
  g.combat = new Combat(g);
  g.missions = new Missions(g);
  g.hud = new HUD(g);
  g.save = new SaveData();

  // Callbacks the mission/police modules use to drive the screens.
  g.showBriefing = showBriefing;
  g.showMissionCard = showMissionCard;
  g.showEnding = showEnding;
  g.onBusted = triggerBusted;
  g.onWasted = triggerWasted;

  wireInput();
  wireButtons();
  exposeGame();
  refreshContinueButton();
  applyShotScenario();
  updateCamera(0);
}

// ------------------------------------------------------------- screens
function hideAllScreens() {
  for (const id of [
    'title-screen', 'pause-menu', 'mission-panel', 'busted-screen',
    'wasted-screen', 'ending-screen', 'briefing',
  ]) hideEl($(id));
}

function showBriefing(title, text) {
  hideAllScreens();
  $('briefing-title').textContent = title || '';
  $('briefing-text').textContent = text || '';
  showEl($('briefing'));
  g.hud.hide();
  g.mode = 'briefing';
}

function showMissionCard(title, text, reward, total) {
  hideAllScreens();
  $('mission-panel-title').textContent = title || 'MISSION COMPLETE';
  $('mission-panel-text').textContent = text || '';
  // Reward and total are read from the same ledger at the same moment.
  $('mission-panel-reward').textContent =
    `Reward: $${reward}  •  Total cash: $${total}`;
  showEl($('mission-panel'));
  g.hud.hide();
  g.mode = 'card';
}

function showEnding(statsText) {
  hideAllScreens();
  $('ending-stats').textContent = statsText || '';
  showEl($('ending-screen'));
  g.hud.hide();
  g.mode = 'ending';
}

function toTitle() {
  hideAllScreens();
  showEl($('title-screen'));
  g.hud.hide();
  if (g.player.car) exitCar(g);
  g.mode = 'title';
  refreshContinueButton();
}

function startNewGame() {
  if (g.player.car) exitCar(g);
  g.cash = 0;
  g.wanted = 0;
  g.heatTimer = 0;
  g.missionIndex = 0;
  g.missionStep = 0;
  g.missionActive = false;
  g.missionDone = false;
  g.missionTimer = 0;
  g.stats = { carsStolen: 0, missionsDone: 0, crimes: 0 };
  g.police.clearWanted(g);
  g.police.clearUnits(g);
  g.missions.cancelSideJobs(g);
  g.player.health = 100;
  g.player.pos.set(g.markers.hideout.x, 0, g.markers.hideout.z);
  g.player.heading = 0;
  g.player.camYaw = 0;
  g.player.camPitch = 0.25;
  g.audio.ensure();
  g.audio.startMusic();
  snapCamera();
  g.missions.startMission(g, 0);
}

function continueGame() {
  const data = g.save.load();
  if (!data) return;
  g.save.apply(g, data);
  // The old apply() did not restore the mission position: restore the
  // mission index and the step inside it explicitly from the record.
  const recMission = data.missionIndex ?? data.mission;
  const recStep = data.missionStep ?? data.step;
  if (typeof recMission === 'number') g.missionIndex = recMission;
  if (typeof recStep === 'number') g.missionStep = recStep;
  if (data.car && !g.player.car) {
    try { g.save.restoreCar(g, data); } catch (err) { console.warn('restoreCar', err); }
  }
  if (data.player) {
    try { g.save.restorePlayer(g, data); } catch (err) { console.warn('restorePlayer', err); }
  }
  // Re-assert the mission position after any restore helper ran.
  if (typeof recMission === 'number') g.missionIndex = recMission;
  if (typeof recStep === 'number') g.missionStep = recStep;
  g.player.health = Math.max(1, g.player.health || 100);
  g.police.clearUnits(g);
  g.audio.ensure();
  g.audio.startMusic();
  snapCamera();
  const job = g.missions.current(g);
  if (job) showBriefing(job.name, job.briefing);
  else { g.hud.show(); g.mode = 'playing'; }
}

function refreshContinueButton() {
  let has = false;
  try { has = !!localStorage.getItem(SAVE_KEY); } catch (err) { has = false; }
  if (has) showEl($('btn-continue'));
  else hideEl($('btn-continue'));
}

// -------------------------------------------------------------- bust/waste
function triggerBusted() {
  if (g.mode !== 'playing') return;
  g.cash = Math.max(0, g.cash - 25);
  g.wanted = 0;
  g.heatTimer = 0;
  g.police.clearWanted(g);
  g.police.clearUnits(g);
  g.missions.cancelSideJobs(g);
  if (g.player.car) exitCar(g);
  g.player.pos.set(g.markers.hideout.x, 0, g.markers.hideout.z);
  g.player.heading = 0;
  g.player.health = 100;
  hideAllScreens();
  showEl($('busted-screen'));
  g.hud.hide();
  g.mode = 'busted';
  snapCamera();
}

function triggerWasted() {
  if (g.mode !== 'playing') return;
  g.cash = Math.max(0, g.cash - 25);
  g.wanted = 0;
  g.heatTimer = 0;
  g.police.clearWanted(g);
  g.police.clearUnits(g);
  g.missions.cancelSideJobs(g);
  if (g.player.car) exitCar(g);
  g.player.pos.set(g.markers.hospital.x, 0, g.markers.hospital.z);
  g.player.heading = 0;
  g.player.health = 100;
  hideAllScreens();
  showEl($('wasted-screen'));
  g.hud.hide();
  g.mode = 'wasted';
  snapCamera();
}

function respawn() {
  hideAllScreens();
  g.hud.show();
  g.mode = 'playing';
  snapCamera();
}

// ---------------------------------------------------------------- input
function pressKey(code, down, repeat) {
  if (down) {
    // Fire the action on a fresh press, or on a keydown that is not an
    // auto-repeat — even if the matching keyup was never seen (a missed
    // keyup used to swallow every later press of that key for good).
    if (!g.input.keys.has(code) || repeat === false) handleActionKey(code);
    g.input.keys.add(code);
  } else {
    g.input.keys.delete(code);
  }
}

function handleActionKey(code) {
  if (code === 'KeyM') {
    g.audio.ensure();
    g.audio.setMuted(!g.audio.muted);
    return;
  }
  if (code === 'KeyP' || code === 'Escape') {
    togglePause();
    return;
  }
  if (g.mode !== 'playing') return;
  if (code === 'KeyE') tryEnterExitCar();
  else if (code === 'KeyF') trySprayOrPunch();
  else if (code === 'KeyT') g.missions.tryTaxiPickup(g);
  else if (code === 'KeyC') g.missions.tryCourierTake(g);
  else if (code === 'KeyQ') g.combat.switchWeapon?.(g);
  else if (code === 'KeyR') g.combat.flipCar?.(g);
}

function togglePause() {
  if (g.mode === 'playing') {
    hideAllScreens();
    showEl($('pause-menu'));
    $('pause-save-note').textContent = '';
    g.mode = 'paused';
  } else if (g.mode === 'paused') {
    hideAllScreens();
    g.hud.show();
    g.mode = 'playing';
  }
}

function tryEnterExitCar() {
  const p = g.player;
  if (p.car) {
    exitCar(g);
    return;
  }
  const car = nearestCar(g, p.pos, STEAL_REACH);
  if (!car) return;
  // Stealing on its own does not raise heat — the steal does: a car that
  // is not already Cole's adds one star the moment he takes it.
  const wasOwned = !!car.owned;
  enterCar(g, car);
  if (p.car === car && !wasOwned) {
    g.police.addWanted(g, 1, 'steal');
    g.stats.carsStolen += 1;
    g.stats.crimes += 1;
  }
}

function trySprayOrPunch() {
  const p = g.player;
  if (p.car) {
    const spray = g.markers.spray;
    const d = dist2D(p.pos.x, p.pos.z, spray.x, spray.z);
    if (d < 9) {
      const car = p.car;
      const needsFix = g.wanted > 0 || car.health < car.maxHealth;
      if (!needsFix) {
        g.hud.showMessage('Nothing to fix — you are clean.');
        return;
      }
      if (g.cash < 100) {
        g.hud.showMessage('Pay N Spray costs $100 — not enough cash.');
        return;
      }
      g.cash -= 100;
      car.health = car.maxHealth;
      g.police.clearWanted(g);
      g.audio.cash();
      g.hud.showMessage('Pay N Spray: heat cleared, car repaired. -$100');
      return;
    }
  }
  g.combat.attack(g);
}

function wireInput() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    pressKey(e.code, true, e.repeat);
  });
  window.addEventListener('keyup', (e) => pressKey(e.code, false));
  window.addEventListener('blur', () => g.input.keys.clear());

  const canvas = $('scene');
  window.addEventListener('mousedown', (e) => {
    if (g.mode !== 'playing') return;
    dragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock(); } catch (err) { /* drag fallback */ }
    }
    // A click swings the fists (or fires the pistol) on foot.
    if (!g.player.car) {
      if (g.player.weapon === 'pistol' && g.player.ammo > 0) g.combat.shoot(g);
      else g.combat.attack(g);
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (g.mode !== 'playing' && g.mode !== 'title') return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && !dragging) return;
    const dx = e.movementX ?? (e.clientX - lastMouseX);
    const dy = e.movementY ?? (e.clientY - lastMouseY);
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    g.player.camYaw -= dx * 0.0028;
    g.player.camPitch = clamp(g.player.camPitch + dy * 0.0022, -0.45, 0.85);
  });
  window.addEventListener('resize', () => {
    g.camera.aspect = window.innerWidth / window.innerHeight;
    g.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function wireButtons() {
  $('btn-start').addEventListener('click', () => {
    g.audio.ensure();
    startNewGame();
  });
  $('btn-continue').addEventListener('click', () => {
    g.audio.ensure();
    continueGame();
  });
  $('btn-resume').addEventListener('click', () => togglePause());
  $('btn-restart-mission').addEventListener('click', () => {
    hideAllScreens();
    g.missions.restartMission(g);
  });
  $('btn-save').addEventListener('click', () => {
    g.save.save(g);
    $('pause-save-note').textContent = 'Saved.';
    refreshContinueButton();
  });
  $('btn-quit-title').addEventListener('click', () => toTitle());
  $('btn-mission-ok').addEventListener('click', () => {
    hideAllScreens();
    if (g.missionIndex >= g.missions.jobs.length) {
      showEnding(g.missions.endingStats(g));
      return;
    }
    const job = g.missions.current(g);
    if (job) showBriefing(job.name, job.briefing);
    else { g.hud.show(); g.mode = 'playing'; }
  });
  $('btn-briefing').addEventListener('click', () => {
    hideAllScreens();
    g.hud.show();
    g.mode = 'playing';
    g.audio.ensure();
    g.audio.startMusic();
    snapCamera();
  });
  $('btn-busted').addEventListener('click', () => respawn());
  $('btn-wasted').addEventListener('click', () => respawn());
  $('btn-ending').addEventListener('click', () => {
    hideAllScreens();
    g.missions.setFreeRoam(g);
    g.hud.show();
    g.mode = 'playing';
  });
}

// -------------------------------------------------------------- camera
function cameraTargetPos(yaw, pitch) {
  const p = g.player.pos;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dist = CAM_DIST * Math.cos(pitch);
  const x = p.x - fx * dist;
  const z = p.z - fz * dist;
  const y = p.y + 1.7 + CAM_HEIGHT * Math.sin(Math.max(0.12, pitch)) + 1.2;
  return { x, y, z };
}

function clearCameraPos(yaw, pitch) {
  const p = g.player.pos;
  const want = cameraTargetPos(yaw, pitch);
  // Walk the ray from the player to the wanted spot; stop just before
  // the first wall or building the ray would clip through.
  let best = { x: want.x, y: want.y, z: want.z };
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const x = p.x + (want.x - p.x) * t;
    const z = p.z + (want.z - p.z) * t;
    const hit = collideCircle(g, x, z, 0.7);
    if (hit.hit || segmentBlocked(g, p.x, p.z, x, z)) {
      const tb = Math.max(0, (i - 1) / 16);
      best = {
        x: p.x + (want.x - p.x) * tb,
        z: p.z + (want.z - p.z) * tb,
        y: p.y + 1.7 + (want.y - p.y - 1.7) * tb,
      };
      break;
    }
    best = { x, y: p.y + 1.7 + (want.y - p.y - 1.7) * t, z };
  }
  if (best.y < p.y + 1.1) best.y = p.y + 1.1;
  return best;
}

function snapCamera() {
  const p = g.player;
  const baseYaw = p.camYaw;
  for (let k = 0; k < 8; k++) {
    const yaw = baseYaw + (k * Math.PI) / 4;
    const pos = cameraTargetPos(yaw, p.camPitch);
    const hit = collideCircle(g, pos.x, pos.z, 0.7);
    if (!hit.hit && !segmentBlocked(g, p.pos.x, p.pos.z, pos.x, pos.z)) {
      p.camYaw = yaw;
      break;
    }
    if (k === 7) p.camYaw = yaw;
  }
  updateCamera(0);
}

function updateCamera(dt) {
  const p = g.player;
  if (g.mode === 'title') {
    const t = g.time * 0.03;
    g.camera.position.set(Math.sin(t) * 150, 55, Math.cos(t) * 150);
    g.camera.lookAt(0, 0, 20);
    return;
  }
  const pos = clearCameraPos(p.camYaw, p.camPitch);
  const fx = Math.sin(p.camYaw);
  const fz = Math.cos(p.camYaw);
  const look = vec3(
    p.pos.x + fx * 3, p.pos.y + 1.6, p.pos.z + fz * 3,
  );
  const k = dt > 0 ? 1 - Math.exp(-dt * 14) : 1;
  g.camera.position.x += (pos.x - g.camera.position.x) * k;
  g.camera.position.y += (pos.y - g.camera.position.y) * k;
  g.camera.position.z += (pos.z - g.camera.position.z) * k;
  g.camera.lookAt(look.x, look.y, look.z);
  g.fx.applyShake(dt);
}

// ------------------------------------------------------- interact prompt
function updateInteract() {
  const el = $('interact');
  if (g.mode !== 'playing') { hideEl(el); return; }
  const p = g.player;
  let text = '';
  if (!p.car) {
    const car = nearestCar(g, p.pos, STEAL_REACH);
    if (car) text = car.owned ? 'Press E — drive' : 'Press E — steal car';
    else if (g.taxi.phase === 'wait' && g.taxi.client) {
      const c = g.taxi.client;
      if (dist2D(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < 6) text = 'Press T — pick up fare';
    } else if (g.missions.courierNear(g)) text = 'Press C — take the parcel';
  } else {
    const spray = g.markers.spray;
    if (dist2D(p.pos.x, p.pos.z, spray.x, spray.z) < 9) {
      text = 'Press F — Pay N Spray $100';
    }
  }
  if (text) { el.textContent = text; showEl(el); }
  else hideEl(el);
}

// ------------------------------------------------------------ game step
function step(dt) {
  if (!g) return;
  g.time += dt;
  if (g.mode === 'playing') {
    updatePlayer(g, dt);
    if (g.player.car) drivePlayerCar(g, dt);
    updateTraffic(g, dt);
    updatePedestrians(g, dt);
    g.police.update(g, dt);
    g.combat.update(g, dt);
    g.missions.update(g, dt);
    g.fx.update(dt);
    // Engine and siren follow the world; both no-op without audio.
    if (g.player.car) {
      const ratio = clamp(Math.abs(g.player.car.speed) / 26, 0, 1);
      g.audio.setEngine(ratio, true);
    } else {
      g.audio.setEngine(0, false);
    }
    g.audio.setSiren(g.wanted > 0);
    if (typeof g.audio.musicTick === 'function') g.audio.musicTick();
    g.hud.update(g, dt);
    updateInteract();
    updateCamera(dt);
    if (g.player.health <= 0) triggerWasted();
  } else if (g.mode === 'title') {
    updateTraffic(g, dt);
    updatePedestrians(g, dt);
    g.fx.update(dt);
    updateCamera(dt);
  } else {
    g.fx.update(dt);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - clockLast) / 1000));
  clockLast = now;
  step(dt);
  if (g && g.renderEnabled !== false && g._render !== false) {
    renderer.render(g.scene, g.camera);
  }
}

// ------------------------------------------------------- driver surface
function exposeGame() {
  const api = {
    get G() { return g; },
    get mode() { return g.mode; },
    get pos() { return g.player.pos; },
    get health() { return Math.round(g.player.health); },
    get driving() { return !!g.player.car; },
    get carName() { return g.player.car ? g.player.car.name : ''; },
    get carHealth() {
      return g.player.car ? Math.round(g.player.car.health) : 0;
    },
    get wanted() { return g.wanted; },
    get cash() { return g.cash; },
    get mission() { return g.missionIndex; },
    get missionStep() { return g.missionStep; },
    get policeCars() { return g.policeCars.length; },
    get taxiPhase() { return g.taxi.phase; },
    get taxiFare() { return g.taxi.fare; },
    get courierPhase() { return (g.courier && g.courier.phase) || 'none'; },
    get courierPay() { return (g.courier && g.courier.pay) || 0; },
    step(dt) { step(typeof dt === 'number' ? dt : 0.05); },
    setRender(on) { g.renderEnabled = !!on; g._render = !!on; },
    pressKey(code, down) { pressKey(code, !!down); },
    teleport(x, z) {
      g.player.pos.set(x, 0, z);
      if (g.player.car) {
        g.player.car.pos.set(x, 0, z);
        g.player.car.speed = 0;
      }
      updateCamera(0);
    },
    hurt(amount) {
      if (g.mode !== 'playing') return;
      damagePlayer(g, amount, 'hurt');
      if (g.player.health <= 0) triggerWasted();
    },
  };
  window.__game = api;
}

// ------------------------------------------------------- shot scenarios
function setupShotDrive(chase) {
  hideAllScreens();
  g.hud.show();
  g.cash = 150;
  g.missionIndex = 0;
  g.missionStep = 1;
  g.missionActive = true;
  // Put Cole in the parked car nearest Mara's garage and point it up
  // the road, so the frame is a drive, not a walk.
  let best = null;
  let bd = Infinity;
  for (const c of g.cars) {
    if (c.parked && !c.isPolice) {
      const d = dist2D(c.pos.x, c.pos.z, 60, 120);
      if (d < bd) { bd = d; best = c; }
    }
  }
  if (best) {
    g.player.pos.set(best.pos.x + 3, 0, best.pos.z);
    best.heading = Math.atan2(60 - best.pos.x, 120 - best.pos.z);
    enterCar(g, best);
    best.name = 'Comet GT';
    g.player.camYaw = best.heading;
  }
  if (chase) {
    g.police.addWanted(g, 3, 'shot');
    g.hud.setMissionName("The Pickup");
    g.hud.setObjective('Deliver the Comet GT to Mara\'s garage');
  } else {
    g.hud.setMissionName('Neon Harbor');
    g.hud.setObjective('Cruise the harbor streets');
  }
  g.mode = 'playing';
  snapCamera();
}

function setupShotMission() {
  // The mission-complete card for job 2: reward $300, total $450.
  g.cash = 450;
  g.missionIndex = 2;
  g.missionStep = 0;
  hideAllScreens();
  $('mission-panel-title').textContent = 'MISSION COMPLETE';
  $('mission-panel-text').textContent =
    'The Pickup — the Comet GT is in Mara\'s garage, clean and paid for.';
  $('mission-panel-reward').textContent = 'Reward: $300  •  Total cash: $450';
  showEl($('mission-panel'));
  g.mode = 'card';
}

function applyShotScenario() {
  const shot = new URLSearchParams(window.location.search).get('shot');
  if (!shot) return;
  try {
    if (shot === 'chase') setupShotDrive(true);
    else if (shot === 'drive') setupShotDrive(false);
    else if (shot === 'mission') setupShotMission();
    else if (shot === 'title') { /* default title screen */ }
    stageShot(g, shot);
  } catch (err) {
    console.warn('shot scenario', err);
  }
}

// ---------------------------------------------------------------- boot
buildWorld();
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
});
requestAnimationFrame(frame);
