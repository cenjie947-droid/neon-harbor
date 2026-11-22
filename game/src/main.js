// Neon Harbor — main entry / game loop / input / camera / screens.
// Written fresh for round 6 (v12). Owns: boot + wiring, the rAF loop and
// the headless step() used by the test driver, keyboard/mouse input,
// on-foot + driving movement, car steal/enter/exit, collisions and car
// damage, the follow camera with building keep-out, Pay N Spray, all
// screens (title / briefing / pause / mission card / busted / wasted /
// ending), save + continue, and the window.__game debug surface.
import * as THREE from 'three';
import * as stateMod from './state.js';
import * as cityMod from './city.js';
import * as vehiclesMod from './vehicles.js';
import * as playerMod from './player.js';
import * as pedsMod from './pedestrians.js';
import * as audioMod from './audio.js';
import * as effectsMod from './effects.js';
import * as combatMod from './combat.js';
import * as hudMod from './hud.js';
import * as saveMod from './save.js';
import * as shotsMod from './shots.js';
import { createMissions } from './missions.js';
import { createPolice } from './police.js';

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const angLerp = (a, b, t) => a + wrapPi(b - a) * clamp(t, 0, 1);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const $ = (id) => document.getElementById(id);
const show = (el) => { if (el) el.classList.remove('hidden'); };
const hide = (el) => { if (el) el.classList.add('hidden'); };

// Landmark positions (x, z) — the shared map contract.
const LANDMARKS = {
  bank: [-60, -60], garage: [-120, 60], hideout: [0, -180],
  hospital: [120, -120], paintShop: [60, 120], showroom: [180, 60],
  spray: [120, 60], warehouse: [-180, 120], docks: [-150, 110],
  beach: [0, 212],
};

// ------------------------------------------------- tolerant module wiring
// Sibling modules are rewritten fresh in parallel, so factory names may
// vary. Resolve a factory by trying the obvious names, then fall back to a
// default export; call it, or `new` it if the call returns nothing usable.
function makeInstance(mod, names, ...args) {
  const tries = [...names];
  if (typeof mod.default === 'function') tries.push('default');
  for (const n of tries) {
    const fn = n === 'default' ? mod.default : mod[n];
    if (typeof fn !== 'function') continue;
    try {
      const r = fn(...args);
      // A successful call is final: factories that build by side effect
      // return nothing, and must NOT be run a second time via `new`.
      if (r && typeof r === 'object') return r;
      return null;
    } catch (e) {
      // A class constructor throws when called plain — retry with `new`.
      try { const r = new fn(...args); if (r && typeof r === 'object') return r; } catch (e2) { /* next name */ }
    }
  }
  return null;
}
function callMethod(obj, names, ...args) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const n of names) {
    if (typeof obj[n] === 'function') {
      try { return obj[n](...args); } catch (e) { return undefined; }
    }
  }
  return undefined;
}
// Tick a subsystem once per step: prefer the object the factory returned,
// otherwise try the same method names on the module namespace itself.
function tickSubsystem(api, mod, dt) {
  if (callMethod(api, ['update', 'step', 'tick'], dt) !== undefined) return;
  if (callMethod(mod, ['update', 'step', 'tick'], G, dt) !== undefined) return;
}

// Minimal shared-state skeleton, used only if the state factory cannot be
// resolved — the real state module normally builds all of this.
function fallbackState() {
  return {
    time: 0, cash: 0, wanted: 0, health: 100,
    mission: 0, missionStep: 0, missionActive: false, freeRoam: false,
    mode: 'title',
    player: {
      pos: new THREE.Vector3(0, 0, 120), heading: 0,
      camYaw: 0, camPitch: 0.32, punchAnim: 0, shootCooldown: 0,
      ammo: 0, invuln: 0, walkPhase: 0, hasPistol: false,
      weapon: 'fists', health: 100, car: null, vy: 0,
    },
    cars: [], policeCars: [], officers: [], peds: [],
    colliders: [], markers: {}, keys: new Set(),
    taxi: { phase: 'none' }, courier: { phase: 'none' },
    race: { phase: 'none', gate: 0, timer: 0, pay: 0, countdown: 0 },
    beacon: null, objective: '', feed: [],
  };
}

let G = null;          // shared state
let scene = null, camera = null, renderer = null;
let renderEnabled = true;
let keys = new Set();
let camDist = 8, camHeight = 3.4;
let lastFrame = 0;
let missionsApi = null, policeApi = null;
let vehiclesApi = null, pedsApi = null, combatApi = null, hudApi = null;
let audioApi = null, fxApi = null, saveApi = null, playerApi = null;
let carBumpAt = 0, smokeAt = 0;
let dragging = false, dragX = 0, dragY = 0;
let booted = false;

// ------------------------------------------------------------ collisions
function circleHits(x, z, r) {
  for (const k of G.colliders) {
    if (Math.abs(x - k.x) < k.hw + r && Math.abs(z - k.z) < k.hd + r) return k;
  }
  return null;
}
// Push a circle (x, z, radius) out of every building box it overlaps.
function pushOut(x, z, r) {
  for (const k of G.colliders) {
    const ox = x - k.x, oz = z - k.z;
    const px = k.hw + r - Math.abs(ox), pz = k.hd + r - Math.abs(oz);
    if (px > 0 && pz > 0) {
      if (px < pz) x = k.x + (ox >= 0 ? k.hw + r : -(k.hw + r));
      else z = k.z + (oz >= 0 ? k.hd + r : -(k.hd + r));
    }
  }
  return [x, z];
}
function findClearSpot(x, z, r) {
  if (!circleHits(x, z, r)) return [x, z];
  for (let ring = 1; ring <= 12; ring++) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + ring * 0.35;
      const nx = x + Math.cos(ang) * ring * 3, nz = z + Math.sin(ang) * ring * 3;
      if (!circleHits(nx, nz, r)) return [nx, nz];
    }
  }
  return [x, z];
}
function segmentBlocked(ax, az, bx, bz) {
  const steps = Math.ceil(dist2(ax, az, bx, bz) / 3) || 1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (circleHits(lerp(ax, bx, t), lerp(az, bz, t), 0.5)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ audio
function sfx(name, ...args) {
  if (!audioApi) return;
  if (typeof audioApi[name] === 'function') {
    try { audioApi[name](...args); } catch (e) { /* audio is cosmetic */ }
  }
}
function fxCall(name, ...args) {
  if (!fxApi) return;
  if (typeof fxApi[name] === 'function') {
    try { fxApi[name](...args); } catch (e) { /* cosmetic */ }
  }
}
function say(msg) {
  if (hudApi && typeof hudApi.addFeed === 'function') {
    try { hudApi.addFeed(msg); return; } catch (e) { /* fall through */ }
  }
  if (Array.isArray(G.feed)) G.feed.push(msg);
  else G.feed = [msg];
}
function setObjective(text) {
  G.objective = text;
  if (hudApi && typeof hudApi.setObjective === 'function') {
    try { hudApi.setObjective(text); } catch (e) { /* ignore */ }
  }
}

// ------------------------------------------------------------------ boot
export function boot() {
  if (booted) return;
  booted = true;

  G = makeInstance(stateMod, ['createGameState', 'createState', 'createSharedState', 'buildState'], THREE) || fallbackState();
  if (!G.player) Object.assign(G, fallbackState());
  G.keys = keys;
  G.time = G.time || 0;
  G.cash = G.cash || 0;
  G.wanted = G.wanted || 0;
  G.health = G.health == null ? 100 : G.health;
  G.mission = G.mission || 0;
  G.missionStep = G.missionStep || 0;
  G.mode = 'title';
  if (!G.taxi) G.taxi = { phase: 'none' };
  if (!G.courier) G.courier = { phase: 'none' };
  if (!G.race) G.race = { phase: 'none', gate: 0, timer: 0, pay: 0, countdown: 0 };
  const p = G.player;
  p.pos = p.pos || new THREE.Vector3(0, 0, 120);
  p.camYaw = p.camYaw || 0; p.camPitch = p.camPitch == null ? 0.32 : p.camPitch;
  p.punchAnim = 0; p.shootCooldown = 0; p.ammo = p.ammo || 0;
  p.invuln = 0; p.walkPhase = 0; p.hasPistol = !!p.hasPistol;
  p.weapon = p.weapon || 'fists'; p.vy = 0; p.health = G.health;

  // Renderer / scene / camera.
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth || 1280, window.innerHeight || 720);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const host = $('scene') || document.body;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec9ee);
  scene.fog = new THREE.Fog(0x9fd0ef, 180, 520);
  G.scene = scene;
  camera = new THREE.PerspectiveCamera(62, (window.innerWidth || 1280) / (window.innerHeight || 720), 0.1, 900);
  G.camera = camera; G.renderer = renderer;

  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.position.set(120, 220, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 1.5));

  // World modules (each factory is optional — the game still boots if one
  // cannot be resolved, and the driver report will show what is missing).
  makeInstance(cityMod, ['buildCity', 'createCity', 'initCity', 'buildWorld'], G, THREE, scene);
  fxApi = makeInstance(effectsMod, ['createEffects', 'createFx', 'initEffects'], G, THREE, scene);
  if (fxApi) G.fx = fxApi;
  if (!G.fx) G.fx = { particles: [], update() {}, add() {}, burst() {}, smokePuff() {}, explosion() {}, muzzle() {}, tracer() {}, shake() {}, applyShake() {}, retire() {}, stepParticle() {} };
  audioApi = makeInstance(audioMod, ['createAudio', 'createSound', 'initAudio'], G);
  if (audioApi) G.audio = audioApi;
  if (!G.audio) G.audio = { muted: false, ensure() {}, setMuted() {}, tone() {}, noise() {}, click() {}, cash() {}, chime() {}, fail() {}, missionComplete() {}, punch() {}, gunshot() {}, crash() {}, setEngine() {}, setSiren() {}, musicTick() {}, startMusic() {}, playSeq() {} };
  vehiclesApi = makeInstance(vehiclesMod, ['createVehicleSystem', 'createVehicles', 'spawnCars', 'spawnVehicles', 'initVehicles', 'buildVehicles'], G, THREE, scene);
  pedsApi = makeInstance(pedsMod, ['createPedestrians', 'spawnPeds', 'initPedestrians'], G, THREE, scene);
  // The factories build the systems but do not seed the world: without
  // these calls the streets stay empty — no cars to steal, no pedestrians
  // for the taxi job or the variety check.
  if (vehiclesApi && typeof vehiclesApi.spawnInitial === 'function') {
    try { vehiclesApi.spawnInitial(); } catch (err) { /* ignore */ }
  } else if (G.vehicles && typeof G.vehicles.spawnInitial === 'function') {
    try { G.vehicles.spawnInitial(); } catch (err) { /* ignore */ }
  }
  if (pedsApi && typeof pedsApi.spawnInitial === 'function') {
    try { pedsApi.spawnInitial(); } catch (err) { /* ignore */ }
  } else if (G.pedsSystem && typeof G.pedsSystem.spawnInitial === 'function') {
    try { G.pedsSystem.spawnInitial(); } catch (err) { /* ignore */ }
  }
  playerApi = makeInstance(playerMod, ['createPlayer', 'buildPlayer', 'initPlayer'], G, THREE, camera);
  if (!G.playerController && playerApi) G.playerController = playerApi;
  if (G.playerController && typeof G.playerController.attach === 'function') {
    try { G.playerController.attach(scene); } catch (err) { /* mesh attach is best-effort */ }
  }
  combatApi = makeInstance(combatMod, ['createCombat', 'initCombat'], G, THREE, scene);
  if (combatApi) G.combat = combatApi;
  if (!G.combat) G.combat = { arcs: [], enemies: [], update() {} };
  if (!Array.isArray(G.combat.arcs)) G.combat.arcs = [];
  hudApi = makeInstance(hudMod, ['createHud', 'initHud'], G, THREE, scene);
  if (hudApi) G.hud = hudApi;
  // The driver reads the static arrowRotation off the HUD constructor:
  // guarantee it exists (north-up map, arrow = PI - heading).
  if (G.hud && G.hud.constructor && G.hud.constructor !== Object &&
      typeof G.hud.constructor.arrowRotation !== 'function') {
    try { G.hud.constructor.arrowRotation = (h) => Math.PI - h; } catch (e) { /* ignore */ }
  }
  saveApi = makeInstance(saveMod, ['createSave', 'createSaveSystem', 'initSave'], G);

  // Markers: the city module normally sets these; fill any gaps from the
  // shared landmark contract so the debug surface is never short.
  if (!G.markers) G.markers = {};
  for (const [k, [x, z]] of Object.entries(LANDMARKS)) {
    if (!G.markers[k]) G.markers[k] = { x, z };
  }
  if (!Array.isArray(G.cars)) G.cars = [];
  if (!Array.isArray(G.policeCars)) G.policeCars = [];
  if (!Array.isArray(G.officers)) G.officers = [];
  if (!Array.isArray(G.peds)) G.peds = [];

  // Missions + police (written by this round, same file set).
  missionsApi = createMissions(G);
  G.missions = missionsApi;
  policeApi = createPolice(G);
  G.police = policeApi;
  G.collision = { circleHits, segmentBlocked, pushOut };

  // Callbacks other modules use to trigger the big screens.
  G.onBusted = () => busted();
  G.onWasted = () => wasted();
  G.showBriefing = showBriefing;

  wireButtons();
  wireInput();
  exposeDebug();

  // Title screen over the city.
  show($('title-screen'));
  hide($('hud'));
  updateCamera(0);
  if (renderEnabled) renderer.render(scene, camera);

  // Screenshot staging (?shot=title|chase|drive|mission): pose the real
  // running game for the submission screenshots. No-op on a plain load.
  try {
    if (typeof shotsMod.maybeStage === 'function') shotsMod.maybeStage(G);
  } catch (err) { /* staging never blocks boot */ }

  lastFrame = performance.now();
  const loop = (t) => {
    const dt = clamp((t - lastFrame) / 1000, 0, 0.05);
    lastFrame = t;
    step(dt);
    if (renderEnabled) renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ input
function wireInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    handleKey(e.code, true);
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => handleKey(e.code, false));
  // Click-to-capture pointer lock lives on the WINDOW so HUD overlays
  // cannot swallow the mousedown; held-drag is the fallback look.
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (G.mode !== 'playing') return;
    const canvas = renderer.domElement;
    if (!document.pointerLockElement) {
      try {
        const lock = canvas.requestPointerLock();
        // requestPointerLock returns a promise in current browsers: a
        // rejection (no user gesture in headless runs) must be caught
        // here or it surfaces as an uncaught console error.
        if (lock && typeof lock.catch === 'function') lock.catch(() => { /* headless: ignore */ });
      } catch (err) { /* headless: ignore */ }
    }
    dragging = true; dragX = e.clientX; dragY = e.clientY;
    if (G.player.car) shoot();
    else punch();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (G.mode !== 'playing') return;
    if (document.pointerLockElement) {
      G.player.camYaw -= (e.movementX || 0) * 0.0032;
      G.player.camPitch = clamp(G.player.camPitch + (e.movementY || 0) * 0.0024, -0.05, 1.0);
    } else if (dragging) {
      G.player.camYaw -= (e.clientX - dragX) * 0.0042;
      G.player.camPitch = clamp(G.player.camPitch + (e.clientY - dragY) * 0.0032, -0.05, 1.0);
      dragX = e.clientX; dragY = e.clientY;
    }
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function handleKey(code, down) {
  if (down) keys.add(code); else keys.delete(code);
  G.keys = keys;
  if (!down) return;
  if (code === 'KeyM') {
    if (G.audio) { G.audio.muted = !G.audio.muted; callMethod(G.audio, ['setMuted'], G.audio.muted); }
    return;
  }
  if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
  if (G.mode !== 'playing') return;
  if (code === 'KeyE') enterExitCar();
  else if (code === 'KeyF') payNSpray();
  else if (code === 'KeyT') callMethod(G.missions, ['tryTaxi']);
  else if (code === 'KeyC') callMethod(G.missions, ['tryCourier']);
  else if (code === 'KeyG') callMethod(G.missions, ['tryRace']);
  else if (code === 'KeyQ') switchWeapon();
  else if (code === 'KeyR') flipCar();
  else if (code === 'Space' && !G.player.car && G.player.pos.y <= 0.01) G.player.vy = 7.5;
}

function togglePause() {
  if (G.mode === 'playing') {
    G.mode = 'paused';
    show($('pause-menu'));
    const note = $('pause-save-note'); if (note) note.textContent = '';
  } else if (G.mode === 'paused') {
    G.mode = 'playing';
    hide($('pause-menu'));
  }
}

function switchWeapon() {
  const pl = G.player;
  if (pl.weapon === 'pistol') { pl.weapon = 'fists'; say('Fists'); return; }
  if (pl.hasPistol) { pl.weapon = 'pistol'; say('Pistol — 12 rounds'); sfx('click'); }
  else say('No pistol yet — look for a dropped one');
}

function flipCar() {
  const car = G.player.car;
  if (!car) return;
  car.speed = 0;
  // Nudge backwards out of whatever it is wedged against.
  const bx = car.pos.x - Math.sin(car.heading) * 3;
  const bz = car.pos.z - Math.cos(car.heading) * 3;
  if (!circleHits(bx, bz, 1.8)) { car.pos.x = bx; car.pos.z = bz; }
  say('Car straightened out');
}

// ------------------------------------------------------- enter / exit car
// Steal reach is measured to the car's oriented body box, out to ~5 m,
// so the prompt works from the front, back or either side.
function nearestCar(maxReach) {
  const pl = G.player;
  let best = null, bestD = Infinity;
  for (const c of G.cars) {
    if (c.isPolice || c.disabled) continue;
    const dx = pl.pos.x - c.pos.x, dz = pl.pos.z - c.pos.z;
    const fwd = dx * Math.sin(c.heading) + dz * Math.cos(c.heading);
    const side = dx * Math.cos(c.heading) - dz * Math.sin(c.heading);
    const d = Math.hypot(Math.max(Math.abs(fwd) - 2.3, 0), Math.max(Math.abs(side) - 1.15, 0));
    if (d < bestD && d <= maxReach) { bestD = d; best = c; }
  }
  return best;
}

function enterExitCar() {
  const pl = G.player;
  if (pl.car) {
    const car = pl.car;
    pl.car = null;
    // Step out to the car's left side.
    const sx = car.pos.x - Math.cos(car.heading) * 2.6;
    const sz = car.pos.z + Math.sin(car.heading) * 2.6;
    const [cx, cz] = pushOut(sx, sz, 0.7);
    pl.pos.set(cx, 0, cz);
    pl.heading = car.heading;
    callMethod(G.missions, ['onExitCar']);
    return;
  }
  const car = nearestCar(5);
  if (!car) return;
  if (car.isPolice) { say('That cruiser is locked'); return; }
  const wasParked = !!car.parked;
  car.parked = false;
  pl.car = car;
  pl.heading = car.heading;
  if (wasParked) {
    callMethod(G.police, ['addWanted'], G, 1, 'steal');
    say('Car stolen — the law is coming');
    sfx('chime');
  }
}

function payNSpray() {
  const pl = G.player;
  const car = pl.car;
  const m = G.markers.spray;
  if (!car || !m) return;
  if (dist2(car.pos.x, car.pos.z, m.x, m.z) > 8) return;
  const needsFix = car.health < 100;
  const needsClear = G.wanted > 0;
  if (!needsFix && !needsClear) { say('Nothing to fix — no stars, car is clean'); return; }
  if (G.cash < 100) { say('Pay N Spray costs $100 — not enough cash'); sfx('fail'); return; }
  G.cash -= 100;
  car.health = 100; car.disabled = false;
  callMethod(G.police, ['clearWanted']);
  say('Pay N Spray — stars cleared, car repaired (-$100)');
  sfx('cash');
  fxCall('burst', car.pos.x, 1, car.pos.z);
}

// ------------------------------------------------------------------ punch
function punch() {
  const pl = G.player;
  if (pl.shootCooldown > 0) return;
  pl.shootCooldown = 0.32;
  pl.punchAnim = 1;
  const before = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  // The combat contract is swing(G) / shoot(G); try that first, then the
  // older positional spellings, then the local fallback below.
  callMethod(G.combat, ['swing'], G);
  let after = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  if (after <= before) {
    callMethod(G.combat, ['punch', 'tryPunch', 'attack'], pl.pos.x, pl.pos.y + 1.3, pl.pos.z, pl.heading);
    after = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  }
  if (after > before) { sfx('punch'); return; }
  // Fallback: the combat module did not register a swing — register one
  // here so the swing is always visible and testable.
  if (!G.combat.arcs) G.combat.arcs = [];
  G.combat.arcs.push({ x: pl.pos.x, y: pl.pos.y + 1.3, z: pl.pos.z, heading: pl.heading, t: 0 });
  const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
  let hit = null, hitD = 2.4;
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    const d = dist2(pl.pos.x, pl.pos.z, ped.pos.x, ped.pos.z);
    if (d < hitD) { hitD = d; hit = ped; }
  }
  if (hit) {
    hit.state = 'down';
    fxCall('burst', hit.pos.x, 1.2, hit.pos.z);
    say('Punch landed!');
  } else {
    fxCall('tracer', pl.pos.x, pl.pos.y + 1.3, pl.pos.z, pl.pos.x + fx * 2, pl.pos.y + 1.3, pl.pos.z + fz * 2);
  }
  sfx('punch');
}

function shoot() {
  const pl = G.player;
  if (pl.weapon !== 'pistol' || !pl.hasPistol) return;
  if (pl.shootCooldown > 0 || pl.ammo <= 0) {
    if (pl.ammo <= 0) say('Out of ammo — press Q for fists');
    return;
  }
  pl.shootCooldown = 0.28;
  pl.ammo -= 1;
  const before = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  callMethod(G.combat, ['shoot'], G);
  let after = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  if (after === before) {
    callMethod(G.combat, ['fire', 'tryShoot'], pl.pos.x, pl.pos.y + 1.4, pl.pos.z, pl.heading);
    after = (G.combat && G.combat.arcs) ? G.combat.arcs.length : 0;
  }
  if (after === before) {
    const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
    fxCall('muzzle', pl.pos.x + fx, pl.pos.y + 1.4, pl.pos.z + fz);
    fxCall('tracer', pl.pos.x + fx, pl.pos.y + 1.4, pl.pos.z + fz,
      pl.pos.x + fx * 40, pl.pos.y + 1.4, pl.pos.z + fz * 40);
  }
  sfx('gunshot');
}

// ------------------------------------------------------------- the step
export function step(dt) {
  if (!G || !scene) return;
  if (G.mode === 'paused' || G.mode === 'card' || G.mode === 'busted' ||
      G.mode === 'wasted' || G.mode === 'ending' || G.mode === 'briefing') {
    // World frozen on screens, but the camera still frames the scene.
    updateCamera(dt);
    return;
  }
  G.time += dt;
  const pl = G.player;
  pl.shootCooldown = Math.max(0, pl.shootCooldown - dt);
  pl.punchAnim = Math.max(0, pl.punchAnim - dt * 2.4);
  pl.invuln = Math.max(0, pl.invuln - dt);
  pl.health = G.health;

  if (G.mode === 'playing') {
    if (pl.car) driveCar(pl.car, dt);
    else walkPlayer(dt);
    callMethod(G.missions, ['update'], dt);
    callMethod(G.police, ['update'], dt);
    tickSubsystem(combatApi, combatMod, dt);
  }
  tickSubsystem(vehiclesApi, vehiclesMod, dt);
  tickSubsystem(pedsApi, pedsMod, dt);
  if (G.fx && typeof G.fx.update === 'function') {
    try { G.fx.update(dt); } catch (e) { /* ignore */ }
  }
  // Damaged cars trail smoke from the hood.
  if (pl.car && pl.car.health < 35 && pl.car.health > 0 && G.time - smokeAt > 0.15) {
    smokeAt = G.time;
    const hx = pl.car.pos.x + Math.sin(pl.car.heading) * 2;
    const hz = pl.car.pos.z + Math.cos(pl.car.heading) * 2;
    fxCall('smokePuff', hx, 1.1, hz);
  }
  // Player mesh follows the simulation (the player module builds the mesh;
  // main.js only syncs it so movement is never applied twice).
  syncPlayerMesh();
  updateCamera(dt);
  updateHud(dt);
  updateAudio(dt);
  pl.health = G.health;
}

function walkPlayer(dt) {
  const pl = G.player;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprint ? 6.6 : 4.1;
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { ix += Math.sin(pl.camYaw); iz += Math.cos(pl.camYaw); }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { ix -= Math.sin(pl.camYaw); iz -= Math.cos(pl.camYaw); }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { ix -= Math.cos(pl.camYaw); iz += Math.sin(pl.camYaw); }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { ix += Math.cos(pl.camYaw); iz -= Math.sin(pl.camYaw); }
  const len = Math.hypot(ix, iz);
  if (len > 0.01) {
    ix /= len; iz /= len;
    const nx = pl.pos.x + ix * speed * dt;
    const nz = pl.pos.z + iz * speed * dt;
    const [px, pz] = pushOut(nx, nz, 0.6);
    pl.pos.x = px; pl.pos.z = pz;
    pl.heading = Math.atan2(ix, iz);
    pl.walkPhase += dt * speed * 1.6;
  }
  // Jump / gravity.
  if (pl.pos.y > 0 || pl.vy !== 0) {
    pl.vy -= 22 * dt;
    pl.pos.y += pl.vy * dt;
    if (pl.pos.y <= 0) { pl.pos.y = 0; pl.vy = 0; }
  }
}

function driveCar(car, dt) {
  const pl = G.player;
  const damaged = car.health < 60;
  const topSpeed = car.disabled || car.health <= 0 ? 0 : damaged ? 16 : 27;
  const accel = damaged ? 8 : 14;
  const wantW = keys.has('KeyW') || keys.has('ArrowUp');
  const wantS = keys.has('KeyS') || keys.has('ArrowDown');
  const handbrake = keys.has('Space');
  if (car.health <= 0) car.disabled = true;
  if (!car.disabled) {
    if (wantW) car.speed += accel * dt;
    if (wantS) car.speed -= (car.speed > 0.5 ? 22 : 9) * dt;
    if (handbrake) car.speed *= Math.max(0, 1 - 3.2 * dt);
    else if (!wantW && !wantS) car.speed *= Math.max(0, 1 - 0.5 * dt);
    car.speed = clamp(car.speed, -9, topSpeed);
  } else {
    car.speed *= Math.max(0, 1 - 2 * dt);
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }
  let steer = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer += 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer -= 1;
  const spd = Math.abs(car.speed);
  if (steer !== 0 && spd > 0.2) {
    car.heading += steer * 1.55 * dt * clamp(spd / 6, 0, 1) * (car.speed >= 0 ? 1 : -1);
  }
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  const hit = circleHits(nx, nz, 1.7);
  if (hit) {
    const impact = Math.abs(car.speed);
    const [px, pz] = pushOut(nx, nz, 1.7);
    car.pos.x = px; car.pos.z = pz;
    if (impact > 6 && G.time - carBumpAt > 1) {
      carBumpAt = G.time;
      car.health = Math.max(0, car.health - 4);
      if (car.health <= 0) car.disabled = true;
      sfx('crash');
      fxCall('burst', car.pos.x, 1, car.pos.z);
      fxCall('shake', 0.35);
    }
    car.speed *= -0.25;
  } else {
    car.pos.x = nx; car.pos.z = nz;
  }
  // Shunt traffic: push other cars aside, small damage on hard hits.
  for (const other of G.cars) {
    if (other === car || other.isPolice) continue;
    const d = dist2(car.pos.x, car.pos.z, other.pos.x, other.pos.z);
    if (d < 3.4 && d > 0.01) {
      const push = (3.4 - d) / 2;
      const ux = (other.pos.x - car.pos.x) / d, uz = (other.pos.z - car.pos.z) / d;
      other.pos.x += ux * push; other.pos.z += uz * push;
      if (Math.abs(car.speed) > 10 && G.time - carBumpAt > 1) {
        carBumpAt = G.time;
        car.health = Math.max(0, car.health - 4);
        sfx('crash');
      }
    }
  }
  pl.pos.set(car.pos.x, 0, car.pos.z);
  pl.heading = car.heading;
  // Camera eases behind the car so driving feels stable.
  pl.camYaw = angLerp(pl.camYaw, car.heading, dt * 0.55);
}

function syncPlayerMesh() {
  const pl = G.player;
  const mesh = pl.mesh || (G.playerController && G.playerController.mesh) || G.playerMesh || (G.meshes && G.meshes.player);
  if (!mesh || !mesh.position) return;
  mesh.position.set(pl.pos.x, pl.pos.y, pl.pos.z);
  mesh.rotation.y = pl.heading;
  if (mesh.visible === false && G.mode === 'playing') mesh.visible = true;
}

// --------------------------------------------------------------- camera
function updateCamera(dt) {
  const pl = G.player;
  const driving = !!pl.car;
  const dist = driving ? 11 : camDist;
  const height = driving ? 4.6 : camHeight;
  const yaw = pl.camYaw;
  const pitch = pl.camPitch;
  const look = new THREE.Vector3(pl.pos.x, pl.pos.y + 1.6, pl.pos.z);
  const back = new THREE.Vector3(
    look.x - Math.sin(yaw) * Math.cos(pitch) * dist,
    look.y + Math.sin(pitch) * dist + height * 0.35,
    look.z - Math.cos(yaw) * Math.cos(pitch) * dist
  );
  // Building keep-out: never let the camera sit inside a building.
  const fixed = keepCameraClear(look, back);
  camera.position.lerp(fixed, dt > 0 ? Math.min(1, dt * 14) : 1);
  camera.lookAt(look);
  if (G.fx && typeof G.fx.applyShake === 'function') {
    try { G.fx.applyShake(camera); } catch (e) { /* ignore */ }
  }
}

// Walk the segment from the player to the wanted camera spot; stop just
// short of the first building the segment would cross.
function keepCameraClear(from, to) {
  const steps = 14;
  let last = from.clone();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = lerp(from.x, to.x, t), pz = lerp(from.z, to.z, t);
    if (circleHits(px, pz, 0.9)) return new THREE.Vector3(last.x, Math.max(last.y, 1.4), last.z);
    last.set(px, lerp(from.y, to.y, t), pz);
  }
  const out = to.clone();
  out.y = Math.max(out.y, 1.4);
  return out;
}

// On start / continue, snap the camera to a spot with a clear view.
export function snapCameraClear() {
  const pl = G.player;
  for (const d of [8, 10, 6, 12]) {
    for (const a of [0, 0.7, -0.7, 1.4, -1.4, Math.PI]) {
      const yaw = pl.camYaw + a;
      const cx = pl.pos.x - Math.sin(yaw) * d;
      const cz = pl.pos.z - Math.cos(yaw) * d;
      if (!circleHits(cx, cz, 1)) {
        camera.position.set(cx, pl.pos.y + 3.4, cz);
        return;
      }
    }
  }
}

// -------------------------------------------------------------------- hud
function updateHud(dt) {
  if (!hudApi) return;
  // Interact prompt, recomputed every frame.
  let prompt = '';
  const pl = G.player;
  if (G.mode === 'playing') {
    if (pl.car) {
      const m = G.markers.spray;
      if (m && dist2(pl.car.pos.x, pl.car.pos.z, m.x, m.z) <= 8) {
        prompt = 'Press F — Pay N Spray ($100)';
      } else if (G.taxi && G.taxi.phase === 'ride') {
        prompt = '';
      } else if (G.race && G.race.phase === 'none' && G.missions &&
          typeof G.missions.racePadNear === 'function' && G.missions.racePadNear()) {
        prompt = 'Press G — Street Race ($100–$200)';
      } else {
        prompt = 'Press E to exit the car';
      }
    } else {
      const car = nearestCar(5);
      if (car) prompt = 'Press E to steal the car';
      else if (G.taxi && G.taxi.phase === 'wait' && G.taxi.client) {
        if (dist2(pl.pos.x, pl.pos.z, G.taxi.client.pos.x, G.taxi.client.pos.z) < 8) prompt = 'Press T — Taxi fare';
      }
      if (!prompt && G.missions && typeof G.missions.dispatcherPosition === 'function') {
        const dp = G.missions.dispatcherPosition();
        if (dp && dist2(pl.pos.x, pl.pos.z, dp.x, dp.z) < 6) prompt = 'Press C — Courier parcel';
      }
    }
  }
  if (typeof hudApi.setInteract === 'function') {
    try { hudApi.setInteract(prompt); } catch (e) { /* ignore */ }
  }
  callMethod(hudApi, ['update', 'step', 'tick', 'render'], dt);
}

function updateAudio(dt) {
  if (!audioApi) return;
  const pl = G.player;
  const speed = pl.car ? Math.abs(pl.car.speed) : 0;
  callMethod(audioApi, ['setEngine'], speed, !!pl.car);
  callMethod(audioApi, ['setSiren'], G.wanted > 0);
  callMethod(audioApi, ['musicTick'], dt);
}

// ------------------------------------------------------- screens + flow
function busted() {
  if (G.mode !== 'playing') return;
  G.mode = 'busted';
  callMethod(G.police, ['clearWanted']);
  callMethod(G.missions, ['cancelSideJobs']);
  show($('busted-screen'));
  sfx('fail');
}
function wasted() {
  if (G.mode !== 'playing') return;
  G.mode = 'wasted';
  callMethod(G.police, ['clearWanted']);
  callMethod(G.missions, ['cancelSideJobs']);
  show($('wasted-screen'));
  sfx('fail');
}
export function hurt(n) {
  if (G.mode !== 'playing') return;
  G.health = Math.max(0, G.health - n);
  G.player.health = G.health;
  if (G.health <= 0) wasted();
}

function respawn() {
  hide($('busted-screen')); hide($('wasted-screen')); hide($('pause-menu'));
  G.health = 100; G.player.health = 100;
  G.player.invuln = 3;
  G.cash = Math.max(0, G.cash - 25);
  if (G.player.car) { G.player.car.parked = true; G.player.car = null; }
  const h = G.markers.hospital;
  const [hx, hz] = findClearSpot(h.x, h.z, 2);
  G.player.pos.set(hx, 0, hz);
  G.player.vy = 0;
  G.player.camYaw = 0;
  callMethod(G.police, ['clearWanted']);
  callMethod(G.missions, ['cancelSideJobs']);
  G.mode = 'playing';
  snapCameraClear();
  say('You woke up at the hospital (-$25)');
}

function showBriefing(title, text) {
  const t = $('briefing-title'), x = $('briefing-text');
  if (t) t.textContent = title;
  if (x) x.textContent = text;
  show($('briefing'));
  hide($('title-screen'));
  G.mode = 'briefing';
}

function wireButtons() {
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('btn-start', () => {
    sfx('ensure'); sfx('startMusic');
    hide($('title-screen')); show($('hud'));
    // Fresh run.
    G.cash = 0; G.wanted = 0; G.health = 100; G.player.health = 100;
    G.mission = 0; G.missionStep = 0;
    G.player.pos.set(0, 0, 120); G.player.camYaw = 0; G.player.car = null;
    G.player.hasPistol = false; G.player.ammo = 0; G.player.weapon = 'fists';
    callMethod(G.missions, ['startMission'], 0);
    snapCameraClear();
  });
  on('btn-continue', () => {
    sfx('ensure');
    if (!loadNow()) { say('No save found'); return; }
    hide($('title-screen')); show($('hud'));
    callMethod(G.missions, ['restoreForStep']);
    snapCameraClear();
  });
  on('btn-briefing', () => {
    hide($('briefing'));
    G.mode = 'playing';
    sfx('ensure'); sfx('startMusic');
  });
  on('btn-resume', () => { G.mode = 'playing'; hide($('pause-menu')); });
  on('btn-restart-mission', () => {
    hide($('pause-menu'));
    callMethod(G.missions, ['restartMission']);
    G.mode = 'playing';
  });
  on('btn-save', () => {
    saveNow();
    const note = $('pause-save-note'); if (note) note.textContent = 'Saved.';
  });
  on('btn-quit-title', () => {
    hide($('pause-menu')); hide($('hud'));
    G.mode = 'title';
    show($('title-screen'));
  });
  on('btn-mission-ok', () => {
    hide($('mission-panel'));
    callMethod(G.missions, ['advanceToNext']);
  });
  on('btn-busted', respawn);
  on('btn-wasted', respawn);
  on('btn-ending', () => {
    hide($('ending-screen')); hide($('hud'));
    G.mode = 'title';
    show($('title-screen'));
  });
}

// ------------------------------------------------------------- save/load
const SAVE_KEY = 'neon-harbor-save-v1';

function buildSaveObject() {
  const pl = G.player;
  const car = pl.car;
  return {
    version: 1,
    mission: G.mission, step: G.missionStep,
    cash: G.cash, health: G.health,
    player: { x: pl.pos.x, z: pl.pos.z, heading: pl.heading },
    car: car ? {
      model: car.model, color: car.color, name: car.name,
      special: !!car.special, x: car.pos.x, z: car.pos.z,
      heading: car.heading, health: car.health,
    } : null,
  };
}

function saveNow() {
  // Prefer the save module when it offers a save; otherwise write the
  // documented shape straight to localStorage.
  const viaModule = callMethod(saveApi, ['save', 'saveGame'], G) ??
    callMethod(saveMod, ['save', 'saveGame'], G);
  if (viaModule !== undefined && viaModule !== null) {
    try { if (localStorage.getItem(SAVE_KEY)) return true; } catch (e) { /* ignore */ }
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveObject()));
    return true;
  } catch (e) { return false; }
}

function applySave(obj) {
  if (!obj) return false;
  G.mission = obj.mission || 0;
  G.missionStep = obj.step || 0;
  G.missionActive = true;
  G.freeRoam = false;
  G.cash = obj.cash || 0;
  G.health = obj.health == null ? 100 : obj.health;
  G.player.health = G.health;
  if (obj.player) {
    G.player.pos.set(obj.player.x || 0, 0, obj.player.z || 120);
    G.player.heading = obj.player.heading || 0;
    G.player.camYaw = obj.player.heading || 0;
  }
  if (obj.car) {
    // Restore the driven car by name: reuse a parked car of the same
    // model, or re-skin any parked car, and park it at a clear spot.
    let car = G.cars.find((c) => !c.isPolice && c.parked && c.model === obj.car.model);
    if (!car) car = G.cars.find((c) => !c.isPolice && c.parked);
    if (car) {
      car.model = obj.car.model; car.color = obj.car.color;
      car.name = obj.car.name; car.special = !!obj.car.special;
      car.health = obj.car.health == null ? 100 : obj.car.health;
      car.disabled = car.health <= 0;
      const [cx, cz] = findClearSpot(obj.car.x, obj.car.z, 2.5);
      car.pos.set(cx, 0, cz);
      car.heading = obj.car.heading || 0;
      car.speed = 0; car.parked = false;
      G.player.car = car;
      G.player.heading = car.heading;
      G.player.camYaw = car.heading;
    }
  }
  G.wanted = 0;
  callMethod(G.police, ['clearWanted']);
  G.mode = 'briefing';
  return true;
}

function loadNow() {
  let obj = null;
  const viaModule = callMethod(saveApi, ['load', 'loadGame'], G) ??
    callMethod(saveMod, ['load', 'loadGame'], G);
  if (viaModule && typeof viaModule === 'object' && viaModule.mission != null) obj = viaModule;
  if (!obj) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) obj = JSON.parse(raw);
    } catch (e) { obj = null; }
  }
  if (!obj) return false;
  return applySave(obj);
}

// ---------------------------------------------------------- debug surface
function exposeDebug() {
  const api = {
    get mode() { return G.mode; },
    get pos() { return { x: G.player.pos.x, z: G.player.pos.z }; },
    setRender(v) { renderEnabled = !!v; },
    step,
    G,
    pressKey: (code, down) => handleKey(code, !!down),
    get player() { return G.player; },
    get time() { return G.time; },
    get mission() { return G.mission; },
    get missionStep() { return G.missionStep; },
    get taxiPhase() { return G.taxi ? G.taxi.phase : 'none'; },
    get taxiFare() { return G.taxi ? (G.taxi.fare || 0) : 0; },
    get courierPhase() { return G.courier ? G.courier.phase : 'none'; },
    get racePhase() { return G.race ? G.race.phase : 'none'; },
    get raceGate() { return G.race ? G.race.gate : 0; },
    get racePay() { return G.race ? G.race.pay : 0; },
    get heliActive() { return !!(G.police && typeof G.police.heliActive === 'function' && G.police.heliActive()); },
    get driving() { return !!G.player.car; },
    get carName() { return G.player.car ? (G.player.car.name || '') : ''; },
    get wanted() { return G.wanted; },
    get cash() { return G.cash; },
    get carHealth() { return G.player.car ? G.player.car.health : 100; },
    get policeCars() { return G.policeCars ? G.policeCars.length : 0; },
    get health() { return G.health; },
    hurt,
    teleport(x, z) {
      const pl = G.player;
      pl.pos.set(x, 0, z);
      pl.vy = 0;
      if (pl.car) { pl.car.pos.set(x, 0, z); pl.car.speed = 0; }
      snapCameraClear();
    },
    snapCameraClear,
    showBriefing,
    saveNow,
    loadNow,
  };
  window.__game = api;
  G.debug = api;
}

// Auto-boot once the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
