// Neon Harbor — bootstrap, input, the game loop and the menus. One file
// owns the frame: it builds the renderer, tunes the light, wires every key
// and mouse, runs the per-frame update, and hands automated tests a debug
// handle on window.__game. The world itself lives in the other modules;
// this file only drives them in the right order.
//
// Two things this file owns outright. First, the look: the city builder
// ships a dusk-grade sunset, and this game is supposed to read as a bright,
// sun-soaked modern city, so the sun, the sky fill and the exposure are
// lifted here after the city is built. Second, the camera: the on-foot and
// driving rigs live in player.js and lerp toward their target, which can
// drag the lens through a wall after a Continue spawn, so every frame ends
// with a keep-out pass that shoves the camera back out of any building it
// ended up inside, and a fresh or continued game snaps the camera to a
// clear spot behind Cole instead of lerping in from the title orbit.
//
// Mouse look: the HUD layer is pointer-events:none, so clicks do reach the
// canvas — but a click that lands on a menu overlay or a button must not
// also swing a punch, and a drag must keep working when pointer lock
// refuses (headless browsers, mostly). Input therefore listens on the
// window in the capture phase, ignores anything that hit a button or an
// overlay, and treats a held drag as a look fallback whenever the pointer
// is not locked.
import * as THREE from 'three';
import { makeGame, clamp, collideCircle } from './state.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
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
import { spawnPedestrians, updatePedestrians, scarePedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { SaveData } from './save.js';
import { stageShot } from './shots.js';

const G = makeGame();
window.__game = null;

// --- renderer and light -------------------------------------------------

function buildRenderer() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !navigator.webdriver });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  G.renderer = renderer;
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
  G.camera.position.set(-40, 8, -14);
  window.addEventListener('resize', () => {
    G.camera.aspect = window.innerWidth / window.innerHeight;
    G.camera.updateProjectionMatrix();
    G.renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// The city ships dusk-grade light; lift it into a bright midday sun so the
// streets read as a sun-soaked modern city instead of an evening haze.
function brightenTheCity() {
  if (G.sun) G.sun.intensity = 3.6;
  const skyFill = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 1.5);
  G.scene.add(skyFill);
  const bounce = new THREE.AmbientLight(0xfff2dd, 0.35);
  G.scene.add(bounce);
  G.scene.fog = new THREE.Fog(0x9fc3e8, 220, 720);
}

// --- input ---------------------------------------------------------------

function wireInput() {
  const input = G.input;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    input.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyM') {
      G.audio.setMuted(!G.audio.muted);
      G.hud.showMessage(G.audio.muted ? 'Sound muted.' : 'Sound on.');
    }
    if (e.code === 'KeyQ' && G.mode === 'playing' && !G.player.car) {
      G.player.weapon = G.player.weapon === 'fists' ? 'pistol' : 'fists';
      G.hud.showMessage(G.player.weapon === 'pistol' ? 'Pistol ready.' : 'Fists ready.');
      G.audio.click();
    }
    if (e.code === 'KeyE' && G.mode === 'playing') tryEnterExitCar();
    if (e.code === 'KeyR' && G.mode === 'playing' && G.player.car) {
      const car = G.player.car;
      car.speed = 0;
      car.mesh.rotation.set(0, car.heading, 0);
      G.hud.showMessage('Car righted.');
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && (G.mode === 'playing' || G.mode === 'paused')) togglePause();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  const canvas = document.getElementById('scene');
  let dragging = false;
  // Capture phase on the window: the click is seen no matter which layer
  // it landed on, and menu clicks are filtered out by target instead of
  // by which element happened to be on top.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.target && e.target.closest && e.target.closest('button, .overlay')) return;
      if (G.mode !== 'playing') return;
      dragging = true;
      canvas.requestPointerLock?.();
      if (e.button === 0) G.combat.attack(G);
    },
    true,
  );
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      input.mouseDX += e.movementX;
      input.mouseDY += e.movementY;
    } else if (dragging && G.mode === 'playing') {
      // Drag-look fallback: works with no pointer lock at all.
      input.mouseDX += e.movementX;
      input.mouseDY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) dragging = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function tryEnterExitCar() {
  const p = G.player;
  if (p.car) {
    exitCar(G);
    return;
  }
  const car = nearestCar(G, p.pos, STEAL_REACH);
  if (!car) return;
  enterCar(G, car);
  G.stats.carsStolen++;
  if (!car.stolen) {
    car.stolen = true;
    G.police.addWanted(G, 1, `You stole the ${car.name}!`);
    scarePedestrians(G, p.pos.x, p.pos.z, 20);
  }
}

function togglePause() {
  if (G.mode === 'playing') {
    G.mode = 'paused';
    document.getElementById('pause-menu').classList.remove('hidden');
    document.exitPointerLock?.();
  } else if (G.mode === 'paused') {
    G.mode = 'playing';
    document.getElementById('pause-menu').classList.add('hidden');
  }
}

// --- menus ---------------------------------------------------------------

function wireMenus() {
  const $ = (id) => document.getElementById(id);
  if (G.save.load()) $('btn-continue').classList.remove('hidden');
  $('btn-start').addEventListener('click', () => {
    G.audio.ensure();
    G.audio.click();
    startGame(0, false);
  });
  $('btn-continue').addEventListener('click', () => {
    G.audio.ensure();
    G.audio.click();
    startGame(null, true);
  });
  $('btn-resume').addEventListener('click', () => {
    G.audio.click();
    togglePause();
  });
  $('btn-restart-mission').addEventListener('click', () => {
    G.audio.click();
    $('pause-menu').classList.add('hidden');
    G.missions.startMission(G, G.missionIndex, false);
    G.mode = 'playing';
    G.hud.showMessage('Mission restarted.');
  });
  $('btn-save').addEventListener('click', () => {
    const ok = G.save.save(G);
    $('pause-save-note').textContent = ok ? 'Saved.' : 'Save failed (browser storage unavailable).';
  });
  $('btn-quit-title').addEventListener('click', () => {
    G.audio.click();
    G.save.save(G);
    $('pause-menu').classList.add('hidden');
    G.mode = 'title';
    $('title-screen').classList.remove('hidden');
    G.hud.hide();
    if (G.save.load()) $('btn-continue').classList.remove('hidden');
  });
  $('btn-mission-ok').addEventListener('click', () => {
    G.audio.click();
    $('mission-panel').classList.add('hidden');
    G.mode = 'playing';
    G.missions.startMission(G, G.missionIndex, true);
  });
  $('btn-busted').addEventListener('click', () => {
    G.audio.click();
    G.missions.respawn(G);
  });
  $('btn-wasted').addEventListener('click', () => {
    G.audio.click();
    G.missions.respawn(G);
  });
  $('btn-ending').addEventListener('click', () => {
    G.audio.click();
    $('ending-screen').classList.add('hidden');
    G.mode = 'playing';
    G.missions.setFreeRoam(G);
  });
  $('btn-briefing').addEventListener('click', () => {
    G.audio.click();
    $('briefing').classList.add('hidden');
    G.mode = 'playing';
  });
}

// --- starting and continuing ---------------------------------------------

function startGame(missionIndex, useSave) {
  document.getElementById('title-screen').classList.add('hidden');
  G.hud.show();
  let startMission = missionIndex ?? 0;
  let resumeStep = 0;
  let resumeNote = '';
  if (useSave) {
    const data = G.save.load();
    if (data) {
      const resumed = G.save.apply(G, data);
      startMission = resumed.index;
      resumeStep = resumed.step;
      resumeNote = resumed.note || '';
    }
  } else {
    G.cash = 0;
    G.player.pos.set(-60, 0, -34);
    G.player.heading = 0;
    G.player.health = 100;
    G.wanted = 0;
  }
  G.mode = 'playing';
  G.missions.startMission(G, startMission, true, resumeStep);
  snapCameraBehindPlayer();
  G.hud.showMessage(resumeNote ? `Welcome back, Cole. ${resumeNote}` : 'Welcome to Neon Harbor, Cole.');
}

// Put the camera on a clear spot behind Cole right away. The rig lerps
// from wherever the camera currently is; after a Continue that used to be
// the title orbit on the far side of the city, and the lerp path cut
// straight through buildings. Starting from a legal spot fixes both.
function snapCameraBehindPlayer() {
  const p = G.player;
  const back = p.heading + Math.PI;
  const x = p.pos.x + Math.sin(back) * 8;
  const z = p.pos.z + Math.cos(back) * 8;
  const clear = collideCircle(G, x, z, 1.2);
  G.camera.position.set(clear.x, 4.5, clear.z);
  G.camera.lookAt(p.pos.x, 1.7, p.pos.z);
}

// --- world ---------------------------------------------------------------

function buildWorld() {
  buildRenderer();
  buildCity(G);
  brightenTheCity();
  createPlayer(G);
  spawnParkedCars(G);
  spawnTraffic(G, 14);
  spawnPedestrians(G, 24);
  G.audio = new AudioEngine();
  G.hud = new HUD(G);
  G.fx = new Effects(G);
  G.police = new Police(G);
  G.combat = new Combat(G);
  G.missions = new Missions(G);
  G.save = new SaveData();
  wireInput();
  wireMenus();
  G.camera.position.set(-60, 26, -60);
  G.camera.lookAt(0, 4, 0);
}

// --- camera keep-out ------------------------------------------------------

// The camera rig lerps, so it can end a frame inside a wall even though its
// target is legal. Push it back out: first horizontally out of any building
// footprint, then along the sight line from the player — walk from the
// player toward the camera and stop just before the first blocked sample.
function keepCameraClear() {
  const cam = G.camera;
  const pushed = collideCircle(G, cam.position.x, cam.position.z, 1.2);
  cam.position.x = pushed.x;
  cam.position.z = pushed.z;
  const p = G.player;
  const eye = new THREE.Vector3(p.pos.x, p.pos.y + 1.7, p.pos.z);
  const toCam = new THREE.Vector3().subVectors(cam.position, eye);
  const len = toCam.length();
  if (len < 0.5) return;
  const step = toCam.clone().multiplyScalar(1 / len);
  let lastClear = 0;
  for (let i = 1; i <= 10; i++) {
    const probe = eye.clone().addScaledVector(step, (len * i) / 10);
    const hit = collideCircle(G, probe.x, probe.z, 0.5).hit;
    if (hit) break;
    lastClear = i;
  }
  if (lastClear < 10) {
    const pull = Math.max(1.5, (len * lastClear) / 10 - 0.6);
    cam.position.copy(eye).addScaledVector(step, pull);
  }
  if (cam.position.y < 1.5) cam.position.y = 1.5;
}

// --- per-frame update ------------------------------------------------------

function updateAmbient(dt) {
  if (G.sea) G.sea.position.y = 0.12 + Math.sin(G.time * 0.7) * 0.05;
  if (G.ferris) G.ferris.children[0].rotation.z += dt * 0.15;
  if (G.beacon && G.beacon.visible) {
    G.beacon.children[1].scale.setScalar(1 + Math.sin(G.time * 4) * 0.15);
    G.beacon.children[0].material.opacity = 0.22 + Math.sin(G.time * 4) * 0.08;
  }
}

function update(dt) {
  G.time += dt;
  updateAmbient(dt);
  if (G.mode === 'title') {
    const a = G.time * 0.03;
    G.camera.position.set(Math.sin(a) * 120, 42, Math.cos(a) * 120);
    G.camera.lookAt(0, 6, 0);
    updateTraffic(G, dt);
    updatePedestrians(G, dt);
    drawFrame();
    return;
  }
  if (G.mode !== 'playing') {
    drawFrame();
    return;
  }
  updatePlayer(G, dt);
  if (G.player.car) drivePlayerCar(G, dt);
  updateTraffic(G, dt);
  updatePedestrians(G, dt);
  G.police.update(G, dt);
  G.combat.update(G, dt);
  G.missions.update(G, dt);
  G.fx.update(dt);
  G.hud.update(G, dt);
  const p = G.player;
  const prompt = document.getElementById('interact');
  if (!p.car) {
    const car = nearestCar(G, p.pos, STEAL_REACH);
    if (car) {
      prompt.textContent = `Press E — steal the ${car.name}`;
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  } else {
    prompt.classList.add('hidden');
  }
  keepCameraClear();
  drawFrame();
}

function drawFrame() {
  if (G._render !== false) G.renderer.render(G.scene, G.camera);
}

// --- debug handle and main loop --------------------------------------------

function exposeDebugHandle() {
  window.__game = {
    get mode() {
      return G.mode;
    },
    get wanted() {
      return G.wanted;
    },
    get cash() {
      return G.cash;
    },
    get mission() {
      return G.missionIndex;
    },
    get missionStep() {
      return G.missionStep;
    },
    get driving() {
      return !!G.player.car;
    },
    get health() {
      return G.player.health;
    },
    get ammo() {
      return G.player.ammo;
    },
    get weapon() {
      return G.player.weapon;
    },
    get pos() {
      return { x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z };
    },
    get cars() {
      return G.cars.length;
    },
    get police() {
      return G.policeCars.length + G.officers.length;
    },
    get policeCars() {
      return G.policeCars.length;
    },
    get peds() {
      return G.peds.length;
    },
    get enemies() {
      return G.enemies.length;
    },
    get carName() {
      return G.player.car ? G.player.car.name : null;
    },
    get cameraLocked() {
      return document.pointerLockElement === document.getElementById('scene');
    },
    teleport(x, z) {
      G.player.pos.set(x, 0, z);
      if (G.player.car) G.player.car.pos.set(x, 0, z);
    },
    startMission(i) {
      G.missions.startMission(G, i, false);
      G.mode = 'playing';
    },
    step(dt) {
      update(dt || 0.05);
    },
    setRender(on) {
      G.renderEnabled = !!on;
      G._render = !!on;
    },
    pressKey(code, down) {
      if (down) G.input.keys.add(code);
      else G.input.keys.delete(code);
    },
    G,
  };
}

function main() {
  buildWorld();
  exposeDebugHandle();
  window.__shotReady = false;
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot) stageShot(G, shot);
  const clock = new THREE.Clock();
  // Adaptive frame pacing: on a slow renderer (software GL in a test
  // browser) a frame can take over a second, which starves the main
  // thread. Measure render cost and skip frames so input, timers and game
  // logic stay responsive; on a real GPU this renders every frame.
  let skip = 0;
  let framesSinceRender = 0;
  let avgMs = 16;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    framesSinceRender++;
    const wantRender = framesSinceRender > skip && G.renderEnabled !== false;
    const t0 = performance.now();
    G._render = wantRender;
    try {
      update(dt);
    } catch (err) {
      console.error('update error', err);
      if (wantRender) G.renderer.render(G.scene, G.camera);
    }
    if (wantRender) {
      framesSinceRender = 0;
      const ms = performance.now() - t0;
      avgMs = avgMs * 0.8 + ms * 0.2;
      if (ms > 200) skip = Math.max(skip, Math.min(6, Math.round(ms / 150)));
      else if (avgMs > 70 && skip < 6) skip++;
      else if (avgMs < 30 && skip > 0) skip--;
    }
  }
  loop();
}

main();
