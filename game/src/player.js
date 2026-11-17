// Neon Harbor — Cole Vance on foot: third-person camera, WASD, sprint, jump,
// punch and pistol, entering and exiting cars.
import * as THREE from 'three';
import { clamp, collideCircle, inWorldBounds, angleLerp } from './state.js';

const SKIN = 0xc98d64, JACKET = 0x2e4a6b, PANTS = 0x2a2a30, HAIR = 0x1a1210;

export function createPlayer(G) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36),
    new THREE.MeshStandardMaterial({ color: JACKET, roughness: 0.8 }));
  body.position.y = 1.05; body.castShadow = true; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 }));
  head.position.y = 1.72; head.castShadow = true; group.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: HAIR, roughness: 1 }));
  hair.position.y = 1.76; group.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 0.26),
    new THREE.MeshStandardMaterial({ color: PANTS, roughness: 0.9 }));
  legL.position.set(-0.16, 0.32, 0); group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.16; group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2),
    new THREE.MeshStandardMaterial({ color: JACKET, roughness: 0.8 }));
  armL.position.set(-0.42, 1.1, 0); group.add(armL);
  const armR = armL.clone(); armR.position.x = 0.42; group.add(armR);
  // pistol held in right hand when armed
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.42, 0.82, 0.25); gun.visible = false; group.add(gun);

  G.scene.add(group);
  const p = {
    mesh: group, legL, legR, armL, armR, gun,
    pos: new THREE.Vector3(-60, 0, -34),
    heading: 0, vy: 0, grounded: true,
    health: 100, maxHealth: 100,
    weapon: 'fists',           // 'fists' | 'pistol'
    ammo: 12, maxAmmo: 24,
    punchCooldown: 0, shootCooldown: 0,
    car: null,                 // car the player is driving, or null
    speed: 0, walkPhase: 0,
    invuln: 0,
  };
  G.player = p;
  return p;
}

function footMove(G, dt) {
  const p = G.player, input = G.input;
  const sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const speed = sprint ? 9 : 5.2;
  let fx = 0, fz = 0;
  const yaw = G.cameraYaw;
  // WASD relative to camera yaw
  if (input.keys.has('KeyW')) { fx += -Math.sin(yaw); fz += -Math.cos(yaw); }
  if (input.keys.has('KeyS')) { fx += Math.sin(yaw); fz += Math.cos(yaw); }
  if (input.keys.has('KeyA')) { fx += -Math.cos(yaw); fz += Math.sin(yaw); }
  if (input.keys.has('KeyD')) { fx += Math.cos(yaw); fz += -Math.sin(yaw); }
  const len = Math.hypot(fx, fz);
  if (len > 0.01) {
    fx /= len; fz /= len;
    const nx = p.pos.x + fx * speed * dt;
    const nz = p.pos.z + fz * speed * dt;
    const res = collideCircle(G, nx, nz, 0.55);
    if (inWorldBounds(res.x, res.z)) { p.pos.x = res.x; p.pos.z = res.z; }
    p.heading = angleLerp(p.heading, Math.atan2(fx, fz), Math.min(1, dt * 12));
    p.walkPhase += dt * speed * 1.6;
    p.speed = speed;
  } else {
    p.speed = 0;
  }
  // jump + gravity
  if (input.keys.has('Space') && p.grounded) { p.vy = 7.5; p.grounded = false; }
  if (!p.grounded) {
    p.vy -= 22 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; }
  }
  // walk animation
  const swing = p.speed > 0 ? Math.sin(p.walkPhase) * 0.55 : 0;
  p.legL.rotation.x = swing; p.legR.rotation.x = -swing;
  p.armL.rotation.x = -swing * 0.8; p.armR.rotation.x = swing * 0.8;
  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.heading;
  p.gun.visible = p.weapon === 'pistol';
}

function updateCamera(G, dt) {
  const p = G.player;
  const cam = G.camera;
  G.cameraYaw -= G.input.mouseDX * 0.0032;
  G.cameraPitch = clamp(G.cameraPitch + G.input.mouseDY * 0.0028, -0.15, 0.9);
  G.input.mouseDX = 0; G.input.mouseDY = 0;
  let target, dist, height;
  if (p.car) {
    const car = p.car;
    const back = car.heading + Math.PI;
    target = car.mesh.position.clone(); target.y += 1.6;
    dist = 11 + car.speed * 0.12;
    height = 4.6;
    const cx = target.x + Math.sin(back) * dist;
    const cz = target.z + Math.cos(back) * dist;
    const want = new THREE.Vector3(cx, height, cz);
    cam.position.lerp(want, Math.min(1, dt * 5));
    cam.lookAt(target.x, target.y, target.z);
  } else {
    target = p.pos.clone(); target.y += 1.7;
    dist = 7.5; height = 3.2;
    const cy = G.cameraPitch;
    const cx = target.x + Math.sin(G.cameraYaw) * Math.cos(cy) * dist;
    const cz = target.z + Math.cos(G.cameraYaw) * Math.cos(cy) * dist;
    const cyy = target.y + Math.sin(cy) * dist + 1.2;
    const want = new THREE.Vector3(cx, cyy, cz);
    cam.position.lerp(want, Math.min(1, dt * 10));
    cam.lookAt(target);
  }
  // screen shake
  if (G.shake > 0.01) {
    cam.position.x += (Math.random() - 0.5) * G.shake * 0.5;
    cam.position.y += (Math.random() - 0.5) * G.shake * 0.5;
  }
  // sun shadow follows the player
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
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.car) {
    // player rides in the car; mesh hidden inside
    p.mesh.visible = false;
    p.pos.copy(p.car.mesh.position);
    p.pos.y = 0;
  } else {
    p.mesh.visible = true;
    if (G.mode === 'playing') footMove(G, dt);
  }
  if (G.mode === 'playing' || G.mode === 'paused') updateCamera(G, dt);
  // slow health regen when the heat is off
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
