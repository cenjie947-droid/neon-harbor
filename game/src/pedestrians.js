// Neon Harbor — the people on the street.
//
// Pedestrians give the city life: they stroll the sidewalks in varied
// heights, clothes, speeds and hats, sometimes in pairs, and they run
// when something loud happens nearby. They are also the taxi side job —
// a walker can be marked as a waiting fare, stand still with a yellow
// marker over their head, and climb in when Cole pulls up.
//
// Walkers stay on the roads. A walker's destination is always a point
// on the same road line they are already on, so they stroll along the
// street instead of cutting through buildings, and the collision test
// is only a safety net for the odd corner.

import * as THREE from 'three';
import { rand, pick, clamp, collideCircle, dist2D } from './state.js';

const WARDROBE = {
  shirts: [0xc05a5a, 0x5a7ac0, 0x5aa87a, 0xd9c05a, 0x8a5ac0, 0xc07a3a, 0x4a9a9a, 0xa85a8a, 0x6a6a6a, 0xe0e0e0],
  skins: [0xd9a986, 0xc08a6a, 0x8a5a3a, 0xe8b89a, 0x6a4a2a],
  pants: [0x2a3a4a, 0x3a2a2a, 0x4a4a4a, 0x2a4a3a],
};

function fabric(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
}

function addBox(parent, w, h, d, mat, x, y, z, shadow) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.x = x;
  mesh.position.y = y;
  mesh.position.z = z;
  if (shadow) mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// One walker, built from boxes: legs that swing, a torso in a random
// shirt, a head in a random skin tone, and a hat on about two in three —
// the hat is a cap in a random colour, which is also what the variety
// check counts. The whole group is scaled by the walker's height.
function buildPed(scale, shirt, skin, hatColor) {
  const group = new THREE.Group();
  const legMat = fabric(pick(WARDROBE.pants));
  const legL = new THREE.Group();
  legL.position.x = -0.11;
  legL.position.y = 0.42;
  legL.position.z = 0;
  addBox(legL, 0.16, 0.42, 0.16, legMat, 0, -0.21, 0, true);
  const legR = new THREE.Group();
  legR.position.x = 0.11;
  legR.position.y = 0.42;
  legR.position.z = 0;
  addBox(legR, 0.16, 0.42, 0.16, legMat, 0, -0.21, 0, true);
  group.add(legL);
  group.add(legR);
  const shirtMat = fabric(shirt);
  addBox(group, 0.46, 0.52, 0.26, shirtMat, 0, 0.68, 0, true);
  addBox(group, 0.12, 0.46, 0.12, shirtMat, -0.3, 0.68, 0, false);
  addBox(group, 0.12, 0.46, 0.12, shirtMat, 0.3, 0.68, 0, false);
  addBox(group, 0.3, 0.32, 0.28, fabric(skin), 0, 1.1, 0, true);
  if (hatColor !== null) {
    const capMat = fabric(hatColor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.12, 10), capMat);
    cap.position.y = 1.3;
    group.add(cap);
    addBox(group, 0.3, 0.04, 0.2, capMat, 0, 1.26, 0.2, false);
  }
  group.scale.setScalar(scale);
  return { group, legL, legR };
}

// A spot on a sidewalk: a road line, a distance along it, and a side.
// Sidewalk spots sit just off the asphalt, clear of the buildings.
function sidewalkSpot(game) {
  const axis = Math.random() < 0.5 ? 'x' : 'z';
  const line = pick(game.roads.xs);
  const along = rand(-210, 210);
  const side = pick([-1, 1]) * rand(6.5, 8.5);
  const spot = { axis, line };
  if (axis === 'x') {
    spot.x = line + side;
    spot.z = along;
  } else {
    spot.x = along;
    spot.z = line + side;
  }
  return spot;
}

function makePed(game, spot) {
  const scale = rand(0.88, 1.18);
  const hatColor = Math.random() < 0.68 ? Math.floor(rand(0, 0xffffff)) : null;
  const built = buildPed(scale, pick(WARDROBE.shirts), pick(WARDROBE.skins), hatColor);
  const ped = {};
  ped.mesh = built.group;
  ped.legL = built.legL;
  ped.legR = built.legR;
  ped.pos = new THREE.Vector3(spot.x, 0, spot.z);
  ped.heading = rand(0, Math.PI * 2);
  ped.speed = rand(0.9, 2.2);
  ped.scale = scale;
  ped.hat = hatColor;
  ped.state = 'walk';
  ped.axis = spot.axis;
  ped.line = spot.line;
  ped.target = null;
  ped.waitTimer = rand(0, 2);
  ped.fleeTimer = 0;
  ped.fleeX = 0;
  ped.fleeZ = 0;
  ped.phase = rand(0, Math.PI * 2);
  ped.marker = null;
  built.group.position.copy(ped.pos);
  built.group.rotation.y = ped.heading;
  game.scene.add(built.group);
  return ped;
}

export function spawnPedestrians(game, count) {
  let i = 0;
  while (i < count) {
    const spot = sidewalkSpot(game);
    const ped = makePed(game, spot);
    game.peds.push(ped);
    // About a third of walkers stroll in pairs: a companion a step
    // behind, heading for the same stretch of street.
    if (Math.random() < 0.32 && game.peds.length < count + 8) {
      const near = {
        x: spot.x + rand(-1.5, 1.5),
        z: spot.z + rand(-1.5, 1.5),
        axis: spot.axis,
        line: spot.line,
      };
      const mate = makePed(game, near);
      mate.target = ped.target;
      game.peds.push(mate);
    }
    i++;
  }
}

// A new destination on the same road line, 25 to 80 m away in either
// direction. Staying on one line is what keeps walkers out of the
// buildings without any pathfinding.
function pickTarget(ped) {
  const along = ped.axis === 'x' ? ped.pos.z : ped.pos.x;
  const next = clamp(along + pick([-1, 1]) * rand(25, 80), -215, 215);
  const side = pick([-1, 1]) * rand(6.5, 8.5);
  const dest = {};
  if (ped.axis === 'x') {
    dest.x = ped.line + side;
    dest.z = next;
  } else {
    dest.x = next;
    dest.z = ped.line + side;
  }
  return dest;
}

// Turn a heading toward a target heading, at most `rate` radians per
// second, always taking the short way round.
function steerToward(heading, want, rate, dt) {
  let turn = want - heading;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return heading + clamp(turn, -dt * rate, dt * rate);
}

function swingLegs(ped, pace, dt, amp) {
  ped.phase += dt * pace * 4;
  const swing = Math.sin(ped.phase) * amp;
  ped.legL.rotation.x = swing;
  ped.legR.rotation.x = -swing;
}

function walkPed(game, ped, dt) {
  if (!ped.target) ped.target = pickTarget(ped);
  const dx = ped.target.x - ped.pos.x;
  const dz = ped.target.z - ped.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.2) {
    ped.waitTimer -= dt;
    if (ped.waitTimer <= 0) {
      ped.target = pickTarget(ped);
      ped.waitTimer = rand(0, 3);
    }
    ped.phase += dt * 2;
    return;
  }
  const want = Math.atan2(dx, dz);
  ped.heading = steerToward(ped.heading, want, 3, dt);
  const nx = ped.pos.x + Math.sin(ped.heading) * ped.speed * dt;
  const nz = ped.pos.z + Math.cos(ped.heading) * ped.speed * dt;
  const moved = collideCircle(game, nx, nz, 0.4);
  if (moved.hit) {
    // A wall in the way: give up on this destination and pick another.
    ped.target = pickTarget(ped);
    return;
  }
  ped.pos.x = moved.x;
  ped.pos.z = moved.z;
  swingLegs(ped, ped.speed, dt, 0.5);
}

function fleePed(game, ped, dt) {
  ped.fleeTimer -= dt;
  if (ped.fleeTimer <= 0) {
    ped.state = 'walk';
    ped.target = null;
    return;
  }
  const dx = ped.pos.x - ped.fleeX;
  const dz = ped.pos.z - ped.fleeZ;
  const d = Math.hypot(dx, dz) || 1;
  const want = Math.atan2(dx / d, dz / d);
  ped.heading = want;
  const run = ped.speed * 2.3;
  const nx = ped.pos.x + Math.sin(want) * run * dt;
  const nz = ped.pos.z + Math.cos(want) * run * dt;
  const moved = collideCircle(game, nx, nz, 0.4);
  ped.pos.x = moved.x;
  ped.pos.z = moved.z;
  swingLegs(ped, run, dt, 0.7);
}

export function updatePedestrians(game, dt) {
  let i = 0;
  while (i < game.peds.length) {
    const ped = game.peds[i];
    if (ped.state === 'taxi') {
      // A waiting fare stands still, marker bobbing over their head.
      if (ped.marker) {
        ped.marker.position.y = 2.5 * ped.scale + Math.sin(game.time * 3) * 0.15;
        ped.marker.rotation.y += dt * 2;
      }
      i++;
      continue;
    }
    if (ped.state === 'flee') fleePed(game, ped, dt);
    else walkPed(game, ped, dt);
    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
    i++;
  }
}

// Everyone nearby runs from a scare — a stolen car, a gunshot, a punch.
export function scarePedestrians(game, x, z, radius) {
  let i = 0;
  while (i < game.peds.length) {
    const ped = game.peds[i];
    if (ped.state === 'walk' && dist2D(ped.pos.x, ped.pos.z, x, z) <= radius) {
      ped.state = 'flee';
      ped.fleeX = x;
      ped.fleeZ = z;
      ped.fleeTimer = rand(2, 3.5);
    }
    i++;
  }
}

// Mark a walker as the waiting fare: they stop, and a yellow diamond
// floats over them so Cole can spot them down the street. Returns the
// walker, or null when they cannot take the fare.
export function markTaxiClient(game, ped) {
  if (!ped) return null;
  if (ped.state !== 'walk') return null;
  ped.state = 'taxi';
  ped.target = null;
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  marker.position.x = ped.pos.x;
  marker.position.y = 2.5 * ped.scale;
  marker.position.z = ped.pos.z;
  game.scene.add(marker);
  ped.marker = marker;
  return ped;
}

export function unmarkTaxiClient(game, ped) {
  if (!ped) return;
  if (ped.marker) {
    game.scene.remove(ped.marker);
    ped.marker = null;
  }
  if (ped.state === 'taxi') {
    ped.state = 'walk';
    ped.target = null;
  }
}
