// Neon Harbor — particle effects (round 6 fresh rewrite).
// One pooled particle system for sparks, smoke, explosions, muzzle
// flashes and tracers, plus the screen-shake trauma used by the camera.
// Particles are small scaled boxes from a shared geometry with one cached
// material per colour, so a big explosion costs no new materials.
//
// Calling convention: burst / muzzle / tracer / smokePuff / explosion all
// accept EITHER plain numbers (x, y, z, ...) OR Vector3 objects — combat
// calls them with numbers, vehicles with Vector3s — so every entry point
// normalises its first argument before doing anything else.

export function createEffects(G, THREE, scene) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const matCache = new Map();
  const freePool = [];
  const particles = [];
  let trauma = 0;
  let lastShakeAt = 0;

  function matFor(color) {
    if (!matCache.has(color)) {
      matCache.set(color, new THREE.MeshBasicMaterial({ color, transparent: true }));
    }
    return matCache.get(color);
  }

  function takeMesh(color) {
    let mesh = freePool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(boxGeo, matFor(color));
    } else {
      mesh.material = matFor(color);
    }
    mesh.visible = true;
    scene.add(mesh);
    return mesh;
  }

  // Normalise "either a Vector3 or (x, y, z)" into a fresh Vector3.
  function toVec(a, b, c) {
    if (a && typeof a === 'object' && 'x' in a && 'z' in a) {
      return new THREE.Vector3(a.x, a.y || 0, a.z);
    }
    return new THREE.Vector3(a || 0, b || 0, c || 0);
  }

  // Positional spawn used by every effect below: addP(x, y, z, vx, vy, vz,
  // life, size, color, gravity, grow).
  function addP(x, y, z, vx, vy, vz, life, size, color, gravity = 6, grow = 0) {
    const mesh = takeMesh(color);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(Math.max(0.02, size));
    const p = {
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(vx, vy, vz),
      life,
      maxLife: life,
      size,
      gravity,
      grow,
      mesh,
    };
    particles.push(p);
    return p;
  }

  // Unpack the two calling styles for the public burst-style methods.
  // Number form:  fn(x, y, z, count, color, speed)
  // Vector form:  fn(vec, count, color, speed)
  function unpack(a, b, c, count, color, speed) {
    if (a && typeof a === 'object' && 'x' in a) {
      return {
        x: a.x, y: a.y || 0, z: a.z,
        count: b ?? 10, color: c ?? 0xffffff, speed: count ?? 6,
      };
    }
    return { x: a || 0, y: b || 0, z: c || 0, count: count ?? 10, color: color ?? 0xffffff, speed: speed ?? 6 };
  }

  function burst(a, b, c, count, color, speed) {
    const u = unpack(a, b, c, count, color, speed);
    for (let i = 0; i < u.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const up = (Math.random() - 0.3) * u.speed;
      const sp = u.speed * (0.4 + Math.random() * 0.8);
      addP(
        u.x, u.y, u.z,
        Math.cos(ang) * sp, up, Math.sin(ang) * sp,
        0.35 + Math.random() * 0.45,
        0.12 + Math.random() * 0.16,
        u.color, 7
      );
    }
  }

  function smokePuff(a, b, c) {
    const v = toVec(a, b, c);
    addP(
      v.x, v.y, v.z,
      (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8,
      1.1 + Math.random() * 0.7,
      0.5 + Math.random() * 0.3,
      0x777777, -1.2, 1.6
    );
  }

  function explosion(a, b, c) {
    const v = toVec(a, b, c);
    burst(v.x, v.y, v.z, 22, 0xff7722, 9);
    burst(v.x, v.y, v.z, 10, 0xffcc44, 6);
    for (let i = 0; i < 8; i++) smokePuff(v.x + (Math.random() - 0.5) * 2, v.y + Math.random(), v.z + (Math.random() - 0.5) * 2);
    shake(0.55);
    if (G.audio) G.audio.crash();
  }

  function muzzle(a, b, c) {
    const v = toVec(a, b, c);
    for (let i = 0; i < 4; i++) {
      addP(
        v.x, v.y, v.z,
        (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
        0.08 + Math.random() * 0.05,
        0.22 + Math.random() * 0.12,
        0xffe066, 0
      );
    }
  }

  // A tracer is a stretched thin box from `from` to `to`, alive ~90 ms.
  // Accepts (vecFrom, vecTo) or (fx, fy, fz, tx, ty, tz).
  function tracer(a, b, c, d, e, f) {
    let from, to;
    if (a && typeof a === 'object' && 'x' in a) {
      from = new THREE.Vector3(a.x, a.y || 0, a.z);
      to = toVec(b, c, d);
    } else {
      from = new THREE.Vector3(a || 0, b || 0, c || 0);
      to = new THREE.Vector3(d || 0, e || 0, f || 0);
    }
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const mesh = takeMesh(0xffe9a8);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.scale.set(0.07, 0.07, len);
    mesh.lookAt(to);
    const p = {
      pos: mid, vel: new THREE.Vector3(0, 0, 0),
      life: 0.09, maxLife: 0.09, size: 0.07, gravity: 0, grow: 0,
      mesh, stretched: true,
    };
    particles.push(p);
    return p;
  }

  function shake(amount) {
    trauma = Math.min(1, trauma + amount);
  }

  // Jitter the camera by the current trauma, then let the trauma decay.
  // Called once per frame after the camera has been positioned.
  function applyShake(camera) {
    if (trauma <= 0.001) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    const dt = lastShakeAt ? Math.min(0.05, now - lastShakeAt) : 0.016;
    lastShakeAt = now;
    const mag = trauma * trauma * 0.55;
    camera.position.x += (Math.random() - 0.5) * mag;
    camera.position.y += (Math.random() - 0.5) * mag;
    camera.position.z += (Math.random() - 0.5) * mag;
    trauma = Math.max(0, trauma - dt * 1.6);
  }

  function retire(p) {
    const i = particles.indexOf(p);
    if (i >= 0) particles.splice(i, 1);
    if (p.mesh) {
      p.mesh.visible = false;
      scene.remove(p.mesh);
      freePool.push(p.mesh);
      p.mesh = null;
    }
  }

  function stepParticle(p, dt) {
    p.vel.y -= p.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    p.life -= dt;
    if (p.mesh && !p.stretched) {
      const k = Math.max(0.05, p.life / p.maxLife);
      const s = p.size * (p.grow ? 1 + (1 - k) * p.grow : k);
      p.mesh.scale.setScalar(Math.max(0.02, s));
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.y += dt * 3;
      p.mesh.rotation.x += dt * 2;
    }
  }

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      stepParticle(p, dt);
      if (p.life <= 0) retire(p);
    }
  }

  const fx = {
    particles,
    add: addP,
    burst,
    smokePuff,
    explosion,
    muzzle,
    tracer,
    shake,
    applyShake,
    retire,
    stepParticle,
    update,
  };
  G.fx = fx;
  return fx;
}

export default createEffects;
