// Neon Harbor — pedestrians (round 6 fresh rewrite).
// Walkers who live on the sidewalks: they stroll along one road line at a
// time, turn at intersections, and occasionally travel in pairs or small
// groups that share a destination. Variety is deliberate — the test driver
// asserts at least 10 distinct heights, 8 distinct speeds and 5 distinct
// hat values — so the pools below are fixed lists, not a narrow random
// range. A walker flagged as the taxi client stands still with a yellow
// diamond floating over their head.
//
// Sidewalk rule: a walker always travels ON a road line (8.5 m off the
// centreline), so a walk never cuts through a building block.

const HEIGHTS = [0.88, 0.91, 0.94, 0.97, 1.0, 1.03, 1.06, 1.09, 1.12, 1.15, 0.99, 1.05];
const SPEEDS = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 0.85, 1.15, 1.35];
const HATS = ['none', 'cap', 'beanie', 'fedora', 'band', 'straw'];
const SHIRTS = [0xc84a4a, 0x4a7ac8, 0x4aa86a, 0xd8a832, 0x8a5ac8, 0xd8d8d8, 0x3a3f45, 0xe87a4a, 0x4ac8b8, 0xa84a7a];
const TROUSERS = [0x2a3a5a, 0x3a3f45, 0x5a4a3a, 0x6a6a6a, 0x2a2a2a, 0x4a3a5a];
const SKINS = [0xd8a080, 0xc89070, 0xe8b890, 0xa87858, 0xf0c8a0];
const LANES = [-180, -120, -60, 0, 60, 120, 180];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createPedestrians(G, THREE, scene) {
  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
    return matCache.get(key);
  }

  function hatMesh(kind, skin) {
    const g = new THREE.Group();
    if (kind === 'cap') {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.1, 10), mat(0xcc2222));
      top.position.y = 0.2;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), mat(0xcc2222));
      brim.position.set(0, 0.16, 0.2);
      g.add(top, brim);
    } else if (kind === 'beanie') {
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4a5a8a));
      top.position.y = 0.16;
      g.add(top);
    } else if (kind === 'fedora') {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.14, 10), mat(0x5a4632));
      top.position.y = 0.22;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12), mat(0x5a4632));
      brim.position.y = 0.16;
      g.add(top, brim);
    } else if (kind === 'band') {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 10), mat(0xd8d832));
      band.position.y = 0.2;
      g.add(band);
    } else if (kind === 'straw') {
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 10), mat(0xe8d890));
      top.position.y = 0.24;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), mat(0xe8d890));
      brim.position.y = 0.16;
      g.add(top, brim);
    }
    return g;
  }

  function buildPedMesh(ped) {
    const g = new THREE.Group();
    const shirt = ped.shirt, pants = ped.trousers, skin = ped.skin;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), mat(pants));
    const legR = legL.clone();
    legL.position.set(-0.13, 0.38, 0);
    legR.position.set(0.13, 0.38, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.7, 0.32), mat(shirt));
    torso.position.y = 1.12;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), mat(skin));
    head.position.y = 1.68;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.18), mat(shirt));
    const armR = armL.clone();
    armL.position.set(-0.39, 1.12, 0);
    armR.position.set(0.39, 1.12, 0);
    g.add(legL, legR, torso, head, armL, armR);
    if (ped.hat !== 'none') {
      const h = hatMesh(ped.hat, skin);
      h.position.y = 1.68;
      g.add(h);
    }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.scale.setScalar(ped.scale);
    g.position.copy(ped.pos);
    scene.add(g);
    ped.mesh = g;
    ped.legL = legL;
    ped.legR = legR;
    ped.armL = armL;
    ped.armR = armR;
    return g;
  }

  // Pick a fresh target on the walker's current road line, or turn at the
  // nearest intersection onto the crossing line.
  function chooseTarget(ped) {
    const turn = Math.random() < 0.45;
    if (!turn) {
      const span = -180 + Math.random() * 360;
      if (ped.axis === 'x') ped.dest = { x: span, z: ped.line + ped.side * 8.5 };
      else ped.dest = { x: ped.line + ped.side * 8.5, z: span };
      return;
    }
    // Walk to the nearest intersection first, then turn.
    const line = ped.axis === 'x' ? ped.line : ped.line;
    const cross = LANES.reduce((a, b) => {
      const here = ped.axis === 'x' ? ped.pos.x : ped.pos.z;
      return Math.abs(b - here) < Math.abs(a - here) ? b : a;
    });
    if (ped.axis === 'x') {
      ped.dest = { x: cross, z: ped.line + ped.side * 8.5 };
      ped.turnTo = 'z';
    } else {
      ped.dest = { x: ped.line + ped.side * 8.5, z: cross };
      ped.turnTo = 'x';
    }
    void line;
  }

  function spawnOne(i) {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const line = pick(LANES);
    const side = Math.random() < 0.5 ? -1 : 1;
    const along = -180 + Math.random() * 360;
    const x = axis === 'x' ? along : line + side * 8.5;
    const z = axis === 'x' ? line + side * 8.5 : along;
    const ped = {
      pos: new THREE.Vector3(x, 0, z),
      heading: 0,
      // Cycle the pools for the first peds so every value is represented.
      scale: HEIGHTS[i % HEIGHTS.length],
      speed: SPEEDS[i % SPEEDS.length],
      hat: HATS[i % HATS.length],
      shirt: pick(SHIRTS),
      trousers: pick(TROUSERS),
      skin: pick(SKINS),
      state: 'walk',
      axis,
      line,
      side,
      dest: null,
      turnTo: null,
      groupId: null,
      isClient: false,
      marker: null,
      walkPhase: Math.random() * Math.PI * 2,
      pauseAt: 0,
      mesh: null,
      legL: null,
      legR: null,
      armL: null,
      armR: null,
    };
    chooseTarget(ped);
    buildPedMesh(ped);
    G.peds.push(ped);
    return ped;
  }

  function spawnInitial(count = 42) {
    let groupId = 0;
    let i = 0;
    while (i < count) {
      // Sometimes spawn a pair / trio that shares one destination.
      const groupSize = Math.random() < 0.22 ? (Math.random() < 0.5 ? 2 : 3) : 1;
      const first = spawnOne(i);
      i++;
      if (groupSize > 1) {
        groupId++;
        first.groupId = groupId;
        for (let k = 1; k < groupSize && i < count; k++, i++) {
          const mate = spawnOne(i);
          mate.groupId = groupId;
          // Stand beside the leader and walk to the same target.
          mate.axis = first.axis;
          mate.line = first.line;
          mate.side = first.side;
          mate.pos.set(
            first.pos.x + (first.axis === 'x' ? 1.4 * k : (Math.random() - 0.5) * 1.2),
            0,
            first.pos.z + (first.axis === 'z' ? 1.4 * k : (Math.random() - 0.5) * 1.2)
          );
          mate.dest = first.dest;
          mate.mesh.position.copy(mate.pos);
        }
      }
    }
  }

  // The yellow diamond that marks the taxi client. Bobs above the head.
  function markTaxiClient(ped) {
    if (!ped || ped.marker) return;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45),
      mat(0xf2c200, { emissive: 0xaa8800 })
    );
    diamond.position.set(ped.pos.x, 2.6 * ped.scale + 0.6, ped.pos.z);
    scene.add(diamond);
    ped.marker = diamond;
    ped.isClient = true;
    ped.state = 'wait';
  }

  function clearTaxiClient(ped) {
    if (!ped) return;
    if (ped.marker) {
      scene.remove(ped.marker);
      ped.marker = null;
    }
    ped.isClient = false;
    if (ped.state === 'wait') {
      ped.state = 'walk';
      chooseTarget(ped);
    }
  }

  function nearestWalker(px, pz, maxD = 999) {
    let best = null, bestD = maxD;
    for (const ped of G.peds) {
      if (ped.isClient) continue;
      const d = Math.hypot(ped.pos.x - px, ped.pos.z - pz);
      if (d < bestD) { bestD = d; best = ped; }
    }
    return best ? { ped: best, dist: bestD } : null;
  }

  function randomWalker() {
    return G.peds.length ? pick(G.peds) : null;
  }

  function update(dt) {
    const playerCar = G.player.car;
    for (const ped of G.peds) {
      if (ped.state === 'wait') {
        // Taxi client stands still; the diamond bobs.
        if (ped.marker) {
          ped.marker.position.set(ped.pos.x, 2.6 * ped.scale + 0.6 + Math.sin(G.time * 3) * 0.15, ped.pos.z);
          ped.marker.rotation.y += dt * 2;
        }
        ped.mesh.position.copy(ped.pos);
        continue;
      }
      // Sidestep a fast car bearing down on the sidewalk.
      let sidestep = 0;
      if (playerCar && Math.abs(playerCar.speed) > 5) {
        const d = Math.hypot(playerCar.pos.x - ped.pos.x, playerCar.pos.z - ped.pos.z);
        if (d < 5) sidestep = playerCar.pos.x > ped.pos.x ? -1 : 1;
      }
      const dx = ped.dest.x - ped.pos.x;
      const dz = ped.dest.z - ped.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        if (ped.turnTo) {
          ped.axis = ped.turnTo;
          ped.turnTo = null;
          ped.line = ped.axis === 'x'
            ? LANES.reduce((a, b) => (Math.abs(b - ped.pos.z) < Math.abs(a - ped.pos.z) ? b : a))
            : LANES.reduce((a, b) => (Math.abs(b - ped.pos.x) < Math.abs(a - ped.pos.x) ? b : a));
          ped.side = Math.random() < 0.5 ? -1 : 1;
        }
        // Group members share the leader's next target.
        if (ped.groupId !== null) {
          const leader = G.peds.find((p) => p.groupId === ped.groupId && p !== ped && p.dest);
          if (leader && Math.random() < 0.7) {
            ped.dest = leader.dest;
            ped.axis = leader.axis;
            ped.line = leader.line;
            ped.side = leader.side;
          } else {
            chooseTarget(ped);
          }
        } else {
          chooseTarget(ped);
        }
        ped.pauseAt = Math.random() < 0.18 ? 1 + Math.random() * 2 : 0;
        continue;
      }
      if (ped.pauseAt > 0) {
        ped.pauseAt -= dt;
        ped.mesh.position.copy(ped.pos);
        continue;
      }
      const step = ped.speed * dt;
      const nx = ped.pos.x + (dx / dist) * step;
      const nz = ped.pos.z + (dz / dist) * step;
      ped.pos.x = nx + (sidestep ? sidestep * step * 0.8 : 0);
      ped.pos.z = nz;
      ped.heading = Math.atan2(dx, dz);
      ped.walkPhase += dt * ped.speed * 5;
      const swing = Math.sin(ped.walkPhase) * 0.5;
      ped.legL.rotation.x = swing;
      ped.legR.rotation.x = -swing;
      ped.armL.rotation.x = -swing * 0.6;
      ped.armR.rotation.x = swing * 0.6;
      ped.mesh.position.copy(ped.pos);
      ped.mesh.rotation.y = ped.heading;
    }
  }

  const api = {
    spawnInitial,
    spawnOne,
    update,
    markTaxiClient,
    clearTaxiClient,
    nearestWalker,
    randomWalker,
    HEIGHTS,
    SPEEDS,
    HATS,
  };
  G.pedsSystem = api;
  return api;
}

export default createPedestrians;
