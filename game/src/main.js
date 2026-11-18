// Neon Harbor — bootstrap, input, the game loop, menus and the debug handle.
// An original open-world crime game built in this session for make.fun gta6-01.
import * as THREE from 'three';
import { makeGame, clamp } from './state.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
import { spawnParkedCars, spawnTraffic, drivePlayerCar, updateTraffic, nearestCar, enterCar, exitCar } from './vehicles.js';
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

function initRenderer() {
  const canvas = document.getElementById('scene');
  // Automated runs (webdriver) use no antialiasing: it is slow under software
  // GL and the game looks the same at screenshot size. Real browsers keep it.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !navigator.webdriver });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
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

function initInput() {
  const input = G.input;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    input.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyM') { G.audio.setMuted(!G.audio.muted); G.hud.showMessage(G.audio.muted ? 'Sound muted.' : 'Sound on.'); }
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
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    if (G.mode === 'playing') {
      canvas.requestPointerLock?.();
      if (e.button === 0) G.combat.attack(G);
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      input.mouseDX += e.movementX; input.mouseDY += e.movementY;
    } else if (dragging && G.mode === 'playing') {
      input.mouseDX += e.movementX; input.mouseDY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) dragging = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function tryEnterExitCar() {
  const p = G.player;
  if (p.car) { exitCar(G); return; }
  const car = nearestCar(G, p.pos, 5.0);
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

function initMenus() {
  const $ = (id) => document.getElementById(id);
  const save = G.save.load();
  if (save) $('btn-continue').classList.remove('hidden');
  $('btn-start').addEventListener('click', () => {
    G.audio.ensure(); G.audio.click();
    startGame(0, false);
  });
  $('btn-continue').addEventListener('click', () => {
    G.audio.ensure(); G.audio.click();
    startGame(null, true);
  });
  $('btn-resume').addEventListener('click', () => { G.audio.click(); togglePause(); });
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
  $('btn-busted').addEventListener('click', () => { G.audio.click(); G.missions.respawn(G); });
  $('btn-wasted').addEventListener('click', () => { G.audio.click(); G.missions.respawn(G); });
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

function startGame(missionIndex, useSave) {
  document.getElementById('title-screen').classList.add('hidden');
  G.hud.show();
  let startMission = missionIndex ?? 0;
  let resumeStep = 0;
  if (useSave) {
    const data = G.save.load();
    if (data) {
      const resumed = G.save.apply(G, data);
      startMission = resumed.index;
      resumeStep = resumed.step;
    }
  } else {
    G.cash = 0;
    G.player.pos.set(-60, 0, -34);
    G.player.health = 100;
    G.wanted = 0;
  }
  G.mode = 'playing';
  G.missions.startMission(G, startMission, true, resumeStep);
  G.hud.showMessage('Welcome to Neon Harbor, Cole.');
}

function initWorld() {
  initRenderer();
  buildCity(G);
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
  initInput();
  initMenus();
  // title screen idles over the city
  G.camera.position.set(-60, 26, -60);
  G.camera.lookAt(0, 4, 0);
}

function update(dt) {
  G.time += dt;
  // ambient world motion always runs
  if (G.sea) G.sea.position.y = 0.12 + Math.sin(G.time * 0.7) * 0.05;
  if (G.ferris) G.ferris.children[0].rotation.z += dt * 0.15;
  if (G.beacon && G.beacon.visible) {
    G.beacon.children[1].scale.setScalar(1 + Math.sin(G.time * 4) * 0.15);
    G.beacon.children[0].material.opacity = 0.22 + Math.sin(G.time * 4) * 0.08;
  }
  if (G.mode === 'title') {
    // slow orbit around downtown for the title backdrop
    const a = G.time * 0.03;
    G.camera.position.set(Math.sin(a) * 120, 42, Math.cos(a) * 120);
    G.camera.lookAt(0, 6, 0);
    updateTraffic(G, dt);
    updatePedestrians(G, dt);
    renderFrame();
    return;
  }
  if (G.mode !== 'playing') {
    // paused / menus: still render, freeze gameplay
    renderFrame();
    return;
  }
  updatePlayer(G, dt);
  if (G.player.car) drivePlayerCar(G, dt);
  updateTraffic(G, dt);
  updatePedestrians(G, dt);
  G.police.update(G, dt);
  G.combat.updateEnemies(G, dt);
  G.missions.update(G, dt);
  G.fx.update(dt);
  G.hud.update(G, dt);
  // interact prompt
  const p = G.player;
  if (!p.car) {
    const car = nearestCar(G, p.pos, 5.0);
    const el = document.getElementById('interact');
    if (car) { el.textContent = `Press E — steal the ${car.name}`; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  } else {
    document.getElementById('interact').classList.add('hidden');
  }
  renderFrame();
}

function renderFrame() {
  if (G._render !== false) G.renderer.render(G.scene, G.camera);
}

function main() {
  initWorld();
  // debug handle for automated tests
  window.__game = {
    get mode() { return G.mode; },
    get wanted() { return G.wanted; },
    get cash() { return G.cash; },
    get mission() { return G.missionIndex; },
    get missionStep() { return G.missionStep; },
    get driving() { return !!G.player.car; },
    get health() { return G.player.health; },
    get ammo() { return G.player.ammo; },
    get weapon() { return G.player.weapon; },
    get pos() { return { x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z }; },
    get cars() { return G.cars.length; },
    get police() { return G.policeCars.length + G.officers.length; },
    get peds() { return G.peds.length; },
    get enemies() { return G.enemies.length; },
    get carName() { return G.player.car ? G.player.car.name : null; },
    teleport(x, z) { G.player.pos.set(x, 0, z); if (G.player.car) { G.player.car.pos.set(x, 0, z); } },
    startMission(i) { G.missions.startMission(G, i, false); G.mode = 'playing'; },
    // Deterministic test hooks: advance the simulation by dt seconds without
    // waiting on the render loop, and toggle rendering (off = logic only).
    step(dt) { update(dt || 0.05); },
    setRender(on) { G.renderEnabled = !!on; G._render = !!on; },
    pressKey(code, down) {
      if (down) G.input.keys.add(code); else G.input.keys.delete(code);
    },
    G,
  };
  window.__shotReady = false;
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  if (shot) {
    // staging: build the scene, stage it, render twice, flag ready
    stageShot(G, shot);
  }
  const clock = new THREE.Clock();
  // Adaptive frame pacing: on a slow renderer (software GL in a test
  // browser) each frame can take over a second, which starves the main
  // thread. Measure render cost and skip frames so input, timers and the
  // game logic stay responsive; on a real GPU this renders every frame.
  let skip = 0, framesSinceRender = 0, avgMs = 16;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    framesSinceRender++;
    const wantRender = framesSinceRender > skip && G.renderEnabled !== false;
    const t0 = performance.now();
    G._render = wantRender;
    try { update(dt); } catch (err) {
      console.error('update error', err);
      if (wantRender) G.renderer.render(G.scene, G.camera);
    }
    if (wantRender) {
      framesSinceRender = 0;
      const ms = performance.now() - t0;
      avgMs = avgMs * 0.8 + ms * 0.2;
      // jump straight to a matching skip on the first slow frame
      if (ms > 200) skip = Math.max(skip, Math.min(6, Math.round(ms / 150)));
      else if (avgMs > 70 && skip < 6) skip++;
      else if (avgMs < 30 && skip > 0) skip--;
    }
  }
  loop();
}

main();
