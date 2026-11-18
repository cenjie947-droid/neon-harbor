// Neon Harbor — combat: fists and pistol for the player, armed rival gang
// members with health bars who chase and shoot.
import * as THREE from 'three';
import { rand, pick, clamp, dist2D } from './state.js';
import { damagePlayer } from './player.js';
import { scarePedestrians } from './pedestrians.js';

export class Combat {
  constructor(G) {
    this.G = G;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 120;
  }

  // player attack (mouse click)
  attack(G) {
    const p = G.player;
    if (G.mode !== 'playing' || p.car) return;
    if (p.weapon === 'fists') this.punch(G);
    else this.shoot(G);
  }

  punch(G) {
    const p = G.player;
    if (p.punchCooldown > 0) return;
    p.punchCooldown = 0.35;
    p.punchAnim = 0.22; // visible swing — applied in footMove, which owns the arms
    G.audio.punch();
    G.fx.shake(0.12);
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const targets = [];
    for (const e of G.enemies) targets.push({ obj: e, d: dist2D(p.pos.x, p.pos.z, e.pos.x, e.pos.z), hp: 'enemy' });
    for (const off of G.officers) targets.push({ obj: off, d: dist2D(p.pos.x, p.pos.z, off.pos.x, off.pos.z), hp: 'officer' });
    for (const ped of G.peds) if (ped.state !== 'down') targets.push({ obj: ped, d: dist2D(p.pos.x, p.pos.z, ped.pos.x, ped.pos.z), hp: 'ped' });
    let hit = false;
    for (const t of targets) {
      if (t.d < 2.4) {
        const dx = t.obj.pos.x - p.pos.x, dz = t.obj.pos.z - p.pos.z;
        const facing = (dx * fx + dz * fz) / (t.d || 1);
        if (facing > 0.3) {
          this.hitTarget(G, t.obj, t.hp, 34, new THREE.Vector3(p.pos.x, 1.4, p.pos.z));
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      G.fx.shake(0.35);
      G.hud.showMessage('Punch landed!');
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
    // gather shootable meshes
    const meshes = [];
    const map = new Map();
    for (const e of G.enemies) { meshes.push(e.mesh); map.set(e.mesh.uuid, { obj: e, kind: 'enemy' }); }
    for (const off of G.officers) { meshes.push(off.mesh); map.set(off.mesh.uuid, { obj: off, kind: 'officer' }); }
    for (const ped of G.peds) if (ped.state !== 'down') { meshes.push(ped.mesh); map.set(ped.mesh.uuid, { obj: ped, kind: 'ped' }); }
    for (const car of G.cars) { meshes.push(car.mesh); map.set(car.mesh.uuid, { obj: car, kind: 'car' }); }
    const hits = this.raycaster.intersectObjects(meshes, true);
    let end = origin.clone().addScaledVector(dir, 90);
    if (hits.length > 0) {
      const h = hits[0];
      end = h.point.clone();
      // walk up to the grouped root
      let root = h.object;
      while (root.parent && root.parent !== G.scene) root = root.parent;
      const entry = map.get(root.uuid);
      if (entry) this.hitTarget(G, entry.obj, entry.kind, 34, end);
      else G.fx.burst(end, 0xffcc66, 5, 3, 1); // hit a building
    }
    G.fx.tracer(origin, end);
    // gunfire is loud: it draws the police
    if (G.wanted < 1) G.police.addWanted(G, 1, 'Gunfire reported — police are coming.');
  }

  hitTarget(G, obj, kind, dmg, point) {
    G.fx.burst(point.clone().setY(1.2), 0xff4444, 7, 3, 2);
    if (kind === 'enemy') {
      obj.hp -= dmg;
      obj.hpBar.scale.x = Math.max(0.01, obj.hp / obj.maxHp);
      obj.hpBar.material.color.setHex(obj.hp > 50 ? 0x37d67a : 0xff5533);
      if (obj.hp <= 0) this.killEnemy(G, obj);
      else { obj.aggro = true; }
    } else if (kind === 'officer') {
      G.police.addWanted(G, 1, 'You attacked an officer!');
    } else if (kind === 'ped') {
      obj.state = 'down'; obj.downTimer = 8;
      obj.mesh.rotation.x = -Math.PI / 2;
      G.police.addWanted(G, 1, 'You hurt a bystander!');
      scarePedestrians(G, obj.pos.x, obj.pos.z, 25);
    } else if (kind === 'car') {
      obj.health -= dmg;
      if (obj.health <= 0) {
        G.fx.explosion(obj.pos.clone().setY(1));
        obj.health = 100;
      }
    }
  }

  spawnEnemy(G, x, z) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.8 }));
    body.position.y = 1.05; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.7 }));
    head.position.y = 1.7; group.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }));
    cap.position.y = 1.88; group.add(cap);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
    legL.position.set(-0.15, 0.3, 0); group.add(legL);
    const legR = legL.clone(); legR.position.x = 0.15; group.add(legR);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    gun.position.set(0.42, 1.0, 0.25); group.add(gun);
    // health bar above head
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }));
    barBg.position.y = 2.15; group.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x37d67a }));
    bar.position.set(0, 2.15, 0.01); group.add(bar);
    group.position.set(x, 0, z);
    G.scene.add(group);
    const e = {
      mesh: group, legL, legR, hpBar: bar,
      pos: group.position, heading: 0, hp: 100, maxHp: 100,
      shootTimer: rand(1, 2.5), phase: rand(0, 6), aggro: false,
    };
    G.enemies.push(e);
    return e;
  }

  killEnemy(G, e) {
    G.fx.burst(e.pos.clone().setY(1.2), 0xff5544, 14, 4, 3);
    G.scene.remove(e.mesh);
    G.enemies = G.enemies.filter(x => x !== e);
    G.hud.showMessage('Venn crew down.');
    if (Math.random() < 0.5) {
      G.player.ammo = Math.min(G.player.maxAmmo, G.player.ammo + 6);
      G.hud.showMessage('Picked up ammo (+6).');
    }
    G.missions.onEnemyKilled(G, e);
  }

  updateEnemies(G, dt) {
    const p = G.player;
    for (const e of [...G.enemies]) {
      const d = dist2D(e.pos.x, e.pos.z, p.pos.x, p.pos.z);
      e.shootTimer -= dt;
      // face the player, chase if far, hold and shoot if near
      const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
      e.heading = Math.atan2(dx / (d || 1), dz / (d || 1));
      e.mesh.rotation.y = e.heading;
      if (d > 14) {
        e.pos.x += (dx / d) * 4.2 * dt;
        e.pos.z += (dz / d) * 4.2 * dt;
        e.phase += dt * 9;
        e.legL.rotation.x = Math.sin(e.phase) * 0.6;
        e.legR.rotation.x = -Math.sin(e.phase) * 0.6;
      } else {
        e.legL.rotation.x = 0; e.legR.rotation.x = 0;
        if (e.shootTimer <= 0 && d < 42 && p.health > 0) {
          e.shootTimer = rand(1.1, 2.0);
          // enemy shot: inaccurate, tracer from enemy to near player
          const from = e.pos.clone().setY(1.5);
          const to = p.pos.clone().setY(1.3 + rand(-1, 1));
          G.fx.tracer(from, to);
          G.audio.gunshot();
          if (Math.random() < 0.3) {
            damagePlayer(G, 7, 'shot');
            G.hud.showMessage('You took a hit!');
          }
        }
      }
      // health bar always faces camera
      e.hpBar.lookAt(G.camera.position);
      e.mesh.position.copy(e.pos);
    }
  }
}
