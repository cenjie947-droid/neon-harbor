// Neon Harbor — combat: bare hands, a pistol, and Dario Venn's gunmen.
//
// Cole's fists never leave him. A click throws a swing you can actually
// see — a pale arc sweeping in front of him, a whoosh, and a line on
// screen that says what happened: "Punch landed!" with a spark burst
// when it connects, "You swing at thin air." when it does not. The
// pistol is the answer to Venn's crew: twelve rounds, Q to draw it,
// a tracer down the aim line on every shot. Gunmen walk in until they
// are close enough to shoot, plant their feet, and fire in bursts of
// three; put one down and there is a fair chance he leaves a pistol
// pickup on the pavement.
//
// This module owns no keys and no input. main.js calls attack() when
// the player clicks with fists out, shoot() when he clicks with the
// pistol out, spawnEnemy() when a mission stages an ambush, and
// update() every frame while the world is playing.
import * as THREE from 'three';

// Punch reach, swing cone, damage and swing rate.
const FIST_REACH = 2.4;
const FIST_HALF_CONE = 1.1;
const FIST_DAMAGE = 12;
const FIST_RATE = 0.38;
// Pistol reach, damage and fire rate.
const PISTOL_REACH = 46;
const PISTOL_DAMAGE = 34;
const PISTOL_RATE = 0.42;
// What a gunman is made of and how he fights.
const GUNMAN_HEALTH = 50;
const GUNMAN_WALK = 3.6;
const GUNMAN_SHOOT_FROM = 19;
const GUNMAN_PLANT_AT = 12;
const GUNMAN_SHOT_HURT = 7;
const GUNMAN_DROP_ODDS = 0.45;
// How close Cole must be to pick a dropped pistol up.
const PICKUP_REACH = 2.2;

function bearing(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

function foldAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function facing(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function clampHealth(v) {
  return Math.max(0, Math.min(100, v ?? 100));
}

// The visible swing. main.js reads combat.arcs each frame, and the
// test driver counts arcs to prove a punch really happened.
class PunchArc {
  constructor(scene, origin, heading) {
    const geo = new THREE.TorusGeometry(1.25, 0.09, 8, 18, Math.PI * 0.95);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0,
      transparent: true,
      opacity: 0.95,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    const dir = facing(heading);
    this.mesh.position.set(origin.x + dir.x * 1.1, 1.25, origin.z + dir.z * 1.1);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = heading;
    this.mesh.rotation.x = Math.PI / 2;
    this.remaining = 0.28;
    this.total = 0.28;
    scene.add(this.mesh);
  }

  // Fade and swell the arc. False when its life is spent.
  tick(dt) {
    this.remaining -= dt;
    const k = Math.max(0, this.remaining / this.total);
    this.mesh.material.opacity = 0.95 * k;
    const grow = 1 + (1 - k) * 0.35;
    this.mesh.scale.set(grow, grow, grow);
    return this.remaining > 0;
  }

  remove(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// One of Venn's gunmen: dark suit, red shirt front, a hat, a pistol
// held out in front. He walks toward Cole until he is close enough to
// shoot, then plants his feet and fires in bursts, strafing sideways
// between bursts so he is not a still target.
class Gunman {
  constructor(scene, x, z) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = Math.random() * Math.PI * 2;
    this.health = GUNMAN_HEALTH;
    this.mode = 'chase';
    this.nextBurstIn = 1.2 + Math.random() * 0.8;
    this.shotsLeft = 0;
    this.shotGap = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeIn = 2 + Math.random() * 2;
    this.hitFlash = 0;
    this.mesh = this.assemble();
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
  }

  assemble() {
    const group = new THREE.Group();
    const suit = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc9976b });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x8f1d1d });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), suit);
    chest.position.y = 1.18;
    group.add(chest);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.05), shirt);
    front.position.set(0, 1.2, 0.19);
    group.add(front);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
    head.position.y = 1.78;
    group.add(head);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.09, 0.44),
      new THREE.MeshLambertMaterial({ color: 0x111114 }),
    );
    brim.position.y = 1.99;
    group.add(brim);
    const legs = new THREE.MeshLambertMaterial({ color: 0x141416 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), legs);
    legL.position.set(-0.16, 0.4, 0);
    group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), legs);
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

  // Step toward a point, sliding around buildings when the world
  // offers a collision helper.
  strideToward(w, tx, tz, speed, dt) {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = this.pos.x + (dx / dist) * speed * dt;
    const nz = this.pos.z + (dz / dist) * speed * dt;
    if (typeof w.collideCircle === 'function') {
      const solved = w.collideCircle(nx, nz, 0.5);
      this.pos.x = solved.x;
      this.pos.z = solved.z;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.heading = bearing(this.pos.x, this.pos.z, tx, tz);
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

  // The world object the main loop passes in each frame; fall back to
  // whatever the constructor was handed.
  world(w) {
    return w ?? this.game;
  }

  sceneOf(w) {
    const s = this.world(w);
    return s.scene ?? s.G?.scene ?? null;
  }

  heroOf(w) {
    const s = this.world(w);
    return s.player ?? s.G?.player ?? null;
  }

  hudOf(w) {
    const s = this.world(w);
    return s.hud ?? s.G?.hud ?? null;
  }

  audioOf(w) {
    const s = this.world(w);
    return s.audio ?? s.G?.audio ?? null;
  }

  fxOf(w) {
    const s = this.world(w);
    return s.fx ?? s.G?.fx ?? null;
  }

  // -- fists ------------------------------------------------------------
  // Swing. Returns true when the swing connected with something.
  attack(w) {
    const s = this.world(w);
    const hero = this.heroOf(w);
    if (!hero || !s) return false;
    if (this.punchTimer > 0) return false;
    if (hero.car) return false; // no punching from the driver's seat
    this.punchTimer = FIST_RATE;
    this.punchAnim = 1;
    hero.punchAnim = 1;
    const scene = this.sceneOf(w);
    if (scene) this.arcs.push(new PunchArc(scene, hero.pos, hero.heading));
    this.audioOf(w)?.punch?.();
    const connected = this.resolvePunch(s, hero);
    const hud = this.hudOf(w);
    if (connected) hud?.showMessage?.('Punch landed!');
    else hud?.showMessage?.('You swing at thin air.');
    return connected;
  }

  // Find the closest thing inside the swing cone and hurt it. Returns
  // true when something connected, so the caller can say so on screen.
  resolvePunch(s, hero) {
    const dir = facing(hero.heading);
    const px = hero.pos.x + dir.x * 1.4;
    const pz = hero.pos.z + dir.z * 1.4;
    let best = null;
    let bestD = FIST_REACH;
    const weigh = (target, x, z, kind) => {
      const d = Math.hypot(x - px, z - pz);
      if (d > bestD) return;
      const off = Math.abs(foldAngle(Math.atan2(x - hero.pos.x, z - hero.pos.z) - hero.heading));
      if (off > FIST_HALF_CONE) return;
      best = { target, kind };
      bestD = d;
    };
    for (const e of this.enemies) weigh(e, e.pos.x, e.pos.z, 'enemy');
    for (const p of s.peds ?? []) {
      if (p.state === 'down') continue;
      weigh(p, p.pos.x, p.pos.z, 'ped');
    }
    for (const o of s.officers ?? []) weigh(o, o.pos.x, o.pos.z, 'officer');
    if (!best) return false;
    const fx = this.fxOf(s);
    const at = best.target.pos;
    fx?.burst?.(at.x, 1.3, at.z, 0xffd75e, 10);
    if (best.kind === 'enemy') {
      this.hurtEnemy(s, best.target, FIST_DAMAGE);
    } else if (best.kind === 'ped') {
      best.target.state = 'flee';
      best.target.fleeTimer = 3;
      best.target.fleeX = best.target.pos.x - hero.pos.x;
      best.target.fleeZ = best.target.pos.z - hero.pos.z;
      if (typeof s.scarePedestrians === 'function') s.scarePedestrians(s, hero.pos.x, hero.pos.z);
      s.police?.addWanted?.(s, 1, 'assault');
    } else {
      best.target.health = clampHealth((best.target.health ?? 100) - FIST_DAMAGE);
      s.police?.addWanted?.(s, 1, 'assault-officer');
    }
    return true;
  }

  // -- pistol -----------------------------------------------------------
  // Fire. Returns true when a shot went off (or a fist swing happened
  // because the pistol was not the active weapon).
  shoot(w) {
    const s = this.world(w);
    const hero = this.heroOf(w);
    if (!hero || !s) return false;
    if (hero.weapon !== 'pistol') return this.attack(w);
    if (hero.car) return false;
    if ((hero.shootCooldown ?? 0) > 0) return false;
    if ((hero.ammo ?? 0) <= 0) {
      this.audioOf(w)?.click?.();
      this.hudOf(w)?.showMessage?.('Out of ammo — look for a dropped pistol.');
      return false;
    }
    hero.shootCooldown = PISTOL_RATE;
    hero.ammo -= 1;
    const fx = this.fxOf(w);
    const dir = facing(hero.heading);
    const ox = hero.pos.x + dir.x * 0.6;
    const oy = 1.45;
    const oz = hero.pos.z + dir.z * 0.6;
    fx?.muzzle?.(ox, oy, oz);
    this.audioOf(w)?.gunshot?.();
    // Find the closest hittable thing down the aim line.
    let best = null;
    let bestD = PISTOL_REACH;
    const weigh = (target, x, z, kind) => {
      const dx = x - hero.pos.x;
      const dz = z - hero.pos.z;
      const along = dx * dir.x + dz * dir.z;
      if (along < 1 || along > bestD) return;
      const sideways = Math.abs(dx * dir.z - dz * dir.x);
      if (sideways > 1.1 + along * 0.02) return;
      best = { target, kind, along };
      bestD = along;
    };
    for (const e of this.enemies) weigh(e, e.pos.x, e.pos.z, 'enemy');
    for (const p of s.peds ?? []) {
      if (p.state === 'down') continue;
      weigh(p, p.pos.x, p.pos.z, 'ped');
    }
    for (const o of s.officers ?? []) weigh(o, o.pos.x, o.pos.z, 'officer');
    for (const c of s.policeCars ?? []) weigh(c, c.pos.x, c.pos.z, 'cruiser');
    const ex = hero.pos.x + dir.x * bestD;
    const ez = hero.pos.z + dir.z * bestD;
    fx?.tracer?.(ox, oy, oz, ex, 1.2, ez);
    if (!best) return true;
    fx?.burst?.(best.target.pos.x, 1.3, best.target.pos.z, 0xff5a3c, 8);
    if (best.kind === 'enemy') {
      this.hurtEnemy(s, best.target, PISTOL_DAMAGE);
    } else if (best.kind === 'ped') {
      best.target.state = 'down';
      s.police?.addWanted?.(s, 2, 'shooting');
    } else if (best.kind === 'officer') {
      best.target.health = clampHealth((best.target.health ?? 100) - PISTOL_DAMAGE);
      s.police?.addWanted?.(s, 2, 'shooting-officer');
    } else if (best.kind === 'cruiser') {
      best.target.health = clampHealth((best.target.health ?? 100) - PISTOL_DAMAGE);
    }
    return true;
  }

  hurtEnemy(s, enemy, dmg) {
    enemy.health -= dmg;
    enemy.hitFlash = 0.12;
    if (enemy.health > 0) return;
    this.dropEnemy(s, enemy);
  }

  dropEnemy(s, enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i !== -1) this.enemies.splice(i, 1);
    const scene = this.sceneOf(s);
    if (scene) scene.remove(enemy.mesh);
    this.fxOf(s)?.burst?.(enemy.pos.x, 1.2, enemy.pos.z, 0xffd75e, 16);
    this.audioOf(s)?.cash?.();
    if (Math.random() < GUNMAN_DROP_ODDS) this.leavePickup(s, enemy.pos.x, enemy.pos.z);
  }

  // -- pickups ----------------------------------------------------------
  leavePickup(s, x, z) {
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

  gatherPickups(s, hero) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= 1 / 60;
      if (p.life <= 0) {
        this.discardPickup(s, i);
        continue;
      }
      const d = Math.hypot(p.pos.x - hero.pos.x, p.pos.z - hero.pos.z);
      if (d > PICKUP_REACH) continue;
      hero.weapon = 'pistol';
      hero.hasPistol = true;
      hero.ammo = (hero.ammo ?? 0) + p.ammo;
      this.discardPickup(s, i);
      this.hudOf(s)?.showMessage?.(`Picked up a pistol (+${p.ammo} rounds). Press Q to switch.`);
      this.hudOf(s)?.renderWeapon?.(hero);
      this.audioOf(s)?.chime?.();
    }
  }

  discardPickup(s, i) {
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
    const s = this.world(w);
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
    const s = this.world(w);
    if (s && Array.isArray(s.enemies)) s.enemies.length = 0;
  }

  // -- weapons ----------------------------------------------------------
  switchWeapon(w) {
    const hero = this.heroOf(w);
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
    const s = this.world(w);
    const hero = this.heroOf(w);
    const car = hero?.car ?? s?.player?.car;
    if (!car || !car.mesh) return false;
    car.mesh.rotation.set(0, car.heading ?? 0, 0);
    return true;
  }

  // -- per-frame --------------------------------------------------------
  update(w, dt) {
    const s = this.world(w);
    if (!s) return;
    const hero = this.heroOf(w);
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.punchAnim > 0) {
      this.punchAnim = Math.max(0, this.punchAnim - dt * 3.2);
      if (hero) hero.punchAnim = this.punchAnim;
    }
    if (hero && (hero.shootCooldown ?? 0) > 0) hero.shootCooldown -= dt;
    const scene = this.sceneOf(w);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      if (!this.arcs[i].tick(dt)) {
        this.arcs[i].remove(scene);
        this.arcs.splice(i, 1);
      }
    }
    if (hero && !hero.car) this.gatherPickups(s, hero);
    if (!hero || hero.car) return;
    for (const e of [...this.enemies]) this.stepEnemy(s, e, hero, dt);
  }

  stepEnemy(s, e, hero, dt) {
    const d = Math.hypot(hero.pos.x - e.pos.x, hero.pos.z - e.pos.z);
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (d > GUNMAN_SHOOT_FROM) {
      e.mode = 'chase';
      e.strideToward(s, hero.pos.x, hero.pos.z, GUNMAN_WALK, dt);
    } else if (d > GUNMAN_PLANT_AT) {
      e.mode = 'chase';
      e.strideToward(s, hero.pos.x, hero.pos.z, GUNMAN_WALK * 0.8, dt);
    } else {
      e.mode = 'shoot';
      e.heading = bearing(e.pos.x, e.pos.z, hero.pos.x, hero.pos.z);
      e.mesh.rotation.y = e.heading;
      e.strafeIn -= dt;
      if (e.strafeIn <= 0) {
        e.strafe *= -1;
        e.strafeIn = 1.5 + Math.random() * 1.5;
      }
      const side = facing(e.heading + Math.PI / 2);
      e.pos.x += side.x * e.strafe * 0.7 * dt;
      e.pos.z += side.z * e.strafe * 0.7 * dt;
      e.mesh.position.set(e.pos.x, 0, e.pos.z);
      this.enemyFire(s, e, hero, d, dt);
    }
    if (e.armR) e.armR.rotation.x = e.mode === 'shoot' ? -1.35 : -1.1;
  }

  enemyFire(s, e, hero, dist, dt) {
    if (e.shotsLeft > 0) {
      e.shotGap -= dt;
      if (e.shotGap <= 0) {
        e.shotGap = 0.16;
        e.shotsLeft -= 1;
        this.enemyShot(s, e, hero, dist);
      }
      return;
    }
    e.nextBurstIn -= dt;
    if (e.nextBurstIn <= 0) {
      e.shotsLeft = 3;
      e.shotGap = 0;
      e.nextBurstIn = 1.6 + Math.random() * 1.2;
    }
  }

  enemyShot(s, e, hero, dist) {
    const fx = this.fxOf(s);
    const dir = facing(e.heading);
    const ox = e.pos.x + dir.x * 0.5;
    const oz = e.pos.z + dir.z * 0.5;
    fx?.muzzle?.(ox, 1.35, oz);
    fx?.tracer?.(ox, 1.35, oz, hero.pos.x, 1.3, hero.pos.z);
    this.audioOf(s)?.gunshot?.();
    // Far shots mostly miss; close ones usually do not.
    const hitOdds = dist < 6 ? 0.75 : dist < 12 ? 0.5 : 0.3;
    if (Math.random() > hitOdds) return;
    if ((hero.invuln ?? 0) > 0) return;
    hero.health = Math.max(0, (hero.health ?? 100) - GUNMAN_SHOT_HURT);
    hero.invuln = 0.7;
    this.hudOf(s)?.flashDamage?.();
    this.hudOf(s)?.renderHealth?.(hero);
    s.police?.addWanted?.(s, 1, 'shot-at');
  }
}
