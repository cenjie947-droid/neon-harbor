// Neon Harbor — fighting. Cole has fists and a pistol; Dario Venn's crew
// has pistols and a grudge. The rule for this module is that no attack is
// ever silent: a punch has to show the swing — a bright arc, a whoosh, and
// then either a spark burst with a "Punch landed!" line or a "Swing and a
// miss" line — so a click never looks dead. A pistol shot draws a tracer
// and a muzzle flash, and the noise brings the police down on Cole.
import * as THREE from 'three';
import { rand, dist2D } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';
import { damageCar } from './vehicles.js';

const FIST_RANGE = 2.6;
const ARC_LIFETIME = 0.35;
const PUNCH_DAMAGE = 34;
const BULLET_DAMAGE = 34;
const PUNCH_COOLDOWN = 0.35;
const PUNCH_ANIM = 0.22;
const SHOT_COOLDOWN = 0.28;
const EMPTY_COOLDOWN = 0.4;
const RAY_FAR = 120;
const TRACER_LEN = 90;
const ARC_INNER = 0.9;
const ARC_OUTER = 1.7;
const ARC_SEGMENTS = 12;
const ARC_START = -Math.PI / 3;
const ARC_SWEEP = (Math.PI * 2) / 3;
const ARC_COLOR = 0xfff2b0;
const HIT_SPARK = 0xff4444;
const MISS_BURST = 0xffffff;
const WALL_CHIP = 0xffcc66;
const ENEMY_JACKET = 0x5a1a1a;
const ENEMY_SKIN = 0x8a5a3b;
const ENEMY_CAP = 0x222222;
const ENEMY_GUN = 0x111111;
const BAR_GREEN = 0x37d67a;
const BAR_RED = 0xff5533;

// Small helper: a box mesh placed in one call, so the enemy builder reads
// as a parts list instead of a wall of statements.
function cuboid(width, height, depth, mat, x, y, z) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  piece.position.set(x, y, z);
  return piece;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RAY_FAR;
    this.arcs = [];
  }

  // The main loop calls this once a frame; it drives the gunmen and fades
  // any punch arcs still hanging in the air.
  update(game, dt) {
    this.tickEnemies(game, dt);
    this.tickArcs(game, dt);
  }

  attack(game) {
    const cole = game.player;
    if (game.mode !== 'playing' || cole.car) return;
    if (cole.weapon === 'fists') this.swing(game);
    else this.shoot(game);
  }

  swing(game) {
    const cole = game.player;
    if (cole.punchCooldown > 0) return;
    cole.punchCooldown = PUNCH_COOLDOWN;
    cole.punchAnim = PUNCH_ANIM;
    this.showArc(game);
    game.audio.punch();
    game.fx.shake(0.12);
    const fx = Math.sin(cole.heading);
    const fz = Math.cos(cole.heading);
    const victim = this.victimInFront(game, fx, fz);
    const at = new THREE.Vector3(cole.pos.x + fx * 1.6, 1.4, cole.pos.z + fz * 1.6);
    if (!victim) {
      // A whiff still has to look like a swing: a pale burst where the
      // fist passed, and a line on screen, so a click never looks dead.
      game.fx.burst(at.clone().setY(1.3), MISS_BURST, 4, 2, 1);
      game.hud.showHint('Swing and a miss — get closer!', 1.2);
      return;
    }
    this.applyHit(game, victim.obj, victim.kind, PUNCH_DAMAGE, at);
    game.fx.shake(0.35);
    game.hud.showMessage('Punch landed!');
    game.hud.showHint('Punch landed!', 1.2);
  }

  // Closest person standing in front of Cole, inside fist range, more or
  // less facing him. Enemies, officers and walkers all count.
  victimInFront(game, fx, fz) {
    const cole = game.player;
    const pool = [];
    for (const obj of game.enemies) pool.push({ obj, kind: 'enemy' });
    for (const obj of game.officers) pool.push({ obj, kind: 'officer' });
    for (const obj of game.peds) {
      if (obj.state !== 'down') pool.push({ obj, kind: 'ped' });
    }
    let best = null;
    let bestD = FIST_RANGE;
    for (const candidate of pool) {
      const dx = candidate.obj.pos.x - cole.pos.x;
      const dz = candidate.obj.pos.z - cole.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      if ((dx * fx + dz * fz) / (d || 1) <= 0.3) continue;
      bestD = d;
      best = candidate;
    }
    return best;
  }

  // A flat crescent hanging in the air where the fist travels, built from
  // a ring segment so it reads as a swing rather than a blob.
  showArc(game) {
    const cole = game.player;
    const geo = new THREE.RingGeometry(ARC_INNER, ARC_OUTER, ARC_SEGMENTS, 1, ARC_START, ARC_SWEEP);
    const mat = new THREE.MeshBasicMaterial({ color: ARC_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const arc = new THREE.Mesh(geo, mat);
    const fx = Math.sin(cole.heading);
    const fz = Math.cos(cole.heading);
    arc.position.set(cole.pos.x + fx * 1.4, 1.3, cole.pos.z + fz * 1.4);
    arc.rotation.set(-Math.PI / 2, 0, -cole.heading + Math.PI / 2);
    game.scene.add(arc);
    this.arcs.push({ mesh: arc, life: ARC_LIFETIME, maxLife: ARC_LIFETIME });
  }

  tickArcs(game, dt) {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.life -= dt;
      if (arc.life <= 0) {
        game.scene.remove(arc.mesh);
        arc.mesh.geometry.dispose();
        arc.mesh.material.dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      arc.mesh.material.opacity = 0.9 * (arc.life / arc.maxLife);
      arc.mesh.scale.setScalar(1 + (1 - arc.life / arc.maxLife) * 0.4);
    }
  }

  shoot(game) {
    const cole = game.player;
    if (cole.shootCooldown > 0) return;
    if (cole.ammo <= 0) {
      game.hud.showMessage('Out of ammo — find an ammo pickup.');
      game.audio.click();
      cole.shootCooldown = EMPTY_COOLDOWN;
      return;
    }
    cole.shootCooldown = SHOT_COOLDOWN;
    cole.ammo--;
    game.audio.gunshot();
    const origin = new THREE.Vector3(cole.pos.x, 1.55, cole.pos.z);
    const dir = new THREE.Vector3();
    game.camera.getWorldDirection(dir);
    dir.y += rand(-0.02, 0.02);
    dir.normalize();
    game.fx.muzzle(origin, dir);
    this.raycaster.set(origin, dir);
    const { targets, owners } = this.collectTargets(game);
    const hits = this.raycaster.intersectObjects(targets, true);
    let end = origin.clone().addScaledVector(dir, TRACER_LEN);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      let root = hit.object;
      while (root.parent && root.parent !== game.scene) root = root.parent;
      const entry = owners.get(root.uuid);
      if (entry) this.applyHit(game, entry.obj, entry.kind, BULLET_DAMAGE, end);
      else game.fx.burst(end, WALL_CHIP, 5, 3, 1); // clipped a building
    }
    game.fx.tracer(origin, end);
    if (game.wanted < 1) game.police.addWanted(game, 1, 'Gunfire reported — police are coming.');
  }

  // Everything a bullet can hit: every mesh that belongs to a person or
  // a car, plus a map from mesh back to its owner and kind.
  collectTargets(game) {
    const targets = [];
    const owners = new Map();
    const groups = [
      [game.enemies, 'enemy'],
      [game.officers, 'officer'],
      [game.peds.filter((ped) => ped.state !== 'down'), 'ped'],
      [game.cars, 'car'],
    ];
    for (const [list, kind] of groups) {
      for (const obj of list) {
        targets.push(obj.mesh);
        owners.set(obj.mesh.uuid, { obj, kind });
      }
    }
    return { targets, owners };
  }

  applyHit(game, obj, kind, damage, point) {
    game.fx.burst(point.clone().setY(1.2), HIT_SPARK, 7, 3, 2);
    switch (kind) {
      case 'enemy': {
        obj.hp -= damage;
        obj.hpBar.scale.x = Math.max(0.01, obj.hp / obj.maxHp);
        obj.hpBar.material.color.setHex(obj.hp > 50 ? BAR_GREEN : BAR_RED);
        if (obj.hp <= 0) this.dropGunman(game, obj);
        else obj.aggro = true;
        break;
      }
      case 'officer':
        game.police.addWanted(game, 1, 'You attacked an officer!');
        break;
      case 'ped':
        obj.state = 'down';
        obj.downTimer = 8;
        obj.mesh.rotation.x = -Math.PI / 2;
        game.police.addWanted(game, 1, 'You hurt a bystander!');
        scarePedestrians(game, obj.pos.x, obj.pos.z, 25);
        break;
      case 'car':
        damageCar(game, obj, damage);
        if (obj.health <= 0) game.fx.explosion(obj.pos.clone().setY(1));
        break;
      default:
        break;
    }
  }

  spawnEnemy(game, x, z) {
    const group = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: ENEMY_JACKET, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: ENEMY_SKIN, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const torso = cuboid(0.62, 0.85, 0.36, jacket, 0, 1.05, 0);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    group.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.27, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: ENEMY_CAP, roughness: 0.7 }),
    );
    cap.position.y = 1.88;
    group.add(cap);
    const legSpecs = [
      [-0.15, 0.3, 0],
      [0.15, 0.3, 0],
    ];
    const legs = legSpecs.map(([lx, ly, lz]) => cuboid(0.22, 0.6, 0.24, dark, lx, ly, lz));
    group.add(legs[0], legs[1]);
    group.add(cuboid(0.09, 0.14, 0.42, new THREE.MeshStandardMaterial({ color: ENEMY_GUN, roughness: 0.4 }), 0.42, 1.0, 0.25));
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }),
    );
    barBg.position.y = 2.15;
    group.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.08), new THREE.MeshBasicMaterial({ color: BAR_GREEN }));
    bar.position.set(0, 2.15, 0.01);
    group.add(bar);
    group.position.set(x, 0, z);
    game.scene.add(group);
    const enemy = {
      mesh: group,
      legL: legs[0],
      legR: legs[1],
      hpBar: bar,
      pos: group.position,
      heading: 0,
      hp: 100,
      maxHp: 100,
      shootTimer: rand(1, 2.5),
      phase: rand(0, 6),
      aggro: false,
    };
    game.enemies.push(enemy);
    return enemy;
  }

  dropGunman(game, enemy) {
    game.fx.burst(enemy.pos.clone().setY(1.2), 0xff5544, 14, 4, 3);
    game.scene.remove(enemy.mesh);
    game.enemies = game.enemies.filter((x) => x !== enemy);
    game.hud.showMessage('Venn crew down.');
    if (Math.random() < 0.5) {
      game.player.ammo = Math.min(game.player.maxAmmo, game.player.ammo + 6);
      game.hud.showMessage('Picked up ammo (+6).');
    }
    game.missions.onEnemyKilled(game, enemy);
  }

  // Gunman AI: face Cole, close the distance when far, hold and shoot when
  // near. Shots are deliberately inaccurate — roughly one in three
  // connects — and every shot draws a tracer so the player can see where
  // the fire is coming from.
  tickEnemies(game, dt) {
    const cole = game.player;
    for (const enemy of [...game.enemies]) {
      const dx = cole.pos.x - enemy.pos.x;
      const dz = cole.pos.z - enemy.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      enemy.shootTimer -= dt;
      enemy.heading = Math.atan2(dx / d, dz / d);
      enemy.mesh.rotation.y = enemy.heading;
      if (d > 14) {
        this.chasePlayer(game, enemy, dx / d, dz / d, dt);
      } else {
        this.holdAndShoot(game, enemy, d, dt);
      }
      enemy.hpBar.lookAt(game.camera.position);
      enemy.mesh.position.copy(enemy.pos);
    }
  }

  chasePlayer(game, enemy, ux, uz, dt) {
    enemy.pos.x += ux * 4.2 * dt;
    enemy.pos.z += uz * 4.2 * dt;
    enemy.phase += dt * 9;
    const step = Math.sin(enemy.phase) * 0.6;
    enemy.legL.rotation.x = step;
    enemy.legR.rotation.x = -step;
  }

  holdAndShoot(game, enemy, d, dt) {
    const cole = game.player;
    enemy.legL.rotation.x = 0;
    enemy.legR.rotation.x = 0;
    if (enemy.shootTimer > 0 || d >= 42 || cole.health <= 0) return;
    enemy.shootTimer = rand(1.1, 2.0);
    const from = enemy.pos.clone().setY(1.5);
    const to = cole.pos.clone().setY(1.3 + rand(-1, 1));
    game.fx.tracer(from, to);
    game.audio.gunshot();
    if (Math.random() < 0.3) {
      damagePlayer(game, 7, 'shot');
      game.hud.showMessage('You took a hit!');
    }
  }
}
