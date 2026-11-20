// Neon Harbor — fighting.
//
// Cole has fists and a pistol; Dario Venn's crew has pistols and a
// grudge. The rule for this module is that no attack is ever silent: a
// punch has to show the swing — a bright arc, a whoosh, and then either
// a spark burst with a "Punch landed!" line or a "Swing and a miss"
// line — so a click never looks dead. A pistol shot draws a tracer and
// a muzzle flash, and the noise brings the police down on Cole.
import * as THREE from 'three';
import { rand, dist2D } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';
import { damageCar } from './vehicles.js';

// Fist and pistol tuning, kept together so a balance pass touches one
// place. Ranges in metres, damage in hit points, times in seconds.
const FIST = { reach: 2.6, damage: 34, cooldown: 0.35, anim: 0.22, arcLife: 0.35 };
const GUN = { damage: 34, cooldown: 0.28, emptyCooldown: 0.4, rayFar: 120, tracerLen: 90 };
const ARC = { inner: 0.9, outer: 1.7, segments: 12, start: -Math.PI / 3, sweep: (Math.PI * 2) / 3, color: 0xfff2b0 };
const SPARK = { hit: 0xff4444, miss: 0xffffff, wall: 0xffcc66, kill: 0xff5544 };
const CREW = { jacket: 0x5a1a1a, skin: 0x8a5a3b, cap: 0x222222, gun: 0x111111 };
const BAR = { green: 0x37d67a, red: 0xff5533 };
const GUNMAN = { chaseRange: 14, shootRange: 42, walkSpeed: 4.2, hitChance: 0.3, shotDamage: 7 };

// Small helper: a box mesh placed in one call, so the enemy builder reads
// as a parts list instead of a wall of statements.
function boxAt(width, height, depth, mat, x, y, z) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  piece.position.x = x;
  piece.position.y = y;
  piece.position.z = z;
  return piece;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = GUN.rayFar;
    this.arcs = [];
  }

  // The main loop calls this once a frame; it drives the gunmen and fades
  // any punch arcs still hanging in the air.
  update(w, dt) {
    this.tickEnemies(w, dt);
    this.tickArcs(w, dt);
  }

  attack(w) {
    const hero = w.player;
    if (w.mode !== 'playing' || hero.car) return;
    if (hero.weapon === 'fists') this.swing(w);
    else this.shoot(w);
  }

  swing(w) {
    const hero = w.player;
    if (hero.punchCooldown > 0) return;
    hero.punchCooldown = FIST.cooldown;
    hero.punchAnim = FIST.anim;
    this.showArc(w);
    w.audio.punch();
    w.fx.shake(0.12);
    const fx = Math.sin(hero.heading);
    const fz = Math.cos(hero.heading);
    const victim = this.victimInFront(w, fx, fz);
    const at = new THREE.Vector3(hero.pos.x + fx * 1.6, 1.4, hero.pos.z + fz * 1.6);
    if (victim) {
      this.applyHit(w, victim.obj, victim.kind, FIST.damage, at);
      w.fx.shake(0.35);
      w.hud.showMessage('Punch landed!');
      w.hud.showHint('Punch landed!', 1.2);
      return;
    }
    // A whiff still has to look like a swing: a pale burst where the
    // fist passed, and a line on screen, so a click never looks dead.
    w.fx.burst(at.clone().setY(1.3), SPARK.miss, 4, 2, 1);
    w.hud.showHint('Swing and a miss — get closer!', 1.2);
  }

  // Closest person standing in front of Cole, inside fist range, more or
  // less facing him. Enemies, officers and walkers all count.
  victimInFront(w, fx, fz) {
    const hero = w.player;
    const pool = [];
    w.enemies.forEach((obj) => pool.push({ obj, kind: 'enemy' }));
    w.officers.forEach((obj) => pool.push({ obj, kind: 'officer' }));
    w.peds.forEach((obj) => {
      if (obj.state !== 'down') pool.push({ obj, kind: 'ped' });
    });
    let best = null;
    let bestD = FIST.reach;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const dx = candidate.obj.pos.x - hero.pos.x;
      const dz = candidate.obj.pos.z - hero.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      const facing = (dx * fx + dz * fz) / (d || 1);
      if (facing <= 0.3) continue;
      bestD = d;
      best = candidate;
    }
    return best;
  }

  // A flat crescent hanging in the air where the fist travels, built from
  // a ring segment so it reads as a swing rather than a blob.
  showArc(w) {
    const hero = w.player;
    const geo = new THREE.RingGeometry(ARC.inner, ARC.outer, ARC.segments, 1, ARC.start, ARC.sweep);
    const mat = new THREE.MeshBasicMaterial({ color: ARC.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const arc = new THREE.Mesh(geo, mat);
    const fx = Math.sin(hero.heading);
    const fz = Math.cos(hero.heading);
    arc.position.x = hero.pos.x + fx * 1.4;
    arc.position.y = 1.3;
    arc.position.z = hero.pos.z + fz * 1.4;
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.y = 0;
    arc.rotation.z = -hero.heading + Math.PI / 2;
    w.scene.add(arc);
    this.arcs.push({ mesh: arc, life: FIST.arcLife, maxLife: FIST.arcLife });
  }

  tickArcs(w, dt) {
    let i = this.arcs.length;
    while (i > 0) {
      i--;
      const arc = this.arcs[i];
      arc.life -= dt;
      if (arc.life > 0) {
        arc.mesh.material.opacity = 0.9 * (arc.life / arc.maxLife);
        arc.mesh.scale.setScalar(1 + (1 - arc.life / arc.maxLife) * 0.4);
        continue;
      }
      w.scene.remove(arc.mesh);
      arc.mesh.geometry.dispose();
      arc.mesh.material.dispose();
      this.arcs.splice(i, 1);
    }
  }

  shoot(w) {
    const hero = w.player;
    if (hero.shootCooldown > 0) return;
    if (hero.ammo <= 0) {
      w.hud.showMessage('Out of ammo — find an ammo pickup.');
      w.audio.click();
      hero.shootCooldown = GUN.emptyCooldown;
      return;
    }
    hero.shootCooldown = GUN.cooldown;
    hero.ammo--;
    w.audio.gunshot();
    const origin = new THREE.Vector3(hero.pos.x, 1.55, hero.pos.z);
    const dir = new THREE.Vector3();
    w.camera.getWorldDirection(dir);
    dir.y += rand(-0.02, 0.02);
    dir.normalize();
    w.fx.muzzle(origin, dir);
    this.raycaster.set(origin, dir);
    const found = this.collectTargets(w);
    const hits = this.raycaster.intersectObjects(found.targets, true);
    let end = origin.clone().addScaledVector(dir, GUN.tracerLen);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      let root = hit.object;
      while (root.parent && root.parent !== w.scene) root = root.parent;
      const entry = found.owners.get(root.uuid);
      if (entry) this.applyHit(w, entry.obj, entry.kind, GUN.damage, end);
      else w.fx.burst(end, SPARK.wall, 5, 3, 1); // clipped a building
    }
    w.fx.tracer(origin, end);
    if (w.wanted < 1) w.police.addWanted(w, 1, 'Gunfire reported — police are coming.');
  }

  // Everything a bullet can hit: every mesh that belongs to a person or
  // a car, plus a map from mesh back to its owner and kind.
  collectTargets(w) {
    const targets = [];
    const owners = new Map();
    const register = (list, kind) => {
      list.forEach((obj) => {
        targets.push(obj.mesh);
        owners.set(obj.mesh.uuid, { obj, kind });
      });
    };
    register(w.enemies, 'enemy');
    register(w.officers, 'officer');
    register(w.peds.filter((ped) => ped.state !== 'down'), 'ped');
    register(w.cars, 'car');
    return { targets, owners };
  }

  applyHit(w, obj, kind, damage, point) {
    w.fx.burst(point.clone().setY(1.2), SPARK.hit, 7, 3, 2);
    if (kind === 'enemy') {
      obj.hp -= damage;
      obj.hpBar.scale.x = Math.max(0.01, obj.hp / obj.maxHp);
      obj.hpBar.material.color.setHex(obj.hp > 50 ? BAR.green : BAR.red);
      if (obj.hp <= 0) this.dropGunman(w, obj);
      else obj.aggro = true;
      return;
    }
    if (kind === 'officer') {
      w.police.addWanted(w, 1, 'You attacked an officer!');
      return;
    }
    if (kind === 'ped') {
      obj.state = 'down';
      obj.downTimer = 8;
      obj.mesh.rotation.x = -Math.PI / 2;
      w.police.addWanted(w, 1, 'You hurt a bystander!');
      scarePedestrians(w, obj.pos.x, obj.pos.z, 25);
      return;
    }
    if (kind === 'car') {
      damageCar(w, obj, damage);
      if (obj.health <= 0) w.fx.explosion(obj.pos.clone().setY(1));
    }
  }

  spawnEnemy(w, x, z) {
    const group = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: CREW.jacket, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: CREW.skin, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const torso = boxAt(0.62, 0.85, 0.36, jacket, 0, 1.05, 0);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    group.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.27, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: CREW.cap, roughness: 0.7 }),
    );
    cap.position.y = 1.88;
    group.add(cap);
    const legL = boxAt(0.22, 0.6, 0.24, dark, -0.15, 0.3, 0);
    const legR = boxAt(0.22, 0.6, 0.24, dark, 0.15, 0.3, 0);
    group.add(legL);
    group.add(legR);
    const gunMat = new THREE.MeshStandardMaterial({ color: CREW.gun, roughness: 0.4 });
    group.add(boxAt(0.09, 0.14, 0.42, gunMat, 0.42, 1.0, 0.25));
    const barBgMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 });
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.12), barBgMat);
    barBg.position.y = 2.15;
    group.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.08), new THREE.MeshBasicMaterial({ color: BAR.green }));
    bar.position.x = 0;
    bar.position.y = 2.15;
    bar.position.z = 0.01;
    group.add(bar);
    group.position.x = x;
    group.position.y = 0;
    group.position.z = z;
    w.scene.add(group);
    const enemy = {};
    enemy.mesh = group;
    enemy.legL = legL;
    enemy.legR = legR;
    enemy.hpBar = bar;
    enemy.pos = group.position;
    enemy.heading = 0;
    enemy.hp = 100;
    enemy.maxHp = 100;
    enemy.shootTimer = rand(1, 2.5);
    enemy.phase = rand(0, 6);
    enemy.aggro = false;
    w.enemies.push(enemy);
    return enemy;
  }

  dropGunman(w, enemy) {
    w.fx.burst(enemy.pos.clone().setY(1.2), SPARK.kill, 14, 4, 3);
    w.scene.remove(enemy.mesh);
    w.enemies = w.enemies.filter((x) => x !== enemy);
    w.hud.showMessage('Venn crew down.');
    if (Math.random() >= 0.5) {
      w.missions.onEnemyKilled(w, enemy);
      return;
    }
    w.player.ammo = Math.min(w.player.maxAmmo, w.player.ammo + 6);
    w.hud.showMessage('Picked up ammo (+6).');
    w.missions.onEnemyKilled(w, enemy);
  }

  // Gunman AI: face Cole, close the distance when far, hold and shoot when
  // near. Shots are deliberately inaccurate — roughly one in three
  // connects — and every shot draws a tracer so the player can see where
  // the fire is coming from.
  tickEnemies(w, dt) {
    const hero = w.player;
    const crew = w.enemies.slice();
    for (let i = 0; i < crew.length; i++) {
      const enemy = crew[i];
      const dx = hero.pos.x - enemy.pos.x;
      const dz = hero.pos.z - enemy.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      enemy.shootTimer -= dt;
      enemy.heading = Math.atan2(dx / d, dz / d);
      enemy.mesh.rotation.y = enemy.heading;
      if (d > GUNMAN.chaseRange) this.closeIn(w, enemy, dx / d, dz / d, dt);
      else this.standAndFire(w, enemy, d, dt);
      enemy.hpBar.lookAt(w.camera.position);
      enemy.mesh.position.copy(enemy.pos);
    }
  }

  closeIn(w, enemy, ux, uz, dt) {
    enemy.pos.x += ux * GUNMAN.walkSpeed * dt;
    enemy.pos.z += uz * GUNMAN.walkSpeed * dt;
    enemy.phase += dt * 9;
    const step = Math.sin(enemy.phase) * 0.6;
    enemy.legL.rotation.x = step;
    enemy.legR.rotation.x = -step;
  }

  standAndFire(w, enemy, d, dt) {
    const hero = w.player;
    enemy.legL.rotation.x = 0;
    enemy.legR.rotation.x = 0;
    if (enemy.shootTimer > 0 || d >= GUNMAN.shootRange || hero.health <= 0) return;
    enemy.shootTimer = rand(1.1, 2.0);
    const from = enemy.pos.clone().setY(1.5);
    const to = hero.pos.clone().setY(1.3 + rand(-1, 1));
    w.fx.tracer(from, to);
    w.audio.gunshot();
    if (Math.random() >= GUNMAN.hitChance) return;
    damagePlayer(w, GUNMAN.shotDamage, 'shot');
    w.hud.showMessage('You took a hit!');
  }
}
