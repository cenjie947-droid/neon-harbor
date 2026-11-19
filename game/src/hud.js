// Neon Harbor — the HUD: health bar, cash, wanted stars, objective line,
// weapon and ammo, speed, the message feed, the damage vignette, and a
// live minimap that follows the player around the city.
//
// Minimap geometry, because the arrow has been wrong before: the map is
// north-up, so world +x runs right and world -z (north) runs up, which
// means world +z (south) runs down the canvas. A heading is atan2(fx, fz),
// so heading 0 faces +z, straight down the map, and heading PI faces -z,
// straight up it. The arrow sprite is drawn pointing up (tip at -y), so
// the canvas rotation that puts its tip along the heading is PI - heading:
// heading 0 rotates it half a turn to point down (south), heading PI leaves
// it pointing up (north). Rotating by the bare heading instead would flip
// north and south.
import { WORLD, clamp } from './state.js';

const MAP_SIZE = 190;
const MAP_SCALE = MAP_SIZE / 560;

export class HUD {
  constructor(G) {
    this.G = G;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      healthBar: $('health-bar'),
      healthText: $('health-text'),
      cash: $('cash-text'),
      ammo: $('ammo'),
      ammoText: $('ammo-text'),
      stars: $('stars'),
      missionName: $('mission-name'),
      objective: $('objective'),
      crosshair: $('crosshair'),
      minimap: $('minimap'),
      speed: $('speed'),
      speedText: $('speed-text'),
      feed: $('feed'),
      hint: $('hint'),
      vignette: $('vignette'),
      interact: $('interact'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.hintTimer = 0;
  }

  // Canvas rotation for the player arrow at a given heading. Kept as a
  // pure function so a test can check the transform without drawing.
  static arrowRotation(heading) {
    return Math.PI - heading;
  }

  show() {
    this.el.hud.classList.remove('hidden');
  }

  hide() {
    this.el.hud.classList.add('hidden');
  }

  setMissionName(text) {
    this.el.missionName.textContent = text;
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }

  // Newest message on top, four at most, each gone after nine seconds.
  showMessage(text) {
    const div = document.createElement('div');
    div.textContent = text;
    this.el.feed.prepend(div);
    while (this.el.feed.children.length > 4) this.el.feed.removeChild(this.el.feed.lastChild);
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 9000);
  }

  showHint(text, seconds = 3) {
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  flashDamage() {
    this.el.vignette.style.opacity = '1';
    setTimeout(() => {
      this.el.vignette.style.opacity = '0';
    }, 220);
  }

  update(G, dt) {
    const p = G.player;
    if (!p) return;
    this.drawHealth(p);
    this.el.cash.textContent = G.cash;
    this.drawStars(G.wanted);
    this.drawWeapon(p);
    this.drawSpeed(p);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    this.drawMinimap(G);
  }

  drawHealth(p) {
    const hp = clamp(p.health, 0, 100);
    this.el.healthBar.style.width = `${hp}%`;
    this.el.healthBar.style.background =
      hp > 50
        ? 'linear-gradient(90deg,#37d67a,#7dff9e)'
        : hp > 25
          ? 'linear-gradient(90deg,#f39c12,#ffd76a)'
          : 'linear-gradient(90deg,#e74c3c,#ff7a6a)';
    this.el.healthText.textContent = Math.ceil(p.health);
  }

  drawStars(wanted) {
    let stars = '';
    for (let i = 0; i < 5; i++) {
      stars += i < wanted ? '★' : '<span class="off">★</span>';
    }
    this.el.stars.innerHTML = stars;
  }

  drawWeapon(p) {
    const aiming = p.weapon === 'pistol' && !p.car;
    this.el.ammo.classList.toggle('hidden', !aiming);
    this.el.crosshair.classList.toggle('hidden', !aiming);
    if (aiming) this.el.ammoText.textContent = p.ammo;
  }

  drawSpeed(p) {
    if (p.car) {
      this.el.speed.classList.remove('hidden');
      this.el.speedText.textContent = Math.round(Math.abs(p.car.speed) * 2.2);
    } else {
      this.el.speed.classList.add('hidden');
    }
  }

  drawMinimap(G) {
    const ctx = this.mapCtx;
    const S = MAP_SIZE;
    const C = S / 2;
    const px = G.player.pos.x;
    const pz = G.player.pos.z;
    const toMap = (x, z) => [C + (x - px) * MAP_SCALE, C + (z - pz) * MAP_SCALE];
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      if (mx < -5 || mx > S + 5 || my < -5 || my > S + 5) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(0, 0, S, S);
    // water to the south, sand band above it
    const [, waterY] = toMap(0, WORLD.waterZ);
    ctx.fillStyle = '#1d5f7a';
    ctx.fillRect(0, waterY, S, S);
    const [, sandY] = toMap(0, WORLD.sandZ);
    ctx.fillStyle = '#d9b98a';
    ctx.fillRect(0, sandY, S, waterY - sandY);
    // roads
    ctx.strokeStyle = '#3a3f4d';
    ctx.lineWidth = Math.max(2, WORLD.roadWidth * MAP_SCALE);
    for (const rx of G.roads.xs) {
      const [x1, y1] = toMap(rx, -240);
      const [x2, y2] = toMap(rx, 240);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (const rz of G.roads.zs) {
      const [x1, y1] = toMap(-240, rz);
      const [x2, y2] = toMap(240, rz);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // city blocks
    ctx.fillStyle = '#232a3a';
    for (let bx = 0; bx < 7; bx++) {
      for (let bz = 0; bz < 7; bz++) {
        const cx = -180 + bx * 60 + 30;
        const cz = -180 + bz * 60 + 30;
        if (cz > 150) continue;
        const [x, y] = toMap(cx - 20, cz - 20);
        ctx.fillRect(x, y, 40 * MAP_SCALE, 40 * MAP_SCALE);
      }
    }
    // objective marker: a pulsing yellow diamond
    if (G.beaconTarget) {
      const [mx, my] = toMap(G.beaconTarget.x, G.beaconTarget.z);
      const r = 7 + Math.sin(G.time * 5) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.moveTo(mx, my - r);
      ctx.lineTo(mx + r, my);
      ctx.lineTo(mx, my + r);
      ctx.lineTo(mx - r, my);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const car of G.traffic) dot(car.pos.x, car.pos.z, 2.5, '#e8e8e8');
    for (const car of G.policeCars) dot(car.pos.x, car.pos.z, 3.5, '#ff4444');
    for (const off of G.officers) dot(off.pos.x, off.pos.z, 2.5, '#ff8888');
    for (const ped of G.peds) dot(ped.pos.x, ped.pos.z, 1.8, '#7dff9e');
    for (const e of G.enemies) dot(e.pos.x, e.pos.z, 3, '#ff2222');
    // Player arrow, centred, pointing along the heading (see the note at
    // the top of this file for why the rotation is PI - heading).
    const heading = G.player.car ? G.player.car.heading : G.player.heading;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(HUD.arrowRotation(heading));
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', C, 12);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(C, C, C - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
