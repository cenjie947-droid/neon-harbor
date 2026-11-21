// Neon Harbor — pedestrians: the people on the sidewalks.
//
// Walkers stroll along the roads on the sidewalk strip, each with their
// own height, colours, walk speed and (sometimes) a hat; a few stroll
// in pairs or small groups that share one destination. They scatter
// when something violent happens nearby, and one of them can be marked
// as the taxi client's fare with a yellow diamond overhead.
import * as THREE from 'three';
import { GRID_LINES, rand, randInt, pick, clamp, collideCircle } from './state.js';

const SHIRTS = [
  0xd95f4b, 0x4b7fd9, 0x58b368, 0xe0a83c, 0x9b59b6,
  0xe6e6e6, 0x333333, 0xdd7fa0, 0x3fa7a0, 0xc25e7a,
];
const TROUSERS = [0x2b2f36, 0x3a4a6b, 0x5a4632, 0x6b6b6b, 0x27403a];
const SKINS = [0xc98d64, 0x8a5a3a, 0xe8b88a, 0x6a4530, 0xd9a06a];
// Weighted so most people are bare-headed but every hat type shows up.
const HATS = ['none', 'none', 'none', 'cap', 'beanie', 'fedora', 'bandana', 'sunhat', 'helmet'];

const SIDEWALK = 6.8;

function hatMesh(kind, headY) {
  const group = new THREE.Group();
  group.position.y = headY;
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  if (kind === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc0392b));
    dome.position.y = 0.02;
    group.add(dome);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), mat(0xc0392b));
    brim.position.set(0, 0.04, 0.2);
    group.add(brim);
  } else if (kind === 'beanie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a4a6b));
    dome.position.y = 0.02;
    group.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), mat(0x2a3a5b));
    band.position.y = 0.02;
    group.add(band);
  } else if (kind === 'fedora') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 10), mat(0x5a4632));
    crown.position.y = 0.1;
    group.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12), mat(0x5a4632));
    brim.position.y = 0.02;
    group.add(brim);
  } else if (kind === 'bandana') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.1, 10), mat(0xd95f4b));
    band.position.y = 0.08;
    group.add(band);
  } else if (kind === 'sunhat') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.14, 10), mat(0xe0cfa8));
    crown.position.y = 0.09;
    group.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), mat(0xe0cfa8));
    brim.position.y = 0.02;
    group.add(brim);
  } else if (kind === 'helmet') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), mat(0xe6e6e6));
    dome.position.y = 0.03;
    group.add(dome);
  }
  return group;
}

function buildPedMesh(ped) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: pick(SKINS), roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: pick(SHIRTS), roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: pick(TROUSERS), roughness: 0.9 });

  const legL = new THREE.Group();
  legL.position.set(-0.11, 0.78, 0);
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), pants);
  legLMesh.position.y = -0.39;
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  const legR = new THREE.Group();
  legR.position.set(0.11, 0.78, 0);
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.2), pants);
  legRMesh.position.y = -0.39;
  legRMesh.castShadow = true;
  legR.add(legRMesh);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
  torso.position.y = 1.1;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.28), skin);
  head.position.y = 1.62;
  head.castShadow = true;

  group.add(legL, legR, torso, head);
  if (ped.hat !== 'none') {
    group.add(hatMesh(ped.hat, 1.8));
  }
  group.scale.setScalar(ped.scale);
  group.position.copy(ped.pos);
  return { group, legL, legR };
}

// A point further along the same sidewalk, or (sometimes) a turn onto
// the road crossing at the walker's current corner.
function pickTarget(ped) {
  if (Math.random() < 0.18) {
    // Turn the corner: swap axis, keep walking along the crossing road.
    const nearLine = GRID_LINES.reduce((a, b) =>
      (Math.abs(b - (ped.axis === 'x' ? ped.pos.z : ped.pos.x)) < Math.abs(a - (ped.axis === 'x' ? ped.pos.z : ped.pos.x)) ? b : a));
    ped.axis = ped.axis === 'x' ? 'z' : 'x';
    ped.line = nearLine;
  }
  const along = pick(GRID_LINES.slice(0, -1)) + rand(12, 48);
  const side = Math.random() < 0.5 ? -SIDEWALK : SIDEWALK;
  if (ped.axis === 'x') return { x: along, z: ped.line + side };
  return { x: ped.line + side, z: along };
}

function makePed(game, opts = {}) {
  const axis = opts.axis || pick(['x', 'z']);
  const line = opts.line ?? pick(GRID_LINES);
  const along = opts.along ?? (pick(GRID_LINES.slice(0, -1)) + rand(12, 48));
  const side = opts.side ?? (Math.random() < 0.5 ? -SIDEWALK : SIDEWALK);
  const ped = {
    pos: new THREE.Vector3(
      axis === 'x' ? along : line + side,
      0,
      axis === 'x' ? line + side : along,
    ),
    state: 'walk',
    target: null,
    marker: null,
    heading: rand(0, Math.PI * 2),
    speed: Math.round(rand(0.9, 2.1) * 10) / 10,
    waitTimer: 0,
    phase: rand(0, Math.PI * 2),
    fleeTimer: 0,
    scale: Math.round(rand(0.85, 1.18) * 100) / 100,
    mesh: null,
    line,
    fleeX: 0,
    fleeZ: 0,
    axis,
    legR: null,
    legL: null,
    hat: pick(HATS),
    taxiClient: false,
  };
  ped.target = opts.target || pickTarget(ped);
  const built = buildPedMesh(ped);
  ped.mesh = built.group;
  ped.legL = built.legL;
  ped.legR = built.legR;
  game.scene.add(ped.mesh);
  game.peds.push(ped);
  return ped;
}

export function spawnPedestrians(game, count = 28) {
  let i = 0;
  while (i < count) {
    // About a third of walkers travel with company: the companion
    // shares the leader's destination and walks a step behind.
    if (Math.random() < 0.3 && i + 1 < count) {
      const leader = makePed(game);
      const side = Math.random() < 0.5 ? -1 : 1;
      makePed(game, {
        axis: leader.axis,
        line: leader.line,
        along: leader.axis === 'x' ? leader.pos.x + side * 1.4 : leader.pos.z + side * 1.4,
        side: leader.axis === 'x' ? leader.pos.z - leader.line : leader.pos.x - leader.line,
        target: { ...leader.target },
      });
      i += 2;
    } else {
      makePed(game);
      i += 1;
    }
  }
  return game.peds.length;
}

export function updatePedestrians(game, dt) {
  for (const ped of game.peds) {
    if (ped.state === 'wait') {
      // Waiting for a taxi: stand still, look around a little.
      ped.phase += dt * 1.5;
      ped.mesh.rotation.y = ped.heading + Math.sin(ped.phase * 0.5) * 0.4;
      ped.waitTimer -= dt;
      continue;
    }

    let mx = 0;
    let mz = 0;
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const dx = ped.pos.x - ped.fleeX;
      const dz = ped.pos.z - ped.fleeZ;
      const d = Math.hypot(dx, dz) || 1;
      mx = (dx / d) * ped.speed * 2.4;
      mz = (dz / d) * ped.speed * 2.4;
      ped.heading = Math.atan2(mx, mz);
      if (ped.fleeTimer <= 0) {
        ped.state = 'walk';
        ped.target = pickTarget(ped);
      }
    } else {
      const dx = ped.target.x - ped.pos.x;
      const dz = ped.target.z - ped.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        ped.target = pickTarget(ped);
      } else {
        mx = (dx / d) * ped.speed;
        mz = (dz / d) * ped.speed;
        ped.heading = Math.atan2(mx, mz);
      }
    }

    const nx = ped.pos.x + mx * dt;
    const nz = ped.pos.z + mz * dt;
    const res = collideCircle(game, nx, nz, 0.5);
    ped.pos.x = clamp(res.x, -235, 235);
    ped.pos.z = clamp(res.z, -235, 235);

    // Walk cycle: legs swing with the stride, faster when fleeing.
    const stride = ped.state === 'flee' ? 12 : 7;
    ped.phase += dt * stride * (ped.speed / 1.5);
    const swing = Math.sin(ped.phase) * 0.5;
    ped.legL.rotation.x = swing;
    ped.legR.rotation.x = -swing;

    ped.mesh.position.copy(ped.pos);
    ped.mesh.rotation.y = ped.heading;
  }
}

// A scare sends every walker in range running away from the spot.
export function scarePedestrians(game, x, z, radius) {
  for (const ped of game.peds) {
    if (ped.state === 'wait') continue;
    const d = Math.hypot(ped.pos.x - x, ped.pos.z - z);
    if (d < radius) {
      ped.state = 'flee';
      ped.fleeTimer = rand(2.5, 4.5);
      ped.fleeX = x;
      ped.fleeZ = z;
    }
  }
}

// Mark one walker as the taxi fare: a yellow diamond floats over their
// head and they wait where they stand until picked up or timed out.
export function markTaxiClient(game, ped) {
  if (!ped || ped.marker) return ped;
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.4),
    new THREE.MeshBasicMaterial({ color: 0xffd21f }),
  );
  diamond.position.set(ped.pos.x, 2.3 * ped.scale + 0.4, ped.pos.z);
  game.scene.add(diamond);
  ped.marker = diamond;
  ped.state = 'wait';
  ped.waitTimer = 8;
  ped.taxiClient = true;
  return ped;
}

export function unmarkTaxiClient(game, ped) {
  if (!ped) return;
  if (ped.marker) {
    game.scene.remove(ped.marker);
    ped.marker.geometry.dispose();
    ped.marker.material.dispose();
    ped.marker = null;
  }
  ped.taxiClient = false;
  if (ped.state === 'wait') {
    ped.state = 'walk';
    ped.target = pickTarget(ped);
  }
}
