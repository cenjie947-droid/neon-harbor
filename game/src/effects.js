// Neon Harbor — sparks, smoke, muzzle flashes and camera shake.
//
// Everything here is a short-lived mesh: a burst throws a handful of
// coloured chips out from a point, a smoke puff rises and swells, a
// tracer is a bright bar that lives for a blink, and an explosion is
// a burst plus smoke plus a shake. Particles carry their own velocity
// and lifetime and are cleaned up when they die, so the scene never
// fills with dead meshes. The list of live particles is public on
// purpose — the tests count smoke through it.

import * as THREE from 'three';

const CHIP = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const PUFF = new THREE.SphereGeometry(0.5, 8, 6);

export class Effects {
  constructor(game) {
    this.game = game;
    this.particles = [];
    this.trauma = 0;
  }

  // Add one particle to the scene and the live list. `rise` makes it
  // float up instead of falling, `grow` swells it as it ages.
  add(mesh, vel, life, opts) {
    const o = opts || {};
    mesh.position.copy(o.at || new THREE.Vector3());
    this.game.scene.add(mesh);
    const p = {};
    p.mesh = mesh;
    p.vel = vel.clone();
    p.life = life;
    p.maxLife = life;
    p.gravity = o.rise ? 1.5 : -9;
    p.grow = o.grow || 0;
    p.baseScale = o.baseScale || 1;
    p.fade = o.fade !== false;
    this.particles.push(p);
    return mesh;
  }

  // A spray of coloured chips: crash debris, hit sparks, punch stars.
  // `speed` is the launch speed, `size` scales the chips.
  burst(at, color, count, speed, size) {
    const launch = speed === undefined ? 3 : speed;
    const scale = size === undefined ? 1 : size;
    let i = 0;
    while (i < count) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(CHIP, material);
      const s = scale * (0.7 + Math.random() * 0.6);
      mesh.scale.setScalar(s);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.7 + 0.3;
      const vel = new THREE.Vector3(0, 0, 0);
      vel.x = Math.cos(a) * launch;
      vel.y = up * launch;
      vel.z = Math.sin(a) * launch;
      const life = 0.45 + Math.random() * 0.4;
      this.add(mesh, vel, life, { at, baseScale: mesh.scale.x });
      i++;
    }
  }

  // A grey puff from a damaged hood: rises, swells, hangs for a while.
  smokePuff(at) {
    const material = new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Mesh(PUFF, material);
    mesh.scale.setScalar(0.6);
    const vel = new THREE.Vector3(0, 0, 0);
    vel.x = (Math.random() - 0.5) * 0.4;
    vel.y = 1.1 + Math.random() * 0.5;
    vel.z = (Math.random() - 0.5) * 0.4;
    this.add(mesh, vel, 1.4, { at, rise: true, grow: 1.6, baseScale: 0.6 });
  }

  // A big one: orange fire, grey smoke, and a shake.
  explosion(at) {
    this.burst(at, 0xff7722, 18, 7, 1.4);
    this.burst(at, 0xffcc66, 10, 4, 1);
    let i = 0;
    while (i < 4) {
      const p = at.clone();
      p.x += (Math.random() - 0.5) * 1.5;
      p.z += (Math.random() - 0.5) * 1.5;
      this.smokePuff(p);
      i++;
    }
    this.shake(0.55);
  }

  // The flash at a gun's muzzle: a bright chip and a couple of sparks.
  muzzle(origin, dir) {
    const at = origin.clone().addScaledVector(dir, 0.8);
    if (at.y < 0.4) at.y = 0.4;
    this.burst(at, 0xffdd66, 4, 3, 0.8);
  }

  // A bright bar from a gun to where the shot landed, gone in a blink.
  tracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const material = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), material);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.lookAt(to);
    this.add(mesh, new THREE.Vector3(), 0.09, { at: mesh.position, fade: true });
  }

  // Add a jolt. The trauma stacks up to 1 and bleeds off over a second.
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt) {
    // Camera shake: a random offset that scales with the square of the
    // trauma, so small bumps barely register and big hits lurch.
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
      const s = this.trauma * this.trauma * 0.55;
      const cam = this.game.camera;
      if (cam) {
        cam.position.x += (Math.random() - 0.5) * s;
        cam.position.y += (Math.random() - 0.5) * s * 0.6;
      }
    }
    let i = this.particles.length - 1;
    while (i >= 0) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.game.scene.remove(p.mesh);
        if (p.mesh.material) p.mesh.material.dispose();
        this.particles.splice(i, 1);
        i--;
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      const age = 1 - p.life / p.maxLife;
      if (p.grow) p.mesh.scale.setScalar(p.baseScale * (1 + age * p.grow));
      if (p.fade) p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      i--;
    }
  }
}
