// Neon Harbor — front door of the game.
//
// This module owns the bits that glue everything else together: it
// creates the renderer, turns the city's evening light into a hard
// midday sun, listens to the keyboard and the mouse, steps the world
// once per frame, and owns every menu screen. The city, the cars, the
// cops and the story all live in their own modules; this one only
// decides the order they run in and what the player sees while they do.
//
// The camera gets special treatment here. The on-foot and driving rigs
// in player.js ease toward where they want to be, and easing can drag
// the lens straight through a wall — most visibly right after a
// Continue, when the camera starts out on the far side of the map from
// Cole. So each frame ends with a clearance pass that shoves the camera
// out of any building it landed inside, and every fresh or continued
// run snaps the camera to an open spot behind Cole first.
//
// Mouse look has to survive two awkward cases: a click on a menu must
// not also throw a punch, and a drag has to keep steering the view when
// the browser refuses pointer lock (headless test browsers do). Input
// therefore listens on the window during capture, throws away anything
// that landed on a button or a full-screen overlay, and treats a held
// drag as a look fallback whenever the pointer is not locked.
//
// The Pay N Spray is wired here too: roll onto the pad by the kiosk,
// press F, hand over $100, and the heat clears and the car comes back
// whole. The taxi side job's T key lives here as well.
import * as THREE from 'three';
import {
  makeGame,
  clamp,
  collideCircle,
  dist2D,
} from './state.js';
import { buildCity } from './city.js';
import {
  createPlayer,
  updatePlayer,
  damagePlayer,
} from './player.js';
import {
  spawnParkedCars,
  spawnTraffic,
  drivePlayerCar,
  updateTraffic,
  nearestCar,
  enterCar,
  exitCar,
  STEAL_REACH,
} from './vehicles.js';
import {
  spawnPedestrians,
  updatePedestrians,
  scarePedestrians,
} from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { SaveData } from './save.js';
import { stageShot } from './shots.js';

const sim = makeGame();
window.__game = undefined;

const byId = (id) => document.getElementById(id);

// What one Pay N Spray visit charges, and how near the pad the car has
// to sit before the prompt shows up.
const SPRAY_COST = 100;
const PAD_RADIUS = 7;

// --- Pay N Spray ----------------------------------------------------------

// True while Cole is behind the wheel and parked on the spray pad.
function carOnPad() {
  const hero = sim.player;
  const padPos = sim.markers.spray;
  if (!hero.car || !padPos) return false;
  return dist2D(hero.pos.x, hero.pos.z, padPos.x, padPos.z) < PAD_RADIUS;
}

function visitSprayShop() {
  const hero = sim.player;
  if (!hero.car || !carOnPad()) return;
  const car = hero.car;
  if (sim.wanted === 0 && car.health >= car.maxHealth) {
    sim.hud.showMessage('No heat and the car is clean — nothing to pay for.');
    return;
  }
  if (sim.cash < SPRAY_COST) {
    sim.hud.showMessage(`Not enough cash — Pay N Spray costs $${SPRAY_COST}.`);
    sim.audio.click();
    return;
  }
  sim.cash -= SPRAY_COST;
  sim.police.clearWanted(sim);
  car.health = car.maxHealth;
  sim.audio.cash();
  sim.hud.showMessage(`Pay N Spray: heat cleared, car fully repaired. -$${SPRAY_COST}.`);
}

// --- input ----------------------------------------------------------------

function tryEnterOrExitCar() {
  const hero = sim.player;
  if (hero.car) {
    exitCar(sim);
    return;
  }
  const car = nearestCar(sim, hero.pos, STEAL_REACH);
  if (!car) return;
  enterCar(sim, car);
  sim.stats.carsStolen++;
  if (car.stolen) return;
  car.stolen = true;
  sim.police.addWanted(sim, 1, `You stole the ${car.name}!`);
  scarePedestrians(sim, hero.pos.x, hero.pos.z, 20);
}

function swapWeapon() {
  if (sim.mode !== 'playing' || sim.player.car) return;
  const hero = sim.player;
  hero.weapon = hero.weapon === 'fists' ? 'pistol' : 'fists';
  sim.hud.showMessage(hero.weapon === 'pistol' ? 'Pistol ready.' : 'Fists ready.');
  sim.audio.click();
}

function uprightCar() {
  if (sim.mode !== 'playing' || !sim.player.car) return;
  const car = sim.player.car;
  car.speed = 0;
  car.mesh.rotation.set(0, car.heading, 0);
  sim.hud.showMessage('Car righted.');
}

function togglePause() {
  if (sim.mode === 'playing') {
    sim.mode = 'paused';
    byId('pause-menu').classList.remove('hidden');
    document.exitPointerLock?.();
    return;
  }
  if (sim.mode !== 'paused') return;
  sim.mode = 'playing';
  byId('pause-menu').classList.add('hidden');
}

function onKeyDown(e) {
  const key = e.code;
  if (key === 'Space') e.preventDefault();
  sim.input.keys.add(key);
  if (e.repeat) return;
  if (key === 'KeyM') {
    sim.audio.setMuted(!sim.audio.muted);
    sim.hud.showMessage(sim.audio.muted ? 'Sound muted.' : 'Sound on.');
    return;
  }
  if (key === 'KeyQ') {
    swapWeapon();
    return;
  }
  if (key === 'KeyE' && sim.mode === 'playing') {
    tryEnterOrExitCar();
    return;
  }
  if (key === 'KeyF' && sim.mode === 'playing') {
    visitSprayShop();
    return;
  }
  if (key === 'KeyT' && sim.mode === 'playing') {
    sim.missions.pickupFare(sim);
    return;
  }
  if (key === 'KeyR') {
    uprightCar();
    return;
  }
  if (key === 'Escape' || key === 'KeyP') {
    if (sim.mode === 'playing' || sim.mode === 'paused') togglePause();
  }
}

function bindKeys() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => sim.input.keys.delete(e.code));
  window.addEventListener('blur', () => sim.input.keys.clear());

  const view = byId('scene');
  let held = false;
  // Capture phase on the window: the click is seen no matter which layer
  // it landed on, and menu clicks are filtered out by target instead of
  // by which element happened to be on top.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.target && e.target.closest && e.target.closest('button, .screen')) return;
      if (sim.mode !== 'playing') return;
      held = true;
      const lock = view.requestPointerLock?.();
      if (lock && lock.catch) lock.catch(() => {});
      if (e.button === 0) sim.combat.attack(sim);
    },
    true,
  );
  window.addEventListener('mouseup', () => {
    held = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === view) {
      sim.input.mouseDX += e.movementX;
      sim.input.mouseDY += e.movementY;
    } else if (held && sim.mode === 'playing') {
      // Drag-look fallback: works with no pointer lock at all.
      sim.input.mouseDX += e.movementX;
      sim.input.mouseDY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== view) held = false;
  });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- menus ----------------------------------------------------------------

function bindMenus() {
  const tap = () => sim.audio.click();
  const showResume = () => {
    if (sim.save.load()) byId('btn-continue').classList.remove('hidden');
  };
  const starter = (index, fromSave) => () => {
    sim.audio.ensure();
    tap();
    startRun(index, fromSave);
  };
  const wiring = [
    ['btn-start', starter(0, false)],
    ['btn-continue', starter(null, true)],
    ['btn-resume', () => {
      tap();
      togglePause();
    }],
    ['btn-restart-mission', () => {
      tap();
      byId('pause-menu').classList.add('hidden');
      sim.missions.startMission(sim, sim.missionIndex, false);
      sim.mode = 'playing';
      sim.hud.showMessage('Mission restarted.');
    }],
    ['btn-save', () => {
      const ok = sim.save.save(sim);
      byId('pause-save-note').textContent = ok ? 'Saved.' : 'Save failed (browser storage unavailable).';
    }],
    ['btn-quit-title', () => {
      tap();
      sim.save.save(sim);
      byId('pause-menu').classList.add('hidden');
      sim.mode = 'title';
      byId('title-screen').classList.remove('hidden');
      sim.hud.hide();
      showResume();
    }],
    ['btn-mission-ok', () => {
      tap();
      byId('mission-panel').classList.add('hidden');
      sim.mode = 'playing';
      sim.missions.startMission(sim, sim.missionIndex, true);
    }],
    ['btn-busted', () => {
      tap();
      sim.missions.respawn(sim);
    }],
    ['btn-wasted', () => {
      tap();
      sim.missions.respawn(sim);
    }],
    ['btn-ending', () => {
      tap();
      byId('ending-screen').classList.add('hidden');
      sim.mode = 'playing';
      sim.missions.setFreeRoam(sim);
    }],
    ['btn-briefing', () => {
      tap();
      byId('briefing').classList.add('hidden');
      sim.mode = 'playing';
    }],
  ];
  showResume();
  for (let k = 0; k < wiring.length; k++) byId(wiring[k][0]).addEventListener('click', wiring[k][1]);
}

// --- world assembly -------------------------------------------------------

function setupRenderer() {
  const view = byId('scene');
  const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: !navigator.webdriver });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  Object.assign(renderer.shadowMap, { enabled: true, type: THREE.PCFSoftShadowMap });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  sim.renderer = renderer;
  sim.scene = new THREE.Scene();
  sim.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
  sim.camera.position.set(-40, 8, -14);
  window.addEventListener('resize', () => {
    sim.camera.aspect = window.innerWidth / window.innerHeight;
    sim.camera.updateProjectionMatrix();
    sim.renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// The city ships dusk-grade light; lift it into a bright midday sun so the
// streets read as a sun-soaked modern city instead of an evening haze.
function liftDaylight() {
  if (sim.sun) sim.sun.intensity = 3.6;
  const sky = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 1.5);
  const fill = new THREE.AmbientLight(0xfff2dd, 0.35);
  sim.scene.add(sky);
  sim.scene.add(fill);
  sim.scene.fog = new THREE.Fog(0x9fc3e8, 220, 720);
}

function assembleWorld() {
  setupRenderer();
  buildCity(sim);
  liftDaylight();
  createPlayer(sim);
  spawnParkedCars(sim);
  spawnTraffic(sim, 14);
  spawnPedestrians(sim, 24);
  sim.audio = new AudioEngine();
  sim.hud = new HUD(sim);
  sim.fx = new Effects(sim);
  sim.police = new Police(sim);
  sim.combat = new Combat(sim);
  sim.missions = new Missions(sim);
  sim.save = new SaveData();
  bindKeys();
  bindMenus();
  sim.camera.position.set(-60, 26, -60);
  sim.camera.lookAt(0, 4, 0);
}

// --- starting and continuing ----------------------------------------------

function startRun(missionIndex, fromSave) {
  byId('title-screen').classList.add('hidden');
  sim.hud.show();
  let jobNo = missionIndex ?? 0;
  let beatNo = 0;
  let note = '';
  if (fromSave) {
    const saved = sim.save.load();
    if (saved) {
      const restored = sim.save.apply(sim, saved);
      jobNo = restored.index;
      beatNo = restored.step;
      note = restored.note || '';
    }
  } else {
    sim.cash = 0;
    const hero = sim.player;
    hero.pos.set(-60, 0, -34);
    hero.heading = 0;
    hero.health = 100;
    sim.wanted = 0;
  }
  sim.mode = 'playing';
  sim.missions.startMission(sim, jobNo, true, beatNo);
  placeCameraBehind();
  sim.hud.showMessage(note ? `Welcome back, Cole. ${note}` : 'Welcome to Neon Harbor, Cole.');
}

// Put the camera on a clear spot behind Cole right away. The rig lerps
// from wherever the camera currently is; after a Continue that used to be
// the title orbit on the far side of the city, and the lerp path cut
// straight through buildings. Starting from a legal spot fixes both.
function placeCameraBehind() {
  const hero = sim.player;
  const behind = hero.heading + Math.PI;
  const bx = hero.pos.x + Math.sin(behind) * 8;
  const bz = hero.pos.z + Math.cos(behind) * 8;
  const open = collideCircle(sim, bx, bz, 1.2);
  sim.camera.position.set(open.x, 4.5, open.z);
  sim.camera.lookAt(hero.pos.x, 1.7, hero.pos.z);
}

// --- camera keep-out -------------------------------------------------------

// The camera rig lerps, so it can end a frame inside a wall even though its
// target is legal. Push it back out: first horizontally out of any building
// footprint, then along the sight line from the player — walk from the
// player toward the camera and stop just before the first blocked sample.
function enforceCameraClearance() {
  const cam = sim.camera;
  const pushed = collideCircle(sim, cam.position.x, cam.position.z, 1.2);
  cam.position.x = pushed.x;
  cam.position.z = pushed.z;
  const hero = sim.player;
  const origin = new THREE.Vector3(hero.pos.x, hero.pos.y + 1.7, hero.pos.z);
  const offset = new THREE.Vector3().subVectors(cam.position, origin);
  const span = offset.length();
  if (span < 0.5) return;
  const dir = offset.clone().multiplyScalar(1 / span);
  const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  let clearTo = 0;
  for (let i = 0; i < samples.length; i++) {
    const test = origin.clone().addScaledVector(dir, span * samples[i]);
    if (collideCircle(sim, test.x, test.z, 0.5).hit) break;
    clearTo = i + 1;
  }
  if (clearTo < samples.length) {
    const draw = Math.max(1.5, (span * clearTo) / samples.length - 0.6);
    cam.position.copy(origin).addScaledVector(dir, draw);
  }
  if (cam.position.y < 1.5) cam.position.y = 1.5;
}

// --- per-frame update -------------------------------------------------------

function tickScenery(dt) {
  if (sim.sea) sim.sea.position.y = 0.12 + Math.sin(sim.time * 0.7) * 0.05;
  if (sim.ferris) sim.ferris.children[0].rotation.z += dt * 0.15;
  const beacon = sim.beacon;
  if (!beacon || !beacon.visible) return;
  beacon.children[1].scale.setScalar(1 + Math.sin(sim.time * 4) * 0.15);
  beacon.children[0].material.opacity = 0.22 + Math.sin(sim.time * 4) * 0.08;
}

// The interact prompt: steal on foot, Pay N Spray while driving on the
// pad, taxi pickup next to a waiting fare. One prompt at a time, in that
// order of priority.
function currentPrompt() {
  const hero = sim.player;
  const taxi = sim.taxi;
  let fareNear = false;
  if (taxi.phase === 'wait' && taxi.client) {
    fareNear = dist2D(hero.pos.x, hero.pos.z, taxi.client.pos.x, taxi.client.pos.z) < 4;
  }
  if (!hero.car) {
    const car = nearestCar(sim, hero.pos, STEAL_REACH);
    if (car) return `Press E — steal the ${car.name}`;
    if (fareNear) return 'Press T — pick up the fare';
    return null;
  }
  if (carOnPad()) return `Press F — Pay N Spray ($${SPRAY_COST}): clear heat + repair`;
  if (fareNear) return 'Press T — pick up the fare';
  return null;
}

function refreshPrompt() {
  const hint = byId('interact');
  const line = currentPrompt();
  if (!line) {
    hint.classList.add('hidden');
    return;
  }
  hint.textContent = line;
  hint.classList.remove('hidden');
}

function spinTitleCamera() {
  const a = sim.time * 0.03;
  sim.camera.position.set(Math.sin(a) * 120, 42, Math.cos(a) * 120);
  sim.camera.lookAt(0, 6, 0);
}

function tick(dt) {
  sim.time += dt;
  tickScenery(dt);
  if (sim.mode === 'title') {
    spinTitleCamera();
    updateTraffic(sim, dt);
    updatePedestrians(sim, dt);
    return;
  }
  if (sim.mode !== 'playing') {
    return;
  }
  updatePlayer(sim, dt);
  if (sim.player.car) drivePlayerCar(sim, dt);
  updateTraffic(sim, dt);
  updatePedestrians(sim, dt);
  sim.police.update(sim, dt);
  sim.combat.update(sim, dt);
  sim.missions.update(sim, dt);
  sim.missions.updateTaxi(sim, dt);
  sim.fx.update(dt);
  sim.hud.update(sim, dt);
  refreshPrompt();
  enforceCameraClearance();
}

function renderScene() {
  if (sim._render !== false) sim.renderer.render(sim.scene, sim.camera);
}

// --- debug handle and main loop --------------------------------------------

function installTestHook() {
  const hero = sim.player;
  // Read-only snapshots for tests, plus the handful of actions a test
  // needs (teleport, start a mission, step the loop, press a key).
  const hook = {
    get mode() {
      return sim.mode;
    },
    get wanted() {
      return sim.wanted;
    },
    get cash() {
      return sim.cash;
    },
    get mission() {
      return sim.missionIndex;
    },
    get missionStep() {
      return sim.missionStep;
    },
    get driving() {
      return !!hero.car;
    },
    get health() {
      return hero.health;
    },
    get carHealth() {
      return hero.car ? hero.car.health : null;
    },
    get ammo() {
      return hero.ammo;
    },
    get weapon() {
      return hero.weapon;
    },
    get pos() {
      return { x: hero.pos.x, y: hero.pos.y, z: hero.pos.z };
    },
    get cars() {
      return sim.cars.length;
    },
    get police() {
      return sim.policeCars.length + sim.officers.length;
    },
    get policeCars() {
      return sim.policeCars.length;
    },
    get peds() {
      return sim.peds.length;
    },
    get enemies() {
      return sim.enemies.length;
    },
    get carName() {
      return hero.car ? hero.car.name : null;
    },
    get taxiPhase() {
      return sim.taxi.phase;
    },
    get taxiFare() {
      return sim.taxi.fare;
    },
    get cameraLocked() {
      return document.pointerLockElement === byId('scene');
    },
    teleport(x, z) {
      hero.pos.set(x, 0, z);
      if (hero.car) hero.car.pos.set(x, 0, z);
    },
    startMission(i) {
      sim.missions.startMission(sim, i, false);
      sim.mode = 'playing';
    },
    step(dt) {
      tick(dt || 0.05);
      renderScene();
    },
    setRender(on) {
      sim.renderEnabled = !!on;
      sim._render = !!on;
    },
    pressKey(code, down) {
      if (down) sim.input.keys.add(code);
      else sim.input.keys.delete(code);
    },
    // Test-only hook: hurt Cole through the real damage path (invuln,
    // vignette, wasted flow) without staging an enemy.
    hurt(amount) {
      damagePlayer(sim, amount, 'test');
    },
    G: sim,
  };
  window.__game = hook;
}

function boot() {
  assembleWorld();
  installTestHook();
  window.__shotReady = false;
  const query = new URLSearchParams(location.search);
  const snap = query.get('shot');
  if (snap) stageShot(sim, snap);
  // Fixed-step simulation: the world advances in 50ms slices of wall-clock
  // time, however fast or slow frames arrive, so a slow renderer (software
  // GL in a test browser) costs frames, never slow motion. The slice stays
  // small so a fast car cannot tunnel through a wall on one long step.
  // Rendering is still skipped on slow frames to stay responsive.
  const SLICE = 0.05;
  const MAX_SLICES = 20;
  let acc = 0;
  let prev = performance.now();
  let dropped = 0;
  let sinceDraw = 0;
  let avgMs = 16;
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let allowance = (now - prev) / 1000;
    prev = now;
    if (allowance > 1) allowance = 1;
    acc += allowance;
    let slices = 0;
    try {
      while (acc >= SLICE && slices < MAX_SLICES) {
        tick(SLICE);
        acc -= SLICE;
        slices++;
      }
    } catch (err) {
      console.error('update error', err);
      acc = 0;
    }
    if (slices === MAX_SLICES) acc = 0;
    sinceDraw++;
    const drawNow = sinceDraw > dropped && sim.renderEnabled !== false;
    sim._render = drawNow;
    if (!drawNow) return;
    sinceDraw = 0;
    const t0 = performance.now();
    try {
      renderScene();
    } catch (err) {
      console.error('render error', err);
    }
    const cost = performance.now() - t0;
    avgMs = avgMs * 0.8 + cost * 0.2;
    if (cost > 200) dropped = Math.max(dropped, Math.min(6, Math.round(cost / 150)));
    else if (avgMs > 70 && dropped < 6) dropped++;
    else if (avgMs < 30 && dropped > 0) dropped--;
  }
  loop();
}

boot();
