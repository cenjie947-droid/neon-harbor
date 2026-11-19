// Neon Harbor — combat: Cole's fists and pistol, and the armed crew from
// Dario Venn's side who chase and shoot back. A punch has to read, every
// time the player presses the button: the arm swings (the player mesh owns
// that through punchAnim), a bright arc sweeps in front of Cole, the air
// pops with a whoosh even when it hits nothing, a connect lands a red
// spark burst, a shake and a "Punch landed!" line, and a clean miss says
// so on screen instead of leaving the player wondering whether the click
// registered at all. The pistol keeps its old shape: raycast shot with a
// tracer and muzzle flash, and gunfire loud enough to draw the police.
import * as THREE from 'three';
import { rand, dist2D } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';

const PUNCH_RANGE = 2.6;
const PUNCH_ARC = 0.35; // seconds a swing stays visible
const PUNCH_DAMAGE = 34;
const SHOT_DAMAGE = 34;

export class Combat {
  constructor(G) {
    this.G = G;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 120;
    this.swingFx = []; // {mesh, life, maxLife} fading arcs in front of Cole
  }

  attack(G) {
    const p = G.player;
    if (G.mode !== 'playing' || p.car) return;
    if (p.weapon === 'fists') this.throwPunch(G);
    else this.firePistol(G);
  }

  throwPunch(G) {
    const p = G.player;
    if (p.punchCooldown > 0) return;
    p.punchCooldown = 0.35;
    // The swing the player sees: the right arm snaps forward (applied to
    // the mesh in the foot-step animation) and an arc sweeps in front.
    p.punchAnim = 0.22;
    this.spawnSwingArc(G);
    G.audio.punch();
    G.fx.shake(0.12);
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const victim = this.findPunchVictim(G, fx, fz);
    if (victim) {
      const at = new THREE.Vector3(p.pos.x + fx * 1.6, 1.4, p.pos.z + fz * 1.6);
      this.hitTarget(G, victim.obj, victim.kind, PUNCH_DAMAGE, at);
      G.fx.shake(0.35);
      G.hud.showMessage('Punch landed!');
      G.hud.showHint('Punch landed!', 1.2);
    } else {
      // A whiff still has to look like a swing: a pale burst where the
      // fist passed, and a line on screen, so F never looks dead.
      const at = new THREE.Vector3(p.pos.x + fx * 1.8, 1.3, p.pos.z + fz * 1.8);
      G.fx.burst(at, 0xffffff, 4, 2, 1);
      G.hud.showHint('Swing and a miss — get closer!', 1.2);
    }
  }

  // The closest person in front of Cole inside punch range, facing them.
  findPunchVictim(G, fx, fz) {
    const p = G.player;
    const candidates = [];
    for (const e of G.enemies) candidates.push({ obj: e, kind: 'enemy' });
    for (const off of G.officers) candidates.push({ obj: off, kind: 'officer' });
    for (const ped of G.peds) {
      if (ped.state !== 'down') candidates.push({ obj: ped, kind: 'ped' });
    }
    let best = null;
    let bestD = PUNCH_RANGE;
    for (const c of candidates) {
      const d = dist2D(p.pos.x, p.pos.z, c.obj.pos.x, c.obj.pos.z);
      if (d >= bestD) continue;
      const dx = c.obj.pos.x - p.pos.x;
      const dz = c.obj.pos.z - p.pos.z;
      const facing = (dx * fx + dz * fz) / (d || 1);
      if (facing <= 0.3) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  // A flat crescent that hangs in the air where the fist travels, fading
  // over a third of a second. Built from a ring segment so it reads as a
  // swing rather than a blob.
  spawnSwingArc(G) {
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
    this.swingFx.push({ mesh: arc, life: PUNCH_ARC, maxLife: PUNCH_ARC });
  }

  firePistol(G) {
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
    const meshes = [];
    const owners = new Map();
    const register = (list, kind) => {
      for (const obj of list) {
        meshes.push(obj.mesh);
        owners.set(obj.mesh.uuid, { obj, kind });
      }
    };
    register(G.enemies, 'enemy');
    register(G.officers, 'officer');
    register(G.peds.filter((ped) => ped.state !== 'down'), 'ped');
    register(G.cars, 'car');
    const hits = this.raycaster.intersectObjects(meshes, true);
    let end = origin.clone().addScaledVector(dir, 90);
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      let root = hit.object;
      while (root.parent && root.parent !== G.scene) root = root.parent;
      const entry = owners.get(root.uuid);
      if (entry) this.hitTarget(G, entry.obj, entry.kind, SHOT_DAMAGE, end);
      else G.fx.burst(end, 0xffcc66, 5, 3, 1); // clipped a building
    }
    G.fx.tracer(origin, end);
    if (G.wanted < 1) G.police.addWanted(G, 1, 'Gunfire reported — police are coming.');
  }

  hitTarget(G, obj, kind, damage, point) {
    G.fx.burst(point.clone().setY(1.2), 0xff4444, 7, 3, 2);
    if (kind === 'enemy') {
      obj.hp -= damage;
      obj.hpBar.scale.x = Math.max(0.01, obj.hp / obj.maxHp);
      obj.hpBar.material.color.setHex(obj.hp > 50 ? 0x37d67a : 0xff5533);
      if (obj.hp <= 0) this.killEnemy(G, obj);
      else obj.aggro = true;
    } else if (kind === 'officer') {
      G.police.addWanted(G, 1, 'You attacked an officer!');
    } else if (kind === 'ped') {
      obj.state = 'down';
      obj.downTimer = 8;
      obj.mesh.rotation.x = -Math.PI / 2;
      G.police.addWanted(G, 1, 'You hurt a bystander!');
      scarePedestrians(G, obj.pos.x, obj.pos.z, 25);
    } else if (kind === 'car') {
      obj.health -= damage;
      if (obj.health <= 0) {
        G.fx.explosion(obj.pos.clone().setY(1));
        obj.health = 100;
      }
    }
  }

  spawnEnemy(G, x, z) {
    const group = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), jacket);
    torso.position.y = 1.05;
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
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.24), dark);
    legL.position.set(-0.15, 0.3, 0);
    group.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.15;
    group.add(legR);
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.14, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
    );
    gun.position.set(0.42, 1.0, 0.25);
    group.add(gun);
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

  killEnemy(G, enemy) {
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

  // Enemy AI: face the player, close the distance when far, hold and shoot
  // when near. Shots are deliberately inaccurate — roughly one in three
  // connects — and every shot draws a tracer so the player can see where
  // the fire is coming from.
  updateEnemies(G, dt) {
    const p = G.player;
    for (const enemy of [...G.enemies]) {
      const d = dist2D(enemy.pos.x, enemy.pos.z, p.pos.x, p.pos.z);
      enemy.shootTimer -= dt;
      const dx = p.pos.x - enemy.pos.x;
      const dz = p.pos.z - enemy.pos.z;
      enemy.heading = Math.atan2(dx / (d || 1), dz / (d || 1));
      enemy.mesh.rotation.y = enemy.heading;
      if (d > 14) {
        enemy.pos.x += (dx / d) * 4.2 * dt;
        enemy.pos.z += (dz / d) * 4.2 * dt;
        enemy.phase += dt * 9;
        enemy.legL.rotation.x = Math.sin(enemy.phase) * 0.6;
        enemy.legR.rotation.x = -Math.sin(enemy.phase) * 0.6;
      } else {
        enemy.legL.rotation.x = 0;
        enemy.legR.rotation.x = 0;
        if (enemy.shootTimer <= 0 && d < 42 && p.health > 0) {
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
      enemy.hpBar.lookAt(G.camera.position);
      enemy.mesh.position.copy(enemy.pos);
    }
    this.updateSwingArcs(G, dt);
  }

  updateSwingArcs(G, dt) {
    for (let i = this.swingFx.length - 1; i >= 0; i--) {
      const fx = this.swingFx[i];
      fx.life -= dt;
      if (fx.life <= 0) {
        G.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        this.swingFx.splice(i, 1);
        continue;
      }
      fx.mesh.material.opacity = 0.9 * (fx.life / fx.maxLife);
      fx.mesh.scale.setScalar(1 + (1 - fx.life / fx.maxLife) * 0.4);
    }
  }

  // Main-loop entry: enemies plus the punch-arc fade. updateEnemies stays
  // as the name other modules already call.
  update(G, dt) {
    this.updateEnemies(G, dt);
  }
}
