// Neon Harbor — police: wanted stars, cruisers, foot officers,
// roadblocks and the 4+ star helicopter. Written fresh for round 6 (v12).
// Heat only falls when the player is genuinely unseen for a full minute;
// the helicopter overhead pauses that decay because it can see the player.
import * as THREE from 'three';

// Road lines, spaced 60 m apart across the city, listed high to low.
const ROAD_LINES = [180, 120, 60, 0, -60, -120, -180];
const CHASE_SPEED = 24;
const DECAY_SECONDS = 60;
const GRAB_SECONDS = 2.5;
const HELI_HEIGHT = 40;
const HELI_TRAIL = 25;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const rand = (a, b) => a + Math.random() * (b - a);
const nearestLine = (v) => ROAD_LINES.reduce((best, line) => (Math.abs(line - v) < Math.abs(best - v) ? line : best));

export function createPolice(G) {
  if (!Array.isArray(G.policeCars)) G.policeCars = [];
  if (!Array.isArray(G.officers)) G.officers = [];
  G.wanted = G.wanted || 0;

  let unseenTimer = 0;
  let blockCooldown = 0;
  let blockPoint = null;
  let heli = null; // { group, rotor, tailRotor, light, pool, mode, leaveTimer }

  // ---- helpers ---------------------------------------------------------
  function say(msg) {
    if (G.hud && typeof G.hud.addFeed === 'function') {
      try { G.hud.addFeed(msg); return; } catch (e) { /* fall through */ }
    }
    if (Array.isArray(G.feed)) G.feed.push(msg);
    else G.feed = [msg];
  }
  function sfx(name, ...args) {
    if (G.audio && typeof G.audio[name] === 'function') {
      try { G.audio[name](...args); } catch (e) { /* cosmetic */ }
    }
  }
  function circleHits(x, z, r) {
    for (const k of G.colliders || []) {
      if (Math.abs(x - k.x) < k.hw + r && Math.abs(z - k.z) < k.hd + r) return true;
    }
    return false;
  }
  function losClear(ax, az, bx, bz) {
    const d = dist2(ax, az, bx, bz);
    const steps = Math.max(1, Math.ceil(d / 3));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (circleHits(lerp(ax, bx, t), lerp(az, bz, t), 0.5)) return false;
    }
    return true;
  }
  function openGroundNear(x, z, minR, maxR) {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = rand(minR, maxR);
      const nx = clamp(x + Math.cos(ang) * r, -200, 200);
      const nz = clamp(z + Math.sin(ang) * r, -200, 200);
      if (!circleHits(nx, nz, 2)) return { x: nx, z: nz };
    }
    return { x, z };
  }
  function snapToRoad(x, z) {
    const lx = nearestLine(x), lz = nearestLine(z);
    if (Math.abs(x - lx) <= Math.abs(z - lz)) return { x: lx, z };
    return { x, z: lz };
  }
  function playerHeading() {
    const car = G.player.car;
    return car ? car.heading : G.player.heading;
  }
  function damagePlayer(n) {
    if (G.player.invuln > 0) return;
    G.health = Math.max(0, (G.health || 0) - n);
    G.player.health = G.health;
    if (G.health <= 0 && typeof G.onWasted === 'function') G.onWasted();
  }
  function damagePlayerCar(car, n) {
    if (!car) return;
    car.health = Math.max(0, car.health - n);
    if (car.health <= 0) car.disabled = true;
    sfx('crash');
  }

  // ---- meshes ----------------------------------------------------------
  function cruiserMesh() {
    const group = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color: 0x14264a });
    const pale = new THREE.MeshLambertMaterial({ color: 0xe8ecf2 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.6), paint);
    body.position.y = 0.75;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 2.2), pale);
    cabin.position.set(0, 1.4, -0.3);
    group.add(cabin);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xcc2222, emissive: 0x550000 }));
    bar.position.set(0, 1.85, -0.3);
    group.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2255cc, emissive: 0x000055 }));
    bar2.position.set(0, 1.85, 0.35);
    group.add(bar2);
    for (const [wx, wz] of [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 0.7), dark);
      wheel.position.set(wx, 0.35, wz);
      group.add(wheel);
    }
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return group;
  }
  function officerMesh() {
    const group = new THREE.Group();
    const navy = new THREE.MeshLambertMaterial({ color: 0x1c2f55 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), navy);
    torso.position.y = 1.05;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
    head.position.y = 1.78;
    group.add(head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.56), navy);
    cap.position.y = 1.98;
    group.add(cap);
    for (const lx of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.24), navy);
      leg.position.set(lx, 0.3, 0);
      group.add(leg);
    }
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return group;
  }

  // ---- cruisers --------------------------------------------------------
  function spawnCruiser(role, px, pz, heading) {
    const mesh = cruiserMesh();
    mesh.position.set(px, 0, pz);
    mesh.rotation.y = heading;
    if (G.scene) G.scene.add(mesh);
    const unit = {
      pos: new THREE.Vector3(px, 0, pz),
      heading, speed: 0, mesh, role: role || 'chase',
      ramAt: 0, farTimer: 0,
    };
    G.policeCars.push(unit);
    return unit;
  }
  function removeCruiser(unit) {
    if (unit.mesh && G.scene) G.scene.remove(unit.mesh);
    const i = G.policeCars.indexOf(unit);
    if (i >= 0) G.policeCars.splice(i, 1);
  }
  function desiredChasers() {
    const w = G.wanted;
    if (w <= 0) return 0;
    if (w === 1) return 1;
    if (w === 2) return 2;
    return 3;
  }
  function updateCruisers(dt) {
    const pl = G.player;
    const want = desiredChasers();
    const chasers = G.policeCars.filter((u) => u.role === 'chase');
    if (chasers.length < want) {
      // Try a few spots: the road snap can land inside a building.
      for (let attempt = 0; attempt < 6; attempt++) {
        const spot = openGroundNear(pl.pos.x, pl.pos.z, 28, 42);
        const road = snapToRoad(spot.x, spot.z);
        if (circleHits(road.x, road.z, 2)) continue;
        const heading = Math.atan2(pl.pos.x - road.x, pl.pos.z - road.z);
        spawnCruiser('chase', road.x, road.z, heading);
        break;
      }
    }
    for (const u of [...G.policeCars]) {
      if (u.role === 'block') continue; // roadblock units are parked
      const tx = pl.pos.x, tz = pl.pos.z;
      const wantHeading = Math.atan2(tx - u.pos.x, tz - u.pos.z);
      const turn = clamp(wrapPi(wantHeading - u.heading), -2.4 * dt, 2.4 * dt);
      u.heading += turn;
      const gap = dist2(u.pos.x, u.pos.z, tx, tz);
      const targetSpeed = gap < 8 ? 12 : CHASE_SPEED;
      u.speed = lerp(u.speed, targetSpeed, Math.min(1, dt * 1.5));
      let nx = u.pos.x + Math.sin(u.heading) * u.speed * dt;
      let nz = u.pos.z + Math.cos(u.heading) * u.speed * dt;
      // Stay on the roads: pull back toward the nearest road line.
      const lineX = nearestLine(nx), lineZ = nearestLine(nz);
      if (Math.min(Math.abs(nx - lineX), Math.abs(nz - lineZ)) > 8) {
        if (Math.abs(nx - lineX) < Math.abs(nz - lineZ)) nx = lineX + Math.sign(nx - lineX) * 8;
        else nz = lineZ + Math.sign(nz - lineZ) * 8;
      }
      if (circleHits(nx, nz, 1.7)) {
        // Slide along one axis instead of driving into the wall.
        if (!circleHits(nx, u.pos.z, 1.7)) nz = u.pos.z;
        else if (!circleHits(u.pos.x, nz, 1.7)) nx = u.pos.x;
        else { nx = u.pos.x; nz = u.pos.z; u.speed = 0; u.heading += 0.6 * dt; }
      }
      u.pos.x = nx; u.pos.z = nz;
      u.mesh.position.set(u.pos.x, 0, u.pos.z);
      u.mesh.rotation.y = u.heading;
      // Keep cruisers from stacking on each other.
      for (const other of G.policeCars) {
        if (other === u) continue;
        const d = dist2(u.pos.x, u.pos.z, other.pos.x, other.pos.z);
        if (d < 5 && d > 0.01) {
          const push = (5 - d) / 2;
          const ux = (u.pos.x - other.pos.x) / d, uz = (u.pos.z - other.pos.z) / d;
          u.pos.x += ux * push; u.pos.z += uz * push;
        }
      }
      // Ram the player's car; shove the player on foot.
      const car = pl.car;
      if (car) {
        const d = dist2(u.pos.x, u.pos.z, car.pos.x, car.pos.z);
        if (d < 4.5 && Math.abs(u.speed) > 5 && G.time - u.ramAt > 1) {
          u.ramAt = G.time;
          damagePlayerCar(car, 4);
          car.speed *= 0.55;
          if (G.fx && typeof G.fx.shake === 'function') {
            try { G.fx.shake(0.4); } catch (e) { /* ignore */ }
          }
        }
      } else {
        const d = dist2(u.pos.x, u.pos.z, pl.pos.x, pl.pos.z);
        if (d < 2.5 && G.time - u.ramAt > 1) {
          u.ramAt = G.time;
          damagePlayer(8);
        }
      }
      if (gap > 160) {
        u.farTimer += dt;
        if (u.farTimer > 10) removeCruiser(u);
      } else u.farTimer = 0;
    }
    if (G.wanted === 0) {
      for (const u of [...G.policeCars]) removeCruiser(u);
      blockPoint = null;
    }
  }

  // ---- roadblocks ------------------------------------------------------
  function updateRoadblocks(dt) {
    blockCooldown = Math.max(0, blockCooldown - dt);
    const pl = G.player;
    const hasBlock = G.policeCars.some((u) => u.role === 'block');
    if (G.wanted >= 3 && !hasBlock && blockCooldown <= 0) {
      const h = playerHeading();
      const ahead = 57;
      const ax = pl.pos.x + Math.sin(h) * ahead;
      const az = pl.pos.z + Math.cos(h) * ahead;
      let bx, bz, across;
      if (Math.abs(Math.sin(h)) > Math.abs(Math.cos(h))) {
        bz = nearestLine(pl.pos.z); bx = ax; across = 0; // road runs east-west
      } else {
        bx = nearestLine(pl.pos.x); bz = az; across = Math.PI / 2; // road runs north-south
      }
      blockPoint = { x: bx, z: bz };
      for (const side of [-3.2, 3.2]) {
        const ox = across === 0 ? 0 : side;
        const oz = across === 0 ? side : 0;
        const px = clamp(bx + ox, -200, 200), pz = clamp(bz + oz, -200, 200);
        if (circleHits(px, pz, 2)) continue;
        spawnCruiser('block', px, pz, h + Math.PI / 2);
      }
      say('Roadblock ahead — punch through or go around!');
      blockCooldown = 45;
    }
    if (hasBlock) {
      // Parked cruisers are solid: smashing one hurts, and it slows you.
      const car = pl.car;
      for (const u of G.policeCars.filter((x) => x.role === 'block')) {
        if (!car) continue;
        const d = dist2(u.pos.x, u.pos.z, car.pos.x, car.pos.z);
        if (d < 4.2 && G.time - u.ramAt > 1) {
          u.ramAt = G.time;
          damagePlayerCar(car, 4);
          car.speed *= 0.4;
        }
      }
      const gone = G.wanted < 3 ||
        (blockPoint && dist2(pl.pos.x, pl.pos.z, blockPoint.x, blockPoint.z) > 60);
      if (gone) {
        for (const u of [...G.policeCars.filter((x) => x.role === 'block')]) removeCruiser(u);
        blockPoint = null;
      }
    }
  }

  // ---- foot officers ---------------------------------------------------
  function spawnOfficer() {
    const pl = G.player;
    const spot = openGroundNear(pl.pos.x, pl.pos.z, 10, 15);
    const mesh = officerMesh();
    mesh.position.set(spot.x, 0, spot.z);
    if (G.scene) G.scene.add(mesh);
    const officer = {
      pos: new THREE.Vector3(spot.x, 0, spot.z),
      heading: 0, mesh, grabTimer: 0,
    };
    G.officers.push(officer);
    return officer;
  }
  function removeOfficer(officer) {
    if (officer.mesh && G.scene) G.scene.remove(officer.mesh);
    const i = G.officers.indexOf(officer);
    if (i >= 0) G.officers.splice(i, 1);
  }
  function updateOfficers(dt) {
    const pl = G.player;
    const want = G.wanted > 0 ? (pl.car ? 1 : 2) : 0;
    while (G.officers.length < want) spawnOfficer();
    while (G.officers.length > want) removeOfficer(G.officers[G.officers.length - 1]);
    for (const o of [...G.officers]) {
      const d = dist2(o.pos.x, o.pos.z, pl.pos.x, pl.pos.z);
      if (d > 3) {
        const heading = Math.atan2(pl.pos.x - o.pos.x, pl.pos.z - o.pos.z);
        o.heading = heading;
        const nx = o.pos.x + Math.sin(heading) * 3.6 * dt;
        const nz = o.pos.z + Math.cos(heading) * 3.6 * dt;
        if (!circleHits(nx, nz, 0.6)) { o.pos.x = nx; o.pos.z = nz; }
        else if (!circleHits(nx, o.pos.z, 0.6)) o.pos.z = o.pos.z;
        else if (!circleHits(o.pos.x, nz, 0.6)) o.pos.x = o.pos.x;
        o.mesh.position.set(o.pos.x, 0, o.pos.z);
        o.mesh.rotation.y = o.heading;
        // Out of reach: the grab timer decays instead of resetting, so a
        // near-miss still leaves the officer halfway to a bust.
        o.grabTimer = Math.max(0, o.grabTimer - dt * 2);
      } else if (!pl.car) {
        o.grabTimer += dt;
        if (o.grabTimer >= GRAB_SECONDS) {
          say('BUSTED — the officers got you');
          if (typeof G.onBusted === 'function') G.onBusted();
          return;
        }
      }
    }
  }

  // ---- helicopter ------------------------------------------------------
  function buildHeli() {
    const group = new THREE.Group();
    const navy = new THREE.MeshLambertMaterial({ color: 0x1a2f5a });
    const pale = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x101418 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 6.5), navy);
    group.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.4, 6.6), pale);
    stripe.position.y = 0.25;
    group.add(stripe);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2.0), glass);
    nose.position.set(0, 0.1, 2.4);
    group.add(nose);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 5.0), navy);
    tail.position.set(0, 0.3, -5.2);
    group.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.7, 1.3), navy);
    fin.position.set(0, 1.1, -7.4);
    group.add(fin);
    for (const sx of [-1.2, 1.2]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 4.2), glass);
      skid.position.set(sx, -1.05, 0.4);
      group.add(skid);
    }
    const rotor = new THREE.Group();
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const bladeA = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.12, 0.55), bladeMat);
    const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 9.5), bladeMat);
    rotor.add(bladeA); rotor.add(bladeB);
    rotor.position.y = 1.15;
    group.add(rotor);
    const tailRotor = new THREE.Group();
    const tailBlade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.3), bladeMat);
    tailRotor.add(tailBlade);
    tailRotor.position.set(0.55, 0.5, -7.4);
    group.add(tailRotor);
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });

    const light = new THREE.SpotLight(0xfff6c0, 90, 110, 0.5, 0.45, 1.2);
    light.position.set(0, 0, 0);
    const target = new THREE.Object3D();
    light.target = target;
    group.add(light);
    group.add(target);

    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.15;
    if (G.scene) G.scene.add(pool);
    if (G.scene) G.scene.add(group);
    return { group, rotor, tailRotor, light, target, pool, mode: 'hover', leaveTimer: 0 };
  }
  function removeHeli() {
    if (!heli) return;
    if (G.scene) {
      G.scene.remove(heli.group);
      G.scene.remove(heli.pool);
    }
    heli = null;
  }
  function updateHeli(dt) {
    const pl = G.player;
    if (!heli && G.wanted >= 4) {
      heli = buildHeli();
      const h = playerHeading();
      heli.group.position.set(
        pl.pos.x - Math.sin(h) * HELI_TRAIL,
        HELI_HEIGHT,
        pl.pos.z - Math.cos(h) * HELI_TRAIL
      );
      say('Police helicopter overhead — stay out of sight!');
    }
    if (!heli) return;
    heli.rotor.rotation.y += 22 * dt;
    heli.tailRotor.rotation.z += 30 * dt;
    if (heli.mode === 'leaving') {
      heli.leaveTimer -= dt;
      heli.group.position.y += 14 * dt;
      const fade = Math.max(0, heli.leaveTimer / 2.5);
      heli.light.intensity = 90 * fade;
      heli.pool.material.opacity = 0.22 * fade;
      if (heli.leaveTimer <= 0) removeHeli();
      return;
    }
    // Hover: ease toward a spot ~25 m behind the player's direction of
    // travel, ~40 m up; the spotlight and ground pool track the player.
    const h = playerHeading();
    const wantX = pl.pos.x - Math.sin(h) * HELI_TRAIL;
    const wantZ = pl.pos.z - Math.cos(h) * HELI_TRAIL;
    const ease = 1 - Math.exp(-dt * 1.2);
    heli.group.position.x = lerp(heli.group.position.x, wantX, ease);
    heli.group.position.z = lerp(heli.group.position.z, wantZ, ease);
    heli.group.position.y = lerp(heli.group.position.y, HELI_HEIGHT, ease);
    heli.group.rotation.y = h;
    heli.target.position.set(pl.pos.x, 0, pl.pos.z);
    heli.pool.position.set(pl.pos.x, 0.15, pl.pos.z);
    if (G.wanted < 3) {
      heli.mode = 'leaving';
      heli.leaveTimer = 2.5;
    }
  }

  // ---- wanted ----------------------------------------------------------
  function addWanted(g, n, reason) {
    let amount = 0;
    if (typeof g === 'number') amount = g;
    else if (typeof n === 'number') amount = n;
    else amount = 1;
    G.wanted = clamp((G.wanted || 0) + amount, 0, 5);
    if (amount > 0) unseenTimer = 0;
  }
  function clearUnits() {
    for (const u of [...G.policeCars]) removeCruiser(u);
    for (const o of [...G.officers]) removeOfficer(o);
    blockPoint = null;
    removeHeli();
  }
  function clearWanted() {
    G.wanted = 0;
    unseenTimer = 0;
    clearUnits();
  }
  function updateDecay(dt) {
    if (G.wanted <= 0) { unseenTimer = 0; return; }
    // The helicopter can see the player while it hovers overhead.
    let seen = !!(heli && heli.mode === 'hover');
    if (!seen) {
      const pl = G.player;
      for (const u of G.policeCars) {
        const d = dist2(u.pos.x, u.pos.z, pl.pos.x, pl.pos.z);
        if (d < 60 && losClear(u.pos.x, u.pos.z, pl.pos.x, pl.pos.z)) { seen = true; break; }
      }
    }
    if (!seen) {
      for (const o of G.officers) {
        const d = dist2(o.pos.x, o.pos.z, G.player.pos.x, G.player.pos.z);
        if (d < 60 && losClear(o.pos.x, o.pos.z, G.player.pos.x, G.player.pos.z)) { seen = true; break; }
      }
    }
    if (seen) { unseenTimer = 0; return; }
    unseenTimer += dt;
    if (unseenTimer >= DECAY_SECONDS) {
      unseenTimer = 0;
      G.wanted = Math.max(0, G.wanted - 1);
      if (G.wanted > 0) say('Heat dying down…');
    }
  }

  // ---- main update -----------------------------------------------------
  function update(dt) {
    if (!G || G.mode === 'paused') return;
    updateCruisers(dt);
    updateRoadblocks(dt);
    updateOfficers(dt);
    updateHeli(dt);
    updateDecay(dt);
  }

  return {
    update,
    addWanted,
    clearWanted,
    clearUnits,
    heliActive() { return !!heli; },
    get heli() {
      if (!heli) return null;
      return {
        active: heli.mode === 'hover',
        mode: heli.mode,
        pos: {
          x: heli.group.position.x,
          y: heli.group.position.y,
          z: heli.group.position.z,
        },
      };
    },
  };
}
