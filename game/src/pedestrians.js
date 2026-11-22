// Neon Harbor — pedestrians: the people on the sidewalks.
//
// Walkers stroll along the roads on the sidewalk strip, each with their
// own height, clothes, pace and sometimes a hat, so the crowd reads as
// people rather than copies. A few walk in pairs or small groups sharing
// one destination. Walkers pick a new destination when they arrive,
// flee from gunfire and car crashes, and can be flagged as the taxi
// client — a yellow diamond floats over their head until the fare ends.
//
// A pedestrian is a plain object: pos, state, target, marker, heading,
// speed, waitTimer, phase, fleeTimer, scale, mesh, line, fleeX, fleeZ,
// axis, legR, legL, hat, shirt, trousers, skin.

import * as THREE from 'three';
import { clamp, rand, pick, collideCircle } from './state.js';

const SHIRTS = [
  0xd84a4a, 0x4a7ad8, 0x4aa84a, 0xd8a83a, 0x8a5ac8, 0xe8e8e8,
  0x2a2a2e, 0x3aa8c8, 0xc86a8a, 0x7a9a4a, 0xff8a3a, 0x5a4a8a,
];
const TROUSERS = [0x2e4a6a, 0x3a3a3a, 0x6a5a4a, 0x4a3a5a, 0x2a4a3a, 0x8a8a8a];
const SKINS = [0xd8a878, 0xc89068, 0x8a6248, 0xe8c098, 0xa87858];
const HATS = [0xc83a3a, 0x2a5a8a, 0xe8d83a, 0x2a2a2e, 0x4a9a4a, 0xd8d8d8, null, null, null];

// A random sidewalk spot: on a road line, offset to the pavement edge.
function sidewalkSpot(game) {
  const line = pick(game.roads.xs);
  const along = rand(-175, 175);
  if (Math.random() < 0.5) return { x: along, z: line + pick([-7.5, 7.5]) };
  return { x: line + pick([-7.5, 7.5]), z: along };
}

// Pick a destination on the same road the walker is on, a little way off.
function newTarget(game, ped) {
  const along = ped.axis === 'x'
    ? clamp(ped.pos.x + rand(-90, 90), -175, 175)
    : clamp(ped.pos.z + rand(-90, 90), -175, 175);
  if (ped.axis === 'x') return { x: along, z: ped.line };
  return { x: ped.line, z: along };
}

function buildPedMesh(ped) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: ped.shirt, roughness: 0.9 });
  const trouser = new THREE.MeshStandardMaterial({ color: ped.trousers, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: ped.skin, roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.28), shirt);
  torso.position.y = 1.05 * ped.scale;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), skin);
  head.position.y = 1.58 * ped.scale;
  head.castShadow = true;
  group.add(head);

  if (ped.hat) {
    const hatMat = new THREE.MeshStandardMaterial({ color: ped.hat, roughness: 0.85 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 10), hatMat);
    cap.position.y = 1.78 * ped.scale;
    group.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 10), hatMat);
    brim.position.y = 1.73 * ped.scale;
    group.add(brim);
  }

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), shirt);
  armL.position.set(-0.33, 1.05 * ped.scale, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.33;
  group.add(armR);

  const legR = new THREE.Group();
  legR.position.set(0.13, 0.78 * ped.scale, 0);
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), trouser);
  legRMesh.position.y = -0.36 * ped.scale;
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  group.add(legR);

  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.78 * ped.scale, 0);
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.18), trouser);
  legLMesh.position.y = -0.36 * ped.scale;
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  group.add(legL);

  group.scale.setScalar(ped.scale);
  return { group, legR, legL };
}

// Create one walker at a sidewalk spot. `shared` lets a group of walkers
// share one destination and one walking line.
function makePed(game, shared = null) {
  const spot = shared
    ? { x: shared.x + rand(-1.5, 1.5), z: shared.z + rand(-1.5, 1.5) }
    : sidewalkSpot(game);
  const axis = shared ? shared.axis : (Math.random() < 0.5 ? 'x' : 'z');
  const line = shared ? shared.line : (axis === 'x' ? spot.z : spot.x);
  const ped = {
    pos: new THREE.Vector3(spot.x, 0, spot.z),
    state: 'walk',
    target: null,
    marker: null,
    heading: rand(0, Math.PI * 2),
    speed: rand(0.9, 2.1),
    waitTimer: 0,
    phase: rand(0, Math.PI * 2),
    fleeTimer: 0,
    scale: rand(0.88, 1.14),
    mesh: null,
    line,
    fleeX: 0,
    fleeZ: 0,
    axis,
    legR: null,
    legL: null,
    hat: pick(HATS),
    shirt: pick(SHIRTS),
    trousers: pick(TROUSERS),
    skin: pick(SKINS),
  };
  ped.target = shared ? { x: shared.target.x, z: shared.target.z } : newTarget(game, ped);
  const built = buildPedMesh(ped);
  ped.mesh = built.group;
  ped.legR = built.legR;
  ped.legL = built.legL;
  ped.mesh.position.copy(ped.pos);
  game.scene.add(ped.mesh);
  game.peds.push(ped);
  return ped;
}

export function spawnPedestrians(game, count = 26) {
  const made = [];
  let left = count;
  // Roughly a third of walkers stroll in pairs or trios.
  while (left > 0) {
    if (left >= 2 && Math.random() < 0.35) {
      const size = left >= 3 && Math.random() < 0.4 ? 3 : 2;
      const lead = makePed(game);
      made.push(lead);
      left -= 1;
      const shared = {
        x: lead.pos.x, z: lead.pos.z, axis: lead.axis, line: lead.line,
        target: { x: lead.target.x, z: lead.target.z },
      };
      for (let i = 1; i < size && left > 0; i++) {
        made.push(makePed(game, shared));
        left -= 1;
      }
    } else {
      made.push(makePed(game));
      left -= 1;
    }
  }
  return made;
}

export function updatePedestrians(game, dt) {
  const player = game.player;
  for (const ped of game.peds) {
    if (ped.state === 'dead') continue;

    if (ped.state === 'flee') {
      // Fleeing: run away from the scare point until the timer runs out.
      ped.fleeTimer -= dt;
      const dx = ped.pos.x - ped.fleeX;
      const dz = ped.pos.z - ped.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      const runSpeed = ped.speed * 2.6;
      let nx = ped.pos.x + (dx / d) * runSpeed * dt;
      let nz = ped.pos.z + (dz / d) * runSpeed * dt;
      const res = collideCircle(game, nx, nz, 0.5);
      nx = res.x;
      nz = res.z;
      ped.pos.set(nx, 0, nz);
      ped.heading = Math.atan2(dx, dz);
      ped.phase += dt * runSpeed * 3;
      if (ped.fleeTimer <= 0) {
        ped.state = 'walk';
        ped.target = newTarget(game, ped);
      }
    } else if (ped.state === 'wait') {
      // Standing still (taxi client waiting for a ride, or a walker
      // pausing). A little idle sway, no travel.
      ped.waitTimer -= dt;
      ped.phase += dt * 1.2;
      if (ped.waitTimer <= 0 && !game.taxi.client) ped.state = 'walk';
    } else {
      // Normal stroll toward the target along the sidewalk line.
      const dx = ped.target.x - ped.pos.x;
      const dz = ped.target.z - ped.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) {
        // Arrived: pause a moment, then pick a fresh destination.
        ped.state = 'wait';
        ped.waitTimer = rand(1, 4);
        ped.target = newTarget(game, ped);
      } else {
        const step = ped.speed * dt;
        let nx = ped.pos.x + (dx / dist) * step;
        let nz = ped.pos.z + (dz / dist) * step;
        const res = collideCircle(game, nx, nz, 0.5);
        nx = res.x;
        nz = res.z;
        ped.pos.set(nx, 0, nz);
        ped.heading = Math.atan2(dx, dz);
        ped.phase += dt * ped.speed * 3.2;
      }
    }

    // A car bearing down makes walkers dive out of the way.
    if (player && player.car) {
      const car = player.car;
      const dx = ped.pos.x - car.pos.x;
      const dz = ped.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      const closing = Math.abs(car.speed) > 3 && d < 9;
      if (closing && ped.state !== 'flee') {
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        const ahead = (dx * -fx + dz * -fz) / (d || 1);
        if (ahead > 0.4) {
          ped.state = 'flee';
          ped.fleeX = car.pos.x;
          ped.fleeZ = car.pos.z;
          ped.fleeTimer = rand(1.5, 3);
        }
      }
    }

    // Animate the legs and face the direction of travel.
    const swing = Math.sin(ped.phase) * 0.5;
    if (ped.legR) ped.legR.rotation.x = swing;
    if (ped.legL) ped.legL.rotation.x = -swing;
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    if (ped.marker) {
      ped.marker.position.set(ped.pos.x, 2.6 * ped.scale + 0.4, ped.pos.z);
      ped.marker.rotation.y += dt * 2;
    }
  }
}

// Scare every walker within `radius` of (x, z): they flee, and the
// police module counts it as a crime when a car does the scaring.
export function scarePedestrians(game, x, z, radius) {
  let scared = 0;
  for (const ped of game.peds) {
    if (ped.state === 'dead') continue;
    const d = Math.hypot(ped.pos.x - x, ped.pos.z - z);
    if (d < radius) {
      ped.state = 'flee';
      ped.fleeX = x;
      ped.fleeZ = z;
      ped.fleeTimer = rand(2, 4);
      scared += 1;
    }
  }
  return scared;
}

// Flag a walker as the taxi client: a spinning yellow diamond floats
// over their head and they wait in place for the pickup.
export function markTaxiClient(game, ped) {
  if (!ped) return;
  unmarkTaxiClient(game, ped);
  const geo = new THREE.OctahedronGeometry(0.45);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
  const marker = new THREE.Mesh(geo, mat);
  marker.position.set(ped.pos.x, 2.6 * ped.scale + 0.4, ped.pos.z);
  game.scene.add(marker);
  ped.marker = marker;
  ped.state = 'wait';
  ped.waitTimer = 9999;
  if (game.taxi) game.taxi.client = ped;
}

// Clear the taxi marker from a walker and let them stroll again.
export function unmarkTaxiClient(game, ped) {
  if (!ped) return;
  if (ped.marker) {
    game.scene.remove(ped.marker);
    ped.marker.geometry.dispose();
    ped.marker.material.dispose();
    ped.marker = null;
  }
  if (game.taxi && game.taxi.client === ped) game.taxi.client = null;
  if (ped.state === 'wait' && ped.waitTimer > 100) {
    ped.state = 'walk';
    ped.waitTimer = 0;
  }
}
