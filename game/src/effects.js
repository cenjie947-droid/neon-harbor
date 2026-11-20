// Neon Harbor — particles, tracers, muzzle flashes and screen shake.
// Particles share one small box geometry and one material per burst; the
// per-frame update ages them, lets them bounce once off the ground, and
// pulls them out of the scene when their life runs out.
import * as THREE from 'three';

export class Effects {
  constructor(G) {
    this.G = G;
    this.particles = []; // {mesh, vel, life, maxLife}
    this.tracers = []; // {line, life}
    this.arcs = []; // punch swing arcs, handled by combat through addArc
    this.particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this.flashLight = new THREE.PointLight(0xffc860, 0, 14, 2);
    G.scene.add(this.flashLight);
  }

  burst(pos, color, count, speed, up = 2.5) {
    const G = this.G;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(pos);
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI - Math.PI / 2;
      const strength = speed * (0.4 + Math.random() * 0.8);
      const vel = new THREE.Vector3(
        Math.cos(azimuth) * Math.cos(elevation) * strength,
        Math.abs(Math.sin(elevation)) * strength + up,
        Math.sin(azimuth) * Math.cos(elevation) * strength,
      );
      G.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 0.7 + Math.random() * 0.4, maxLife: 1.1 });
    }
  }

  // A burst that keeps feeding itself for a while — used for the smoke
  // trailing a badly damaged car. Call once per frame while smoking.
  smokePuff(pos) {
    this.burst(pos, 0x777777, 2, 1.2, 2.2);
  }

  explosion(pos) {
    this.burst(pos, 0xff7a1e, 26, 9, 4);
    this.burst(pos, 0xffd23e, 16, 6, 5);
    this.burst(pos, 0x444444, 12, 3, 6);
    this.G.shake = Math.max(this.G.shake, 0.7);
    this.G.audio.crash();
  }

  tracer(from, to) {
    const G = this.G;
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 }),
    );
    G.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  muzzle(pos, dir) {
    const G = this.G;
    this.flashLight.position.copy(pos).addScaledVector(dir, 0.4);
    this.flashLight.intensity = 26;
    this.burst(pos.clone().addScaledVector(dir, 0.5), 0xffc860, 5, 3, 1);
  }

  shake(amount) {
    this.G.shake = Math.max(this.G.shake, amount);
  }

  update(dt) {
    const G = this.G;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        G.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.mesh.material.opacity = Math.min(1, p.life / 0.4);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        G.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      t.line.material.opacity = t.life / 0.09;
    }
    if (this.flashLight.intensity > 0) {
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 260);
    }
    G.shake = Math.max(0, G.shake - dt * 2.2);
  }
}
