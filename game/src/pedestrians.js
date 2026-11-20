// Neon Harbor — pedestrians. Sidewalk walkers who flee when a crime
// happens nearby and go down when a car hits them. They come in visibly
// different shapes now: heights, shirt and trouser colours, walk speeds,
// a hat on some of them, and a few who stroll in pairs or small groups
// along the same route instead of every one walking alone.
//
// One of them can also be a taxi fare: the taxi system marks a walker,
// puts a floating marker over their head, and that walker waits at the
// kerb instead of wandering off.
import * as THREE from 'three';
import { rand, randInt, pick, collideCircle, inWorldBounds, dist2D } from './state.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0xe67e22, 0x2ecc71, 0xff6b9d, 0x5dade2];
const TROUSERS = [0x2a2a30, 0x3a4a6b, 0x5a3a2a, 0x6b6b6b, 0x1f3a2a, 0x7a5a8a];
const SKINS = [0xc98d64, 0x8a5a3b, 0xe8b98a, 0x6b4423, 0xf0c8a0];
const HATS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x222222, 0xffffff];

// Pick a sidewalk corner: next to a road line, offset onto the pavement.
function pickWalkTarget(G) {
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const line = pick(G.roads.xs);
  const along = rand(-210, 150);
  const off = pick([-11, 11]);
  if (axis === 'x') return { x: line + off, z: along };
  return { x: along, z: line + off };
}

function buildWalkerMesh(G, opts) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: opts.shirt, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: opts.skin, roughness: 0.7 });
  const legMat = new THREE.MeshStandardMaterial({ color: opts.trousers, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.32), shirtMat);
  torso.position.y = 1.0;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skinMat);
  head.position.y = 1.62;
  group.add(head);
  if (opts.hat !== null) {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: opts.hat, roughness: 0.8 }),
    );
    hat.position.y = 1.82;
    group.add(hat);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.22), legMat);
  legL.position.set(-0.14, 0.3, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);
  // Arms so a walker does not read as a floating torso.
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), shirtMat);
  armL.position.set(-0.37, 1.05, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.37;
  group.add(armR);
  group.scale.setScalar(opts.scale);
  group.position.set(opts.x, 0, opts.z);
  G.scene.add(group);
  return { group, legL, legR, armL, armR };
}

export function createPedestrian(G, x, z, sharedTarget) {
  const look = {
    shirt: pick(SHIRTS),
    trousers: pick(TROUSERS),
    skin: pick(SKINS),
    hat: Math.random() < 0.3 ? pick(HATS) : null,
    scale: rand(0.88, 1.16),
    x,
    z,
  };
  const parts = buildWalkerMesh(G, look);
  const ped = {
    mesh: parts.group,
    legL: parts.legL,
    legR: parts.legR,
    armL: parts.armL,
    armR: parts.armR,
    pos: parts.group.position,
    heading: rand(0, Math.PI * 2),
    speed: rand(1.0, 2.6),
    target: sharedTarget || pickWalkTarget(G),
    state: 'walk', // walk | flee | down | taxi
    downTimer: 0,
    phase: rand(0, 6),
    fleeFrom: null,
    isTaxiClient: false,
    taxiMarker: null,
  };
  G.peds.push(ped);
  return ped;
}

// Most walkers are solo; a few spawn in pairs or trios that share one
// destination and stroll a step apart, which reads as people together
// rather than a crowd of loners.
export function spawnPedestrians(G, count) {
  let made = 0;
  while (made < count) {
    const groupSize = Math.random() < 0.3 ? (Math.random() < 0.5 ? 2 : 3) : 1;
    const target = pickWalkTarget(G);
    for (let i = 0; i < groupSize && made < count; i++, made++) {
      const t = pickWalkTarget(G);
      createPedestrian(
        G,
        target.x + rand(-6, 6) + (i - (groupSize - 1) / 2) * 1.6,
        target.z + rand(-6, 6) + (i % 2) * 1.2,
        { x: t.x, z: t.z },
      );
    }
  }
}

export function scarePedestrians(G, x, z, radius) {
  for (const ped of G.peds) {
    if (ped.state === 'down' || ped.state === 'taxi') continue;
    if (dist2D(ped.pos.x, ped.pos.z, x, z) < radius) {
      ped.state = 'flee';
      ped.fleeFrom = { x, z };
    }
  }
}

// Mark a walker as the waiting taxi fare: they stop at the kerb and get a
// floating yellow diamond over their head. Returns the walker, or null.
export function markTaxiClient(G, ped) {
  if (!ped || ped.state === 'down') return null;
  ped.state = 'taxi';
  ped.isTaxiClient = true;
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  diamond.position.y = 2.6;
  ped.mesh.add(diamond);
  ped.taxiMarker = diamond;
  return ped;
}

export function unmarkTaxiClient(G, ped) {
  if (!ped) return;
  ped.isTaxiClient = false;
  if (ped.taxiMarker) {
    ped.mesh.remove(ped.taxiMarker);
    ped.taxiMarker = null;
  }
  if (ped.state === 'taxi') {
    ped.state = 'walk';
    ped.target = pickWalkTarget(G);
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
    if (ped.state === 'taxi') {
      // Waiting at the kerb: idle sway, marker bobbing, no wandering.
      ped.phase += dt * 2;
      ped.armL.rotation.x = Math.sin(ped.phase) * 0.08;
      ped.armR.rotation.x = -Math.sin(ped.phase) * 0.08;
      if (ped.taxiMarker) ped.taxiMarker.position.y = 2.6 + Math.sin(G.time * 3) * 0.12;
      continue;
    }
    let speed = ped.speed;
    let tx;
    let tz;
    if (ped.state === 'flee' && ped.fleeFrom) {
      speed = 4.5;
      const dx = ped.pos.x - ped.fleeFrom.x;
      const dz = ped.pos.z - ped.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = ped.pos.x + (dx / d) * 30;
      tz = ped.pos.z + (dz / d) * 30;
      if (dist2D(ped.pos.x, ped.pos.z, ped.fleeFrom.x, ped.fleeFrom.z) > 45) {
        ped.state = 'walk';
        ped.target = pickWalkTarget(G);
      }
    } else {
      tx = ped.target.x;
      tz = ped.target.z;
      if (dist2D(ped.pos.x, ped.pos.z, tx, tz) < 2) ped.target = pickWalkTarget(G);
    }
    const dx = tx - ped.pos.x;
    const dz = tz - ped.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    ped.heading = Math.atan2(dx / d, dz / d);
    const nx = ped.pos.x + (dx / d) * speed * dt;
    const nz = ped.pos.z + (dz / d) * speed * dt;
    const res = collideCircle(G, nx, nz, 0.5);
    if (inWorldBounds(res.x, res.z)) {
      ped.pos.x = res.x;
      ped.pos.z = res.z;
    }
    ped.phase += dt * speed * 2.2;
    const swing = Math.sin(ped.phase) * 0.5;
    ped.legL.rotation.x = swing;
    ped.legR.rotation.x = -swing;
    ped.armL.rotation.x = -swing * 0.6;
    ped.armR.rotation.x = swing * 0.6;
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    // Run over by a moving car?
    for (const car of G.cars) {
      if (Math.abs(car.speed) < 4) continue;
      if (dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z) < 2.3) {
        knockPedDown(G, ped);
        if (car === player.car) {
          G.police.addWanted(G, 1, 'You hit a pedestrian!');
          scarePedestrians(G, ped.pos.x, ped.pos.z, 25);
        }
      }
    }
  }
}

export function knockPedDown(G, ped) {
  if (ped.isTaxiClient) unmarkTaxiClient(G, ped);
  ped.state = 'down';
  ped.downTimer = 6;
  ped.mesh.rotation.x = -Math.PI / 2;
  G.fx.burst(ped.pos.clone().setY(1), 0xff4444, 8, 3, 2);
  G.audio.crash();
}
