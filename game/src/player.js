// Neon Harbor — Cole on foot: walking, looking, jumping, and the
// third-person camera. Driving is delegated to vehicles.js; this file
// owns everything about the character himself — his mesh, his health,
// his weapons, and how he moves through the city without walking
// through walls.
//
// Controls on foot: WASD walks relative to the camera, Shift sprints,
// Space jumps, the mouse turns the camera (pointer lock, with a held
// drag fallback handled in main). In a car, the same keys drive and
// this module hands the frame to vehicles.drivePlayerCar.

import * as THREE from 'three';
import { clamp, collideCircle } from './state.js';
import { drivePlayerCar } from './vehicles.js';

const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.6;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.5;

// Build Cole: a simple stylised figure — dark jacket, jeans, boots —
// with separate arm meshes so the punch animation can swing one.
function buildColeMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.85 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2e4a6a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), jacket);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), hair);
  hairTop.position.y = 1.99;
  group.add(hairTop);

  const armR = new THREE.Group();
  armR.position.set(0.4, 1.48, 0);
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), jacket);
  armRMesh.position.y = -0.28;
  armRMesh.castShadow = true;
  armR.add(armRMesh);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), skin);
  handR.position.y = -0.62;
  armR.add(handR);
  group.add(armR);

  const armL = new THREE.Group();
  armL.position.set(-0.4, 1.48, 0);
  const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), jacket);
  armLMesh.position.y = -0.28;
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  group.add(armL);

  const legR = new THREE.Group();
  legR.position.set(0.16, 0.82, 0);
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.24), jeans);
  legRMesh.position.y = -0.39;
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.36), boot);
  bootR.position.set(0, -0.78, 0.05);
  legR.add(bootR);
  group.add(legR);

  const legL = new THREE.Group();
  legL.position.set(-0.16, 0.82, 0);
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.24), jeans);
  legLMesh.position.y = -0.39;
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.36), boot);
  bootL.position.set(0, -0.78, 0.05);
  legL.add(bootL);
  group.add(legL);

  // Pistol, hidden until the pistol is the active weapon.
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.42), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.4, metalness: 0.7 }));
  gun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 }));
  grip.position.set(0, -0.12, -0.14);
  gun.add(grip);
  gun.position.set(0, -0.66, 0.12);
  gun.visible = false;
  armR.add(gun);

  return { group, armR, armL, legR, legL, gun };
}

export function createPlayer(game) {
  const built = buildColeMesh();
  const spawn = game.markers.hideout || { x: 0, z: -180 };
  const player = {
    pos: new THREE.Vector3(spawn.x, 0, spawn.z + 8),
    heading: 0,
    health: 100,
    mesh: built.group,
    group: built.group,
    weapon: 'fists',
    ammo: 12,
    shootCooldown: 0,
    punchAnim: 0,
    camYaw: 0,
    camPitch: -0.18,
    vy: 0,
    grounded: true,
    speed: 0,
    invuln: 0,
    armR: built.armR,
    armL: built.armL,
    legR: built.legR,
    legL: built.legL,
    gun: built.gun,
    car: null,
    walkPhase: 0,
  };
  built.group.position.copy(player.pos);
  game.scene.add(built.group);
  game.player = player;
  return player;
}

// Hurt Cole. Returns true when the hit killed him. A short invulnerable
// window after each hit stops one shotgun blast from registering twice.
export function damagePlayer(game, amount, cause) {
  const player = game.player;
  if (!player || player.invuln > 0 || game.mode === 'wasted' || game.mode === 'busted') return false;
  player.health = Math.max(0, player.health - amount);
  player.invuln = 0.5;
  if (game.audio) game.audio.fail();
  if (game.fx) game.fx.shake(0.35);
  if (game.hud) game.hud.feed(`Hurt by ${cause || 'an attack'} (-${Math.round(amount)})`);
  return player.health <= 0;
}

export function updatePlayer(game, dt) {
  const player = game.player;
  if (!player) return;
  player.invuln = Math.max(0, player.invuln - dt);
  player.shootCooldown = Math.max(0, player.shootCooldown - dt);
  player.punchAnim = Math.max(0, player.punchAnim - dt * 3);

  // Mouse look: consume the deltas main accumulated this frame.
  player.camYaw -= game.input.mouseDX * 0.0026;
  player.camPitch = clamp(player.camPitch - game.input.mouseDY * 0.0022, -0.9, 0.55);
  game.input.mouseDX = 0;
  game.input.mouseDY = 0;

  // Driving hands the whole frame to the vehicle code.
  if (player.car) {
    drivePlayerCar(game, dt);
    updateCamera(game, dt);
    return;
  }

  const keys = game.input.keys;
  const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;

  // Movement is relative to the camera yaw.
  let fwd = 0;
  let strafe = 0;
  if (keys.has('KeyW')) fwd += 1;
  if (keys.has('KeyS')) fwd -= 1;
  if (keys.has('KeyA')) strafe -= 1;
  if (keys.has('KeyD')) strafe += 1;
  const moving = fwd !== 0 || strafe !== 0;
  const len = Math.hypot(fwd, strafe) || 1;
  fwd /= len;
  strafe /= len;

  const sy = Math.sin(player.camYaw);
  const cy = Math.cos(player.camYaw);
  const mx = (-sy * fwd + cy * strafe) * speed;
  const mz = (-cy * fwd - sy * strafe) * speed;
  player.speed = moving ? speed : 0;

  let nx = player.pos.x + mx * dt;
  let nz = player.pos.z + mz * dt;

  // Keep Cole out of buildings; sliding along a wall still moves him.
  const resolved = collideCircle(game, nx, nz, 0.55);
  nx = resolved.x;
  nz = resolved.z;

  // Pedestrians are soft — brush past them instead of stopping dead.
  for (const ped of game.peds) {
    const dx = nx - ped.pos.x;
    const dz = nz - ped.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01 && d < 0.9) {
      nx += (dx / d) * (0.9 - d);
      nz += (dz / d) * (0.9 - d);
    }
  }

  player.pos.x = nx;
  player.pos.z = nz;

  // Face the direction of travel; stand still and he faces the camera.
  if (moving) {
    const targetHeading = Math.atan2(mx, mz);
    let diff = targetHeading - player.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.heading += diff * Math.min(1, 14 * dt);
  } else {
    player.heading = player.camYaw + Math.PI;
  }

  // Jump and gravity.
  if (keys.has('Space') && player.grounded) {
    player.vy = JUMP_VELOCITY;
    player.grounded = false;
  }
  if (!player.grounded) {
    player.vy -= GRAVITY * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vy = 0;
      player.grounded = true;
    }
  }

  // Walk cycle and punch swing.
  if (moving) player.walkPhase += dt * speed * 1.6;
  const swing = moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  player.legR.rotation.x = swing;
  player.legL.rotation.x = -swing;
  player.armL.rotation.x = -swing * 0.7;
  if (player.punchAnim > 0) {
    // A fast forward arc, then back.
    player.armR.rotation.x = -Math.sin((1 - player.punchAnim) * Math.PI) * 1.9;
  } else {
    player.armR.rotation.x = swing * 0.7;
  }
  player.gun.visible = player.weapon === 'pistol';

  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;

  updateCamera(game, dt);
}

// Third-person camera: behind and above Cole (or the car), looking
// slightly down. A short ray of collision checks keeps the camera out
// of building faces — it pulls in close instead of clipping through.
function updateCamera(game, dt) {
  const player = game.player;
  const camera = game.camera;
  if (!camera) return;
  const car = player.car;
  const focus = car ? car.pos : player.pos;
  const yaw = car ? car.heading + Math.PI : player.camYaw;
  const pitch = player.camPitch;
  const dist = car ? 10.5 : 7.5;
  const height = car ? 4.4 : 3.2;

  const cx = focus.x + Math.sin(yaw) * Math.cos(pitch) * dist;
  const cz = focus.z + Math.cos(yaw) * Math.cos(pitch) * dist;
  const cy = focus.y + height - Math.sin(pitch) * dist * 0.6;

  // Pull the camera in if a building sits between it and the focus.
  let useDist = dist;
  for (let t = 1; t >= 0.15; t -= 0.15) {
    const tx = focus.x + Math.sin(yaw) * Math.cos(pitch) * dist * t;
    const tz = focus.z + Math.cos(yaw) * Math.cos(pitch) * dist * t;
    const blocked = game.colliders.some((c) => (
      Math.abs(tx - c.x) < c.hw + 0.4 && Math.abs(tz - c.z) < c.hd + 0.4
    ));
    if (!blocked) { useDist = dist * t; break; }
    useDist = dist * t;
  }
  const px = focus.x + Math.sin(yaw) * Math.cos(pitch) * useDist;
  const pz = focus.z + Math.cos(yaw) * Math.cos(pitch) * useDist;
  const py = focus.y + height - Math.sin(pitch) * useDist * 0.6;

  // Smooth the chase so the camera never snaps.
  const k = Math.min(1, 10 * dt);
  camera.position.x += (px - camera.position.x) * k;
  camera.position.y += (py - camera.position.y) * k;
  camera.position.z += (pz - camera.position.z) * k;
  camera.lookAt(focus.x, focus.y + 1.4, focus.z);
}
