// Neon Harbor — particles and camera shake.
//
// Every transient visual lives here: sparks and smoke from crashes,
// muzzle flashes and tracers from gunfire, the burst when a punch
// lands, and the screen shake that sells an impact. Particles are
// small meshes added to the scene and retired once their life runs
// out, so the scene never accumulates dead geometry.
//
// The driver reads game.fx.particles.length to confirm a damaged car
// is smoking, so particles must be real scene meshes in that array.
//
// Position arguments accept either a THREE.Vector3 or plain numeric
// coordinates: vehicles.js passes vectors (burst(at, ...),
// smokePuff(hood)), while combat.js passes numbers (burst(x, y, z,
// ...), muzzle(x, y, z), tracer(x1, y1, z1, x2, y2, z2)). Both forms
// resolve to the same point.

import * as THREE from 'three';
import { rand } from './state.js';

const MAX_PARTICLES = 400;

// Normalise a position argument: a Vector3 is used as-is, three
// numbers become a fresh Vector3.
function toVec(a, b, c) {
  if (a !== null && typeof a === 'object') return a;
  return new THREE.Vector3(a ?? 0, b ?? 0, c ?? 0);
}

export class Effects {
  constructor(game) {
    this.game = game;
    this.particles = [];
    this.shakeAmount = 0;
    this.shakeTime = 0;
  }

  // Register one particle mesh with a velocity and a lifetime.
  // opts: { gravity, drag, grow, shrink, fade, spin }.
  add(mesh, vel, life, opts = {}) {
    if (this.particles.length >= MAX_PARTICLES) this.retire(0);
    mesh.position.y = mesh.position.y || 0;
    this.game.scene.add(mesh);
    this.particles.push({
      mesh,
      vel: vel.clone ? vel.clone() : new THREE.Vector3(vel.x, vel.y, vel.z),
      life,
      maxLife: life,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0,
      grow: opts.grow ?? 0,
      shrink: opts.shrink ?? 0,
      fade: opts.fade !== false,
      spin: opts.spin ?? 0,
    });
  }

  // A spray of small coloured cubes flying out from a point.
  // burst(at, color, count, speed, size) or burst(x, y, z, color, count).
  burst(a, b, c, d, e, f) {
    let at;
    let color;
    let count = 12;
    let speed = 6;
    let size = 0.22;
    if (a !== null && typeof a === 'object') {
      at = a;
      color = b;
      count = c ?? 12;
      speed = d ?? 6;
      size = e ?? 0.22;
    } else {
      at = new THREE.Vector3(a, b, c);
      color = d;
      count = e ?? 12;
      speed = f ?? 6;
    }
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      mesh.position.copy(at);
      const vel = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1))
        .normalize()
        .multiplyScalar(rand(speed * 0.4, speed));
      this.add(mesh, vel, rand(0.35, 0.8), { gravity: -9, fade: true, spin: rand(-6, 6) });
    }
  }

  // One soft grey smoke puff, rising and swelling as it fades.
  smokePuff(a, b, c) {
    const at = toVec(a, b, c);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8a8a8a, transparent: true, opacity: 0.55,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(rand(0.35, 0.5), 8, 6), mat);
    mesh.position.copy(at);
    const vel = new THREE.Vector3(rand(-0.4, 0.4), rand(1.2, 2), rand(-0.4, 0.4));
    this.add(mesh, vel, rand(1.2, 1.8), { grow: 1.6, fade: true });
  }

  // A crash explosion: orange fireball, dark smoke and a spray of sparks.
  explosion(a, b, c) {
    const at = toVec(a, b, c);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true });
    const fire = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), fireMat);
    fire.position.copy(at);
    this.add(fire, new THREE.Vector3(0, 1.5, 0), 0.5, { grow: 3.5, fade: true });
    for (let i = 0; i < 5; i++) {
      const p = at.clone();
      p.x += rand(-0.8, 0.8);
      p.z += rand(-0.8, 0.8);
      p.y += rand(0, 1);
      this.smokePuff(p);
    }
    this.burst(at, 0xffc860, 16, 9, 0.26);
    this.burst(at, 0xff4a20, 8, 6, 0.3);
    this.shake(0.7);
    if (this.game.audio) this.game.audio.crash();
  }

  // A brief muzzle flash at the gun's tip. muzzle(origin, dir) with
  // vectors, or muzzle(x, y, z) with plain coordinates.
  muzzle(a, b, c) {
    let origin;
    let dir = null;
    if (a !== null && typeof a === 'object') {
      origin = a;
      dir = b;
    } else {
      origin = new THREE.Vector3(a, b, c);
    }
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true });
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 6), mat);
    flash.position.copy(origin);
    if (dir) {
      flash.position.addScaledVector(dir, 0.45);
      flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    }
    this.add(flash, new THREE.Vector3(0, 0, 0), 0.09, { fade: true });
  }

  // A thin bright line from one point to another that vanishes in a
  // blink — the visible path of a bullet. tracer(from, to) with
  // vectors, or tracer(x1, y1, z1, x2, y2, z2) with numbers.
  tracer(a, b, c, d, e, f) {
    let from;
    let to;
    if (a !== null && typeof a === 'object') {
      from = a;
      to = b;
    } else {
      from = new THREE.Vector3(a, b, c);
      to = new THREE.Vector3(d, e, f);
    }
    const length = from.distanceTo(to);
    if (length < 0.5) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, length), mat);
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.lookAt(to);
    this.add(beam, new THREE.Vector3(0, 0, 0), 0.12, { fade: true });
  }

  // Kick the camera. Larger amounts shake harder and longer.
  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, 0.35 + amount * 0.3);
  }

  // Apply the current shake to the camera each frame. Called from the
  // main loop after the camera has been positioned for the frame.
  applyShake(dt) {
    if (this.shakeTime <= 0 || !this.game.camera) return;
    this.shakeTime -= dt;
    const decay = Math.max(0, this.shakeTime / 0.6);
    const a = this.shakeAmount * decay;
    const camera = this.game.camera;
    camera.position.x += rand(-a, a) * 0.35;
    camera.position.y += rand(-a, a) * 0.35;
    camera.position.z += rand(-a, a) * 0.2;
    if (this.shakeTime <= 0) this.shakeAmount = 0;
  }

  // Remove particle i from the scene and the list, freeing its geometry.
  retire(i) {
    const p = this.particles[i];
    if (!p) return;
    this.game.scene.remove(p.mesh);
    if (p.mesh.geometry) p.mesh.geometry.dispose();
    if (p.mesh.material) p.mesh.material.dispose();
    this.particles.splice(i, 1);
  }

  // Advance one particle one frame: velocity, gravity, drag, growth,
  // shrink, spin and fading. Returns false when its life is spent.
  stepParticle(p, dt) {
    p.life -= dt;
    if (p.life <= 0) return false;
    p.vel.y += p.gravity * dt;
    if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.grow) {
      const s = 1 + p.grow * dt;
      p.mesh.scale.multiplyScalar(s);
    }
    if (p.shrink) {
      const s = Math.max(0.01, 1 - p.shrink * dt);
      p.mesh.scale.multiplyScalar(s);
    }
    if (p.spin) {
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * 0.7 * dt;
    }
    if (p.fade && p.mesh.material && p.mesh.material.transparent) {
      p.mesh.material.opacity = Math.max(0, (p.life / p.maxLife) * 0.6);
    }
    return true;
  }

  // Advance every particle; retire the spent ones.
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (!this.stepParticle(this.particles[i], dt)) this.retire(i);
    }
  }
}
