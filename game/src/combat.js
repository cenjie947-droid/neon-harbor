// combat.js — fists, pistol, armed gang gunmen and pickups for Neon Harbor.
//
// This module owns everything violent: the punch, the pistol, the gang
// gunmen who hunt Cole, and the pickups they leave behind. It talks to the
// rest of the game only through the shared state object G, so it never
// assumes which module created the player, the police or the effects.
//
// Conventions used here (and nowhere else): effect helpers always take
// plain numbers (x, y, z), never Vector3 objects, so a caller can pass
// coordinates straight out of any position record.

// NOTE: this module never imports three.js. Main passes THREE in through
// the constructor (or it rides on the state object as G.THREE), and every
// mesh below is a visual-only extra — when no THREE is available the
// logic still runs and only the arc / tracer / flash records are kept.

const PUNCH_REACH = 2.4;
const PUNCH_ARC = 1.9; // radians of forward cone the fist can catch
const PUNCH_COOLDOWN = 0.38;
const PUNCH_DAMAGE = 34;
const PISTOL_AMMO = 12;
const PISTOL_RANGE = 42;
const PISTOL_COOLDOWN = 0.24;
const GUNMAN_APPROACH_RANGE = 26;
const GUNMAN_PLANT_RANGE = 17;
const GUNMAN_BURST_GAP = 1.35;
const GUNMAN_SHOTS_PER_BURST = 3;
const GUNMAN_SHOT_GAP = 0.13;
const GUNMAN_HIT_CHANCE = 0.3;
const GUNMAN_SHOT_DAMAGE = 7;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export class Combat {
  constructor(G, THREE) {
    this.G = G;
    // Main passes THREE in; the state object may also carry it as
    // G.THREE. When neither is present, meshes are skipped and only the
    // arc / tracer / flash records are kept — the logic never depends on
    // the renderer.
    this.THREE = THREE || (G && (G.THREE || G.three)) || null;
    // Visible swing arcs the renderer can draw: {x, y, z, angle, life}.
    this.arcs = [];
    // Tracer lines: {x1,y1,z1,x2,y2,z2,life}.
    this.tracers = [];
    // Muzzle flashes: {x, y, z, life}.
    this.flashes = [];
    // Gunmen currently hunting Cole.
    this.gunmen = [];
    // Pickups on the ground: {kind, x, y, z, life}.
    this.pickups = [];
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    this._arcMeshes = [];
    this._tracerMeshes = [];
    this._flashMeshes = [];
    this._gunmanMeshes = new Map();
    // Mirror the pickup list onto the shared state so any other module
    // (player movement, the renderer) can see the same pickups.
    if (G) G.pickups = this.pickups;
  }

  // -- small helpers ------------------------------------------------------

  _player() {
    return this.G && this.G.player ? this.G.player : null;
  }

  // The THREE namespace main passed in, or null when there is none.
  _T() {
    return this.THREE || (this.G && (this.G.THREE || this.G.three)) || null;
  }

  // The player module calls swing(G) / shoot(G) with the state; adopt it
  // when one is handed in so this module always works on live state.
  _useG(G) {
    if (G && G.player) {
      this.G = G;
      if (!this.THREE && (G.THREE || G.three)) this.THREE = G.THREE || G.three;
    }
  }

  _sfx(name) {
    const audio = this.G && this.G.audio;
    if (!audio) return;
    try {
      if (typeof audio.play === 'function') audio.play(name);
      else if (typeof audio[name] === 'function') audio[name]();
      else if (typeof audio.sfx === 'function') audio.sfx(name);
    } catch (err) { /* sound is never fatal */ }
  }

  _burst(x, y, z, kind, count) {
    const fx = this.G && this.G.fx;
    if (!fx) return;
    try {
      if (typeof fx.spawnBurst === 'function') { fx.spawnBurst(x, y, z, kind, count); return; }
      if (typeof fx.spawnSpark === 'function') { fx.spawnSpark(x, y, z); return; }
      if (typeof fx.addParticle === 'function') {
        for (let i = 0; i < (count || 8); i++) fx.addParticle(x, y, z, kind);
        return;
      }
      if (Array.isArray(fx.particles)) {
        for (let i = 0; i < (count || 8); i++) {
          fx.particles.push({
            x, y, z,
            vx: (Math.random() - 0.5) * 6,
            vy: Math.random() * 4 + 1,
            vz: (Math.random() - 0.5) * 6,
            life: 0.45 + Math.random() * 0.25,
            kind: kind || 'spark',
          });
        }
      }
    } catch (err) { /* effects are never fatal */ }
  }

  _addToScene(mesh) {
    const scene = this.G && this.G.scene;
    if (!scene || typeof scene.add !== 'function' || !mesh) return false;
    try { scene.add(mesh); return true; }
    catch (err) { return false; }
  }

  _removeFromScene(mesh) {
    const scene = this.G && this.G.scene;
    if (!scene || typeof scene.remove !== 'function' || !mesh) return;
    try { scene.remove(mesh); } catch (err) { /* ignore */ }
  }

  _hurtPlayer(amount) {
    const G = this.G;
    if (!G) return;
    try {
      if (typeof G.damagePlayer === 'function') { G.damagePlayer(amount); return; }
      if (typeof G.hurtPlayer === 'function') { G.hurtPlayer(amount); return; }
      if (typeof window !== 'undefined' && window.__game && typeof window.__game.hurt === 'function') {
        window.__game.hurt(amount);
        return;
      }
    } catch (err) { /* fall through to the direct path */ }
    const player = this._player();
    if (player && typeof player.health === 'number') {
      player.health = Math.max(0, player.health - amount);
    }
  }

  _say(text) {
    const hud = this.G && this.G.hud;
    if (!hud) return;
    try {
      if (typeof hud.feed === 'function') hud.feed(text);
      else if (typeof hud.addFeed === 'function') hud.addFeed(text);
      else if (typeof hud.showFeed === 'function') hud.showFeed(text);
    } catch (err) { /* ignore */ }
  }

  // -- fists --------------------------------------------------------------

  // Throw a punch. Works only on foot; driving players cannot punch.
  // Always produces a visible swing arc, even on a miss, so the player
  // can see the attack happened. Returns true when a swing went out.
  punch(G) {
    if (G) this._useG(G);
    const player = this._player();
    if (!player || player.car) return false;
    if (this.punchCooldown > 0) return false;
    this.punchCooldown = PUNCH_COOLDOWN;
    player.punchAnim = 1;
    player.weapon = player.weapon || 'fists';

    const heading = player.heading || 0;
    const fwd = forwardOf(heading);
    const px = player.pos.x;
    const py = (player.pos.y || 0) + 1.25;
    const pz = player.pos.z;
    const ax = px + fwd.x * 1.15;
    const az = pz + fwd.z * 1.15;

    this.spawnPunchArc(ax, py, az, heading);
    this._sfx('whoosh');

    const victim = this._nearestPunchTarget(px, pz, heading);
    if (victim) {
      this.spawnSpark(victim.x, 1.2, victim.z);
      this._say('Punch landed!');
      this._sfx('punchHit');
      this._damageTarget(victim, PUNCH_DAMAGE);
    } else {
      this._say('You swing at the air.');
    }
    return true;
  }

  tryPunch(G) { return this.punch(G); }
  swing(G) { return this.punch(G); }
  attack(G) {
    if (G) this._useG(G);
    const player = this._player();
    if (player && player.weapon === 'pistol') return this.shoot();
    return this.punch();
  }

  // The click handler main.js calls: fists punch, pistol fires.
  handleClick() { return this.attack(); }
  onMouseDown() { return this.attack(); }

  _nearestPunchTarget(px, pz, heading) {
    let best = null;
    let bestD = PUNCH_REACH;
    const consider = (obj, x, z) => {
      if (!obj || obj.dead) return;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > PUNCH_REACH || d < 0.01) return;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), heading));
      if (ang > PUNCH_ARC / 2 + 0.35) return;
      if (d < bestD) { bestD = d; best = obj; best.x = x; best.z = z; }
    };
    const G = this.G;
    if (G && Array.isArray(G.peds)) {
      for (const ped of G.peds) {
        if (ped.state === 'down' || ped.fled) continue;
        consider(ped, ped.pos.x, ped.pos.z);
      }
    }
    if (G && Array.isArray(G.officers)) {
      for (const officer of G.officers) consider(officer, officer.pos.x, officer.pos.z);
    }
    for (const gunman of this.gunmen) {
      if (gunman.health > 0) consider(gunman, gunman.pos.x, gunman.pos.z);
    }
    return best;
  }

  _damageTarget(target, amount) {
    if (typeof target.health === 'number') {
      target.health -= amount;
      if (target.health <= 0) {
        target.dead = true;
        if (target.state !== undefined) target.state = 'down';
        if (this.gunmen.includes(target)) this._onGunmanDown(target);
      }
    } else {
      // Pedestrians without a health field just go down.
      target.dead = true;
      if (target.state !== undefined) target.state = 'down';
    }
  }

  // -- pistol ---------------------------------------------------------------

  switchWeapon() {
    const player = this._player();
    if (!player) return 'fists';
    if (player.weapon === 'pistol') {
      player.weapon = 'fists';
      this._say('Fists.');
      return 'fists';
    }
    if ((player.ammo || 0) <= 0) {
      this._say('Out of ammo — find a pistol pickup.');
      this._sfx('dryFire');
      return 'fists';
    }
    player.weapon = 'pistol';
    this._say('Pistol out.');
    this._sfx('draw');
    return 'pistol';
  }

  toggleWeapon() { return this.switchWeapon(); }
  setWeapon(name) {
    const player = this._player();
    if (!player) return;
    if (name === 'pistol' && (player.ammo || 0) <= 0) {
      this._say('Out of ammo — find a pistol pickup.');
      player.weapon = 'fists';
      return;
    }
    player.weapon = name === 'pistol' ? 'pistol' : 'fists';
  }

  // Fire the pistol straight ahead. Returns true when a shot went out.
  shoot(G) {
    if (G) this._useG(G);
    const player = this._player();
    if (!player || player.car) return false;
    if (player.weapon !== 'pistol') return false;
    if (this.shootCooldown > 0) return false;
    if ((player.ammo || 0) <= 0) {
      this._sfx('dryFire');
      this._say('Click — out of ammo.');
      this.shootCooldown = 0.3;
      return false;
    }
    this.shootCooldown = PISTOL_COOLDOWN;
    player.ammo -= 1;

    const heading = player.heading || 0;
    const fwd = forwardOf(heading);
    const mx = player.pos.x + fwd.x * 0.9;
    const my = (player.pos.y || 0) + 1.35;
    const mz = player.pos.z + fwd.z * 0.9;
    this.spawnMuzzleFlash(mx, my, mz);
    this._sfx('shoot');

    const hit = this._nearestShotTarget(player.pos.x, player.pos.z, heading);
    const endX = hit ? hit.x : player.pos.x + fwd.x * PISTOL_RANGE;
    const endZ = hit ? hit.z : player.pos.z + fwd.z * PISTOL_RANGE;
    this.spawnTracer(mx, my, mz, endX, 1.2, endZ);
    if (hit) {
      this.spawnSpark(hit.x, 1.2, hit.z);
      this._damageTarget(hit, 50);
      this._say(hit === this._lastGunmanHit ? 'Gunman down!' : 'Hit!');
    }
    return true;
  }

  firePistol() { return this.shoot(); }
  fire() { return this.shoot(); }

  _nearestShotTarget(px, pz, heading) {
    let best = null;
    let bestD = PISTOL_RANGE;
    const consider = (obj, x, z) => {
      if (!obj || obj.dead) return;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > PISTOL_RANGE || d < 0.5) return;
      const ang = Math.abs(angleDiff(Math.atan2(dx, dz), heading));
      if (ang > 0.16) return;
      if (d < bestD) { bestD = d; best = obj; best.x = x; best.z = z; }
    };
    const G = this.G;
    if (G && Array.isArray(G.peds)) {
      for (const ped of G.peds) {
        if (ped.state === 'down' || ped.fled) continue;
        consider(ped, ped.pos.x, ped.pos.z);
      }
    }
    if (G && Array.isArray(G.officers)) {
      for (const officer of G.officers) consider(officer, officer.pos.x, officer.pos.z);
    }
    for (const gunman of this.gunmen) {
      if (gunman.health > 0) {
        consider(gunman, gunman.pos.x, gunman.pos.z);
        if (best === gunman) this._lastGunmanHit = gunman;
      }
    }
    return best;
  }

  // -- gunmen ---------------------------------------------------------------

  // Spawn an armed gang gunman at (x, z). He closes in, plants himself
  // and fires in bursts until Cole leaves, is busted, or drops him.
  spawnGunman(x, z, opts) {
    const options = opts || {};
    const gunman = {
      kind: 'gunman',
      pos: { x, y: 0, z },
      x,
      z,
      heading: 0,
      health: options.health || 100,
      state: 'approach',
      burstTimer: 0.6 + Math.random() * 0.8,
      shotsLeft: 0,
      shotTimer: 0,
      speed: options.speed || 5.2,
      dead: false,
    };
    this.gunmen.push(gunman);
    this._buildGunmanMesh(gunman);
    return gunman;
  }

  addGunman(x, z, opts) { return this.spawnGunman(x, z, opts); }
  spawnEnemy(x, z, opts) { return this.spawnGunman(x, z, opts); }
  spawnGangster(x, z, opts) { return this.spawnGunman(x, z, opts); }

  _buildGunmanMesh(gunman) {
    if (!this.G || !this.G.scene) return;
    const T = this._T();
    if (!T) return;
    try {
      const group = new T.Group();
      const jacket = new T.Mesh(
        new T.BoxGeometry(0.62, 0.85, 0.36),
        new T.MeshLambertMaterial({ color: 0x5a1f1f })
      );
      jacket.position.y = 1.05;
      const head = new T.Mesh(
        new T.BoxGeometry(0.34, 0.34, 0.34),
        new T.MeshLambertMaterial({ color: 0xc89878 })
      );
      head.position.y = 1.68;
      const legs = new T.Mesh(
        new T.BoxGeometry(0.5, 0.62, 0.3),
        new T.MeshLambertMaterial({ color: 0x1c1c22 })
      );
      legs.position.y = 0.31;
      const gun = new T.Mesh(
        new T.BoxGeometry(0.08, 0.08, 0.5),
        new T.MeshLambertMaterial({ color: 0x111111 })
      );
      gun.position.set(0.3, 1.25, 0.25);
      group.add(jacket, head, legs, gun);
      group.position.set(gunman.pos.x, 0, gunman.pos.z);
      if (this._addToScene(group)) this._gunmanMeshes.set(gunman, group);
    } catch (err) { /* a missing scene never blocks the logic */ }
  }

  _onGunmanDown(gunman) {
    const mesh = this._gunmanMeshes.get(gunman);
    if (mesh) {
      this._removeFromScene(mesh);
      this._gunmanMeshes.delete(gunman);
    }
    this._say('Gunman down!');
    this._burst(gunman.pos.x, 1.0, gunman.pos.z, 'spark', 14);
    // Sometimes he drops his pistol; a health pickup often lies near it.
    if (Math.random() < 0.4) {
      this.dropPickup('pistol', gunman.pos.x + 1.2, gunman.pos.z + 0.6);
      if (Math.random() < 0.6) {
        this.dropPickup('health', gunman.pos.x - 1.0, gunman.pos.z + 1.4);
      }
    } else if (Math.random() < 0.25) {
      this.dropPickup('health', gunman.pos.x + 0.8, gunman.pos.z - 0.8);
    }
  }

  _updateGunmen(dt) {
    const player = this._player();
    if (!player) return;
    for (const gunman of this.gunmen) {
      if (gunman.dead || gunman.health <= 0) continue;
      const dx = player.pos.x - gunman.pos.x;
      const dz = player.pos.z - gunman.pos.z;
      const d = Math.hypot(dx, dz);
      gunman.heading = Math.atan2(dx, dz);
      const mesh = this._gunmanMeshes.get(gunman);
      if (d > GUNMAN_APPROACH_RANGE) {
        gunman.state = 'approach';
      } else if (d > GUNMAN_PLANT_RANGE) {
        gunman.state = 'approach';
        const step = gunman.speed * dt;
        gunman.pos.x += (dx / d) * step;
        gunman.pos.z += (dz / d) * step;
      } else {
        gunman.state = 'planted';
      }
      if (mesh) {
        mesh.position.set(gunman.pos.x, 0, gunman.pos.z);
        mesh.rotation.y = gunman.heading;
      }
      if (gunman.state !== 'planted') continue;
      if (player.car) continue; // gunmen hold fire on a moving car
      if (gunman.shotsLeft > 0) {
        gunman.shotTimer -= dt;
        if (gunman.shotTimer <= 0) {
          gunman.shotTimer = GUNMAN_SHOT_GAP;
          gunman.shotsLeft -= 1;
          this._gunmanShot(gunman, d);
        }
      } else {
        gunman.burstTimer -= dt;
        if (gunman.burstTimer <= 0) {
          gunman.burstTimer = GUNMAN_BURST_GAP;
          gunman.shotsLeft = GUNMAN_SHOTS_PER_BURST;
          gunman.shotTimer = 0;
        }
      }
    }
    // Sweep the dead out of the list once their meshes are gone.
    this.gunmen = this.gunmen.filter((g) => !g.dead || g.health > 0);
  }

  _gunmanShot(gunman, dist) {
    const player = this._player();
    if (!player) return;
    const mx = gunman.pos.x + Math.sin(gunman.heading) * 0.7;
    const mz = gunman.pos.z + Math.cos(gunman.heading) * 0.7;
    this.spawnMuzzleFlash(mx, 1.3, mz);
    this.spawnTracer(mx, 1.3, mz, player.pos.x, 1.2, player.pos.z);
    this._sfx('enemyShoot');
    if (Math.random() < GUNMAN_HIT_CHANCE) {
      this._hurtPlayer(GUNMAN_SHOT_DAMAGE);
      this._say('You\'re hit!');
      if (this.G && this.G.hud && typeof this.G.hud.flashDamage === 'function') {
        this.G.hud.flashDamage();
      }
    }
  }

  clearGunmen() {
    for (const gunman of this.gunmen) {
      const mesh = this._gunmanMeshes.get(gunman);
      if (mesh) this._removeFromScene(mesh);
    }
    this._gunmanMeshes.clear();
    this.gunmen = [];
  }

  // -- pickups --------------------------------------------------------------

  dropPickup(kind, x, z) {
    const pickup = { kind, x, y: 0.5, z, life: 120 };
    this.pickups.push(pickup);
    if (this.G) this.G.pickups = this.pickups;
    return pickup;
  }

  addPickup(kind, x, z) { return this.dropPickup(kind, x, z); }

  _updatePickups(dt) {
    const player = this._player();
    if (!player) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      pickup.life -= dt;
      if (pickup.life <= 0) { this.pickups.splice(i, 1); continue; }
      if (player.car) continue;
      const d = Math.hypot(player.pos.x - pickup.x, player.pos.z - pickup.z);
      if (d > 1.8) continue;
      this.pickups.splice(i, 1);
      if (pickup.kind === 'pistol') {
        player.ammo = (player.ammo || 0) + PISTOL_AMMO;
        this._say(`Picked up a pistol (+${PISTOL_AMMO} ammo).`);
        this._sfx('pickup');
      } else if (pickup.kind === 'health') {
        player.health = Math.min(100, (player.health || 100) + 40);
        this._say('Picked up a medkit (+40 health).');
        this._sfx('pickup');
      } else if (pickup.kind === 'ammo') {
        player.ammo = (player.ammo || 0) + PISTOL_AMMO;
        this._say(`Picked up ammo (+${PISTOL_AMMO}).`);
        this._sfx('pickup');
      }
    }
  }

  // -- effects (plain numbers in, plain numbers out) ------------------------

  spawnPunchArc(x, y, z, angle) {
    const arc = { x, y, z, angle, life: 0.28, maxLife: 0.28 };
    this.arcs.push(arc);
    const T = this._T();
    if (!T) return arc;
    try {
      const geo = new T.TorusGeometry(1.05, 0.045, 6, 14, Math.PI * 0.75);
      const mat = new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.PI / 2, 0, -angle + Math.PI * 0.12);
      if (this._addToScene(mesh)) {
        arc.mesh = mesh;
        this._arcMeshes.push(mesh);
      }
    } catch (err) { /* visual only */ }
    return arc;
  }

  spawnMuzzleFlash(x, y, z) {
    const flash = { x, y, z, life: 0.07, maxLife: 0.07 };
    this.flashes.push(flash);
    this._burst(x, y, z, 'flash', 3);
    const T = this._T();
    if (!T) return flash;
    try {
      const mesh = new T.Mesh(
        new T.SphereGeometry(0.22, 8, 6),
        new T.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 1 })
      );
      mesh.position.set(x, y, z);
      if (this._addToScene(mesh)) {
        flash.mesh = mesh;
        this._flashMeshes.push(mesh);
      }
    } catch (err) { /* visual only */ }
    return flash;
  }

  spawnTracer(x, y, z, tx, ty, tz) {
    const tracer = { x1: x, y1: y, z1: z, x2: tx, y2: ty, z2: tz, life: 0.09, maxLife: 0.09 };
    this.tracers.push(tracer);
    const T = this._T();
    if (!T) return tracer;
    try {
      const dx = tx - x, dy = ty - y, dz = tz - z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const geo = new T.CylinderGeometry(0.02, 0.02, len, 5, 1, true);
      const mat = new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set((x + tx) / 2, (y + ty) / 2, (z + tz) / 2);
      mesh.quaternion.setFromUnitVectors(
        new T.Vector3(0, 1, 0),
        new T.Vector3(dx / len, dy / len, dz / len)
      );
      if (this._addToScene(mesh)) {
        tracer.mesh = mesh;
        this._tracerMeshes.push(mesh);
      }
    } catch (err) { /* visual only */ }
    return tracer;
  }

  spawnSpark(x, y, z) {
    this._burst(x, y, z, 'spark', 12);
    return { x, y, z };
  }

  // -- per-frame update -------------------------------------------------------

  update(dt) {
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    const player = this._player();
    if (player && typeof player.punchAnim === 'number' && player.punchAnim > 0) {
      player.punchAnim = Math.max(0, player.punchAnim - dt * 3.2);
    }
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.life -= dt;
      if (arc.mesh) arc.mesh.material.opacity = Math.max(0, arc.life / arc.maxLife);
      if (arc.life <= 0) {
        if (arc.mesh) { this._removeFromScene(arc.mesh); }
        this.arcs.splice(i, 1);
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      if (tracer.mesh) tracer.mesh.material.opacity = Math.max(0, tracer.life / tracer.maxLife);
      if (tracer.life <= 0) {
        if (tracer.mesh) this._removeFromScene(tracer.mesh);
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      if (flash.life <= 0) {
        if (flash.mesh) this._removeFromScene(flash.mesh);
        this.flashes.splice(i, 1);
      }
    }
    this._updateGunmen(dt);
    this._updatePickups(dt);
  }
}

export { Combat as CombatSystem };
export default Combat;
