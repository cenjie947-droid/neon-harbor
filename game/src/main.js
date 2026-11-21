// Neon Harbor — entry wiring and game loop.
//
// This file builds the world out of the other modules, runs the frame
// loop, and owns everything the player touches directly: keyboard and
// mouse, the camera, the title / pause / busted / wasted / ending
// screens, saving and continuing, the Pay N Spray, and the screenshot
// staging the test driver uses (?shot=title|chase|drive|mission).
//
// The world only advances while mode is 'playing'. Every other mode
// freezes the simulation but keeps rendering, so the city stays alive
// behind the menus. The driver drives the game through window.__game:
// step(dt) advances one tick, pressKey feeds the input set, teleport
// moves Cole (and his car), hurt damages him.

import * as THREE from 'three';
import {
  WORLD, makeGame, clamp, rand, randInt, pick, dist2D, angleLerp,
  inWorldBounds, collideCircle, segmentBlocked, vec3,
} from './state.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
import {
  STEAL_REACH, createCar, spawnParkedCars, spawnTraffic,
  damageFactor, damageCar, carBoxDistance, nearestCar,
  enterCar, exitCar, drivePlayerCar, updateTraffic,
} from './vehicles.js';
import { spawnPedestrians, updatePedestrians, scarePedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions, MISSIONS } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { SaveData } from './save.js';
import { stageShot } from './shots.js';

const SAVE_KEY = 'neon-harbor-save-v1';
const SPRAY_RANGE = 7;
const SPRAY_PRICE = 100;

const canvas = document.getElementById('scene');

// ---------------------------------------------------------------- build

function buildWorld() {
  const game = makeGame();
  game.mode = 'title';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  game.renderer = renderer;

  const scene = new THREE.Scene();
  game.scene = scene;
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 60, 160);
  game.camera = camera;

  game.player = createPlayer(game);
  if (game.player.health === undefined) game.player.health = 100;
  if (!game.player.weapon) game.player.weapon = 'fists';
  const hideout = { x: -60, z: -60 };
  game.player.pos.set(hideout.x, 0, hideout.z);
  game.player.heading = 0;

  game.hud = new HUD(game);
  game.audio = new AudioEngine();
  game.fx = new Effects(game);
  game.police = new Police(game);
  game.combat = new Combat(game);
  game.missions = new Missions(game);
  game.save = new SaveData();

  buildCity(game);
  spawnParkedCars(game);
  spawnTraffic(game, 18);
  spawnPedestrians(game, 60);

  // The two cars the story revolves around.
  const comet = createCar(game, {
    x: 135, z: -118, heading: Math.PI / 2,
    color: 0xffe14d, name: 'Comet GT', parked: true,
  });
  game.cometGT = comet;
  const van = createCar(game, {
    x: -108, z: -120, heading: 0,
    color: 0x2a4a6a, name: 'Bank Van', isVan: true, parked: true,
  });
  game.bankVan = van;

  // A beacon pillar that marks the current objective.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.visible = false;
  scene.add(beacon);
  game.beaconMesh = beacon;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return game;
}

const G = buildWorld();

// Camera state. On foot the camera sits behind Cole and the mouse turns
// him; in a car the camera trails the car and the mouse orbits it.
let camYaw = 0;
let driveYawOffset = 0;
let dragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let titleAngle = 0;

// ---------------------------------------------------------------- screens

const SCREENS = ['title-screen', 'briefing', 'pause-menu', 'mission-panel', 'busted-screen', 'wasted-screen', 'ending-screen'];

function showOnly(id) {
  for (const s of SCREENS) {
    const node = document.getElementById(s);
    if (node) node.classList.toggle('hidden', s !== id);
  }
}

function hideScreens() {
  for (const s of SCREENS) {
    const node = document.getElementById(s);
    if (node) node.classList.add('hidden');
  }
}

function setHudVisible(on) {
  if (on) G.hud.show();
  else G.hud.hide();
}

// ---------------------------------------------------------------- camera

// Walk the camera in from its ideal spot until the line from the
// target to the camera is clear of buildings, so it never clips into
// a wall. If even a close camera is inside a wall, lift it up.
function placeCamera(target, yaw, dist, height) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let useDist = dist;
  let useHeight = height;
  for (const d of [dist, 5, 3, 1.6]) {
    const cx = target.x - fx * d;
    const cz = target.z - fz * d;
    if (!segmentBlocked(G, target.x, target.z, cx, cz) && !collideCircle(G, cx, cz, 0.6).hit) {
      useDist = d;
      break;
    }
    useDist = d;
  }
  let cx = target.x - fx * useDist;
  let cz = target.z - fz * useDist;
  if (collideCircle(G, cx, cz, 0.6).hit) useHeight = Math.max(height, 11);
  G.camera.position.set(cx, useHeight, cz);
  G.camera.lookAt(target.x + fx * 4, 1.4, target.z + fz * 4);
}

function updateCamera(dt) {
  const car = G.player.car;
  if (G.mode === 'title') {
    titleAngle += dt * 0.03;
    const r = 170;
    G.camera.position.set(Math.sin(titleAngle) * r, 70, Math.cos(titleAngle) * r);
    G.camera.lookAt(0, 10, 0);
    return;
  }
  if (car) {
    const yaw = car.heading + driveYawOffset;
    placeCamera(car.pos, yaw, 9.5, 4.2);
  } else {
    placeCamera(G.player.pos, camYaw, 7, 3.4);
  }
}

// ---------------------------------------------------------------- flow

function startPlaying() {
  hideScreens();
  setHudVisible(true);
  G.mode = 'playing';
}

function respawn() {
  hideScreens();
  const hideout = G.markers.hideout;
  G.player.pos.set(hideout.x, 0, hideout.z);
  G.player.heading = 0;
  camYaw = 0;
  driveYawOffset = 0;
  if (G.player.car) {
    G.player.car = null;
  }
  G.player.health = 100;
  G.cash = Math.max(0, G.cash - 25);
  G.police.clearWanted(G);
  G.missions.cancelSideJobs(G);
  startPlaying();
}

function enterWasted() {
  if (G.mode === 'wasted') return;
  G.missions.cancelSideJobs(G);
  G.mode = 'wasted';
  if (G.audio) G.audio.fail();
  showOnly('wasted-screen');
  setHudVisible(false);
}

function hurt(amount) {
  damagePlayer(G, amount, 'injury');
  if (G.hud) G.hud.flashDamage();
  if (G.player.health <= 0) enterWasted();
}

// ---------------------------------------------------------------- Pay N Spray

function tryPayNSpray() {
  const car = G.player.car;
  const spray = G.markers.spray;
  if (!car || !spray) return;
  if (dist2D(car.pos.x, car.pos.z, spray.x, spray.z) > SPRAY_RANGE) {
    if (G.hud) G.hud.showMessage('Pay N Spray is at the blue marker — drive onto the pad.');
    return;
  }
  if (G.cash < SPRAY_PRICE) {
    if (G.hud) G.hud.showMessage(`Pay N Spray costs $${SPRAY_PRICE} — you have $${G.cash}.`);
    return;
  }
  if (G.wanted === 0 && car.health >= 100) {
    if (G.hud) G.hud.showMessage('Nothing to fix — the car is clean and the heat is off.');
    return;
  }
  G.cash -= SPRAY_PRICE;
  G.police.clearWanted(G);
  car.health = 100;
  if (G.audio) G.audio.cash();
  if (G.hud) G.hud.showMessage(`Pay N Spray: heat cleared, car repaired — $${SPRAY_PRICE}.`);
}

// ---------------------------------------------------------------- input

function onKeyDown(e) {
  if (e.repeat) {
    G.input.keys.add(e.code);
    return;
  }
  G.input.keys.add(e.code);
  if (e.code === 'KeyM') {
    if (G.audio) G.audio.setMuted(!G.audio.muted);
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (G.mode === 'playing') {
      G.mode = 'paused';
      showOnly('pause-menu');
      const note = document.getElementById('pause-save-note');
      if (note) note.textContent = '';
    } else if (G.mode === 'paused') {
      startPlaying();
    }
    return;
  }
  if (G.mode !== 'playing') return;
  if (e.code === 'KeyE') {
    if (G.player.car) {
      exitCar(G);
    } else {
      const car = nearestCar(G, G.player.pos, STEAL_REACH);
      if (car) enterCar(G, car);
    }
  } else if (e.code === 'KeyF') {
    if (G.player.car) tryPayNSpray();
    else if (G.combat) G.combat.attack(G);
  } else if (e.code === 'KeyT') {
    if (G.missions) G.missions.tryTaxiPickup(G);
  } else if (e.code === 'KeyC') {
    if (G.missions) G.missions.tryCourierPickup(G);
  } else if (e.code === 'KeyQ') {
    G.player.weapon = G.player.weapon === 'pistol' ? 'fists' : 'pistol';
    if (G.hud) G.hud.showMessage(G.player.weapon === 'pistol' ? 'Pistol ready.' : 'Fists.');
  } else if (e.code === 'KeyR') {
    const car = G.player.car;
    if (car) {
      car.speed = 0;
      const bx = car.pos.x - Math.sin(car.heading) * 2;
      const bz = car.pos.z - Math.cos(car.heading) * 2;
      if (!collideCircle(G, bx, bz, 1.7).hit) {
        car.pos.x = bx;
        car.pos.z = bz;
      }
      if (G.hud) G.hud.showMessage('Car righted.');
    }
  }
}

function onKeyUp(e) {
  G.input.keys.delete(e.code);
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

canvas.addEventListener('mousedown', (e) => {
  if (G.mode !== 'playing') return;
  dragging = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch {
    // Pointer lock is a nicety; the drag fallback covers it.
  }
});

window.addEventListener('mouseup', () => {
  dragging = false;
});

window.addEventListener('mousemove', (e) => {
  if (G.mode !== 'playing') return;
  let dx = 0;
  if (document.pointerLockElement === canvas) {
    dx = e.movementX || 0;
  } else if (dragging) {
    dx = (e.clientX - lastMouseX) * 1.6;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  } else {
    return;
  }
  if (G.player.car) {
    driveYawOffset = clamp(driveYawOffset - dx * 0.0032, -1.2, 1.2);
  } else {
    camYaw = camYaw - dx * 0.0032;
    G.player.heading = camYaw;
  }
});

// Click to punch, or shoot when the pistol is out. Clicks on buttons
// and menu screens are not attacks.
window.addEventListener('mousedown', (e) => {
  if (G.mode !== 'playing' || e.button !== 0) return;
  const t = e.target;
  if (t && t.closest && (t.closest('button') || t.closest('.screen'))) return;
  if (G.player.weapon === 'pistol') {
    if (G.combat) G.combat.shoot(G);
  } else if (G.combat) {
    G.combat.attack(G);
  }
});

// ---------------------------------------------------------------- buttons

function wireButtons() {
  const on = (id, fn) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener('click', fn);
  };
  on('btn-start', () => {
    if (G.audio) {
      G.audio.ensure();
      G.audio.startMusic();
    }
    G.cash = 0;
    G.wanted = 0;
    G.player.health = 100;
    G.police.clearUnits(G);
    const hideout = G.markers.hideout;
    G.player.pos.set(hideout.x, 0, hideout.z);
    G.player.heading = 0;
    camYaw = 0;
    driveYawOffset = 0;
    G.missions.startMission(G, 0);
  });
  on('btn-continue', () => {
    let data = null;
    try {
      data = G.save.load();
    } catch {
      data = null;
    }
    if (!data) return;
    try {
      G.save.apply(G, data);
    } catch {
      // A stale save still shows the briefing for the stored mission.
    }
    // The save record carries the mission beat, cash and heat; apply()
    // restores the player and the car, so the mission fields are set
    // back from the same record here.
    if (typeof data.missionIndex === 'number') G.missionIndex = data.missionIndex;
    if (typeof data.missionStep === 'number') G.missionStep = data.missionStep;
    if (typeof data.cash === 'number') G.cash = data.cash;
    if (typeof data.wanted === 'number') G.wanted = data.wanted;
    if (G.audio) {
      G.audio.ensure();
      G.audio.startMusic();
    }
    setHudVisible(false);
    if (G.missionIndex < MISSIONS.length) {
      G.missionActive = true;
      G.missionDone = false;
      G.missions.beginStep(G);
      G.missions.showBriefing(G);
    } else {
      G.missions.setFreeRoam(G);
      startPlaying();
    }
  });
  on('btn-briefing', () => {
    startPlaying();
  });
  on('btn-resume', () => {
    startPlaying();
  });
  on('btn-restart-mission', () => {
    hideScreens();
    setHudVisible(false);
    G.missions.startMission(G, G.missionIndex);
  });
  on('btn-save', () => {
    let ok = false;
    try {
      G.save.save(G);
      ok = !!localStorage.getItem(SAVE_KEY);
    } catch {
      ok = false;
    }
    const note = document.getElementById('pause-save-note');
    if (note) note.textContent = ok ? 'Saved.' : 'Save failed.';
  });
  on('btn-quit-title', () => {
    G.mode = 'title';
    G.police.clearWanted(G);
    const hideout = G.markers.hideout;
    G.player.pos.set(hideout.x, 0, hideout.z);
    G.player.heading = 0;
    camYaw = 0;
    setHudVisible(false);
    showOnly('title-screen');
    refreshContinueButton();
  });
  on('btn-mission-ok', () => {
    G.missions.advanceMission(G);
  });
  on('btn-busted', () => {
    respawn();
  });
  on('btn-wasted', () => {
    respawn();
  });
  on('btn-ending', () => {
    hideScreens();
    G.missions.setFreeRoam(G);
    startPlaying();
  });
}

function refreshContinueButton() {
  let data = null;
  try {
    data = G.save.load();
  } catch {
    data = null;
  }
  const btn = document.getElementById('btn-continue');
  if (btn) btn.classList.toggle('hidden', !data);
}

// ---------------------------------------------------------------- shot staging

// ?shot=title|chase|drive|mission stages a scene for screenshots.
function stageForShot(shot) {
  try {
    stageShot(G, shot);
  } catch {
    // Staging is best-effort; the explicit setup below still runs.
  }
  if (shot === 'mission') {
    G.cash = 450;
    const title = document.getElementById('mission-panel-title');
    if (title) title.textContent = 'MISSION COMPLETE';
    const text = document.getElementById('mission-panel-text');
    if (text) text.textContent = 'The Pickup — nice driving, Cole. Mara has the take.';
    const reward = document.getElementById('mission-panel-reward');
    if (reward) reward.textContent = 'Reward $300 — Total cash $450';
    showOnly('mission-panel');
    setHudVisible(true);
    G.mode = 'complete';
    return;
  }
  if (shot === 'chase') {
    const comet = G.cometGT;
    comet.pos.set(0, 0, 60);
    comet.heading = 0;
    comet.health = 100;
    enterCar(G, comet);
    G.police.addWanted(G, 2, 'The cops are onto the Comet GT!');
    hideScreens();
    setHudVisible(true);
    G.mode = 'playing';
    return;
  }
  if (shot === 'drive') {
    let car = null;
    for (const c of G.cars) {
      if (c.parked && !c.isPolice && c !== G.cometGT && c !== G.bankVan) {
        if (Math.abs(c.pos.x) < 70 && Math.abs(c.pos.z) < 70) {
          car = c;
          break;
        }
      }
    }
    if (car) {
      car.pos.set(0, 0, 0);
      car.heading = 0;
      enterCar(G, car);
      G.police.clearWanted(G);
    }
    hideScreens();
    setHudVisible(true);
    G.mode = 'playing';
    return;
  }
  // 'title' and anything else: the plain title screen.
  G.mode = 'title';
}

// ---------------------------------------------------------------- step

function step(dt) {
  if (dt <= 0) return;
  if (G.mode === 'playing') {
    G.time += dt;
    const car = G.player.car;
    if (car) {
      drivePlayerCar(G, dt);
      G.player.pos.copy(car.pos);
      G.player.heading = car.heading;
      if (G.player.mesh) G.player.mesh.visible = false;
      if (G.player.group) G.player.group.visible = false;
    } else {
      if (G.player.mesh) G.player.mesh.visible = true;
      if (G.player.group) G.player.group.visible = true;
      updatePlayer(G, dt);
    }
    updateTraffic(G, dt);
    updatePedestrians(G, dt);
    if (G.combat) G.combat.update(G, dt);
    if (G.police) G.police.update(G, dt);
    if (G.missions) G.missions.update(G, dt);
    if (G.fx) G.fx.update(dt);
    if (G.audio) G.audio.musicTick();
    // The beacon pillar follows the current objective.
    if (G.beaconTarget && G.beaconMesh) {
      G.beaconMesh.visible = true;
      G.beaconMesh.position.set(G.beaconTarget.x, 17, G.beaconTarget.z);
    } else if (G.beaconMesh) {
      G.beaconMesh.visible = false;
    }
    // Marker pins bob gently.
    if (G.markerPins) {
      let i = 0;
      for (const pin of Object.values(G.markerPins)) {
        pin.position.y = 7 + Math.sin(G.time * 2 + i) * 0.5;
        pin.rotation.y += dt * 0.8;
        i++;
      }
    }
    if (G.ferris && G.ferris.userData.wheel) {
      G.ferris.userData.wheel.rotation.z += dt * 0.12;
    }
    if (G.player.health <= 0) enterWasted();
    if (G.hud) {
      G.hud.update(G, dt);
      if (G.hud.renderHealth) G.hud.renderHealth(G);
      if (G.hud.renderStars) G.hud.renderStars(G);
      if (G.hud.renderWeapon) G.hud.renderWeapon(G);
      if (G.hud.renderDrive) G.hud.renderDrive(G);
      if (G.hud.renderMap) G.hud.renderMap(G);
    }
  }
  updateCamera(dt);
  if (G.renderEnabled !== false && G._render !== false) {
    G.renderer.render(G.scene, G.camera);
  }
}

// ---------------------------------------------------------------- boot

wireButtons();
refreshContinueButton();
showOnly('title-screen');
setHudVisible(false);
const shotParam = new URLSearchParams(window.location.search).get('shot');
if (shotParam) stageForShot(shotParam);

let lastNow = performance.now();
function loop(now) {
  const dt = clamp((now - lastNow) / 1000, 0, 0.05);
  lastNow = now;
  step(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- test API

window.__game = {
  get G() { return G; },
  get mode() { return G.mode; },
  get pos() { return { x: G.player.pos.x, z: G.player.pos.z }; },
  get health() { return G.player.health; },
  get driving() { return !!G.player.car; },
  get carName() { return G.player.car ? (G.player.car.name || G.player.car.model || '') : ''; },
  get wanted() { return G.wanted; },
  get cash() { return G.cash; },
  get mission() { return G.missionIndex; },
  get missionStep() { return G.missionStep; },
  get carHealth() { return G.player.car ? Math.round(G.player.car.health) : 0; },
  get policeCars() { return G.policeCars.length; },
  get taxiPhase() { return G.taxi ? G.taxi.phase : 'none'; },
  get taxiFare() { return G.taxi ? G.taxi.fare : 0; },
  get courierPhase() { return G.courier ? G.courier.phase : 'none'; },
  get courierPay() { return G.courier ? G.courier.pay : 0; },
  step(dt) { step(typeof dt === 'number' ? dt : 0.05); },
  setRender(on) {
    G.renderEnabled = !!on;
    G._render = !!on;
  },
  pressKey(code, down) {
    if (down) G.input.keys.add(code);
    else G.input.keys.delete(code);
  },
  teleport(x, z) {
    G.player.pos.set(x, 0, z);
    const car = G.player.car;
    if (car) {
      car.pos.set(x, 0, z);
      car.speed = 0;
    }
  },
  hurt(amount) { hurt(amount); },
};
