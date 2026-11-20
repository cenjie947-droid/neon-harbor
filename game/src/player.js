// Neon Harbor — Cole Vance on foot.
//
// This module owns the player: his body and mesh, walking and jumping,
// the third-person camera that follows him (and his car), and taking
// damage. Driving itself lives in vehicles.js — this file only keeps
// Cole's position glued to the car while he is in it, because the
// missions, the police and the HUD all read `player.pos`, so it has to
// mean "where Cole is" whether he is walking or driving.
//
// The camera is a simple orbit rig: the mouse drags the yaw and pitch
// around Cole, and the camera lerps to its spot behind him so it never
// snaps. While driving it sits behind the car instead, keyed off the
// car's heading, since that is the direction the player is looking.

import * as THREE from 'three';
import { clamp, angleLerp, collideCircle } from './state.js';

const WALK_SPEED = 5.2;
const SPRINT_MULT = 1.7;
const JUMP_VELOCITY = 7;
const GRAVITY = 22;
const CAM_DIST = 8;
const CAM_HEIGHT = 4.5;

// A limb that swings from a joint: a group at the joint with the box
// hanging below it, so rotating the group swings the limb.
function limb(parent, x, y, w, h, d, color) {
  const joint = new THREE.Group();
  joint.position.set(x, y, 0);
  const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  piece.position.y = -h / 2;
  piece.castShadow = true;
  joint.add(piece);
  parent.add(joint);
  return joint;
}

function buildColeMesh() {
  const group = new THREE.Group();
  const skin = 0xd9a986;
  const jacket = 0x2a5a6a;
  const jeans = 0x2a3a4a;
  const hair = 0x2a2018;
  const legL = limb(group, -0.14, 0.52, 0.22, 0.52, 0.22, jeans);
  const legR = limb(group, 0.14, 0.52, 0.22, 0.52, 0.22, jeans);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.32), new THREE.MeshStandardMaterial({ color: jacket, roughness: 0.85 }));
  torso.position.y = 0.85;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
  head.position.y = 1.36;
  head.castShadow = true;
  group.add(head);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), new THREE.MeshStandardMaterial({ color: hair, roughness: 0.95 }));
  top.position.set(0, 1.58, -0.02);
  group.add(top);
  const armL = limb(group, -0.37, 1.12, 0.16, 0.55, 0.16, jacket);
  const armR = limb(group, 0.37, 1.12, 0.16, 0.55, 0.16, jacket);
  return { group, legL, legR, armL, armR };
}

export function createPlayer(game) {
  const built = buildColeMesh();
  game.scene.add(built.group);
  const cole = {
    pos: new THREE.Vector3(-60, 0, -34),
    heading: 0,
    health: 100,
    maxHealth: 100,
    ammo: 12,
    maxAmmo: 24,
    weapon: 'fists',
    car: null,
    speed: 0,
    punchAnim: 0,
    punchCooldown: 0,
    shootCooldown: 0,
    invuln: 0,
    vy: 0,
    grounded: true,
    camYaw: 0,
    camPitch: 0.35,
    mesh: built.group,
    legL: built.legL,
    legR: built.legR,
    armL: built.armL,
    armR: built.armR,
  };
  built.group.position.copy(cole.pos);
  game.player = cole;
  return cole;
}

// Put the camera where it belongs this frame: behind Cole on foot, behind
// the car while driving. It lerps in, and snaps when it is a long way off
// (a teleport or a Continue), so the view never sweeps across the city.
function moveCamera(game, dt) {
  const cole = game.player;
  const cam = game.camera;
  const target = new THREE.Vector3(cole.pos.x, cole.pos.y + 1.7, cole.pos.z);
  let yaw;
  let dist = CAM_DIST;
  if (cole.car) {
    yaw = cole.car.heading;
    dist = 10;
  } else {
    yaw = cole.camYaw;
  }
  const cp = Math.cos(cole.camPitch);
  const sp = Math.sin(cole.camPitch);
  const want = new THREE.Vector3(
    target.x - Math.sin(yaw) * cp * dist,
    target.y + sp * dist + (cole.car ? 1 : 0),
    target.z - Math.cos(yaw) * cp * dist,
  );
  // On foot the rig sits about head height above the street; the numbers
  // above already put it there, but clamp the floor so it never dips
  // under the pavement.
  if (want.y < 1.5) want.y = 1.5;
  const gap = cam.position.distanceTo(want);
  if (gap > 25) {
    cam.position.copy(want);
  } else {
    const k = Math.min(1, dt * 9);
    cam.position.lerp(want, k);
  }
  cam.lookAt(target);
}

function tickTimers(cole, dt) {
  if (cole.punchCooldown > 0) cole.punchCooldown -= dt;
  if (cole.shootCooldown > 0) cole.shootCooldown -= dt;
  if (cole.invuln > 0) cole.invuln -= dt;
  if (cole.punchAnim > 0) cole.punchAnim -= dt;
}

export function updatePlayer(game, dt) {
  const cole = game.player;
  tickTimers(cole, dt);
  // The mouse orbits the camera. Consume the deltas here so they apply
  // exactly once per frame.
  cole.camYaw -= game.input.mouseDX * 0.0035;
  cole.camPitch = clamp(cole.camPitch + game.input.mouseDY * 0.0022, 0.06, 1.05);
  game.input.mouseDX = 0;
  game.input.mouseDY = 0;
  if (cole.car) {
    // Driving: Cole rides with the car. His position tracks it, the mesh
    // hides inside the car, and the camera trails the car.
    cole.pos.copy(cole.car.pos);
    cole.pos.y = 0;
    cole.heading = cole.car.heading;
    cole.mesh.visible = false;
    cole.speed = Math.abs(cole.car.speed);
    moveCamera(game, dt);
    return;
  }
  cole.mesh.visible = true;
  const keys = game.input.keys;
  // Camera-relative movement: W runs away from the camera, S toward it,
  // A/D strafe. The camera yaw is the reference, not Cole's heading, so
  // turning the camera turns the controls with it.
  const fwdX = Math.sin(cole.camYaw);
  const fwdZ = Math.cos(cole.camYaw);
  const rightX = Math.cos(cole.camYaw);
  const rightZ = -Math.sin(cole.camYaw);
  let mx = 0;
  let mz = 0;
  if (keys.has('KeyW')) { mx += fwdX; mz += fwdZ; }
  if (keys.has('KeyS')) { mx -= fwdX; mz -= fwdZ; }
  if (keys.has('KeyD')) { mx += rightX; mz += rightZ; }
  if (keys.has('KeyA')) { mx -= rightX; mz -= rightZ; }
  const moving = mx !== 0 || mz !== 0;
  let pace = 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    pace = WALK_SPEED * (sprint ? SPRINT_MULT : 1);
    const nx = cole.pos.x + mx * pace * dt;
    const nz = cole.pos.z + mz * pace * dt;
    const moved = collideCircle(game, nx, nz, 0.55);
    cole.pos.x = moved.x;
    cole.pos.z = moved.z;
    cole.heading = angleLerp(cole.heading, Math.atan2(mx, mz), Math.min(1, dt * 12));
  }
  // Jump and gravity. Space is the handbrake while driving, so it only
  // jumps here, on foot.
  if (keys.has('Space') && cole.grounded) {
    cole.vy = JUMP_VELOCITY;
    cole.grounded = false;
  }
  if (!cole.grounded) {
    cole.vy -= GRAVITY * dt;
    cole.pos.y += cole.vy * dt;
    if (cole.pos.y <= 0) {
      cole.pos.y = 0;
      cole.vy = 0;
      cole.grounded = true;
    }
  }
  cole.speed = pace;
  // Animate the body: legs swing with the stride, the right arm swings
  // the punch while a punch is playing, otherwise it swings with the
  // stride too.
  const stride = moving ? game.time * 11 : 0;
  const swing = moving ? Math.sin(stride) * 0.55 : 0;
  cole.legL.rotation.x = swing;
  cole.legR.rotation.x = -swing;
  cole.armL.rotation.x = -swing * 0.7;
  if (cole.punchAnim > 0) {
    // A punch lasts 0.22 s (the combat module's window): the arm swings
    // out and back in that time.
    const p = 1 - cole.punchAnim / 0.22;
    cole.armR.rotation.x = -Math.sin(p * Math.PI) * 1.5;
  } else {
    cole.armR.rotation.x = swing * 0.7;
  }
  cole.mesh.position.copy(cole.pos);
  cole.mesh.rotation.y = cole.heading;
  moveCamera(game, dt);
}

// Hurt Cole. A short grace window keeps a single scrape from landing
// twice, but the test hook ('test') always goes through. At zero health
// the wasted flow takes over.
export function damagePlayer(game, amount, cause) {
  const cole = game.player;
  if (!cole || game.mode !== 'playing' || cole.health <= 0) return;
  if (cause !== 'test' && cole.invuln > 0) return;
  cole.health = Math.max(0, cole.health - amount);
  cole.invuln = 0.5;
  if (game.hud) game.hud.flashDamage();
  if (cole.health <= 0) {
    game.missions.onWasted(game);
  }
}
