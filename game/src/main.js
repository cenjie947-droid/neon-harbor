// Neon Harbor — the entry point. This file builds the renderer, brightens
// the light, wires every key and mouse, runs the per-frame update, owns
// the menus, and hands automated tests a debug handle on window.__game.
// The world itself lives in the other modules; this file only drives them
// in the right order.
//
// Two things live here and nowhere else. First, the look: the city
// builder ships dusk-grade light, but this game is meant to read as a
// bright, sun-soaked modern city, so the sun, the sky fill and the
// exposure are lifted here once the city is built. Second, the camera:
// the on-foot and driving rigs in player.js lerp toward their target,
// which can drag the lens through a wall after a Continue spawn — so
// every frame ends with a keep-out pass that shoves the camera back out
// of any building it ended up inside, and a fresh or continued game snaps
// the camera to a clear spot behind Cole instead of lerping in from the
// title orbit.
//
// Mouse look: the HUD layer is pointer-events:none, so clicks reach the
// canvas — but a click on a menu overlay or a button must not also swing
// a punch, and a drag has to keep working when pointer lock refuses
// (headless browsers, mostly). Input therefore listens on the window in
// the capture phase, ignores anything that hit a button or an overlay,
// and treats a held drag as a look fallback whenever the pointer is not
// locked.
//
// Pay N Spray lives here too: drive onto the pad by the kiosk, press F,
// pay $100, and the wanted stars clear and the car comes back to full
// health. The taxi side job's T key is wired here as well.
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

const game = makeGame();
window.__game = undefined;

const el = (id) => document.getElementById(id);

// What a Pay N Spray visit costs, and how close the car has to be to the
// pad for the prompt to appear.
const GARAGE_PRICE = 100;
const GARAGE_REACH = 7;

// --- Pay N Spray ----------------------------------------------------------

// True when Cole is driving and sitting on the Pay N Spray pad.
function carOnSprayPad() {
  const cole = game.player;
  const pad = game.markers.spray;
  return !!cole.car && !!pad && dist2D(cole.pos.x, cole.pos.z, pad.x, pad.z) < GARAGE_REACH;
}

function runSprayService() {
  const cole = game.player;
  if (!cole.car || !carOnSprayPad()) return;
  const ride = cole.car;
  if (game.wanted === 0 && ride.health >= ride.maxHealth) {
    game.hud.showMessage('No heat and the car is clean — nothing to pay for.');
    return;
  }
  if (game.cash < GARAGE_PRICE) {
    game.hud.showMessage(`Not enough cash — Pay N Spray costs $${GARAGE_PRICE}.`);
    game.audio.click();
    return;
  }
  game.cash -= GARAGE_PRICE;
  game.police.clearWanted(game);
  ride.health = ride.maxHealth;
  game.audio.cash();
  game.hud.showMessage(`Pay N Spray: heat cleared, car fully repaired. -$${GARAGE_PRICE}.`);
}

// --- input ----------------------------------------------------------------

function toggleCarEntry() {
  const cole = game.player;
  if (cole.car) {
    exitCar(game);
    return;
  }
  const ride = nearestCar(game, cole.pos, STEAL_REACH);
  if (!ride) return;
  enterCar(game, ride);
  game.stats.carsStolen++;
  if (!ride.stolen) {
    ride.stolen = true;
    game.police.addWanted(game, 1, `You stole the ${ride.name}!`);
    scarePedestrians(game, cole.pos.x, cole.pos.z, 20);
  }
}

function cycleWeapon() {
  if (game.mode !== 'playing' || game.player.car) return;
  const cole = game.player;
  cole.weapon = cole.weapon === 'fists' ? 'pistol' : 'fists';
  game.hud.showMessage(cole.weapon === 'pistol' ? 'Pistol ready.' : 'Fists ready.');
  game.audio.click();
}

function rightCar() {
  if (game.mode !== 'playing' || !game.player.car) return;
  const ride = game.player.car;
  ride.speed = 0;
  ride.mesh.rotation.set(0, ride.heading, 0);
  game.hud.showMessage('Car righted.');
}

function flipPause() {
  if (game.mode === 'playing') {
    game.mode = 'paused';
    el('pause-menu').classList.remove('hidden');
    document.exitPointerLock?.();
  } else if (game.mode === 'paused') {
    game.mode = 'playing';
    el('pause-menu').classList.add('hidden');
  }
}

function handleKeyDown(e) {
  const code = e.code;
  if (code === 'Space') e.preventDefault();
  game.input.keys.add(code);
  if (e.repeat) return;
  switch (code) {
    case 'KeyM':
      game.audio.setMuted(!game.audio.muted);
      game.hud.showMessage(game.audio.muted ? 'Sound muted.' : 'Sound on.');
      break;
    case 'KeyQ':
      cycleWeapon();
      break;
    case 'KeyE':
      if (game.mode === 'playing') toggleCarEntry();
      break;
    case 'KeyF':
      if (game.mode === 'playing') runSprayService();
      break;
    case 'KeyT':
      if (game.mode === 'playing') game.missions.pickupFare(game);
      break;
    case 'KeyR':
      rightCar();
      break;
    case 'Escape':
    case 'KeyP':
      if (game.mode === 'playing' || game.mode === 'paused') flipPause();
      break;
    default:
      break;
  }
}

function wireKeyboard() {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', (e) => game.input.keys.delete(e.code));
  window.addEventListener('blur', () => game.input.keys.clear());

  const canvas = el('scene');
  let dragging = false;
  // Capture phase on the window: the click is seen no matter which layer
  // it landed on, and menu clicks are filtered out by target instead of
  // by which element happened to be on top.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.target && e.target.closest && e.target.closest('button, .screen')) return;
      if (game.mode !== 'playing') return;
      dragging = true;
      const lock = canvas.requestPointerLock?.();
      if (lock && lock.catch) lock.catch(() => {});
      if (e.button === 0) game.combat.attack(game);
    },
    true,
  );
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      game.input.mouseDX += e.movementX;
      game.input.mouseDY += e.movementY;
    } else if (dragging && game.mode === 'playing') {
      // Drag-look fallback: works with no pointer lock at all.
      game.input.mouseDX += e.movementX;
      game.input.mouseDY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) dragging = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- menus ----------------------------------------------------------------

function wireButtons() {
  const clickSound = () => game.audio.click();
  const showContinue = () => {
    if (game.save.load()) el('btn-continue').classList.remove('hidden');
  };
  const begin = (index, fromSave) => () => {
    game.audio.ensure();
    clickSound();
    startRun(index, fromSave);
  };
  const actions = [
    ['btn-start', begin(0, false)],
    ['btn-continue', begin(null, true)],
    ['btn-resume', () => {
      clickSound();
      flipPause();
    }],
    ['btn-restart-mission', () => {
      clickSound();
      el('pause-menu').classList.add('hidden');
      game.missions.startMission(game, game.missionIndex, false);
      game.mode = 'playing';
      game.hud.showMessage('Mission restarted.');
    }],
    ['btn-save', () => {
      const ok = game.save.save(game);
      el('pause-save-note').textContent = ok ? 'Saved.' : 'Save failed (browser storage unavailable).';
    }],
    ['btn-quit-title', () => {
      clickSound();
      game.save.save(game);
      el('pause-menu').classList.add('hidden');
      game.mode = 'title';
      el('title-screen').classList.remove('hidden');
      game.hud.hide();
      showContinue();
    }],
    ['btn-mission-ok', () => {
      clickSound();
      el('mission-panel').classList.add('hidden');
      game.mode = 'playing';
      game.missions.startMission(game, game.missionIndex, true);
    }],
    ['btn-busted', () => {
      clickSound();
      game.missions.respawn(game);
    }],
    ['btn-wasted', () => {
      clickSound();
      game.missions.respawn(game);
    }],
    ['btn-ending', () => {
      clickSound();
      el('ending-screen').classList.add('hidden');
      game.mode = 'playing';
      game.missions.setFreeRoam(game);
    }],
    ['btn-briefing', () => {
      clickSound();
      el('briefing').classList.add('hidden');
      game.mode = 'playing';
    }],
  ];
  showContinue();
  for (const [id, fn] of actions) el(id).addEventListener('click', fn);
}

// --- world assembly -------------------------------------------------------

function createRenderer() {
  const canvas = el('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !navigator.webdriver });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  Object.assign(renderer.shadowMap, { enabled: true, type: THREE.PCFSoftShadowMap });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  game.renderer = renderer;
  game.scene = new THREE.Scene();
  game.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
  game.camera.position.set(-40, 8, -14);
  window.addEventListener('resize', () => {
    game.camera.aspect = window.innerWidth / window.innerHeight;
    game.camera.updateProjectionMatrix();
    game.renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// The city ships dusk-grade light; lift it into a bright midday sun so the
// streets read as a sun-soaked modern city instead of an evening haze.
function brightenCity() {
  if (game.sun) game.sun.intensity = 3.6;
  const fills = [
    new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 1.5),
    new THREE.AmbientLight(0xfff2dd, 0.35),
  ];
  for (const light of fills) game.scene.add(light);
  game.scene.fog = new THREE.Fog(0x9fc3e8, 220, 720);
}

function buildWorld() {
  createRenderer();
  buildCity(game);
  brightenCity();
  createPlayer(game);
  spawnParkedCars(game);
  spawnTraffic(game, 14);
  spawnPedestrians(game, 24);
  game.audio = new AudioEngine();
  game.hud = new HUD(game);
  game.fx = new Effects(game);
  game.police = new Police(game);
  game.combat = new Combat(game);
  game.missions = new Missions(game);
  game.save = new SaveData();
  wireKeyboard();
  wireButtons();
  game.camera.position.set(-60, 26, -60);
  game.camera.lookAt(0, 4, 0);
}

// --- starting and continuing ----------------------------------------------

function startRun(missionIndex, fromSave) {
  el('title-screen').classList.add('hidden');
  game.hud.show();
  let startMission = missionIndex ?? 0;
  let resumeStep = 0;
  let resumeNote = '';
  if (fromSave) {
    const data = game.save.load();
    if (data) {
      const resumed = game.save.apply(game, data);
      startMission = resumed.index;
      resumeStep = resumed.step;
      resumeNote = resumed.note || '';
    }
  } else {
    game.cash = 0;
    const cole = game.player;
    cole.pos.set(-60, 0, -34);
    cole.heading = 0;
    cole.health = 100;
    game.wanted = 0;
  }
  game.mode = 'playing';
  game.missions.startMission(game, startMission, true, resumeStep);
  snapCameraBehind();
  const greeting = resumeNote ? `Welcome back, Cole. ${resumeNote}` : 'Welcome to Neon Harbor, Cole.';
  game.hud.showMessage(greeting);
}

// Put the camera on a clear spot behind Cole right away. The rig lerps
// from wherever the camera currently is; after a Continue that used to be
// the title orbit on the far side of the city, and the lerp path cut
// straight through buildings. Starting from a legal spot fixes both.
function snapCameraBehind() {
  const cole = game.player;
  const back = cole.heading + Math.PI;
  const spotX = cole.pos.x + Math.sin(back) * 8;
  const spotZ = cole.pos.z + Math.cos(back) * 8;
  const clear = collideCircle(game, spotX, spotZ, 1.2);
  game.camera.position.set(clear.x, 4.5, clear.z);
  game.camera.lookAt(cole.pos.x, 1.7, cole.pos.z);
}

// --- camera keep-out -------------------------------------------------------

// The camera rig lerps, so it can end a frame inside a wall even though its
// target is legal. Push it back out: first horizontally out of any building
// footprint, then along the sight line from the player — walk from the
// player toward the camera and stop just before the first blocked sample.
function keepCameraClear() {
  const cam = game.camera;
  const pushed = collideCircle(game, cam.position.x, cam.position.z, 1.2);
  cam.position.x = pushed.x;
  cam.position.z = pushed.z;
  const cole = game.player;
  const eye = new THREE.Vector3(cole.pos.x, cole.pos.y + 1.7, cole.pos.z);
  const toCam = new THREE.Vector3().subVectors(cam.position, eye);
  const len = toCam.length();
  const tooClose = len < 0.5;
  if (tooClose) return;
  const step = toCam.clone().multiplyScalar(1 / len);
  let lastClear = 0;
  const fractions = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  for (let i = 0; i < fractions.length; i++) {
    const probe = eye.clone().addScaledVector(step, len * fractions[i]);
    const blocked = collideCircle(game, probe.x, probe.z, 0.5).hit;
    if (blocked) break;
    lastClear = i + 1;
  }
  if (lastClear < fractions.length) {
    const pull = Math.max(1.5, (len * lastClear) / fractions.length - 0.6);
    cam.position.copy(eye).addScaledVector(step, pull);
  }
  if (cam.position.y < 1.5) cam.position.y = 1.5;
}

// --- per-frame update -------------------------------------------------------

function animateScenery(dt) {
  if (game.sea) game.sea.position.y = 0.12 + Math.sin(game.time * 0.7) * 0.05;
  if (game.ferris) game.ferris.children[0].rotation.z += dt * 0.15;
  const beacon = game.beacon;
  if (beacon && beacon.visible) {
    beacon.children[1].scale.setScalar(1 + Math.sin(game.time * 4) * 0.15);
    beacon.children[0].material.opacity = 0.22 + Math.sin(game.time * 4) * 0.08;
  }
}

// The interact prompt: steal on foot, Pay N Spray while driving on the
// pad, taxi pickup next to a waiting fare. One prompt at a time, in that
// order of priority.
function promptText() {
  const cole = game.player;
  const taxi = game.taxi;
  const fareNear =
    taxi.phase === 'wait' &&
    taxi.client &&
    dist2D(cole.pos.x, cole.pos.z, taxi.client.pos.x, taxi.client.pos.z) < 4;
  if (!cole.car) {
    const ride = nearestCar(game, cole.pos, STEAL_REACH);
    if (ride) return `Press E — steal the ${ride.name}`;
    if (fareNear) return 'Press T — pick up the fare';
    return null;
  }
  if (carOnSprayPad()) return `Press F — Pay N Spray ($${GARAGE_PRICE}): clear heat + repair`;
  if (fareNear) return 'Press T — pick up the fare';
  return null;
}

function updateInteractPrompt() {
  const prompt = el('interact');
  const text = promptText();
  if (text) {
    prompt.textContent = text;
    prompt.classList.remove('hidden');
  } else {
    prompt.classList.add('hidden');
  }
}

function orbitTitleCamera() {
  const a = game.time * 0.03;
  game.camera.position.set(Math.sin(a) * 120, 42, Math.cos(a) * 120);
  game.camera.lookAt(0, 6, 0);
}

function frame(dt) {
  game.time += dt;
  animateScenery(dt);
  if (game.mode === 'title') {
    orbitTitleCamera();
    updateTraffic(game, dt);
    updatePedestrians(game, dt);
    return;
  }
  if (game.mode !== 'playing') {
    return;
  }
  updatePlayer(game, dt);
  if (game.player.car) drivePlayerCar(game, dt);
  updateTraffic(game, dt);
  updatePedestrians(game, dt);
  game.police.update(game, dt);
  game.combat.update(game, dt);
  game.missions.update(game, dt);
  game.missions.updateTaxi(game, dt);
  game.fx.update(dt);
  game.hud.update(game, dt);
  updateInteractPrompt();
  keepCameraClear();
}

function drawFrame() {
  if (game._render !== false) game.renderer.render(game.scene, game.camera);
}

// --- debug handle and main loop --------------------------------------------

function exposeTestHandle() {
  const cole = game.player;
  // Read-only snapshots for tests, plus the handful of actions a test
  // needs (teleport, start a mission, step the loop, press a key).
  const handle = {
    get mode() {
      return game.mode;
    },
    get wanted() {
      return game.wanted;
    },
    get cash() {
      return game.cash;
    },
    get mission() {
      return game.missionIndex;
    },
    get missionStep() {
      return game.missionStep;
    },
    get driving() {
      return !!cole.car;
    },
    get health() {
      return cole.health;
    },
    get carHealth() {
      return cole.car ? cole.car.health : null;
    },
    get ammo() {
      return cole.ammo;
    },
    get weapon() {
      return cole.weapon;
    },
    get pos() {
      return { x: cole.pos.x, y: cole.pos.y, z: cole.pos.z };
    },
    get cars() {
      return game.cars.length;
    },
    get police() {
      return game.policeCars.length + game.officers.length;
    },
    get policeCars() {
      return game.policeCars.length;
    },
    get peds() {
      return game.peds.length;
    },
    get enemies() {
      return game.enemies.length;
    },
    get carName() {
      return cole.car ? cole.car.name : null;
    },
    get taxiPhase() {
      return game.taxi.phase;
    },
    get taxiFare() {
      return game.taxi.fare;
    },
    get cameraLocked() {
      return document.pointerLockElement === el('scene');
    },
    teleport(x, z) {
      cole.pos.set(x, 0, z);
      if (cole.car) cole.car.pos.set(x, 0, z);
    },
    startMission(i) {
      game.missions.startMission(game, i, false);
      game.mode = 'playing';
    },
    step(dt) {
      frame(dt || 0.05);
      drawFrame();
    },
    setRender(on) {
      game.renderEnabled = !!on;
      game._render = !!on;
    },
    pressKey(code, down) {
      if (down) game.input.keys.add(code);
      else game.input.keys.delete(code);
    },
    // Test-only hook: hurt Cole through the real damage path (invuln,
    // vignette, wasted flow) without staging an enemy.
    hurt(amount) {
      damagePlayer(game, amount, 'test');
    },
    G: game,
  };
  window.__game = handle;
}

function launch() {
  buildWorld();
  exposeTestHandle();
  window.__shotReady = false;
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot) stageShot(game, shot);
  // Fixed-step simulation: the world advances in 50ms slices of wall-clock
  // time, however fast or slow frames arrive, so a slow renderer (software
  // GL in a test browser) costs frames, never slow motion. The slice stays
  // small so a fast car cannot tunnel through a wall on one long step.
  // Rendering is still skipped on slow frames to stay responsive.
  const STEP = 0.05;
  const MAX_STEPS = 20;
  let carry = 0;
  let last = performance.now();
  let skipped = 0;
  let framesSinceDraw = 0;
  let meanMs = 16;
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let budget = (now - last) / 1000;
    last = now;
    if (budget > 1) budget = 1;
    carry += budget;
    let steps = 0;
    try {
      while (carry >= STEP && steps < MAX_STEPS) {
        frame(STEP);
        carry -= STEP;
        steps++;
      }
    } catch (err) {
      console.error('update error', err);
      carry = 0;
    }
    if (steps === MAX_STEPS) carry = 0;
    framesSinceDraw++;
    const wantDraw = framesSinceDraw > skipped && game.renderEnabled !== false;
    game._render = wantDraw;
    if (!wantDraw) return;
    framesSinceDraw = 0;
    const started = performance.now();
    try {
      drawFrame();
    } catch (err) {
      console.error('render error', err);
    }
    const spent = performance.now() - started;
    meanMs = meanMs * 0.8 + spent * 0.2;
    if (spent > 200) skipped = Math.max(skipped, Math.min(6, Math.round(spent / 150)));
    else if (meanMs > 70 && skipped < 6) skipped++;
    else if (meanMs < 30 && skipped > 0) skipped--;
  }
  loop();
}

launch();
