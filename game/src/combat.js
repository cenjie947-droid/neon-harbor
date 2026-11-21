// Neon Harbor — combat: fists, pistol, and Venn's armed crew.
//
// Cole fights two ways. His fists are always with him: a click swings a
// visible arc in front of him, and anything close enough in that cone
// takes the hit. The pistol needs ammo, fires a tracer down the aim line,
// and is the only sane answer to the gunmen Dario Venn sends. Gunmen
// close in on foot, plant themselves at firing range, and shoot back;
// dropping one sometimes leaves a pistol pickup on the ground.
//
// This module owns no input and no keys. main.js calls attack() for a
// mouse click with fists out, shoot() for a click with the pistol out,
// and spawnEnemy() when a mission stages an ambush. update() runs every
// frame while the world is playing.
import * as THREE from 'three';

const PUNCH_RANGE = 2.4;
const PUNCH_ARC = 1.1; // half-angle of the swing cone, radians
const PUNCH_DAMAGE = 12;
const PUNCH_COOLDOWN = 0.38;
const GUN_RANGE = 46;
const GUN_DAMAGE = 34;
const GUN_COOLDOWN = 0.42;
const ENEMY_HEALTH = 50;
const ENEMY_SPEED = 3.6;
const ENEMY_FIRE_RANGE = 19;
const ENEMY_HOLD_RANGE = 12;
const ENEMY_SHOT_DAMAGE = 7;
const DROP_CHANCE = 0.45;
const PICKUP_RADIUS = 2.2;

function angleTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

// A short-lived swing arc. main.js reads combat.arcs every frame, and
// the test driver counts arcs to prove a punch really happened.
class SwingArc {
  constructor(scene, origin, heading) {
    const geo = new THREE.TorusGeometry(1.25, 0.09, 8, 18, Math.PI * 0.95);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0,
      transparent: true,
      opacity: 0.95,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    const f = forwardOf(heading);
    this.mesh.position.set(origin.x + f.x * 1.1, 1.25, origin.z + f.z * 1.1);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = heading;
    this.mesh.rotation.x = Math.PI / 2;
    this.life = 0.28;
    this.maxLife = 0.28;
    scene.add(this.mesh);
  }

  step(dt) {
    this.life -= dt;
    const k = Math.max(0, this.life / this.maxLife);
    this.mesh.material.opacity = 0.95 * k;
    const s = 1 + (1 - k) * 0.35;
    this.mesh.scale.set(s, s, s);
    return this.life > 0;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// One of Venn's gunmen: dark suit, visible pistol, no face you would
// recognise. He walks toward Cole until he is close enough to shoot,
// then plants his feet and fires in bursts.
class Gunman {
  constructor(scene, x, z) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = Math.random() * Math.PI * 2;
    this.health = ENEMY_HEALTH;
    this.state = 'chase';
    this.fireTimer = 1.2 + Math.random() * 0.8;
    this.burstLeft = 0;
    this.burstGap = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 2 + Math.random() * 2;
    this.flashTimer = 0;
    this.mesh = this.buildMesh();
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
  }

  buildMesh() {
    const group = new THREE.Group();
    const suit = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc9976b });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x8f1d1d });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), suit);
    torso.position.y = 1.18;
    group.add(torso);
    const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.05), shirt);
    shirtFront.position.set(0, 1.2, 0.19);
    group.add(shirtFront);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
    head.position.y = 1.78;
    group.add(head);
    const hat = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.09, 0.44),
      new THREE.MeshLambertMaterial({ color: 0x111114 }),
    );
    hat.position.y = 1.99;
    group.add(hat);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x141416 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), legMat);
    legL.position.set(-0.16, 0.4, 0);
    group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), legMat);
    legR.position.set(0.16, 0.4, 0);
    group.add(legR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), suit);
    armL.position.set(-0.42, 1.2, 0);
    group.add(armL);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), suit);
    this.armR.position.set(0.42, 1.2, 0.14);
    this.armR.rotation.x = -1.1;
    group.add(this.armR);
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x0a0a0c }),
    );
    this.gun.position.set(0.42, 1.32, 0.42);
    group.add(this.gun);
    return group;
  }

  // Walk toward a point, sliding around buildings instead of through
  // them when the world offers a collision helper.
  walkToward(w, tx, tz, speed, dt) {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = this.pos.x + (dx / d) * speed * dt;
    const nz = this.pos.z + (dz / d) * speed * dt;
    if (typeof w.collideCircle === 'function') {
      const solved = w.collideCircle(nx, nz, 0.5);
      this.pos.x = solved.x;
      this.pos.z = solved.z;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.heading = angleTo(this.pos.x, this.pos.z, tx, tz);
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
  }
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.arcs = [];
    this.enemies = [];
    this.pickups = [];
    this.punchTimer = 0;
    this.punchAnim = 0;
  }

  // The state object the main loop passes in each frame; fall back to
  // whatever the constructor was handed.
  state(w) {
    return w ?? this.game;
  }

  sceneOf(w) {
    const s = this.state(w);
    return s.scene ?? s.G?.scene ?? null;
  }

  playerOf(w) {
    const s = this.state(w);
    return s.player ?? s.G?.player ?? null;
  }

  hudOf(w) {
    const s = this.state(w);
    return s.hud ?? s.G?.hud ?? null;
  }

  audioOf(w) {
    const s = this.state(w);
    return s.audio ?? s.G?.audio ?? null;
  }

  fxOf(w) {
    const s = this.state(w);
    return s.fx ?? s.G?.fx ?? null;
  }

  // -- fists ------------------------------------------------------------
  attack(w) {
    const s = this.state(w);
    const hero = this.playerOf(w);
    if (!hero || !s) return false;
    if (this.punchTimer > 0) return false;
    if (hero.car) return false; // no punching from the driver's seat
    this.punchTimer = PUNCH_COOLDOWN;
    this.punchAnim = 1;
    hero.punchAnim = 1;
    const scene = this.sceneOf(w);
    if (scene) this.arcs.push(new SwingArc(scene, hero.pos, hero.heading));
    const audio = this.audioOf(w);
    audio?.punch?.();
    const hit = this.punchHit(s, hero);
    const hud = this.hudOf(w);
    if (hit) {
      hud?.showMessage?.('Punch landed!');
    } else {
      hud?.showMessage?.('You swing at thin air.');
    }
    return hit;
  }

  // Find the closest thing inside the swing cone and hurt it. Returns
  // true when something connected, so the caller can say so on screen.
  punchHit(s, hero) {
    const f = forwardOf(hero.heading);
    const px = hero.pos.x + f.x * 1.4;
    const pz = hero.pos.z + f.z * 1.4;
    let best = null;
    let bestD = PUNCH_RANGE;
    const consider = (target, x, z, kind) => {
      const d = Math.hypot(x - px, z - pz);
      if (d > bestD) return;
      const ang = Math.abs(wrapAngle(Math.atan2(x - hero.pos.x, z - hero.pos.z) - hero.heading));
      if (ang > PUNCH_ARC) return;
      best = { target, kind };
      bestD = d;
    };
    for (const e of this.enemies) consider(e, e.pos.x, e.pos.z, 'enemy');
    for (const p of s.peds ?? []) {
      if (p.state === 'down') continue;
      consider(p, p.pos.x, p.pos.z, 'ped');
    }
    for (const o of s.officers ?? []) consider(o, o.pos.x, o.pos.z, 'officer');
    if (!best) return false;
    const fx = this.fxOf(s);
    const at = best.target.pos;
    fx?.burst?.(at.x, 1.3, at.z, 0xffd75e, 10);
    if (best.kind === 'enemy') {
      this.damageEnemy(s, best.target, PUNCH_DAMAGE);
    } else if (best.kind === 'ped') {
      best.target.state = 'flee';
      best.target.fleeTimer = 3;
      best.target.fleeX = best.target.pos.x - hero.pos.x;
      best.target.fleeZ = best.target.pos.z - hero.pos.z;
      if (typeof s.scarePedestrians === 'function') s.scarePedestrians(s, hero.pos.x, hero.pos.z);
      s.police?.addWanted?.(s, 1, 'assault');
    } else {
      best.target.health = (best.target.health ?? 100) - PUNCH_DAMAGE;
      s.police?.addWanted?.(s, 1, 'assault-officer');
    }
    return true;
  }

  // -- pistol -----------------------------------------------------------
  shoot(w) {
    const s = this.state(w);
    const hero = this.playerOf(w);
    if (!hero || !s) return false;
    if (hero.weapon !== 'pistol') return this.attack(w);
    if (hero.car) return false;
    if ((hero.shootCooldown ?? 0) > 0) return false;
    if ((hero.ammo ?? 0) <= 0) {
      this.audioOf(w)?.click?.();
      this.hudOf(w)?.showMessage?.('Out of ammo — look for a dropped pistol.');
      return false;
    }
    hero.shootCooldown = GUN_COOLDOWN;
    hero.ammo -= 1;
    const fx = this.fxOf(w);
    const f = forwardOf(hero.heading);
    const ox = hero.pos.x + f.x * 0.6;
    const oy = 1.45;
    const oz = hero.pos.z + f.z * 0.6;
    fx?.muzzle?.(ox, oy, oz);
    this.audioOf(w)?.gunshot?.();
    // Find the closest hittable thing down the aim line.
    let best = null;
    let bestD = GUN_RANGE;
    const consider = (target, x, z, kind) => {
      const dx = x - hero.pos.x;
      const dz = z - hero.pos.z;
      const along = dx * f.x + dz * f.z;
      if (along < 1 || along > bestD) return;
      const lateral = Math.abs(dx * f.z - dz * f.x);
      if (lateral > 1.1 + along * 0.02) return;
      best = { target, kind, along };
      bestD = along;
    };
    for (const e of this.enemies) consider(e, e.pos.x, e.pos.z, 'enemy');
    for (const p of s.peds ?? []) {
      if (p.state === 'down') continue;
      consider(p, p.pos.x, p.pos.z, 'ped');
    }
    for (const o of s.officers ?? []) consider(o, o.pos.x, o.pos.z, 'officer');
    for (const c of s.policeCars ?? []) consider(c, c.pos.x, c.pos.z, 'cruiser');
    const ex = hero.pos.x + f.x * bestD;
    const ez = hero.pos.z + f.z * bestD;
    fx?.tracer?.(ox, oy, oz, ex, 1.2, ez);
    if (!best) return true;
    fx?.burst?.(best.target.pos.x, 1.3, best.target.pos.z, 0xff5a3c, 8);
    if (best.kind === 'enemy') {
      this.damageEnemy(s, best.target, GUN_DAMAGE);
    } else if (best.kind === 'ped') {
      best.target.state = 'down';
      s.police?.addWanted?.(s, 2, 'shooting');
    } else if (best.kind === 'officer') {
      best.target.health = (best.target.health ?? 100) - GUN_DAMAGE;
      s.police?.addWanted?.(s, 2, 'shooting-officer');
    } else if (best.kind === 'cruiser') {
      best.target.health = (best.target.health ?? 100) - GUN_DAMAGE;
    }
    return true;
  }

  damageEnemy(s, enemy, dmg) {
    enemy.health -= dmg;
    enemy.flashTimer = 0.12;
    if (enemy.health > 0) return;
    this.killEnemy(s, enemy);
  }

  killEnemy(s, enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i !== -1) this.enemies.splice(i, 1);
    const scene = this.sceneOf(s);
    if (scene) scene.remove(enemy.mesh);
    this.fxOf(s)?.burst?.(enemy.pos.x, 1.2, enemy.pos.z, 0xffd75e, 16);
    this.audioOf(s)?.cash?.();
    if (Math.random() < DROP_CHANCE) this.dropPickup(s, enemy.pos.x, enemy.pos.z);
  }

  // -- pickups ----------------------------------------------------------
  dropPickup(s, x, z) {
    const scene = this.sceneOf(s);
    if (!scene) return;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, 0.16),
      new THREE.MeshLambertMaterial({ color: 0x222226 }),
    );
    body.position.y = 0.12;
    group.add(body);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.04, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.55 }),
    );
    glow.position.y = 0.05;
    group.add(glow);
    group.position.set(x, 0, z);
    scene.add(group);
    const pickup = { kind: 'pistol', ammo: 12, pos: new THREE.Vector3(x, 0, z), mesh: group, life: 60 };
    this.pickups.push(pickup);
    if (Array.isArray(s.pickups)) s.pickups.push(pickup);
  }

  collectPickups(s, hero) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= 1 / 60;
      if (p.life <= 0) {
        this.removePickup(s, i);
        continue;
      }
      const d = Math.hypot(p.pos.x - hero.pos.x, p.pos.z - hero.pos.z);
      if (d > PICKUP_RADIUS) continue;
      hero.weapon = 'pistol';
      hero.hasPistol = true;
      hero.ammo = (hero.ammo ?? 0) + p.ammo;
      this.removePickup(s, i);
      this.hudOf(s)?.showMessage?.(`Picked up a pistol (+${p.ammo} rounds). Press Q to switch.`);
      this.hudOf(s)?.renderWeapon?.(hero);
      this.audioOf(s)?.chime?.();
    }
  }

  removePickup(s, i) {
    const p = this.pickups[i];
    this.pickups.splice(i, 1);
    const scene = this.sceneOf(s);
    if (scene && p.mesh) scene.remove(p.mesh);
    if (Array.isArray(s.pickups)) {
      const j = s.pickups.indexOf(p);
      if (j !== -1) s.pickups.splice(j, 1);
    }
  }

  // -- enemies ----------------------------------------------------------
  spawnEnemy(w, x, z) {
    const s = this.state(w);
    const scene = this.sceneOf(w);
    if (!s || !scene) return null;
    const enemy = new Gunman(scene, x, z);
    this.enemies.push(enemy);
    if (Array.isArray(s.enemies)) s.enemies.push(enemy);
    else s.enemies = this.enemies;
    return enemy;
  }

  clearEnemies(w) {
    const scene = this.sceneOf(w);
    for (const e of this.enemies) if (scene) scene.remove(e.mesh);
    this.enemies.length = 0;
    const s = this.state(w);
    if (s && Array.isArray(s.enemies)) s.enemies.length = 0;
  }

  // -- weapons ----------------------------------------------------------
  switchWeapon(w) {
    const hero = this.playerOf(w);
    if (!hero) return;
    if (hero.weapon === 'pistol') {
      hero.weapon = 'fists';
    } else if (hero.hasPistol || (hero.ammo ?? 0) > 0) {
      hero.weapon = 'pistol';
    } else {
      this.hudOf(w)?.showMessage?.('No pistol yet — drop a gunman to get one.');
      return;
    }
    this.hudOf(w)?.renderWeapon?.(hero);
    this.audioOf(w)?.click?.();
  }

  // Right a flipped car. Called from the R key; harmless when there is
  // nothing to flip.
  flipCar(w) {
    const s = this.state(w);
    const hero = this.playerOf(w);
    const car = hero?.car ?? s?.player?.car;
    if (!car || !car.mesh) return false;
    car.mesh.rotation.set(0, car.heading ?? 0, 0);
    return true;
  }

  // -- per-frame --------------------------------------------------------
  update(w, dt) {
    const s = this.state(w);
    if (!s) return;
    const hero = this.playerOf(w);
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.punchAnim > 0) {
      this.punchAnim = Math.max(0, this.punchAnim - dt * 3.2);
      if (hero) hero.punchAnim = this.punchAnim;
    }
    if (hero && (hero.shootCooldown ?? 0) > 0) hero.shootCooldown -= dt;
    const scene = this.sceneOf(w);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      if (!this.arcs[i].step(dt)) {
        this.arcs[i].dispose(scene);
        this.arcs.splice(i, 1);
      }
    }
    if (hero && !hero.car) this.collectPickups(s, hero);
    if (!hero || hero.car) return;
    for (const e of [...this.enemies]) this.updateEnemy(s, e, hero, dt);
  }

  updateEnemy(s, e, hero, dt) {
    const d = Math.hypot(hero.pos.x - e.pos.x, hero.pos.z - e.pos.z);
    if (e.flashTimer > 0) e.flashTimer -= dt;
    if (d > ENEMY_FIRE_RANGE) {
      e.state = 'chase';
      e.walkToward(s, hero.pos.x, hero.pos.z, ENEMY_SPEED, dt);
    } else if (d > ENEMY_HOLD_RANGE) {
      e.state = 'chase';
      e.walkToward(s, hero.pos.x, hero.pos.z, ENEMY_SPEED * 0.8, dt);
    } else {
      e.state = 'shoot';
      e.heading = angleTo(e.pos.x, e.pos.z, hero.pos.x, hero.pos.z);
      e.mesh.rotation.y = e.heading;
      e.strafeTimer -= dt;
      if (e.strafeTimer <= 0) {
        e.strafeDir *= -1;
        e.strafeTimer = 1.5 + Math.random() * 1.5;
      }
      const side = forwardOf(e.heading + Math.PI / 2);
      e.pos.x += side.x * e.strafeDir * 0.7 * dt;
      e.pos.z += side.z * e.strafeDir * 0.7 * dt;
      e.mesh.position.set(e.pos.x, 0, e.pos.z);
      this.enemyFire(s, e, hero, d, dt);
    }
    if (e.armR) e.armR.rotation.x = e.state === 'shoot' ? -1.35 : -1.1;
  }

  enemyFire(s, e, hero, dist, dt) {
    if (e.burstLeft > 0) {
      e.burstGap -= dt;
      if (e.burstGap <= 0) {
        e.burstGap = 0.16;
        e.burstLeft -= 1;
        this.enemyShot(s, e, hero, dist);
      }
      return;
    }
    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      e.burstLeft = 3;
      e.burstGap = 0;
      e.fireTimer = 1.6 + Math.random() * 1.2;
    }
  }

  enemyShot(s, e, hero, dist) {
    const fx = this.fxOf(s);
    const f = forwardOf(e.heading);
    const ox = e.pos.x + f.x * 0.5;
    const oz = e.pos.z + f.z * 0.5;
    fx?.muzzle?.(ox, 1.35, oz);
    fx?.tracer?.(ox, 1.35, oz, hero.pos.x, 1.3, hero.pos.z);
    this.audioOf(s)?.gunshot?.();
    // Far shots mostly miss; close ones usually do not.
    const hitChance = dist < 6 ? 0.75 : dist < 12 ? 0.5 : 0.3;
    if (Math.random() > hitChance) return;
    if ((hero.invuln ?? 0) > 0) return;
    hero.health = Math.max(0, (hero.health ?? 100) - ENEMY_SHOT_DAMAGE);
    hero.invuln = 0.7;
    this.hudOf(s)?.flashDamage?.();
    this.hudOf(s)?.renderHealth?.(hero);
    s.police?.addWanted?.(s, 1, 'shot-at');
  }
}
