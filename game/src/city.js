// Neon Harbor — the procedural city. One builder lays out the whole
// world: a bright midday sky, ground / sand / sea, the road grid with
// sidewalks, a block-by-block skyline (downtown towers in the middle,
// warehouses on the east docks, low houses elsewhere), palms, lamps, shop
// signs, the pier and ferris wheel, the Pay N Spray garage, and the named
// markers the missions drive to. The objective beacon is built here too
// and moved around by the mission system.
import * as THREE from 'three';
import { WORLD, rand, randInt, pick, makeCanvasTexture } from './state.js';

const ROAD_LINES = [-180, -120, -60, 0, 60, 120, 180];
const SIGNS = [
  'TACO TIDE', 'NEON MOTEL', 'PALM PAWN', 'SALT AIR BAR', 'PIER PIZZA',
  'HARBOR INK', 'SUNSET DONUTS', 'WAVE WASH', 'CORAL CAFE', 'TIDE POOL GYM',
  'ANCHOR ARMS', 'GULL GROCERY', 'MANGO MOTORS', 'REEF RECORDS',
];

// A facade texture: flat base colour with a grid of windows, some lit.
function wallTexture(base, lit) {
  return makeCanvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 18) {
      for (let x = 8; x < w - 8; x += 16) {
        ctx.fillStyle = Math.random() < 0.42 ? lit : 'rgba(20,26,44,0.9)';
        ctx.fillRect(x, y, 10, 12);
      }
    }
  });
}

function signFace(text, accent) {
  return makeCanvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = accent;
    ctx.font = 'bold 30px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
}

export function buildCity(G) {
  const scene = G.scene;
  G.roads.xs = [...ROAD_LINES];
  G.roads.zs = [...ROAD_LINES];
  let signIdx = 0;

  // ----- sky, light, fog -----
  scene.background = new THREE.Color(0x7fb2e5);
  scene.fog = new THREE.Fog(0x9fc3e8, 180, 620);
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x9a8a6a, 1.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.6);
  sun.position.set(-140, 120, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 500;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffd9a8, 0.75);
  fill.position.set(160, 90, 140);
  scene.add(fill);
  G.sun = sun;
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0, 0, 0);
  scene.add(sunTarget);
  sun.target = sunTarget;

  // Gradient dome plus a low sun disc, so the horizon never reads flat.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f7fd0) },
      mid: { value: new THREE.Color(0x9fd0f0) },
      bot: { value: new THREE.Color(0xffe9b8) },
    },
    vertexShader:
      'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      void main(){ float h = normalize(vP).y;
      vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.75, h)) : mix(bot, mid, smoothstep(-0.05, 0.25, h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12), skyMat));
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(34, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }),
  );
  sunDisc.position.set(-420, 95, -320);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);

  // ----- ground, sand, sea -----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2 + 80, WORLD.half * 2 + 80),
    new THREE.MeshStandardMaterial({ color: 0x6b7d5e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 40);
  ground.receiveShadow = true;
  scene.add(ground);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2 + 80, 40),
    new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.05, 184);
  sand.receiveShadow = true;
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.half * 2 + 400, 260),
    new THREE.MeshStandardMaterial({ color: 0x1d5f7a, roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.94 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.12, 330);
  scene.add(sea);
  G.sea = sea;

  // ----- buildings, block by block -----
  const texDowntown = wallTexture('#3a4258', '#ffd98a');
  const texMid = wallTexture('#4a4038', '#ffb36b');
  const texLow = wallTexture('#5a4a3e', '#ffcf8a');
  const texWare = wallTexture('#5c6066', '#9fd8ff');
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 1 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x35506e, roughness: 0.35, metalness: 0.3 });

  function putBuilding(cx, cz, w, d, h, tex, isGlass) {
    const mat = isGlass ? glassMat : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.position.set(cx, h / 2, cz);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6), roofMat);
    roof.position.set(cx, h + 0.4, cz);
    scene.add(roof);
    G.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    if (h > 34 && Math.random() < 0.6) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.5, 10, 6),
        new THREE.MeshStandardMaterial({ color: 0x888888 }),
      );
      antenna.position.set(cx, h + 5, cz);
      scene.add(antenna);
    }
    return body;
  }

  function hangSign(x, z, y, rotY) {
    const text = SIGNS[signIdx++ % SIGNS.length];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.2),
      new THREE.MeshBasicMaterial({
        map: signFace(text, pick(['#ff5b8a', '#4fd8ff', '#ffd23e', '#7dff9e'])),
        transparent: true,
      }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    scene.add(sign);
  }

  function fillBlock(cx, cz) {
    if (cz > 150) return; // beach band stays open
    const downtown = Math.abs(cx) <= 90 && Math.abs(cz) <= 90;
    const docks = cx > 120;
    const count = downtown ? randInt(1, 2) : randInt(1, 3);
    for (let i = 0; i < count; i++) {
      const ox = (i % 2 === 0 ? -11 : 11) + rand(-3, 3);
      const oz = (i < 2 ? -11 : 11) + rand(-3, 3);
      const w = rand(16, 24);
      const d = rand(16, 24);
      let h;
      let tex;
      let glass = false;
      if (downtown) {
        h = rand(30, 68);
        tex = texDowntown;
        glass = Math.random() < 0.4;
      } else if (docks) {
        h = rand(9, 14);
        tex = texWare;
      } else {
        h = rand(8, 18);
        tex = Math.random() < 0.5 ? texMid : texLow;
      }
      const built = putBuilding(cx + ox, cz + oz, w, d, h, tex, glass);
      if (Math.random() < 0.3 && h < 22) {
        hangSign(built.position.x, built.position.z + d / 2 + 0.3, Math.min(h - 1.5, 7), 0);
      }
    }
  }

  for (let bx = 0; bx < 7; bx++) {
    for (let bz = 0; bz < 7; bz++) {
      fillBlock(-180 + bx * 60 + 30, -180 + bz * 60 + 30);
    }
  }

  // ----- roads, dashes, sidewalks -----
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x35363e, roughness: 0.95 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c25a });
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 1 });
  for (const rx of ROAD_LINES) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.half * 2), roadMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(rx, 0.06, 0);
    strip.receiveShadow = true;
    scene.add(strip);
    for (let z = -WORLD.half + 15; z < WORLD.half; z += 30) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 7), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(rx, 0.09, z);
      scene.add(dash);
    }
    for (const side of [-9, 9]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(4, WORLD.half * 2), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(rx + side, 0.05, 0);
      scene.add(walk);
    }
  }
  for (const rz of ROAD_LINES) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.half * 2, WORLD.roadWidth), roadMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.06, rz);
    strip.receiveShadow = true;
    scene.add(strip);
    for (let x = -WORLD.half + 15; x < WORLD.half; x += 30) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.5), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.09, rz);
      scene.add(dash);
    }
    for (const side of [-9, 9]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.half * 2, 4), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(0, 0.05, rz + side);
      scene.add(walk);
    }
  }

  // ----- palms -----
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d46, roughness: 1, side: THREE.DoubleSide });
  function plantPalm(x, z) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 6, 6), trunkMat);
    trunk.position.y = 3;
    trunk.rotation.z = rand(-0.12, 0.12);
    trunk.castShadow = true;
    palm.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), leafMat);
      leaf.position.y = 6.1;
      leaf.rotation.y = (i / 6) * Math.PI * 2;
      leaf.rotation.x = -0.7;
      leaf.translateY(0.4);
      palm.add(leaf);
    }
    palm.position.set(x, 0, z);
    scene.add(palm);
  }
  for (let x = -210; x <= 210; x += 24) plantPalm(x + rand(-4, 4), 162 + rand(-2, 2));
  for (let i = 0; i < 26; i++) {
    plantPalm(pick(ROAD_LINES) + pick([-11, 11]), rand(-180, 140));
  }

  // ----- street lamps -----
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  G.lamps = [];
  for (const rx of ROAD_LINES) {
    for (let z = -180; z <= 150; z += 60) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
      pole.position.set(rx + 8.5, 3.5, z);
      pole.castShadow = true;
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat);
      head.position.set(rx + 8.5, 7.1, z);
      scene.add(head);
    }
  }

  // ----- pier and ferris wheel, south into the sea -----
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 70), pierMat);
  pier.position.set(60, 0.8, 225);
  pier.receiveShadow = true;
  scene.add(pier);
  for (let z = 200; z <= 256; z += 14) {
    for (const px of [56, 64]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 6), pierMat);
      post.position.set(px, 0.4, z);
      scene.add(post);
    }
  }
  const ferris = new THREE.Group();
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.7, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xff5b8a, emissive: 0x881133, roughness: 0.4 }),
  );
  wheel.position.y = 14;
  ferris.add(wheel);
  for (let i = 0; i < 8; i++) {
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshStandardMaterial({ color: pick([0xffd23e, 0x4fd8ff, 0x7dff9e]) }),
    );
    const a = (i / 8) * Math.PI * 2;
    cab.position.set(Math.cos(a) * 9, 14 + Math.sin(a) * 9, 0);
    ferris.add(cab);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 15, 6), poleMat);
    leg.position.set(side * 5, 7, 0);
    leg.rotation.z = -side * 0.35;
    ferris.add(leg);
  }
  ferris.position.set(84, 0, 232);
  scene.add(ferris);
  G.ferris = ferris;

  // ----- named markers -----
  G.markers = {
    garage: new THREE.Vector3(-60, 0, -40),
    hideout: new THREE.Vector3(-120, 0, 150),
    paintShop: new THREE.Vector3(60, 0, 30),
    docks: new THREE.Vector3(180, 0, 90),
    showroom: new THREE.Vector3(120, 0, -120),
    warehouse: new THREE.Vector3(180, 0, -30),
    bank: new THREE.Vector3(0, 0, 30),
    hospital: new THREE.Vector3(-120, 0, -150),
    beach: new THREE.Vector3(0, 0, 175),
    spray: new THREE.Vector3(120, 0, 60), // Pay N Spray pad, on the road grid
  };

  // Yellow ground pads on the spots that matter, so the player can see
  // them from a block away.
  const padMat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.35 });
  for (const [name, p] of Object.entries(G.markers)) {
    if (name === 'beach') continue;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(4, 20), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(p.x, 0.1, p.z);
    scene.add(pad);
  }

  // ----- Pay N Spray: a kiosk on the corner by the pad -----
  const kiosk = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f6fb2, roughness: 0.7 }),
  );
  kiosk.position.set(138, 3, 78);
  kiosk.castShadow = true;
  kiosk.receiveShadow = true;
  scene.add(kiosk);
  const kioskRoof = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.7, 9),
    new THREE.MeshStandardMaterial({ color: 0xffd23e, roughness: 0.6 }),
  );
  kioskRoof.position.set(138, 6.4, 78);
  scene.add(kioskRoof);
  G.colliders.push({ minX: 133, maxX: 143, minZ: 74, maxZ: 82 });
  const spraySign = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 2.5),
    new THREE.MeshBasicMaterial({ map: signFace('PAY N SPRAY', '#7dff9e'), transparent: true }),
  );
  spraySign.position.set(138, 4.6, 73.8);
  spraySign.rotation.y = Math.PI;
  scene.add(spraySign);
  // A striped awning over the pad so the bay reads as a garage, not a
  // random patch of road.
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd23e, roughness: 0.8, side: THREE.DoubleSide }),
  );
  awning.rotation.x = -Math.PI / 2;
  awning.position.set(120, 5.2, 60);
  scene.add(awning);
  for (const px of [114.5, 125.5]) {
    for (const pz of [56, 64]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.2, 6), poleMat);
      post.position.set(px, 2.6, pz);
      scene.add(post);
    }
  }

  // ----- objective beacon (moved by the mission system) -----
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.6, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 21;
  beacon.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3, 0.35, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  beacon.add(ring);
  const blight = new THREE.PointLight(0xffd23e, 14, 30, 2);
  blight.position.y = 4;
  beacon.add(blight);
  beacon.visible = false;
  scene.add(beacon);
  G.beacon = beacon;
  G.beaconTarget = null;

  return G;
}
