// Neon Harbor — the wanted system: stars, heat decay, police cars that
// chase and ram, foot officers who can bust the player.
import * as THREE from 'three';
import { rand, pick, clamp, dist2D, angleLerp, collideCircle, inWorldBounds } from './state.js';
import { createCar } from './vehicles.js';
import { damagePlayer } from './player.js';

export class Police {
  constructor(G) {
    this.G = G;
    this.holdTimer = 0;   // officer holding the player
    this.spawnTimer = 0;
  }

  addWanted(G, stars, message) {
    const before = G.wanted;
    G.wanted = clamp(G.wanted + stars, 0, 5);
    G.heatTimer = 0;
    G.stats.crimes++;
    if (G.wanted > before && message) G.hud.showMessage(message);
    if (G.wanted > 0) G.hud.showMessage(`Wanted level ${G.wanted} — Harbor PD is on you.`);
  }

  clearWanted(G) {
    G.wanted = 0; G.heatTimer = 0;
    this.despawnAll(G);
  }

  despawnAll(G) {
    for (const car of G.policeCars) {
      G.scene.remove(car.mesh);
      G.cars = G.cars.filter(c => c !== car);
    }
    G.policeCars = [];
    for (const off of G.officers) G.scene.remove(off.mesh);
    G.officers = [];
    this.holdTimer = 0;
  }

  spawnPoliceCar(G) {
    const p = G.player.pos;
    // spawn on a road at the city edge, away from the player
    const edge = pick([
      { x: -210, z: rand(-180, 140) }, { x: 210, z: rand(-180, 140) },
      { x: rand(-210, 210), z: -210 }, { x: rand(-210, 210), z: 150 },
    ]);
    const car = createCar(G, {
      x: edge.x, z: edge.z, heading: 0, color: 0xf5f5f5, name: 'Harbor PD', isPolice: true,
    });
    car.maxSpeed = 34;
    G.policeCars.push(car);
    return car;
  }

  spawnOfficer(G) {
    const p = G.player.pos;
    const a = rand(0, Math.PI * 2);
    const x = clamp(p.x + Math.cos(a) * 40, -230, 230);
    const z = clamp(p.z + Math.sin(a) * 40, -230, 190);
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 }));
    body.position.y = 1.05; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.7 }));
    head.position.y = 1.7; group.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.6 }));
    cap.position.y = 1.88; group.add(cap);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 }));
    legL.position.set(-0.15, 0.3, 0); group.add(legL);
    const legR = legL.clone(); legR.position.x = 0.15; group.add(legR);
    group.position.set(x, 0, z);
    G.scene.add(group);
    const off = { mesh: group, legL, legR, pos: group.position, heading: 0, phase: 0, speed: 5.6 };
    G.officers.push(off);
    return off;
  }

  update(G, dt) {
    // heat decay: if no police can see the player, wanted fades
    if (G.wanted > 0) {
      G.heatTimer += dt;
      let nearest = 9999;
      for (const car of G.policeCars) nearest = Math.min(nearest, dist2D(car.pos.x, car.pos.z, G.player.pos.x, G.player.pos.z));
      for (const off of G.officers) nearest = Math.min(nearest, dist2D(off.pos.x, off.pos.z, G.player.pos.x, G.player.pos.z));
      const seen = nearest < 55;
      if (!seen && G.heatTimer > 14) {
        G.wanted = Math.max(0, G.wanted - 1);
        G.heatTimer = 0;
        if (G.wanted === 0) { this.despawnAll(G); G.hud.showMessage('You lost the cops. Heat is off.'); }
        else G.hud.showMessage(`Heat dropping — wanted level ${G.wanted}.`);
      }
      if (seen) G.heatTimer = 0;
    }

    // keep the right number of units on the street
    const wantCars = G.wanted >= 1 ? Math.min(3, G.wanted) : 0;
    const wantOfficers = G.wanted >= 2 ? Math.min(3, G.wanted - 1) : 0;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (G.policeCars.length < wantCars) this.spawnPoliceCar(G);
      else if (G.officers.length < wantOfficers) this.spawnOfficer(G);
      this.spawnTimer = 1.2;
    }

    // siren while any police unit is close
    let near = false;
    for (const car of G.policeCars) if (dist2D(car.pos.x, car.pos.z, G.player.pos.x, G.player.pos.z) < 70) near = true;
    G.audio.setSiren(near && G.wanted > 0);

    // police cars chase and ram
    const p = G.player;
    for (const car of G.policeCars) {
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const wantHeading = Math.atan2(dx / d, dz / d);
      car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 1.6));
      const targetSpeed = d > 60 ? car.maxSpeed : 24;
      car.speed += clamp(targetSpeed - car.speed, -14 * dt, 12 * dt);
      const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
      const res = collideCircle(G, nx, nz, 2.1);
      if (!res.hit && inWorldBounds(res.x, res.z)) { car.pos.x = res.x; car.pos.z = res.z; }
      else { car.speed *= 0.5; }
      // ram the player's car / player
      if (d < 4.6) {
        if (p.car) {
          p.car.speed *= 0.7;
          car.speed *= 0.5;
          G.audio.crash();
          G.fx.burst(car.pos.clone().setY(1), 0xffaa33, 5, 3, 2);
          damagePlayer(G, 3, 'ram');
        } else {
          damagePlayer(G, 8, 'ram');
          car.speed *= 0.3;
        }
        G.fx.shake(0.3);
      }
      // push other traffic out of the way
      for (const other of G.traffic) {
        if (dist2D(car.pos.x, car.pos.z, other.pos.x, other.pos.z) < 5) other.stuck = 0.8;
      }
      car.mesh.position.copy(car.pos);
      car.mesh.rotation.y = car.heading;
      for (const w of car.wheels) w.rotation.x += car.speed * dt * 2.4;
      // flashing light bar
      const lights = car.mesh.userData.policeLights;
      if (lights) {
        const on = Math.floor(G.time * 6) % 2 === 0;
        lights[0].material.color.setHex(on ? 0xff2222 : 0x551111);
        lights[1].material.color.setHex(on ? 0x112255 : 0x2266ff);
      }
    }

    // foot officers chase; holding the player for ~2s = BUSTED
    let holding = false;
    for (const off of G.officers) {
      const dx = p.pos.x - off.pos.x, dz = p.pos.z - off.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      off.heading = Math.atan2(dx / d, dz / d);
      const speed = p.car ? 6.4 : 5.6;
      off.pos.x += (dx / d) * speed * dt;
      off.pos.z += (dz / d) * speed * dt;
      off.phase += dt * speed * 2;
      off.legL.rotation.x = Math.sin(off.phase) * 0.6;
      off.legR.rotation.x = -Math.sin(off.phase) * 0.6;
      off.mesh.position.copy(off.pos);
      off.mesh.rotation.y = off.heading;
      if (!p.car && d < 1.7) holding = true;
    }
    if (holding) {
      this.holdTimer += dt;
      G.hud.showHint('The officer is grabbing you — move!');
      if (this.holdTimer > 2.0) {
        this.holdTimer = 0;
        G.missions.onBusted(G);
      }
    } else {
      this.holdTimer = Math.max(0, this.holdTimer - dt * 2);
    }
  }
}
