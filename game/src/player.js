// Neon Harbor — Cole on foot: walking, looking, jumping, and the
// third-person camera. Driving is delegated to vehicles.js; this file
// owns everything about the character himself — his mesh, his health,
// and keeping him out of the buildings.
//
// Camera convention: camYaw 0 looks toward +z with the camera behind
// the player at -z. Forward on the ground is (sin(camYaw), cos(camYaw))
// and right is (-cos(camYaw), sin(camYaw)).
import * as THREE from 'three';
import { clamp, angleLerp, collideCircle } from './state.js';
import { drivePlayerCar } from './vehicles.js';

const WALK_SPEED = 5.0;
const SPRINT_SPEED = 8.5;
const JUMP_VELOCITY = 7;
const GRAVITY = 20;

function limb(material, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true;
  return m;
}

export function createPlayer(game) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2e6fb0, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6 });

  // Legs hang from hip pivots so the walk cycle can swing them.
  const legL = new THREE.Group();
  legL.position.set(-0.14, 0.85, 0);
  const legLMesh = limb(pants, 0.22, 0.85, 0.24);
  legLMesh.position.y = -0.42;
  legL.add(legLMesh);
  const legR = new THREE.Group();
  legR.position.set(0.14, 0.85, 0);
  const legRMesh = limb(pants, 0.22, 0.85, 0.24);
  legRMesh.position.y = -0.42;
  legR.add(legRMesh);

  const torso = limb(shirt, 0.62, 0.75, 0.34);
  torso.position.y = 1.22;
  const jacketMesh = limb(jacket, 0.66, 0.5, 0.38);
  jacketMesh.position.y = 1.35;

  const head = limb(skin, 0.34, 0.36, 0.32);
  head.position.y = 1.8;
  const hair = limb(dark, 0.36, 0.12, 0.34);
  hair.position.y = 2.0;

  // Right arm hangs from a shoulder pivot: it swings when walking and
  // snaps forward for the punch animation.
  const armL = new THREE.Group();
  armL.position.set(-0.4, 1.52, 0);
  const armLMesh = limb(shirt, 0.18, 0.7, 0.2);
  armLMesh.position.y = -0.32;
  armL.add(armLMesh);
  const armR = new THREE.Group();
  armR.position.set(0.4, 1.52, 0);
  const armRMesh = limb(shirt, 0.18, 0.7, 0.2);
  armRMesh.position.y = -0.32;
  armR.add(armRMesh);

  // Pistol, kept in the right hand and hidden while fists are out.
  const weaponMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.32), dark);
  weaponMesh.position.set(0, -0.68, 0.12);
  weaponMesh.visible = false;
  armR.add(weaponMesh);

  group.add(legL, legR, torso, jacketMesh, head, hair, armL, armR);

  const spawn = game.markers.hideout || { x: 0, z: 0 };
  group.position.set(spawn.x, 0, spawn.z);
  game.scene.add(group);

  return {
    pos: group.position,
    heading: 0,
    health: 100,
    mesh: group,
    group,
    weapon: 'fists',
    weaponMesh,
    ammo: 12,
    shootCooldown: 0,
    punchAnim: 0,
    camYaw: 0,
    camPitch: -0.12,
    vy: 0,
    grounded: true,
    speed: 0,
    invuln: 0,
    armR,
    armL,
    legR,
    legL,
    car: null,
    walkPhase: 0,
  };
}

// Third-person camera: behind and above the player, pulled in close
// when a building would otherwise sit between camera and player, and
// never left inside a wall after a teleport.
function positionCamera(game, dt) {
  const p = game.player;
  const cam = game.camera;
  if (!cam) return;
  const dist = p.car ? 9.5 : 7.5;
  const height = p.car ? 3.6 : 3.0;
  const cy = p.camYaw;
  const cp = p.camPitch;
  const ox = -Math.sin(cy) * Math.cos(cp) * dist;
  const oz = -Math.cos(cy) * Math.cos(cp) * dist;
  const oy = height + Math.sin(cp) * dist;
  let cx = p.pos.x + ox;
  let cz = p.pos.z + oz;
  let cyPos = p.pos.y + oy;
  const res = collideCircle(game, cx, cz, 0.4);
  if (res.hit) {
    // A wall is in the way: pull the camera most of the way in.
    cx = p.pos.x + ox * 0.4;
    cz = p.pos.z + oz * 0.4;
    cyPos = p.pos.y + oy * 0.55;
    const res2 = collideCircle(game, cx, cz, 0.4);
    if (res2.hit) {
      cx = p.pos.x + ox * 0.15;
      cz = p.pos.z + oz * 0.15;
      cyPos = p.pos.y + 2.2;
    }
  }
  cam.position.set(cx, Math.max(cyPos, 1.2), cz);
  cam.lookAt(p.pos.x, p.pos.y + 1.6, p.pos.z);
}

export function updatePlayer(game, dt) {
  const p = game.player;
  if (!p) return;

  // Mouse look first: the deltas are consumed here, once per frame.
  p.camYaw -= game.input.mouseDX * 0.0032;
  p.camPitch = clamp(p.camPitch - game.input.mouseDY * 0.0032, -0.9, 0.6);
  game.input.mouseDX = 0;
  game.input.mouseDY = 0;

  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.punchAnim = Math.max(0, p.punchAnim - dt * 3.2);
  p.invuln = Math.max(0, p.invuln - dt);

  if (p.car) {
    // While driving the camera drifts behind the car unless the
    // player is actively looking around with the mouse.
    drivePlayerCar(game, dt);
    p.camYaw = angleLerp(p.camYaw, p.car.heading, dt * 1.2);
    p.heading = p.car.heading;
    positionCamera(game, dt);
    return;
  }

  const keys = game.input.keys;
  let mz = 0;
  let mx = 0;
  if (keys.has('KeyW')) mz += 1;
  if (keys.has('KeyS')) mz -= 1;
  if (keys.has('KeyA')) mx -= 1;
  if (keys.has('KeyD')) mx += 1;

  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
  const moving = mz !== 0 || mx !== 0;
  let vx = 0;
  let vz = 0;
  if (moving) {
    const fx = Math.sin(p.camYaw);
    const fz = Math.cos(p.camYaw);
    const rx = -Math.cos(p.camYaw);
    const rz = Math.sin(p.camYaw);
    vx = fx * mz + rx * mx;
    vz = fz * mz + rz * mx;
    const len = Math.hypot(vx, vz) || 1;
    vx /= len;
    vz /= len;
    p.heading = Math.atan2(vx, vz);
    p.walkPhase += dt * (sprint ? 13 : 9);
    const swing = Math.sin(p.walkPhase) * 0.55;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armL.rotation.x = -swing * 0.7;
    p.armR.rotation.x = p.punchAnim > 0 ? -1.5 * p.punchAnim : swing * 0.7;
    p.speed = speed;
  } else {
    p.legL.rotation.x *= 0.8;
    p.legR.rotation.x *= 0.8;
    p.armL.rotation.x *= 0.8;
    if (p.punchAnim <= 0) p.armR.rotation.x *= 0.8;
    else p.armR.rotation.x = -1.5 * p.punchAnim;
    p.speed = 0;
  }

  // Jump and gravity.
  if (keys.has('Space') && p.grounded) {
    p.vy = JUMP_VELOCITY;
    p.grounded = false;
  }
  if (!p.grounded) {
    p.vy -= GRAVITY * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vy = 0;
      p.grounded = true;
    }
  }

  const nx = p.pos.x + vx * speed * dt;
  const nz = p.pos.z + vz * speed * dt;
  const res = collideCircle(game, nx, nz, 0.6);
  p.pos.x = clamp(res.x, -238, 238);
  p.pos.z = clamp(res.z, -238, 238);

  p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
  p.mesh.rotation.y = p.heading;
  positionCamera(game, dt);
}

// A hit on Cole: brief invulnerability so one burst cannot stack, a
// red spark for feedback, and the health total back to the caller.
export function damagePlayer(game, amount, cause) {
  const p = game.player;
  if (!p || p.health <= 0) return p ? p.health : 0;
  if (p.invuln > 0) return p.health;
  p.health = Math.max(0, p.health - amount);
  p.invuln = 0.6;
  if (game.fx) {
    game.fx.burst(new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z), 0xff4444, 6, 3, 0.15);
  }
  if (game.audio) game.audio.tone(160, 0.18, 'sawtooth', 0.15, 0, -70);
  return p.health;
}
