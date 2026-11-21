// Neon Harbor — the procedural sun-soaked coastal city.
//
// One build pass lays out the whole map: a downtown tower grid, a
// beach and harbor with a pier and ferris wheel along the south edge,
// dockside warehouses on the west side, and low residential blocks
// around the outside. Everything a mission or the HUD needs to navigate
// is recorded in `world.markers` (ten named spots), `world.roads` (the
// grid lines) and `world.colliders` (one box per solid building, so the
// player, cars and police sightlines all agree on what is solid).
//
// Daylight is kept bright on purpose: a high pale sun, a light-blue sky
// and a warm haze, so the city reads as a sunny harbor town, not a
// night map.
import * as THREE from 'three';
import { WORLD, GRID_LINES, rand, randInt, pick } from './state.js';

const BLOCKS = [-150, -90, -30, 30, 90, 150];

const TOWER_BASES = [0x7fa8c9, 0xc9a06a, 0x9aa5ad, 0xb08a7a, 0x6f8fa8, 0xc2b49a];
const HOUSE_BASES = [0xe0cfa8, 0xd9a08a, 0xa8c4b8, 0xe8e2d4, 0xc9b8d9, 0xf0d9a0];
const ROOF_COLORS = [0x8a4a3a, 0x4a5a6a, 0x6a5a4a, 0x7a3a3a, 0x3a4a5a];

function std(color, roughness = 0.85, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

// A canvas facade: lit and dark window panes over a base colour, so a
// plain box reads as a tower without a separate mesh per window.
function facadeTexture(base, height) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + base.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 256);
  const cols = 6;
  const rows = 14;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lit = Math.random() < 0.35;
      ctx.fillStyle = lit ? '#ffd98a' : '#2e3d4d';
      ctx.fillRect(8 + col * 20, 10 + r * 17, 13, 11);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, Math.max(1, Math.round(height / 30)));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function boxMesh(scene, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function addCollider(world, x, z, hw, hd) {
  world.colliders.push({ x, z, hw, hd });
}

function tower(world, cx, cz) {
  const hw = rand(11, 16);
  const hd = rand(11, 16);
  const h = rand(24, 58);
  const mat = new THREE.MeshStandardMaterial({
    map: facadeTexture(pick(TOWER_BASES), h),
    roughness: 0.85,
  });
  boxMesh(world.scene, hw * 2, h, hd * 2, mat, cx, h / 2, cz);
  addCollider(world, cx, cz, hw, hd);
  // Roof slab and, on half the towers, a rooftop plant box or antenna.
  boxMesh(world.scene, hw * 2 + 1, 1.2, hd * 2 + 1, std(0x3a3f46, 0.9), cx, h + 0.6, cz);
  if (Math.random() < 0.5) {
    boxMesh(world.scene, 3, 2, 3, std(0x565d66, 0.9), cx + rand(-6, 6), h + 2.2, cz + rand(-6, 6));
  } else {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6), std(0x888888, 0.6, 0.6));
    ant.position.set(cx, h + 4.5, cz);
    world.scene.add(ant);
  }
}

function house(world, cx, cz) {
  const hw = rand(6, 9);
  const hd = rand(6, 9);
  const h = rand(5, 9);
  const base = pick(HOUSE_BASES);
  boxMesh(world.scene, hw * 2, h, hd * 2, std(base, 0.9), cx, h / 2, cz);
  addCollider(world, cx, cz, hw, hd);
  // Flat slab roof in a contrasting colour, plus a chimney.
  boxMesh(world.scene, hw * 2 + 0.8, 0.7, hd * 2 + 0.8, std(pick(ROOF_COLORS), 0.9), cx, h + 0.35, cz);
  if (Math.random() < 0.6) {
    boxMesh(world.scene, 1, 1.8, 1, std(0x8a6a5a, 0.9), cx + hw * 0.5, h + 1.2, cz - hd * 0.4);
  }
}

function warehouse(world, cx, cz, color) {
  const hw = 20;
  const hd = 13;
  const h = 9;
  boxMesh(world.scene, hw * 2, h, hd * 2, std(color, 0.9), cx, h / 2, cz);
  addCollider(world, cx, cz, hw, hd);
  boxMesh(world.scene, hw * 2 + 1, 0.8, hd * 2 + 1, std(0x4a4f55, 0.9), cx, h + 0.4, cz);
  // Roller door on the road side.
  boxMesh(world.scene, 8, 5, 0.4, std(0x2e3238, 0.7, 0.3), cx, 2.5, cz + hd + 0.2);
}

function shippingContainer(world, x, z, color, ry) {
  const m = boxMesh(world.scene, 6.4, 2.6, 2.6, std(color, 0.9), x, 1.3, z);
  m.rotation.y = ry || 0;
  const ext = Math.abs(Math.cos(ry || 0)) > 0.7 ? { hw: 3.2, hd: 1.3 } : { hw: 1.3, hd: 3.2 };
  addCollider(world, x, z, ext.hw, ext.hd);
}

function tree(world, x, z) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.8, 6), std(0x6a4a2a, 0.95));
  trunk.position.set(x, 0.9, z);
  trunk.castShadow = true;
  world.scene.add(trunk);
  const top = new THREE.Mesh(new THREE.SphereGeometry(rand(1.0, 1.5), 8, 6), std(pick([0x4a8a3a, 0x5a9a44, 0x3a7a34]), 0.95));
  top.position.set(x, 2.6, z);
  top.castShadow = true;
  world.scene.add(top);
}

function buildGround(world) {
  const scene = world.scene;
  // Sky, haze and light: bright midday over the harbor.
  scene.background = new THREE.Color(0x8ec9ee);
  scene.fog = new THREE.Fog(0xa8d4f0, 300, 620);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8f78, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(140, 190, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  world.sun = sun;

  // City ground: pale warm grass-concrete.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2, WORLD.half * 2),
    std(0x93a184, 1),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sand strip along the south edge, then the sea beyond it.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2, WORLD.half - WORLD.sandZ + 2),
    std(0xe6d49a, 1),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, (WORLD.sandZ + WORLD.half) / 2);
  sand.receiveShadow = true;
  scene.add(sand);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2, 130),
    new THREE.MeshStandardMaterial({ color: 0x2f88c4, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, WORLD.waterZ + 65);
  scene.add(sea);
  world.sea = sea;
}

function buildRoads(world) {
  const scene = world.scene;
  const asphalt = std(0x3d4148, 0.95);
  const walk = std(0xb9b3a4, 0.95);
  const roadLen = WORLD.half * 2;
  for (const v of GRID_LINES) {
    // One strip each way per grid line, plus a pale sidewalk on each side.
    const alongX = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, WORLD.roadWidth), asphalt);
    alongX.rotation.x = -Math.PI / 2;
    alongX.position.set(0, 0.03, v);
    alongX.receiveShadow = true;
    scene.add(alongX);
    const alongZ = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, roadLen), asphalt);
    alongZ.rotation.x = -Math.PI / 2;
    alongZ.position.set(v, 0.03, 0);
    alongZ.receiveShadow = true;
    scene.add(alongZ);
    for (const off of [-6.4, 6.4]) {
      const s1 = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, 2.6), walk);
      s1.rotation.x = -Math.PI / 2;
      s1.position.set(0, 0.035, v + off);
      scene.add(s1);
      const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, roadLen), walk);
      s2.rotation.x = -Math.PI / 2;
      s2.position.set(v + off, 0.035, 0);
      scene.add(s2);
    }
  }
}

function buildBlocks(world) {
  // Special blocks get a named building; the rest follow their zone.
  for (const cx of BLOCKS) {
    for (const cz of BLOCKS) {
      // Beachfront row stays low; the sand starts just south of it.
      if (cx === 90 && cz === 150) continue; // paint shop, below
      if (cx === 150 && cz === -30) continue; // Pay N Spray lot, below
      if (cx === -30 && cz === -30) continue; // Mara's garage, below
      if (cx === -30 && cz === 90) continue; // hospital, below
      if (cx === -90 && cz === 30) continue; // hideout, below
      if (cx === 150 && cz === 30) continue; // showroom, below
      if (cx === 30 && cz === -30) { tower(world, cx, cz); continue; } // bank tower
      if (cx === -150 && (cz === 90 || cz === 150)) {
        warehouse(world, cx, cz, pick([0x7a8894, 0x8a7a6a, 0x6a7a8a]));
        continue;
      }
      const downtown = Math.abs(cx) <= 90 && Math.abs(cz) <= 90;
      if (downtown) {
        tower(world, cx, cz);
      } else {
        // Residential: two or three small houses per block, on fixed
        // corners so no two houses ever overlap each other.
        const spots = [[-12, -12], [12, 11], [-11, 12]];
        const n = randInt(2, 3);
        for (let i = 0; i < n; i++) {
          house(world, cx + spots[i][0], cz + spots[i][1]);
        }
      }
    }
  }

  // Mara's garage — low block with a yellow awning over the forecourt.
  boxMesh(world.scene, 22, 7, 14, std(0x8a7a5a, 0.9), -30, 3.5, -30);
  addCollider(world, -30, -30, 11, 7);
  boxMesh(world.scene, 22, 0.6, 6, std(0xe0b93c, 0.8), -30, 6.2, -19);
  boxMesh(world.scene, 10, 4.5, 0.4, std(0x2e3238, 0.7, 0.3), -30, 2.25, -22.8);

  // Paint shop — a low workshop on the beachfront row.
  boxMesh(world.scene, 24, 8, 20, std(0x9a6a8a, 0.9), 85, 4, 140);
  addCollider(world, 85, 140, 12, 10);
  boxMesh(world.scene, 24, 0.8, 5, std(0xe0b93c, 0.8), 85, 7.4, 128.5);

  // Hospital — white block with a red cross slab on the roof.
  boxMesh(world.scene, 30, 14, 22, std(0xe8e8e2, 0.85), -30, 7, 95);
  addCollider(world, -30, 95, 15, 11);
  boxMesh(world.scene, 8, 1, 2.5, std(0xc0392b, 0.8), -30, 14.6, 95);
  boxMesh(world.scene, 2.5, 1, 8, std(0xc0392b, 0.8), -30, 14.6, 95);

  // Hideout — a plain two-storey house on its own block.
  house(world, -90, 30);

  // Showroom — glass-fronted sales block on the east side.
  boxMesh(world.scene, 34, 10, 24, std(0x5a7a9a, 0.5, 0.4), 150, 5, 30);
  addCollider(world, 150, 30, 17, 12);
  boxMesh(world.scene, 34, 0.8, 4, std(0x2e3238, 0.6, 0.4), 150, 8.5, 16.5);

  // Pay N Spray — an open pad, not a building: a painted slab, a kiosk
  // at the edge and no collider, so cars drive straight onto it.
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 22),
    std(0x4a6a8a, 0.9),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(150, 0.04, -45);
  pad.receiveShadow = true;
  world.scene.add(pad);
  boxMesh(world.scene, 4, 4, 4, std(0xe0b93c, 0.8), 160, 2, -56);
  boxMesh(world.scene, 26, 0.5, 1, std(0xe0e0e0, 0.8), 150, 0.1, -56);

  // Dockside containers, stacked two high in places.
  const containerColors = [0xb04030, 0x3070b0, 0x40a060, 0xc0a030, 0x707880];
  const spots = [[-165, 60], [-138, 62], [-160, 122], [-135, 125], [-168, 175], [-140, 178]];
  for (const [x, z] of spots) {
    shippingContainer(world, x, z, pick(containerColors), Math.random() < 0.5 ? 0 : Math.PI / 2);
  }
  shippingContainer(world, -165, 68, pick(containerColors), 0);
}

function buildHarbor(world) {
  // Wooden pier reaching out into the sea from the beach.
  boxMesh(world.scene, 8, 0.5, 38, std(0x8a6a44, 0.95), -60, 0.25, 216);
  for (const [px, pz] of [[-63, 205], [-57, 205], [-63, 232], [-57, 232]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 6), std(0x5a4028, 0.95));
    post.position.set(px, 0.4, pz);
    world.scene.add(post);
  }

  // Ferris wheel on the sand: two legs and a spinning rim with cabins.
  const cx = 45;
  const cz = 208;
  const legMat = std(0xdde3e8, 0.6, 0.3);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 1.2), legMat);
    leg.position.set(cx + s * 7, 11, cz);
    leg.rotation.z = s * -0.32;
    leg.castShadow = true;
    world.scene.add(leg);
  }
  const wheel = new THREE.Group();
  wheel.position.set(cx, 20, cz);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(15, 0.7, 8, 40),
    std(0xe05a6a, 0.5, 0.4),
  );
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.5, 10), std(0xeeeeee, 0.5, 0.4));
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 29, 0.5), std(0xeeeeee, 0.6, 0.3));
    spoke.position.set(0, 0, 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 2.2),
      std(pick([0xe05a6a, 0x4a90d9, 0xe0b93c, 0x40a060]), 0.6),
    );
    cabin.position.set(Math.sin(a) * 15, Math.cos(a) * 15, 0);
    wheel.add(cabin);
  }
  // Turn the rim to face the beach: the wheel plane is YZ after this.
  wheel.rotation.y = Math.PI / 2;
  world.scene.add(wheel);
  world.ferris = wheel;
  addCollider(world, cx, cz, 3, 3);

  // A few beach umbrellas for colour.
  for (const [ux, uz, col] of [[-20, 206, 0xe05a6a], [10, 210, 0x4a90d9], [80, 204, 0xe0b93c]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), std(0xeeeeee, 0.7));
    pole.position.set(ux, 1.2, uz);
    world.scene.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.9, 10), std(col, 0.8));
    top.position.set(ux, 2.7, uz);
    world.scene.add(top);
  }
}

function buildTrees(world) {
  // Trees along sidewalk corners, clear of roads and driveways.
  let placed = 0;
  let guard = 0;
  while (placed < 40 && guard < 300) {
    guard++;
    const x = pick(BLOCKS) + rand(-24, 24);
    const z = pick(BLOCKS) + rand(-24, 24);
    let onRoad = false;
    for (const v of GRID_LINES) {
      if (Math.abs(x - v) < 8 || Math.abs(z - v) < 8) { onRoad = true; break; }
    }
    if (onRoad) continue;
    let inside = false;
    for (const c of world.colliders) {
      if (Math.abs(x - c.x) < c.hw + 1 && Math.abs(z - c.z) < c.hd + 1) { inside = true; break; }
    }
    if (inside) continue;
    tree(world, x, z);
    placed++;
  }
}

export function buildCity(world) {
  buildGround(world);
  buildRoads(world);
  buildBlocks(world);
  buildHarbor(world);
  buildTrees(world);

  // Navigation markers. Each sits on a road next to its building, so a
  // car can drive right up to it; the beach marker is on the sand.
  world.markers = {
    bank: { x: 30, z: -60 },
    beach: { x: 0, z: 205 },
    docks: { x: -180, z: 90 },
    garage: { x: -30, z: -60 },
    hideout: { x: -90, z: 60 },
    hospital: { x: -60, z: 90 },
    paintShop: { x: 85, z: 120 },
    showroom: { x: 120, z: 30 },
    spray: { x: 150, z: -60 },
    warehouse: { x: -180, z: 150 },
  };
  world.roads = { xs: [...GRID_LINES], zs: [...GRID_LINES] };
  return world;
}
