// Neon Harbor — pedestrians: sidewalk strollers who flee from crimes,
// and who fall when a car hits them.
import * as THREE from 'three';
import { rand, randInt, pick, collideCircle, inWorldBounds, dist2D } from './state.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0xe67e22, 0x2ecc71];
const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b98a, 0x6b4423];

export function createPedestrian(G, x, z) {
  const group = new THREE.Group();
  const shirt = pick(SHIRTS), skin = pick(SKINS);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.32),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }));
  body.position.y = 1.0; body.castShadow = true; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
  head.position.y = 1.62; group.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.9 }));
  legL.position.set(-0.14, 0.3, 0); group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; group.add(legR);
  group.position.set(x, 0, z);
  G.scene.add(group);
  const ped = {
    mesh: group, legL, legR,
    pos: group.position,
    heading: rand(0, Math.PI * 2),
    speed: rand(1.2, 2.0),
    target: null,
    state: 'walk',   // walk | flee | down
    downTimer: 0,
    phase: rand(0, 6),
    fleeFrom: null,
  };
  ped.target = pickWalkTarget(G);
  G.peds.push(ped);
  return ped;
}

function pickWalkTarget(G) {
  // a sidewalk corner: near a road line, offset to the sidewalk
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const line = pick(G.roads.xs);
  const along = rand(-210, 150);
  const off = pick([-11, 11]);
  if (axis === 'x') return { x: line + off, z: along };
  return { x: along, z: line + off };
}

export function spawnPedestrians(G, count) {
  for (let i = 0; i < count; i++) {
    const t = pickWalkTarget(G);
    createPedestrian(G, t.x + rand(-6, 6), t.z + rand(-6, 6));
  }
}

export function scarePedestrians(G, x, z, radius) {
  for (const ped of G.peds) {
    if (ped.state === 'down') continue;
    if (dist2D(ped.pos.x, ped.pos.z, x, z) < radius) {
      ped.state = 'flee';
      ped.fleeFrom = { x, z };
    }
  }
}

export function updatePedestrians(G, dt) {
  const player = G.player;
  for (const ped of G.peds) {
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      ped.mesh.rotation.x = Math.max(-Math.PI / 2, ped.mesh.rotation.x - dt * 4);
      if (ped.downTimer <= 0) {
        ped.state = 'walk';
        ped.mesh.rotation.x = 0;
        ped.target = pickWalkTarget(G);
      }
      continue;
    }
    let speed = ped.speed, tx, tz;
    if (ped.state === 'flee' && ped.fleeFrom) {
      speed = 4.5;
      const dx = ped.pos.x - ped.fleeFrom.x, dz = ped.pos.z - ped.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = ped.pos.x + (dx / d) * 30; tz = ped.pos.z + (dz / d) * 30;
      if (dist2D(ped.pos.x, ped.pos.z, ped.fleeFrom.x, ped.fleeFrom.z) > 45) {
        ped.state = 'walk'; ped.target = pickWalkTarget(G);
      }
    } else {
      tx = ped.target.x; tz = ped.target.z;
      if (dist2D(ped.pos.x, ped.pos.z, tx, tz) < 2) ped.target = pickWalkTarget(G);
    }
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx / d, dz / d);
    ped.heading = heading;
    const nx = ped.pos.x + (dx / d) * speed * dt;
    const nz = ped.pos.z + (dz / d) * speed * dt;
    const res = collideCircle(G, nx, nz, 0.5);
    if (inWorldBounds(res.x, res.z)) { ped.pos.x = res.x; ped.pos.z = res.z; }
    ped.phase += dt * speed * 2.2;
    const swing = Math.sin(ped.phase) * 0.5;
    ped.legL.rotation.x = swing; ped.legR.rotation.x = -swing;
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    // hit by a moving car?
    for (const car of G.cars) {
      if (Math.abs(car.speed) < 4) continue;
      if (dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z) < 2.3) {
        ped.state = 'down'; ped.downTimer = 6;
        ped.mesh.rotation.x = -Math.PI / 2;
        G.fx.burst(ped.pos.clone().setY(1), 0xff4444, 8, 3, 2);
        G.audio.crash();
        if (car === player.car) {
          G.police.addWanted(G, 1, 'You hit a pedestrian!');
          scarePedestrians(G, ped.pos.x, ped.pos.z, 25);
        }
      }
    }
  }
}
