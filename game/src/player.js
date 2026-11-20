// Neon Harbor — Cole Vance on foot. Third-person camera, WASD movement
// relative to the camera, sprint, jump with gravity, a walk-cycle limb
// swing, and the punch animation that overrides the right arm while it
// plays. When Cole is driving, his mesh hides inside the car and his
// position just tracks it; the camera rig lives here too, with a keep-out
// pass that shoves the lens out of any building it ends up inside.
import * as THREE from 'three';
import { clamp, collideCircle, inWorldBounds, angleLerp } from './state.js';

const SKIN = 0xc98d64;
const JACKET = 0x2e4a6b;
const PANTS = 0x2a2a30;
const HAIR = 0x1a1210;

function limb(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createPlayer(G) {
  const group = new THREE.Group();
  const jacketMat = new THREE.MeshStandardMaterial({ color: JACKET, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: PANTS, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), jacketMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: HAIR, roughness: 1 }),
  );
  hair.position.y = 1.76;
  group.add(hair);
  const legL = limb(0.24, 0.62, 0.26, pantsMat, -0.16, 0.32, 0);
  const legR = limb(0.24, 0.62, 0.26, pantsMat, 0.16, 0.32, 0);
  const armL = limb(0.18, 0.6, 0.2, jacketMat, -0.42, 1.1, 0);
  const armR = limb(0.18, 0.6, 0.2, jacketMat, 0.42, 1.1, 0);
  group.add(legL, legR, armL, armR);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.14, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }),
  );
  gun.position.set(0.42, 0.82, 0.25);
  gun.visible = false;
  group.add(gun);

  G.scene.add(group);
  const p = {
    mesh: group,
    legL,
    legR,
    armL,
    armR,
    gun,
    pos: new THREE.Vector3(-60, 0, -34),
    heading: 0,
    vy: 0,
    grounded: true,
    health: 100,
    maxHealth: 100,
    weapon: 'fists', // 'fists' | 'pistol'
    ammo: 12,
    maxAmmo: 24,
    punchCooldown: 0,
    shootCooldown: 0,
    punchAnim: 0,
    car: null, // the car Cole is driving, or null
    speed: 0,
    walkPhase: 0,
    invuln: 0,
  };
  G.player = p;
  return p;
}

function moveOnFoot(G, dt) {
  const p = G.player;
  const input = G.input;
  const sprinting = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const speed = sprinting ? 9 : 5.2;
  let fx = 0;
  let fz = 0;
  const yaw = G.cameraYaw;
  // WASD is relative to where the camera looks, not to the world axes.
  if (input.keys.has('KeyW')) {
    fx += -Math.sin(yaw);
    fz += -Math.cos(yaw);
  }
  if (input.keys.has('KeyS')) {
    fx += Math.sin(yaw);
    fz += Math.cos(yaw);
  }
  if (input.keys.has('KeyA')) {
    fx += -Math.cos(yaw);
    fz += Math.sin(yaw);
  }
  if (input.keys.has('KeyD')) {
    fx += Math.cos(yaw);
    fz += -Math.sin(yaw);
  }
  const len = Math.hypot(fx, fz);
  if (len > 0.01) {
    fx /= len;
    fz /= len;
    const nx = p.pos.x + fx * speed * dt;
    const nz = p.pos.z + fz * speed * dt;
    const res = collideCircle(G, nx, nz, 0.55);
    if (inWorldBounds(res.x, res.z)) {
      p.pos.x = res.x;
      p.pos.z = res.z;
    }
    p.heading = angleLerp(p.heading, Math.atan2(fx, fz), Math.min(1, dt * 12));
    p.walkPhase += dt * speed * 1.6;
    p.speed = speed;
  } else {
    p.speed = 0;
  }
  if (input.keys.has('Space') && p.grounded) {
    p.vy = 7.5;
    p.grounded = false;
  }
  if (!p.grounded) {
    p.vy -= 22 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vy = 0;
      p.grounded = true;
    }
  }
  const swing = p.speed > 0 ? Math.sin(p.walkPhase) * 0.55 : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  p.armL.rotation.x = -swing * 0.8;
  p.armR.rotation.x = swing * 0.8;
  // A punch swing overrides the walk cycle on the right arm.
  if (p.punchAnim > 0) {
    p.armR.rotation.x = -1.4;
    p.armL.rotation.x = 0.4;
  }
  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.heading;
  p.gun.visible = p.weapon === 'pistol';
}

function moveCamera(G, dt) {
  const p = G.player;
  const cam = G.camera;
  G.cameraYaw -= G.input.mouseDX * 0.0032;
  G.cameraPitch = clamp(G.cameraPitch + G.input.mouseDY * 0.0028, -0.15, 0.9);
  G.input.mouseDX = 0;
  G.input.mouseDY = 0;
  let target;
  let want;
  if (p.car) {
    const car = p.car;
    target = car.mesh.position.clone();
    target.y += 1.6;
    const behind = car.heading + Math.PI;
    const dist = 11 + car.speed * 0.12;
    want = new THREE.Vector3(
      target.x + Math.sin(behind) * dist,
      4.6,
      target.z + Math.cos(behind) * dist,
    );
    const clear = collideCircle(G, want.x, want.z, 1.0);
    want.x = clear.x;
    want.z = clear.z;
    cam.position.lerp(want, Math.min(1, dt * 5));
    cam.lookAt(target.x, target.y, target.z);
  } else {
    target = p.pos.clone();
    target.y += 1.7;
    const pitch = G.cameraPitch;
    const dist = 7.5;
    want = new THREE.Vector3(
      target.x + Math.sin(G.cameraYaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist + 1.2,
      target.z + Math.cos(G.cameraYaw) * Math.cos(pitch) * dist,
    );
    const clear = collideCircle(G, want.x, want.z, 1.0);
    want.x = clear.x;
    want.z = clear.z;
    cam.position.lerp(want, Math.min(1, dt * 10));
    cam.lookAt(target);
  }
  if (G.shake > 0.01) {
    cam.position.x += (Math.random() - 0.5) * G.shake * 0.5;
    cam.position.y += (Math.random() - 0.5) * G.shake * 0.5;
  }
  // The shadow-casting sun follows Cole so shadows stay crisp near him.
  if (G.sun) {
    G.sun.position.set(p.pos.x - 140, 120, p.pos.z - 90);
    G.sun.target.position.set(p.pos.x, 0, p.pos.z);
    G.sun.target.updateMatrixWorld();
  }
}

export function updatePlayer(G, dt) {
  const p = G.player;
  if (!p) return;
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.punchAnim = Math.max(0, (p.punchAnim || 0) - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.car) {
    p.mesh.visible = false;
    p.pos.copy(p.car.mesh.position);
    p.pos.y = 0;
  } else {
    p.mesh.visible = true;
    if (G.mode === 'playing') moveOnFoot(G, dt);
  }
  if (G.mode === 'playing' || G.mode === 'paused') moveCamera(G, dt);
  // Slow recovery while the heat is off.
  if (G.wanted === 0 && p.health > 0 && p.health < p.maxHealth) {
    p.health = Math.min(p.maxHealth, p.health + dt * 2.5);
  }
}

export function damagePlayer(G, amount, cause) {
  const p = G.player;
  if (!p || p.invuln > 0 || p.health <= 0) return;
  p.health -= amount;
  p.invuln = 0.25;
  G.fx.shake(0.35);
  G.hud.flashDamage();
  if (p.health <= 0) {
    p.health = 0;
    G.missions.onWasted(G);
  }
}
