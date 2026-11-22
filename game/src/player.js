// Neon Harbor — player controller (round 6 fresh rewrite).
// Owns Cole on foot and behind the wheel: walking / sprinting / jumping,
// the third-person camera (with building keep-out, so Continue can never
// spawn the camera inside a wall), entering / exiting / stealing cars,
// and the punch / shoot trigger. Combat resolution itself lives in the
// combat module — this file only starts the swing and plays the feedback.
//
// Conventions: heading 0 faces +z (south on the north-up minimap). The
// camera sits behind the player along -forward and looks at the player's
// chest. Mouse deltas arrive through update() so main can feed them from
// either pointer lock or the held-drag fallback.

const WALK_SPEED = 6;
const SPRINT_SPEED = 9.5;
const GRAVITY = -24;
const JUMP_VELOCITY = 8.5;
const CAM_DISTANCE = 7.5;
const CAM_HEIGHT = 3.2;

export function createPlayer(G, THREE, camera) {
  const player = G.player;
  const city = () => G.city;

  // --- mesh: simple blocky Cole, dark jacket, jeans ----------------------
  const mesh = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a080 });
  const jacket = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x3a4a6a });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), jeans);
  const legR = legL.clone();
  legL.position.set(-0.14, 0.4, 0);
  legR.position.set(0.14, 0.4, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.34), jacket);
  torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.78;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), jacket);
  const armR = armL.clone();
  armL.position.set(-0.42, 1.2, 0);
  armR.position.set(0.42, 1.2, 0);
  mesh.add(legL, legR, torso, head, armL, armR);
  mesh.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  mesh.position.copy(player.pos);
  // The scene is passed in through G by main after boot; attach lazily.
  let attached = false;
  function attach(scene) {
    if (attached || !scene) return;
    scene.add(mesh);
    attached = true;
  }

  function groundY() {
    return 0;
  }

  // Keep a point out of buildings: slide it toward the player until clear.
  function pullOutOfWalls(px, pz, r) {
    const c = city();
    if (!c || !c.hitsBuilding(px, pz, r)) return { x: px, z: pz };
    for (let t = 0.9; t > 0.1; t -= 0.1) {
      const ix = player.pos.x + (px - player.pos.x) * t;
      const iz = player.pos.z + (pz - player.pos.z) * t;
      if (!c.hitsBuilding(ix, iz, r)) return { x: ix, z: iz };
    }
    return { x: player.pos.x, z: player.pos.z };
  }

  function updateCamera() {
    const yaw = player.camYaw;
    const pitch = player.camPitch;
    const dist = CAM_DISTANCE * Math.cos(pitch);
    const height = CAM_HEIGHT - Math.sin(pitch) * CAM_DISTANCE * 0.9;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let cx = player.pos.x - fx * dist;
    let cz = player.pos.z - fz * dist;
    const clear = pullOutOfWalls(cx, cz, 0.6);
    cx = clear.x; cz = clear.z;
    camera.position.set(cx, player.pos.y + height, cz);
    camera.lookAt(player.pos.x, player.pos.y + 1.5, player.pos.z);
    if (G.fx) G.fx.applyShake(camera);
  }

  // Snap the camera to a clear spot (used on start / Continue so the first
  // frame is never inside a wall).
  function snapCameraClear() {
    updateCamera();
  }

  function moveOnFoot(dt, keys) {
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
    const yaw = player.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = fx * fwd + rx * strafe;
    let mz = fz * fwd + rz * strafe;
    const len = Math.hypot(mx, mz);
    player.moving = len > 0.01;
    if (player.moving) {
      mx /= len; mz /= len;
      player.heading = Math.atan2(mx, mz);
      const nx = player.pos.x + mx * speed * dt;
      const nz = player.pos.z + mz * speed * dt;
      const c = city();
      if (!c || !c.hitsBuilding(nx, player.pos.z, 0.6)) player.pos.x = nx;
      if (!c || !c.hitsBuilding(player.pos.x, nz, 0.6)) player.pos.z = nz;
      // Do not walk through parked cars.
      if (G.vehicles) {
        for (const car of G.cars) {
          const d = G.vehicles.distanceToCarBox(player.pos.x, player.pos.z, car);
          if (d < 0.7) {
            const ox = player.pos.x - car.pos.x, oz = player.pos.z - car.pos.z;
            const od = Math.hypot(ox, oz) || 1;
            player.pos.x = car.pos.x + (ox / od) * (car.length / 2 + 0.8);
            player.pos.z = car.pos.z + (oz / od) * (car.length / 2 + 0.8);
          }
        }
      }
      player.walkPhase += dt * speed * 1.6;
    }
    // Jump / gravity.
    if ((keys.has('Space')) && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
    }
    if (!player.onGround) {
      player.vy += GRAVITY * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= groundY()) {
        player.pos.y = groundY();
        player.vy = 0;
        player.onGround = true;
      }
    }
    player.pos.x = Math.max(-250, Math.min(250, player.pos.x));
    player.pos.z = Math.max(-250, Math.min(250, player.pos.z));
  }

  function syncMesh() {
    mesh.position.set(player.pos.x, player.pos.y, player.pos.z);
    mesh.rotation.y = player.heading;
    const swing = player.moving ? Math.sin(player.walkPhase) * 0.55 : 0;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.7;
    // Punch: right arm snaps forward while punchAnim runs.
    if (player.punchAnim > 0) {
      const k = Math.sin((player.punchAnim / 0.35) * Math.PI);
      armR.rotation.x = -1.5 * k;
    } else {
      armR.rotation.x = swing * 0.7;
    }
    mesh.visible = !player.car;
  }

  // E key: get out if driving, otherwise steal / enter the nearest car.
  // Returns 'exit' | 'enter' | 'steal' | null.
  function tryEnterExit() {
    if (player.car) {
      const car = player.car;
      const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
      // Step out on the car's right side, clear of walls.
      let ex = car.pos.x + ch * 2.4;
      let ez = car.pos.z - sh * 2.4;
      const clear = pullOutOfWalls(ex, ez, 0.7);
      player.pos.set(clear.x, 0, clear.z);
      player.heading = car.heading;
      player.camYaw = car.heading;
      car.driver = null;
      player.car = null;
      if (G.audio) G.audio.click();
      return 'exit';
    }
    if (!G.vehicles) return null;
    const found = G.vehicles.nearestStealable(player.pos.x, player.pos.z);
    if (!found) return null;
    const car = found.car;
    const wasParked = car.parked;
    car.driver = 'player';
    car.parked = false;
    car.speed = 0;
    player.car = car;
    player.pos.set(car.pos.x, 0, car.pos.z);
    player.heading = car.heading;
    player.camYaw = car.heading;
    if (G.audio) G.audio.click();
    if (wasParked && !car.isPolice) {
      // Stealing a parked car is a crime: +1 star.
      if (G.police && G.police.addWanted) G.police.addWanted(G, 1, 'steal');
      else G.wanted = Math.min(5, G.wanted + 1);
      if (G.hud && G.hud.feed) G.hud.feed('You stole a ' + car.name + '!');
      return 'steal';
    }
    return 'enter';
  }

  // Mouse click / F-key attack: pistol shot if armed, otherwise a punch.
  function attack() {
    if (player.car) return;
    if (player.shootCooldown > 0) return;
    if (player.weapon === 'pistol' && player.hasPistol && player.ammo > 0) {
      player.shootCooldown = 0.35;
      player.ammo -= 1;
      if (G.audio) G.audio.gunshot();
      if (G.fx) {
        const sh = Math.sin(player.heading), ch = Math.cos(player.heading);
        G.fx.muzzle(player.pos.x + sh * 0.8, 1.4, player.pos.z + ch * 0.8);
      }
      if (G.combat && G.combat.shoot) G.combat.shoot(G);
    } else {
      player.punchAnim = 0.35;
      player.shootCooldown = 0.28;
      if (G.audio) G.audio.punch();
      if (G.combat && G.combat.swing) G.combat.swing(G);
      else if (G.hud && G.hud.feed) G.hud.feed('Punch!');
    }
  }

  function teleport(x, z) {
    const clear = pullOutOfWalls(x, z, 0.8);
    if (player.car) {
      const car = player.car;
      car.pos.set(clear.x, 0, clear.z);
      car.speed = 0;
      player.pos.set(clear.x, 0, clear.z);
    } else {
      player.pos.set(clear.x, 0, clear.z);
    }
    updateCamera();
  }

  function update(dt, keys, mouseDX = 0, mouseDY = 0) {
    player.camYaw -= mouseDX * 0.0028;
    player.camPitch = Math.max(-1.1, Math.min(0.5, player.camPitch + mouseDY * 0.0022));
    if (player.punchAnim > 0) player.punchAnim -= dt;
    if (player.shootCooldown > 0) player.shootCooldown -= dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (player.car) {
      const car = player.car;
      player.pos.set(car.pos.x, 0, car.pos.z);
      player.heading = car.heading;
      // Camera eases back behind the car instead of snapping, so the
      // mouse can still look around while driving.
      let diff = car.heading - player.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.camYaw += diff * Math.min(1, dt * 2.5);
      player.moving = Math.abs(car.speed) > 0.5;
    } else {
      moveOnFoot(dt, keys);
    }
    syncMesh();
    updateCamera();
  }

  const api = {
    mesh,
    attach,
    update,
    attack,
    tryEnterExit,
    teleport,
    snapCameraClear,
    updateCamera,
  };
  G.playerController = api;
  return api;
}

export default createPlayer;
