// Neon Harbor — the HUD: health bar, cash, wanted stars, objective line,
// weapon and ammo, speed and car condition, the message feed, the damage
// vignette, and a live minimap that follows Cole around the city.
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
      carHealth: $('car-health'),
      carHealthText: $('car-health-text'),
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
    this.renderHealth(p);
    this.el.cash.textContent = G.cash;
    this.renderStars(G.wanted);
    this.renderWeapon(p);
    this.renderDrive(p);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    this.renderMap(G);
  }

  renderHealth(p) {
    const hp = clamp(p.health, 0, 100);
    const bar = this.el.healthBar;
    bar.style.width = `${hp}%`;
    if (hp > 50) bar.style.background = 'linear-gradient(90deg,#37d67a,#7dff9e)';
    else if (hp > 25) bar.style.background = 'linear-gradient(90deg,#f39c12,#ffd76a)';
    else bar.style.background = 'linear-gradient(90deg,#e74c3c,#ff7a6a)';
    this.el.healthText.textContent = Math.ceil(p.health);
  }

  renderStars(wanted) {
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += i < wanted ? '★' : '<span class="off">★</span>';
    }
    this.el.stars.innerHTML = html;
  }

  renderWeapon(p) {
    const aiming = p.weapon === 'pistol' && !p.car;
    this.el.ammo.classList.toggle('hidden', !aiming);
    this.el.crosshair.classList.toggle('hidden', !aiming);
    if (aiming) this.el.ammoText.textContent = p.ammo;
  }

  // Speed while driving, plus the car's condition: green while healthy,
  // amber when dented, red when it is about to quit. Hidden on foot.
  renderDrive(p) {
    const driving = !!p.car;
    this.el.speed.classList.toggle('hidden', !driving);
    this.el.carHealth.classList.toggle('hidden', !driving);
    if (!driving) return;
    this.el.speedText.textContent = Math.round(Math.abs(p.car.speed) * 2.2);
    const hp = Math.max(0, Math.round(p.car.health));
    this.el.carHealthText.textContent = hp;
    if (hp > 60) this.el.carHealth.style.color = '#7dff9e';
    else if (hp > 30) this.el.carHealth.style.color = '#ffd76a';
    else this.el.carHealth.style.color = '#ff7a6a';
  }

  renderMap(G) {
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
    // City blocks first, then roads over them.
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
    // Water to the south, sand band above it.
    const [, waterY] = toMap(0, WORLD.waterZ);
    ctx.fillStyle = '#1d5f7a';
    ctx.fillRect(0, waterY, S, S);
    const [, sandY] = toMap(0, WORLD.sandZ);
    ctx.fillStyle = '#d9b98a';
    ctx.fillRect(0, sandY, S, waterY - sandY);
    // Pay N Spray: a blue square so the garage is findable on the map.
    if (G.markers.spray) {
      const [mx, my] = toMap(G.markers.spray.x, G.markers.spray.z);
      ctx.fillStyle = '#4fa8ff';
      ctx.fillRect(mx - 4, my - 4, 8, 8);
    }
    this.drawObjectiveDiamond(ctx, toMap, G);
    this.drawMapDots(ctx, dot, G);
    this.drawPlayerArrow(ctx, C, G);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(C, C, C - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Objective marker: a pulsing yellow diamond.
  drawObjectiveDiamond(ctx, toMap, G) {
    if (!G.beaconTarget) return;
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

  drawMapDots(ctx, dot, G) {
    const groups = [
      [G.traffic, 2.5, '#e8e8e8'],
      [G.policeCars, 3.5, '#ff4444'],
      [G.officers, 2.5, '#ff8888'],
      [G.peds, 1.8, '#7dff9e'],
      [G.enemies, 3, '#ff2222'],
    ];
    for (const [list, r, color] of groups) {
      for (const obj of list) dot(obj.pos.x, obj.pos.z, r, color);
    }
    // The waiting taxi fare, if any, shows as a yellow dot.
    if (G.taxi && G.taxi.client) {
      dot(G.taxi.client.pos.x, G.taxi.client.pos.z, 3.5, '#ffd23e');
    }
  }

  // Player arrow, centred, pointing along the heading (see the note at
  // the top of this file for why the rotation is PI - heading).
  drawPlayerArrow(ctx, C, G) {
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
  }
}
