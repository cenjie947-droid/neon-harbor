// Neon Harbor — the HUD: health, cash, stars, objective, speed, ammo,
// message feed, crosshair, damage vignette, and the minimap canvas.
import { WORLD, clamp } from './state.js';

export class HUD {
  constructor(G) {
    this.G = G;
    this.el = {
      hud: document.getElementById('hud'),
      healthBar: document.getElementById('health-bar'),
      healthText: document.getElementById('health-text'),
      cash: document.getElementById('cash-text'),
      ammo: document.getElementById('ammo'),
      ammoText: document.getElementById('ammo-text'),
      stars: document.getElementById('stars'),
      missionName: document.getElementById('mission-name'),
      objective: document.getElementById('objective'),
      crosshair: document.getElementById('crosshair'),
      minimap: document.getElementById('minimap'),
      speed: document.getElementById('speed'),
      speedText: document.getElementById('speed-text'),
      feed: document.getElementById('feed'),
      hint: document.getElementById('hint'),
      vignette: document.getElementById('vignette'),
      interact: document.getElementById('interact'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.hintTimer = 0;
    this.messages = [];
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setMissionName(t) { this.el.missionName.textContent = t; }
  setObjective(t) { this.el.objective.textContent = t; }

  showMessage(text) {
    const div = document.createElement('div');
    div.textContent = text;
    this.el.feed.prepend(div);
    while (this.el.feed.children.length > 4) this.el.feed.removeChild(this.el.feed.lastChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 9000);
  }

  showHint(text, seconds = 3) {
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  flashDamage() {
    this.el.vignette.style.opacity = '1';
    setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 220);
  }

  update(G, dt) {
    const p = G.player;
    if (!p) return;
    this.el.healthBar.style.width = clamp(p.health, 0, 100) + '%';
    this.el.healthBar.style.background = p.health > 50
      ? 'linear-gradient(90deg,#37d67a,#7dff9e)'
      : p.health > 25 ? 'linear-gradient(90deg,#f39c12,#ffd76a)' : 'linear-gradient(90deg,#e74c3c,#ff7a6a)';
    this.el.healthText.textContent = Math.ceil(p.health);
    this.el.cash.textContent = G.cash;
    // stars
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < G.wanted ? '★' : '<span class="off">★</span>';
    this.el.stars.innerHTML = stars;
    // weapon / ammo
    if (p.weapon === 'pistol' && !p.car) {
      this.el.ammo.classList.remove('hidden');
      this.el.ammoText.textContent = p.ammo;
      this.el.crosshair.classList.remove('hidden');
    } else {
      this.el.ammo.classList.add('hidden');
      this.el.crosshair.classList.add('hidden');
    }
    // speed
    if (p.car) {
      this.el.speed.classList.remove('hidden');
      this.el.speedText.textContent = Math.round(Math.abs(p.car.speed) * 2.2);
    } else {
      this.el.speed.classList.add('hidden');
    }
    // hint timer
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    this.drawMinimap(G);
  }

  drawMinimap(G) {
    const ctx = this.mapCtx, S = 190, C = S / 2;
    const scale = S / 560; // world units -> px (shows ~280 radius around player)
    const px = G.player.pos.x, pz = G.player.pos.z;
    ctx.clearRect(0, 0, S, S);
    // clip to circle
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#0d1526'; ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [C + (x - px) * scale, C + (z - pz) * scale];
    // water (south)
    ctx.fillStyle = '#1d5f7a';
    const [, wy] = toMap(0, WORLD.waterZ);
    ctx.fillRect(0, wy, S, S);
    ctx.fillStyle = '#d9b98a';
    const [, sy] = toMap(0, WORLD.sandZ);
    ctx.fillRect(0, sy, S, wy - sy);
    // roads
    ctx.strokeStyle = '#3a3f4d'; ctx.lineWidth = Math.max(2, WORLD.roadWidth * scale);
    for (const rx of G.roads.xs) {
      const [x1, y1] = toMap(rx, -240), [x2, y2] = toMap(rx, 240);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (const rz of G.roads.zs) {
      const [x1, y1] = toMap(-240, rz), [x2, y2] = toMap(240, rz);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // blocks
    ctx.fillStyle = '#232a3a';
    for (let bx = 0; bx < 7; bx++) for (let bz = 0; bz < 7; bz++) {
      const cx = -180 + bx * 60 + 30, cz = -180 + bz * 60 + 30;
      if (cz > 150) continue;
      const [x, y] = toMap(cx - 20, cz - 20);
      ctx.fillRect(x, y, 40 * scale, 40 * scale);
    }
    const dot = (x, z, r, color) => {
      const [mx, my] = toMap(x, z);
      if (mx < -5 || mx > S + 5 || my < -5 || my > S + 5) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    };
    // mission marker (pulsing yellow diamond)
    if (G.beaconTarget) {
      const [mx, my] = toMap(G.beaconTarget.x, G.beaconTarget.z);
      const r = 7 + Math.sin(G.time * 5) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.moveTo(mx, my - r); ctx.lineTo(mx + r, my); ctx.lineTo(mx, my + r); ctx.lineTo(mx - r, my);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // traffic + police + peds
    for (const car of G.traffic) dot(car.pos.x, car.pos.z, 2.5, '#e8e8e8');
    for (const car of G.policeCars) dot(car.pos.x, car.pos.z, 3.5, '#ff4444');
    for (const off of G.officers) dot(off.pos.x, off.pos.z, 2.5, '#ff8888');
    for (const ped of G.peds) dot(ped.pos.x, ped.pos.z, 1.8, '#7dff9e');
    for (const e of G.enemies) dot(e.pos.x, e.pos.z, 3, '#ff2222');
    // player arrow (north-up, rotates with heading)
    const heading = G.player.car ? G.player.car.heading : G.player.heading;
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(heading);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north tick
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', C, 12);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(C, C, C - 1, 0, Math.PI * 2); ctx.stroke();
  }
}
