// Neon Harbor — fists, pistol and the armed gang members who shoot back.
//
// Cole fights on foot. A punch is a short, wide swing in front of him;
// the pistol is a hitscan shot down his facing. Gang enemies close in,
// stop at range and fire. A dropped gunman sometimes leaves a pistol
// pickup behind. Everything here is plain boxes and bursts — no models.
import * as THREE from 'three';
import { clamp, dist2D, rand, vec3 } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';

const PUNCH_REACH = 2.4;
const PUNCH_ARC = 0.55; // cosine of the half-angle of the swing
const PUNCH_DAMAGE = 34;
const PUNCH_COOLDOWN = 0.45;
const SHOT_RANGE = 46;
const SHOT_ARC = 0.93; // cosine of the half-angle of the aim cone
const SHOT_DAMAGE = 34;
const SHOT_COOLDOWN = 0.32;
const ENEMY_HEALTH = 60;
const ENEMY_SPEED = 3.4;
const ENEMY_STOP = 7; // stand off and shoot from here
const ENEMY_FIRE_EVERY = 1.9;
const ENEMY_SHOT_DAMAGE = 7;
const PICKUP_RADIUS = 1.6;

// Forward on the ground plane for a heading. The whole game agrees that
// heading 0 faces +z and heading grows toward +x: forward = (sin h, cos h).
function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

// Is a point inside the cone in front of the player?
function inFront(px, pz, heading, tx, tz, reach, cosLimit) {
  const dx = tx - px;
  const dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d > reach || d < 0.001) return d < 0.001 ? true : false;
  const f = forwardOf(heading);
  return (dx * f.x + dz * f.z) / d >= cosLimit;
}

function makeEnemyMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x8a1f1f });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9976b });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), jacket);
  torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.72;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.36), dark);
  cap.position.y = 1.92;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), dark);
  legL.position.set(-0.16, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), jacket);
  armL.position.set(-0.42, 1.2, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), jacket);
  armR.position.set(0.42, 1.2, 0.1);
  armR.rotation.x = -1.1; // gun arm held out level
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.1, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x111114 })
  );
  gun.position.set(0.42, 1.18, 0.42);
  group.add(torso, head, cap, legL, legR, armL, armR, gun);
  group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group, legL, legR, armR };
}

function makePickupMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.6, roughness: 0.4 })
  );
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.06, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffd23e })
  );
  glow.position.y = -0.45;
  group.add(body, glow);
  return group;
}

export class Combat {
  constructor(game) {
    this.game = game;
    // Swing arcs the main loop can read (the driver counts them). Each
    // entry is a live torus mesh in front of the player that fades out.
    this.arcs = [];
    // Tracers for pistol shots, same idea: short-lived scene lines.
    this.tracers = [];
    // Weapon pickups dropped by gunmen, lying on the ground.
    this.pickups = [];
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    // Enemies live on the shared game object so missions and the police
    // can see them too; this class owns their behaviour.
    if (!game.enemies) game.enemies = [];
    this.enemies = game.enemies;
  }

  // -- spawning -----------------------------------------------------------

  spawnEnemy(w, x, z) {
    const built = makeEnemyMesh();
    const enemy = {
      pos: vec3(x, 0, z),
      heading: rand(0, Math.PI * 2),
      health: ENEMY_HEALTH,
      maxHealth: ENEMY_HEALTH,
      speed: ENEMY_SPEED,
      mesh: built.group,
      legL: built.legL,
      legR: built.legR,
      armR: built.armR,
      fireTimer: rand(0.8, 1.6),
      walkPhase: rand(0, Math.PI * 2),
      dead: false,
    };
    built.group.position.set(x, 0, z);
    w.scene.add(built.group);
    this.enemies.push(enemy);
    if (w.hud) w.hud.showMessage('Armed gunman — Dario\'s crew!');
    return enemy;
  }

  dropPickup(w, x, z) {
    const mesh = makePickupMesh();
    mesh.position.set(x, 0.6, z);
    w.scene.add(mesh);
    this.pickups.push({ pos: vec3(x, 0, z), mesh, bob: rand(0, Math.PI * 2) });
  }

  // -- the punch ----------------------------------------------------------

  attack(w) {
    const p = w.player;
    if (!p || p.car || w.mode !== 'playing') return;
    if (this.punchCooldown > 0) return;
    this.punchCooldown = PUNCH_COOLDOWN;
    p.punchAnim = 1;
    if (w.audio) w.audio.punch();
    this.spawnArc(w);
    const px = p.pos.x;
    const pz = p.pos.z;
    const h = p.heading;

    // Gang enemies take the hit first — they are the real threat.
    for (const e of [...this.enemies]) {
      if (e.dead) continue;
      if (inFront(px, pz, h, e.pos.x, e.pos.z, PUNCH_REACH, PUNCH_ARC)) {
        this.hitEnemy(w, e, PUNCH_DAMAGE, 'Punch landed!');
        return;
      }
    }
    // A foot officer can be shoved off his grab: the bust timer resets
    // and he stumbles back, which buys Cole a few seconds.
    for (const o of w.officers || []) {
      if (inFront(px, pz, h, o.pos.x, o.pos.z, PUNCH_REACH, PUNCH_ARC)) {
        const dx = o.pos.x - px;
        const dz = o.pos.z - pz;
        const d = Math.hypot(dx, dz) || 1;
        o.pos.x = clamp(o.pos.x + (dx / d) * 2.5, -235, 235);
        o.pos.z = clamp(o.pos.z + (dz / d) * 2.5, -235, 235);
        o.grabTimer = 0;
        this.hitSpark(w, o.pos.x, 1.3, o.pos.z);
        if (w.hud) w.hud.showMessage('Punch landed! The officer staggers back.');
        return;
      }
    }
    // A walker just gets scared and runs.
    for (const ped of w.peds || []) {
      if (inFront(px, pz, h, ped.pos.x, ped.pos.z, PUNCH_REACH, PUNCH_ARC)) {
        scarePedestrians(w, ped.pos.x, ped.pos.z, 6);
        if (w.hud) w.hud.showMessage('Punch landed! The pedestrian flees.');
        return;
      }
    }
    // Nothing in reach: say so on screen, so a swing is never silent.
    if (w.hud) w.hud.showMessage('You swing at the air.');
  }

  spawnArc(w) {
    const p = w.player;
    const geo = new THREE.TorusGeometry(1.15, 0.06, 6, 14, Math.PI * 0.95);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const f = forwardOf(p.heading);
    mesh.position.set(p.pos.x + f.x * 1.1, 1.15, p.pos.z + f.z * 1.1);
    mesh.rotation.set(Math.PI / 2, 0, -p.heading + Math.PI / 2);
    w.scene.add(mesh);
    this.arcs.push({ mesh, mat, life: 0.28, maxLife: 0.28 });
  }

  hitSpark(w, x, y, z) {
    if (w.fx) w.fx.burst(vec3(x, y, z), 0xffd23e, 12, 5, 0.16);
    if (w.fx) w.fx.shake(0.12);
  }

  hitEnemy(w, enemy, damage, line) {
    enemy.health -= damage;
    this.hitSpark(w, enemy.pos.x, 1.3, enemy.pos.z);
    if (w.hud) w.hud.showMessage(line);
    if (enemy.health <= 0) this.killEnemy(w, enemy);
  }

  killEnemy(w, enemy) {
    enemy.dead = true;
    if (w.fx) w.fx.burst(vec3(enemy.pos.x, 1.2, enemy.pos.z), 0xff5544, 18, 7, 0.2);
    if (enemy.mesh && w.scene) w.scene.remove(enemy.mesh);
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
    if (w.stats) w.stats.crimes = (w.stats.crimes || 0) + 1;
    if (Math.random() < 0.45) {
      this.dropPickup(w, enemy.pos.x, enemy.pos.z);
      if (w.hud) w.hud.showMessage('Gunman down — he dropped a pistol.');
    } else if (w.hud) {
      w.hud.showMessage('Gunman down.');
    }
  }

  // -- the pistol ---------------------------------------------------------

  shoot(w) {
    const p = w.player;
    if (!p || p.car || w.mode !== 'playing') return;
    if (this.shootCooldown > 0) return;
    if (p.weapon !== 'pistol') return;
    if (p.ammo <= 0) {
      if (w.hud) w.hud.showMessage('Out of ammo — press Q for fists.');
      return;
    }
    this.shootCooldown = SHOT_COOLDOWN;
    p.ammo -= 1;
    p.punchAnim = 0.6; // recoil snap of the gun arm
    const px = p.pos.x;
    const pz = p.pos.z;
    const h = p.heading;
    const f = forwardOf(h);
    const from = vec3(px + f.x * 0.6, 1.35, pz + f.z * 0.6);
    let end = vec3(px + f.x * SHOT_RANGE, 1.3, pz + f.z * SHOT_RANGE);
    let hit = null;
    let best = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2D(px, pz, e.pos.x, e.pos.z);
      if (d > SHOT_RANGE) continue;
      if (!inFront(px, pz, h, e.pos.x, e.pos.z, SHOT_RANGE, SHOT_ARC)) continue;
      if (d < best) { best = d; hit = e; }
    }
    if (hit) {
      end = vec3(hit.pos.x, 1.3, hit.pos.z);
      this.hitEnemy(w, hit, SHOT_DAMAGE, 'Hit! Gunman down.');
      if (w.audio && w.audio.tone) w.audio.tone(140, 0.12, 'square', 0.2, 0, -70);
    } else if (w.audio && w.audio.tone) {
      w.audio.tone(950, 0.09, 'square', 0.14, 0, -70);
    }
    this.spawnTracer(w, from, end);
    if (w.fx) w.fx.burst(from, 0xffe9a0, 4, 2, 0.1);
  }

  spawnTracer(w, from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    w.scene.add(line);
    this.tracers.push({ line, mat, geo, life: 0.09, maxLife: 0.09 });
  }

  // -- weapon switching and the flip key ----------------------------------

  switchWeapon(w) {
    const p = w.player;
    if (!p || p.car) return;
    if (p.weapon === 'pistol') {
      p.weapon = 'fists';
    } else {
      if (p.ammo <= 0) {
        if (w.hud) w.hud.showMessage('No pistol ammo — fists it is.');
        return;
      }
      p.weapon = 'pistol';
    }
    if (p.weaponMesh) p.weaponMesh.visible = p.weapon === 'pistol';
    if (w.hud) w.hud.showMessage(p.weapon === 'pistol' ? 'Pistol drawn.' : 'Fists up.');
  }

  flipCar(w) {
    const car = w.player ? w.player.car : null;
    if (!car) return;
    car.speed = 0;
    if (car.mesh) car.mesh.position.y = 0;
    if (w.hud) w.hud.showMessage('Car flipped upright.');
  }

  // -- per-frame ----------------------------------------------------------

  update(w, dt) {
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    for (const a of [...this.arcs]) {
      a.life -= dt;
      a.mat.opacity = Math.max(0, (a.life / a.maxLife)) * 0.95;
      if (a.life <= 0) {
        w.scene.remove(a.mesh);
        a.mat.dispose();
        a.mesh.geometry.dispose();
        this.arcs.splice(this.arcs.indexOf(a), 1);
      }
    }
    for (const t of [...this.tracers]) {
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / t.maxLife) * 0.9;
      if (t.life <= 0) {
        w.scene.remove(t.line);
        t.mat.dispose();
        t.geo.dispose();
        this.tracers.splice(this.tracers.indexOf(t), 1);
      }
    }
    this.updateEnemies(w, dt);
    this.updatePickups(w, dt);
  }

  updateEnemies(w, dt) {
    const p = w.player;
    if (!p) return;
    for (const e of [...this.enemies]) {
      if (e.dead) continue;
      const d = dist2D(e.pos.x, e.pos.z, p.pos.x, p.pos.z);
      const want = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      let turn = want - e.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      e.heading += clamp(turn, -2.4 * dt, 2.4 * dt);
      if (d > ENEMY_STOP && !p.car) {
        // Close in on foot Cole.
        const f = forwardOf(e.heading);
        e.pos.x = clamp(e.pos.x + f.x * e.speed * dt, -235, 235);
        e.pos.z = clamp(e.pos.z + f.z * e.speed * dt, -235, 235);
        e.walkPhase += dt * 9;
        const swing = Math.sin(e.walkPhase) * 0.45;
        if (e.legL) e.legL.rotation.x = swing;
        if (e.legR) e.legR.rotation.x = -swing;
      } else if (d > ENEMY_STOP && p.car) {
        // Cole is driving: hold ground and wait — a gunman on foot
        // cannot catch a car, so he does not sprint into traffic.
        e.walkPhase += dt * 2;
      } else {
        // In range: stand, aim and fire.
        if (e.legL) e.legL.rotation.x = 0;
        if (e.legR) e.legR.rotation.x = 0;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && w.mode === 'playing' && p.health > 0) {
          e.fireTimer = ENEMY_FIRE_EVERY * rand(0.85, 1.25);
          const from = vec3(e.pos.x, 1.35, e.pos.z);
          const to = vec3(p.pos.x, 1.2, p.pos.z);
          this.spawnTracer(w, from, to);
          if (w.fx) w.fx.burst(from, 0xffe9a0, 4, 2, 0.1);
          if (w.audio && w.audio.tone) w.audio.tone(700, 0.08, 'square', 0.1, 0, -70);
          damagePlayer(w, ENEMY_SHOT_DAMAGE, 'shot');
          if (w.hud) w.hud.flashDamage();
        }
      }
      e.mesh.position.set(e.pos.x, 0, e.pos.z);
      e.mesh.rotation.y = e.heading;
    }
  }

  updatePickups(w, dt) {
    const p = w.player;
    if (!p) return;
    for (const pk of [...this.pickups]) {
      pk.bob += dt * 3;
      pk.mesh.position.y = 0.6 + Math.sin(pk.bob) * 0.12;
      pk.mesh.rotation.y += dt * 2;
      if (!p.car && dist2D(p.pos.x, p.pos.z, pk.pos.x, pk.pos.z) < PICKUP_RADIUS) {
        p.ammo = (p.ammo || 0) + 12;
        if (p.weapon !== 'pistol') {
          p.weapon = 'pistol';
          if (p.weaponMesh) p.weaponMesh.visible = true;
        }
        if (w.hud) w.hud.showMessage('Picked up a pistol. +12 ammo.');
        if (w.audio) w.audio.cash();
        w.scene.remove(pk.mesh);
        this.pickups.splice(this.pickups.indexOf(pk), 1);
      }
    }
  }
}
