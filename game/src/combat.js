// Neon Harbor — fighting. Cole has fists and a pistol; Dario Venn's crew
// has pistols and a grudge. The design rule here is that every attack has
// to be visible: a punch shows a swinging arm, a bright arc, a whoosh, and
// either a spark burst plus "Punch landed!" or a "Swing and a miss" line,
// so the player never wonders whether the click did anything. A pistol
// shot draws a tracer and a muzzle flash, and the noise brings the police.
import * as THREE from 'three';
import { rand, dist2D } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';
import { damageCar } from './vehicles.js';

const REACH = 2.6;
const SWING_TIME = 0.35;
const FIST_DMG = 34;
const SHOT_DMG = 34;

// Small helper: a box mesh placed in one call, so the enemy and officer
// builders read as a parts list instead of a wall of statements.
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class Combat {
  constructor(G) {
    this.G = G;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 120;
    this.arcs = [];
  }

  // The main loop calls this once a frame; it drives the gunmen and fades
  // any punch arcs still hanging in the air.
  update(G, dt) {
    this.tickEnemies(G, dt);
    this.tickArcs(G, dt);
  }

  attack(G) {
    const p = G.player;
    if (G.mode !== 'playing' || p.car) return;
    if (p.weapon === 'fists') this.swing(G);
    else this.shoot(G);
  }

  swing(G) {
    const p = G.player;
    if (p.punchCooldown > 0) return;
    p.punchCooldown = 0.35;
    p.punchAnim = 0.22;
    this.showArc(G);
    G.audio.punch();
    G.fx.shake(0.12);
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const victim = this.victimInFront(G, fx, fz);
    const at = new THREE.Vector3(p.pos.x + fx * 1.6, 1.4, p.pos.z + fz * 1.6);
    if (!victim) {
      // A whiff still has to look like a swing: a pale burst where the
      // fist passed, and a line on screen, so a click never looks dead.
      G.fx.burst(at.clone().setY(1.3), 0xffffff, 4, 2, 1);
      G.hud.showHint('Swing and a miss — get closer!', 1.2);
      return;
    }
    this.applyHit(G, victim.obj, victim.kind, FIST_DMG, at);
    G.fx.shake(0.35);
    G.hud.showMessage('Punch landed!');
    G.hud.showHint('Punch landed!', 1.2);
  }

  // Closest person standing in front of Cole, inside fist range, more or
  // less facing him. Enemies, officers and walkers all count.
  victimInFront(G, fx, fz) {
    const p = G.player;
    const pool = [
      ...G.enemies.map((obj) => ({ obj, kind: 'enemy' })),
      ...G.officers.map((obj) => ({ obj, kind: 'officer' })),
      ...G.peds.filter((ped) => ped.state !== 'down').map((obj) => ({ obj, kind: 'ped' })),
    ];
    let best = null;
    let bestD = REACH;
    for (const c of pool) {
      const dx = c.obj.pos.x - p.pos.x;
      const dz = c.obj.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      if ((dx * fx + dz * fz) / (d || 1) <= 0.3) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  // A flat crescent hanging in the air where the fist travels, built from
  // a ring segment so it reads as a swing rather than a blob.
  showArc(G) {
    const p = G.player;
    const geo = new THREE.RingGeometry(0.9, 1.7, 12, 1, -Math.PI / 3, (Math.PI * 2) / 3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2b0,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const arc = new THREE.Mesh(geo, mat);
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    arc.position.set(p.pos.x + fx * 1.4, 1.3, p.pos.z + fz * 1.4);
    arc.rotation.set(-Math.PI / 2, 0, -p.heading + Math.PI / 2);
    G.scene.add(arc);
    this.arcs.push({ mesh: arc, life: SWING_TIME, maxLife: SWING_TIME });
  }

  tickArcs(G, dt) {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.life -= dt;
      if (arc.life <= 0) {
        G.scene.remove(arc.mesh);
        arc.mesh.geometry.dispose();
        arc.mesh.material.dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      arc.mesh.material.opacity = 0.9 * (arc.life / arc.maxLife);
      arc.mesh.scale.setScalar(1 + (1 - arc.life / arc.maxLife) * 0.4);
    }
  }

  shoot(G) {
    const p = G.player;
    if (p.shootCooldown > 0) return;
    if (p.ammo <= 0) {
      G.hud.showMessage('Out of ammo — find an ammo pickup.');
      G.audio.click();
      p.shootCooldown = 0.4;
      return;
    }
    p.shootCooldown = 0.28;
    p.ammo--;
    G.audio.gunshot();
    const origin = new THREE.Vector3(p.pos.x, 1.55, p.pos.z);
    const dir = new THREE.Vector3();
    G.camera.getWorldDirection(dir);
    dir.y += rand(-0.02, 0.02);
    dir.normalize();
    G.fx.muzzle(origin, dir);
    this.raycaster.set(origin, dir);
    const { targets, owners } = this.collectTargets(G);
    const hits = this.raycaster.intersectObjects(targets, true);
    let end = origin.clone().addScaledVector(dir, 90);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      let root = hit.object;
      while (root.parent && root.parent !== G.scene) root = root.parent;
      const entry = owners.get(root.uuid);
      if (entry) this.applyHit(G, entry.obj, entry.kind, SHOT_DMG, end);
      else G.fx.burst(end, 0xffcc66, 5, 3, 1); // clipped a building
    }
    G.fx.tracer(origin, end);
    if (G.wanted < 1) G.police.addWanted(G, 1, 'Gunfire reported — police are coming.');
  }

  // Everything a bullet can hit: every mesh that belongs to a person or
  // a car, plus a map from mesh back to its owner and kind.
  collectTargets(G) {
    const targets = [];
    const owners = new Map();
    const groups = [
      [G.enemies, 'enemy'],
      [G.officers, 'officer'],
      [G.peds.filter((ped) => ped.state !== 'down'), 'ped'],
      [G.cars, 'car'],
    ];
    for (const [list, kind] of groups) {
      for (const obj of list) {
        targets.push(obj.mesh);
        owners.set(obj.mesh.uuid, { obj, kind });
      }
    }
    return { targets, owners };
  }

  applyHit(G, obj, kind, damage, point) {
    G.fx.burst(point.clone().setY(1.2), 0xff4444, 7, 3, 2);
    if (kind === 'enemy') {
      obj.hp -= damage;
      obj.hpBar.scale.x = Math.max(0.01, obj.hp / obj.maxHp);
      obj.hpBar.material.color.setHex(obj.hp > 50 ? 0x37d67a : 0xff5533);
      if (obj.hp <= 0) this.dropGunman(G, obj);
      else obj.aggro = true;
      return;
    }
    if (kind === 'officer') {
      G.police.addWanted(G, 1, 'You attacked an officer!');
      return;
    }
    if (kind === 'ped') {
      obj.state = 'down';
      obj.downTimer = 8;
      obj.mesh.rotation.x = -Math.PI / 2;
      G.police.addWanted(G, 1, 'You hurt a bystander!');
      scarePedestrians(G, obj.pos.x, obj.pos.z, 25);
      return;
    }
    if (kind === 'car') {
      damageCar(G, obj, damage);
      if (obj.health <= 0) G.fx.explosion(obj.pos.clone().setY(1));
    }
  }

  spawnEnemy(G, x, z) {
    const group = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const torso = box(0.62, 0.85, 0.36, jacket, 0, 1.05, 0);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
    head.position.y = 1.7;
    group.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.27, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }),
    );
    cap.position.y = 1.88;
    group.add(cap);
    const legL = box(0.22, 0.6, 0.24, dark, -0.15, 0.3, 0);
    const legR = box(0.22, 0.6, 0.24, dark, 0.15, 0.3, 0);
    group.add(legL, legR);
    group.add(box(0.09, 0.14, 0.42, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }), 0.42, 1.0, 0.25));
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }),
    );
    barBg.position.y = 2.15;
    group.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.08), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
    bar.position.set(0, 2.15, 0.01);
    group.add(bar);
    group.position.set(x, 0, z);
    G.scene.add(group);
    const enemy = {
      mesh: group,
      legL,
      legR,
      hpBar: bar,
      pos: group.position,
      heading: 0,
      hp: 100,
      maxHp: 100,
      shootTimer: rand(1, 2.5),
      phase: rand(0, 6),
      aggro: false,
    };
    G.enemies.push(enemy);
    return enemy;
  }

  dropGunman(G, enemy) {
    G.fx.burst(enemy.pos.clone().setY(1.2), 0xff5544, 14, 4, 3);
    G.scene.remove(enemy.mesh);
    G.enemies = G.enemies.filter((x) => x !== enemy);
    G.hud.showMessage('Venn crew down.');
    if (Math.random() < 0.5) {
      G.player.ammo = Math.min(G.player.maxAmmo, G.player.ammo + 6);
      G.hud.showMessage('Picked up ammo (+6).');
    }
    G.missions.onEnemyKilled(G, enemy);
  }

  // Gunman AI: face Cole, close the distance when far, hold and shoot when
  // near. Shots are deliberately inaccurate — roughly one in three
  // connects — and every shot draws a tracer so the player can see where
  // the fire is coming from.
  tickEnemies(G, dt) {
    const p = G.player;
    for (const enemy of [...G.enemies]) {
      const dx = p.pos.x - enemy.pos.x;
      const dz = p.pos.z - enemy.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      enemy.shootTimer -= dt;
      enemy.heading = Math.atan2(dx / d, dz / d);
      enemy.mesh.rotation.y = enemy.heading;
      if (d > 14) {
        this.chasePlayer(G, enemy, dx / d, dz / d, dt);
      } else {
        this.holdAndShoot(G, enemy, d, dt);
      }
      enemy.hpBar.lookAt(G.camera.position);
      enemy.mesh.position.copy(enemy.pos);
    }
  }

  chasePlayer(G, enemy, ux, uz, dt) {
    enemy.pos.x += ux * 4.2 * dt;
    enemy.pos.z += uz * 4.2 * dt;
    enemy.phase += dt * 9;
    const step = Math.sin(enemy.phase) * 0.6;
    enemy.legL.rotation.x = step;
    enemy.legR.rotation.x = -step;
  }

  holdAndShoot(G, enemy, d, dt) {
    const p = G.player;
    enemy.legL.rotation.x = 0;
    enemy.legR.rotation.x = 0;
    if (enemy.shootTimer > 0 || d >= 42 || p.health <= 0) return;
    enemy.shootTimer = rand(1.1, 2.0);
    const from = enemy.pos.clone().setY(1.5);
    const to = p.pos.clone().setY(1.3 + rand(-1, 1));
    G.fx.tracer(from, to);
    G.audio.gunshot();
    if (Math.random() < 0.3) {
      damagePlayer(G, 7, 'shot');
      G.hud.showMessage('You took a hit!');
    }
  }
}
