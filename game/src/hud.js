// Neon Harbor — the HUD: health, cash, stars, weapon, speed, feed and
// the live north-up minimap. All reads come from the shared game object
// each frame; nothing here owns game state, it only shows it.
import { WORLD } from './state.js';

const MAP_SIZE = 190;
const MAP_HALF = WORLD.half; // world runs -240..240 on both axes
const MAP_SCALE = MAP_SIZE / (MAP_HALF * 2);

const MARKER_COLORS = {
  hideout: '#7dff8a',
  paintShop: '#ffd23e',
  spray: '#4db2ff',
  garage: '#ffd23e',
  bank: '#ffb347',
  warehouse: '#c9a86a',
  docks: '#8ad8ff',
  beach: '#ffe9a0',
  hospital: '#ffffff',
  showroom: '#ff8ad8',
};

// World (x, z) -> minimap pixels. North is up: canvas y grows with
// world z, so a point's map position is a plain linear scale of x and z.
function mapX(x) { return MAP_SIZE / 2 + x * MAP_SCALE; }
function mapY(z) { return MAP_SIZE / 2 + z * MAP_SCALE; }

function el(id) { return document.getElementById(id); }

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = el('hud');
    this.healthBar = el('health-bar');
    this.healthText = el('health-text');
    this.cashText = el('cash-text');
    this.ammoBox = el('ammo');
    this.ammoText = el('ammo-text');
    this.starsBox = el('stars');
    this.missionNameBox = el('mission-name');
    this.objectiveBox = el('objective');
    this.crosshair = el('crosshair');
    this.speedBox = el('speed');
    this.speedText = el('speed-text');
    this.carHealthBox = el('car-health');
    this.carHealthText = el('car-health-text');
    this.feed = el('feed');
    this.hintBox = el('hint');
    this.vignette = el('vignette');
    this.map = el('minimap');
    this.mapCtx = this.map ? this.map.getContext('2d') : null;
    this.missionName = '';
    this.objective = '';
    this.hintTimer = 0;
    this.flash = 0;
    this.lastStars = -1;
    this.lastWeapon = '';
  }

  // Minimap arrow rotation for a heading, on a north-up map. The arrow
  // is drawn pointing up and rotated by this amount: a heading of 0
  // (facing +z, i.e. down the map) points the arrow straight down.
  static arrowRotation(heading) {
    return Math.PI - heading;
  }

  show() { if (this.root) this.root.classList.remove('hidden'); }
  hide() { if (this.root) this.root.classList.add('hidden'); }

  setMissionName(text) {
    this.missionName = text || '';
    if (this.missionNameBox) this.missionNameBox.textContent = this.missionName;
  }

  setObjective(text) {
    this.objective = text || '';
    if (this.objectiveBox) this.objectiveBox.textContent = this.objective;
  }

  // A one-line event message in the feed, bottom-left. Oldest lines age
  // out so the feed never covers the playfield.
  showMessage(text) {
    if (!this.feed || !text) return;
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = text;
    this.feed.appendChild(line);
    while (this.feed.children.length > 4) this.feed.removeChild(this.feed.firstChild);
    window.setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 5200);
  }

  showHint(text, seconds = 4) {
    if (!this.hintBox) return;
    this.hintBox.textContent = text || '';
    this.hintBox.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  // Red flash round the screen edge when Cole takes a hit.
  flashDamage() {
    this.flash = 1;
    if (this.vignette) this.vignette.style.opacity = '0.85';
  }

  update(w, dt) {
    const p = w.player;
    if (!p) return;
    this.updateVitals(w, p);
    this.updateWeapon(w, p);
    this.updateDriving(w, p);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.hintBox) this.hintBox.classList.add('hidden');
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
      if (this.vignette) this.vignette.style.opacity = String(this.flash * 0.85);
    }
    this.drawMinimap(w, p);
  }

  updateVitals(w, p) {
    const hp = Math.max(0, Math.round(p.health));
    if (this.healthBar) {
      this.healthBar.style.width = `${hp}%`;
      this.healthBar.style.background = hp > 55 ? '#57e389' : hp > 25 ? '#ffb347' : '#ff5544';
    }
    if (this.healthText) this.healthText.textContent = String(hp);
    if (this.cashText) this.cashText.textContent = String(Math.max(0, Math.round(w.cash || 0)));
    const stars = Math.max(0, Math.min(5, Math.round(w.wanted || 0)));
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      if (this.starsBox) {
        this.starsBox.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
        this.starsBox.classList.toggle('hot', stars > 0);
      }
    }
  }

  updateWeapon(w, p) {
    const weapon = p.car ? '' : (p.weapon || 'fists');
    if (weapon !== this.lastWeapon) {
      this.lastWeapon = weapon;
      if (this.ammoBox) this.ammoBox.classList.toggle('hidden', weapon !== 'pistol');
      if (this.crosshair) this.crosshair.classList.toggle('hidden', weapon !== 'pistol');
    }
    if (weapon === 'pistol' && this.ammoText) {
      this.ammoText.textContent = String(Math.max(0, p.ammo || 0));
    }
  }

  updateDriving(w, p) {
    const car = p.car || null;
    if (this.speedBox) this.speedBox.classList.toggle('hidden', !car);
    if (this.carHealthBox) this.carHealthBox.classList.toggle('hidden', !car);
    if (car) {
      if (this.speedText) this.speedText.textContent = String(Math.round(Math.abs(car.speed || 0) * 2.237));
      if (this.carHealthText) {
        const ch = Math.max(0, Math.round(car.health || 0));
        this.carHealthText.textContent = String(ch);
        this.carHealthBox.style.color = ch > 55 ? '#7dff8a' : ch > 25 ? '#ffb347' : '#ff5544';
      }
    }
  }

  // -- the minimap ---------------------------------------------------------

  drawMinimap(w, p) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const S = MAP_SIZE;
    ctx.clearRect(0, 0, S, S);
    // Sea and sand along the south edge, then the city slab.
    ctx.fillStyle = 'rgba(10, 26, 40, 0.82)';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(46, 111, 160, 0.9)';
    ctx.fillRect(0, mapY(198), S, S - mapY(198));
    ctx.fillStyle = 'rgba(232, 205, 140, 0.85)';
    ctx.fillRect(0, mapY(186), S, mapY(198) - mapY(186));
    ctx.fillStyle = 'rgba(38, 48, 60, 0.9)';
    ctx.fillRect(0, 0, S, mapY(186));
    // Road grid.
    ctx.strokeStyle = 'rgba(150, 160, 175, 0.55)';
    ctx.lineWidth = 2;
    for (let v = -180; v <= 180; v += 60) {
      ctx.beginPath(); ctx.moveTo(mapX(v), 0); ctx.lineTo(mapX(v), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, mapY(v)); ctx.lineTo(S, mapY(v)); ctx.stroke();
    }
    // Named places.
    for (const key of Object.keys(w.markers || {})) {
      const m = w.markers[key];
      if (!m) continue;
      ctx.fillStyle = MARKER_COLORS[key] || '#b8c4d0';
      ctx.fillRect(mapX(m.x) - 3, mapY(m.z) - 3, 6, 6);
    }
    // Objective beacon: a pulsing yellow diamond.
    const target = this.objectiveTarget(w);
    if (target) {
      const pulse = 5 + Math.sin((w.time || 0) * 5) * 1.6;
      this.diamond(ctx, mapX(target.x), mapY(target.z), pulse, '#ffd23e');
    }
    // Taxi client waiting for a ride, and the courier drop-off.
    if (w.taxi && w.taxi.phase === 'wait' && w.taxi.client) {
      this.diamond(ctx, mapX(w.taxi.client.pos.x), mapY(w.taxi.client.pos.z), 5, '#ffe14d');
    }
    const rideDest = this.jobDest(w, w.taxi && w.taxi.dest);
    if (rideDest) this.diamond(ctx, mapX(rideDest.x), mapY(rideDest.z), 5, '#ffe14d');
    const courierDest = this.jobDest(w, w.courier && w.courier.dest);
    if (courierDest) this.diamond(ctx, mapX(courierDest.x), mapY(courierDest.z), 5, '#ff9a3d');
    // Traffic, walkers, police, gang.
    this.dots(ctx, w.cars, 2.5, (c) => (c.isPolice ? '#5aa2ff' : '#e8ecf0'));
    this.dots(ctx, w.peds, 1.6, () => '#c8ccd2');
    this.dots(ctx, w.officers, 2.5, () => '#ff6b5e');
    this.dots(ctx, w.enemies, 2.5, () => '#ff3b30');
    // Cole: a white arrow rotated PI - heading, exactly as the
    // static arrowRotation() computes it.
    const cx = mapX(p.pos.x);
    const cy = mapY(p.pos.z);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(HUD.arrowRotation(p.heading));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  diamond(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  }

  dots(ctx, list, r, colorFor) {
    if (!list) return;
    for (const u of list) {
      if (!u || !u.pos) continue;
      ctx.fillStyle = colorFor(u);
      ctx.beginPath();
      ctx.arc(mapX(u.pos.x), mapY(u.pos.z), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Where the current objective points: the mission beacon if one is
  // set, otherwise the active mission's marker.
  objectiveTarget(w) {
    if (w.beaconTarget && typeof w.beaconTarget.x === 'number') return w.beaconTarget;
    if (w.beacon && typeof w.beacon.x === 'number') return w.beacon;
    return null;
  }

  // A side-job destination may be a marker key ({ key }) or a raw point.
  jobDest(w, dest) {
    if (!dest) return null;
    if (typeof dest.x === 'number' && typeof dest.z === 'number') return dest;
    if (dest.key && w.markers && w.markers[dest.key]) return w.markers[dest.key];
    return null;
  }
}
