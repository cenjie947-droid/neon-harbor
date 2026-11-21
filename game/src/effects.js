// Neon Harbor — particles and camera shake.
//
// Every transient visual lives here: sparks and smoke from crashes,
// muzzle flashes and tracers from gunfire, explosions, and the
// screen shake that sells an impact. Particles are plain meshes
// tracked in `particles` with a velocity, a remaining life and a
// fade; `update` steps them all and retires the dead ones.
import * as THREE from 'three';
import { rand } from './state.js';

export class Effects {
  constructor(game) {
    this.game = game;
    this.particles = [];
    this.trauma = 0;
  }

  // Track a mesh as a particle. `opts.at` sets where it starts;
  // otherwise the mesh's current position is used.
  add(mesh, vel, life, opts = {}) {
    if (opts.at) mesh.position.copy(opts.at);
    this.game.scene.add(mesh);
    const mat = mesh.material;
    const p = {
      mesh,
      vel: vel ? vel.clone() : new THREE.Vector3(),
      life,
      maxLife: life,
      gravity: opts.gravity ?? 0,
      fade: opts.fade ?? true,
      grow: opts.grow ?? 0,
      spin: opts.spin ?? 0,
      baseScale: opts.size ?? 1,
      baseOpacity: mat && mat.transparent ? (mat.opacity ?? 1) : 1,
    };
    if (mat) mat.transparent = true;
    this.particles.push(p);
    return p;
  }

  // A spray of small bright boxes, e.g. impact sparks or a punch hit.
  burst(at, color, count = 10, speed = 6, size = 0.18) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(
        Math.cos(a) * speed * rand(0.4, 1),
        rand(-0.5, 1) * speed,
        Math.sin(a) * speed * rand(0.4, 1),
      );
      this.add(m, vel, rand(0.4, 0.9), { at, gravity: 12 });
    }
  }

  // One slow grey puff that rises, swells and fades — car smoke.
  smokePuff(at) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.35, 0.55), 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.55 }),
    );
    this.add(
      m,
      new THREE.Vector3(rand(-0.3, 0.3), rand(1.2, 2.0), rand(-0.3, 0.3)),
      rand(0.9, 1.4),
      { at, gravity: -1.5, grow: 0.8 },
    );
  }

  explosion(at) {
    this.burst(at, 0xff7b24, 22, 9, 0.3);
    this.burst(at, 0xffd21f, 12, 6, 0.22);
    for (let i = 0; i < 4; i++) {
      this.smokePuff(new THREE.Vector3(at.x + rand(-1, 1), at.y + rand(0, 1), at.z + rand(-1, 1)));
    }
    this.shake(0.7);
  }

  // A flash at the barrel plus a tracer downrange.
  muzzle(origin, dir) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true }),
    );
    this.add(m, dir.clone().multiplyScalar(2), 0.08, { at: origin, fade: true });
    this.tracer(origin, origin.clone().add(dir.clone().multiplyScalar(18)));
  }

  tracer(from, to) {
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, Math.max(len, 0.1)),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }),
    );
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    this.add(m, new THREE.Vector3(), 0.09, { at: m.position });
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // Jitter the camera by the current trauma, then let it decay. The
  // camera position is rebuilt every frame by the player update, so
  // this only ever adds a one-frame offset.
  applyShake(dt) {
    if (this.trauma <= 0.001 || !this.game.camera) return;
    const s = this.trauma * this.trauma * 0.5;
    this.game.camera.position.x += rand(-s, s);
    this.game.camera.position.y += rand(-s, s);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
  }

  retire(i) {
    const p = this.particles[i];
    if (!p) return;
    this.game.scene.remove(p.mesh);
    if (p.mesh.geometry) p.mesh.geometry.dispose();
    if (p.mesh.material) p.mesh.material.dispose();
    this.particles.splice(i, 1);
  }

  stepParticle(p, dt) {
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.y -= p.gravity * dt;
    if (p.grow) {
      const s = p.baseScale + p.grow * (p.maxLife - p.life);
      p.mesh.scale.setScalar(Math.max(0.05, s));
    }
    if (p.spin) {
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * dt * 0.7;
    }
    if (p.fade && p.mesh.material) {
      const f = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = p.baseOpacity * f;
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.stepParticle(this.particles[i], dt);
      if (this.particles[i].life <= 0) this.retire(i);
    }
    this.applyShake(dt);
  }
}
