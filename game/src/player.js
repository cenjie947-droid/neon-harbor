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
// around Cole, and the camera eases to its spot behind him so it never
// snaps. While driving it sits behind the car instead, keyed off the
// car's heading, since that is the direction the player is looking.

import * as THREE from 'three';
import { clamp, angleLerp, collideCircle } from './state.js';

const TUNE = {
  walkSpeed: 5.2,
  sprintMult: 1.7,
  jumpVelocity: 7,
  gravity: 22,
  camDist: 8,
  camHeight: 4.5,
};

// A limb that swings from a joint: a group at the joint with the box
// hanging below it, so rotating the group swings the limb.
function makeLimb(parent, x, y, w, h, d, color) {
  const joint = new THREE.Group();
  joint.position.x = x;
  joint.position.y = y;
  joint.position.z = 0;
  const piece = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  piece.position.y = -h / 2;
  piece.castShadow = true;
  joint.add(piece);
  parent.add(joint);
  return joint;
}

function boxPart(parent, w, h, d, color, rough, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough }),
  );
  mesh.position.x = x;
  mesh.position.y = y;
  mesh.position.z = z;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildColeMesh() {
  const group = new THREE.Group();
  const colors = { skin: 0xd9a986, jacket: 0x2a5a6a, jeans: 0x2a3a4a, hair: 0x2a2018 };
  const legL = makeLimb(group, -0.14, 0.52, 0.22, 0.52, 0.22, colors.jeans);
  const legR = makeLimb(group, 0.14, 0.52, 0.22, 0.52, 0.22, colors.jeans);
  // Torso, head and hair as [w, h, d, color, rough, x, y, z] rows.
  const boxes = [
    [0.56, 0.62, 0.32, colors.jacket, 0.85, 0, 0.85, 0],
    [0.34, 0.36, 0.32, colors.skin, 0.7, 0, 1.36, 0],
    [0.36, 0.12, 0.34, colors.hair, 0.95, 0, 1.58, -0.02],
  ];
  const parts = [];
  let i = 0;
  while (i < boxes.length) {
    const b = boxes[i];
    parts.push(boxPart(group, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]));
    i++;
  }
  parts[2].castShadow = false;
  const armL = makeLimb(group, -0.37, 1.12, 0.16, 0.55, 0.16, colors.jacket);
  const armR = makeLimb(group, 0.37, 1.12, 0.16, 0.55, 0.16, colors.jacket);
  return { group, legL, legR, armL, armR };
}

export function createPlayer(game) {
  const built = buildColeMesh();
  game.scene.add(built.group);
  const cole = {};
  cole.pos = new THREE.Vector3(-60, 0, -34);
  cole.heading = 0;
  cole.health = 100;
  cole.maxHealth = 100;
  cole.ammo = 12;
  cole.maxAmmo = 24;
  cole.weapon = 'fists';
  cole.car = null;
  cole.speed = 0;
  cole.punchAnim = 0;
  cole.punchCooldown = 0;
  cole.shootCooldown = 0;
  cole.invuln = 0;
  cole.vy = 0;
  cole.grounded = true;
  cole.camYaw = 0;
  cole.camPitch = 0.35;
  cole.mesh = built.group;
  cole.legL = built.legL;
  cole.legR = built.legR;
  cole.armL = built.armL;
  cole.armR = built.armR;
  built.group.position.copy(cole.pos);
  game.player = cole;
  return cole;
}

// Where the camera wants to be: behind the target at the given yaw
// and distance, lifted by the pitch.
function cameraSpot(target, yaw, dist, lift, pitch) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const spot = new THREE.Vector3(0, 0, 0);
  spot.x = target.x - Math.sin(yaw) * cp * dist;
  spot.y = target.y + sp * dist + lift;
  spot.z = target.z - Math.cos(yaw) * cp * dist;
  return spot;
}

// Put the camera where it belongs this frame: behind Cole on foot,
// behind the car while driving. It eases in, and snaps when it is a
// long way off (a teleport or a Continue), so the view never sweeps
// across the city.
function moveCamera(game, dt) {
  const cole = game.player;
  const cam = game.camera;
  const target = new THREE.Vector3(cole.pos.x, cole.pos.y + 1.7, cole.pos.z);
  let yaw = cole.camYaw;
  let dist = TUNE.camDist;
  let lift = 0;
  if (cole.car) {
    yaw = cole.car.heading;
    dist = 10;
    lift = 1;
  }
  const want = cameraSpot(target, yaw, dist, lift, cole.camPitch);
  // On foot the rig sits about head height above the street; the
  // numbers above already put it there, but clamp the floor so it
  // never dips under the pavement.
  if (want.y < 1.5) want.y = 1.5;
  const gap = cam.position.distanceTo(want);
  const k = gap > 25 ? 1 : Math.min(1, dt * 9);
  cam.position.lerp(want, k);
  cam.lookAt(target);
}

function tickTimers(cole, dt) {
  const timers = ['punchCooldown', 'shootCooldown', 'invuln', 'punchAnim'];
  for (const key of timers) {
    if (cole[key] > 0) cole[key] = cole[key] - dt;
  }
}

// Camera-relative movement: W runs away from the camera, S toward it,
// A/D strafe. The camera yaw is the reference, not Cole's heading, so
// turning the camera turns the controls with it. Each held key adds
// its direction to the move vector.
function stepOnFoot(game, cole, dt) {
  const keys = game.input.keys;
  const fwdX = Math.sin(cole.camYaw);
  const fwdZ = Math.cos(cole.camYaw);
  const rightX = Math.cos(cole.camYaw);
  const rightZ = -Math.sin(cole.camYaw);
  const moves = [
    ['KeyW', fwdX, fwdZ],
    ['KeyS', -fwdX, -fwdZ],
    ['KeyD', rightX, rightZ],
    ['KeyA', -rightX, -rightZ],
  ];
  let mx = 0;
  let mz = 0;
  for (const [code, dx, dz] of moves) {
    if (keys.has(code)) {
      mx = mx + dx;
      mz = mz + dz;
    }
  }
  const moving = mx !== 0 || mz !== 0;
  let pace = 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx = mx / len;
    mz = mz / len;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    pace = TUNE.walkSpeed * (sprint ? TUNE.sprintMult : 1);
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
    cole.vy = TUNE.jumpVelocity;
    cole.grounded = false;
  }
  if (!cole.grounded) {
    cole.vy = cole.vy - TUNE.gravity * dt;
    cole.pos.y = cole.pos.y + cole.vy * dt;
    if (cole.pos.y <= 0) {
      cole.pos.y = 0;
      cole.vy = 0;
      cole.grounded = true;
    }
  }
  cole.speed = pace;
  return moving;
}

// Animate the body: legs swing with the stride, the right arm swings
// the punch while a punch is playing, otherwise it swings with the
// stride too.
function animateCole(game, cole, moving) {
  const stride = moving ? game.time * 11 : 0;
  const swing = moving ? Math.sin(stride) * 0.55 : 0;
  cole.legL.rotation.x = swing;
  cole.legR.rotation.x = -swing;
  cole.armL.rotation.x = -swing * 0.7;
  if (cole.punchAnim > 0) {
    // A punch lasts 0.22 s (the combat module's window): the arm swings
    // out and back in that time.
    const p = (0.22 - cole.punchAnim) / 0.22;
    cole.armR.rotation.x = -Math.sin(p * Math.PI) * 1.5;
  } else {
    cole.armR.rotation.x = swing * 0.7;
  }
  cole.mesh.position.copy(cole.pos);
  cole.mesh.rotation.y = cole.heading;
}

export function updatePlayer(game, dt) {
  const cole = game.player;
  tickTimers(cole, dt);
  // The mouse orbits the camera. Consume the deltas here so they apply
  // exactly once per frame.
  cole.camYaw = cole.camYaw - game.input.mouseDX * 0.0035;
  const nextPitch = cole.camPitch + game.input.mouseDY * 0.0022;
  cole.camPitch = clamp(nextPitch, 0.06, 1.05);
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
  const moving = stepOnFoot(game, cole, dt);
  animateCole(game, cole, moving);
  moveCamera(game, dt);
}

// Hurt Cole. A short grace window keeps a single scrape from landing
// twice, but the test hook ('test') always goes through. At zero health
// the wasted flow takes over.
export function damagePlayer(game, amount, cause) {
  const cole = game.player;
  const open = cole && game.mode === 'playing' && cole.health > 0;
  const grace = cause !== 'test' && cole && cole.invuln > 0;
  if (!open || grace) return;
  cole.health = Math.max(0, cole.health - amount);
  cole.invuln = 0.5;
  if (game.hud) game.hud.flashDamage();
  if (cole.health <= 0) {
    game.missions.onWasted(game);
  }
}
