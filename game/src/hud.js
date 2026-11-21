// Neon Harbor — HUD: health, cash, stars, weapon, speed, and the live
// minimap. Every number on screen is drawn from the same game state the
// world simulates, so the HUD can never disagree with the game: the
// mission card's reward and total, the star count, the speedometer and
// the car-condition label all read the live fields at render time.
//
// The minimap is north-up and covers the whole city. The player arrow
// is rotated PI − heading — north on the map is −Z in world space, so
// an arrow drawn pointing up the canvas at heading 0 must be turned
// around. The driver asserts that exact formula, so it lives in one
// static method and nowhere else.
const MAP_HALF = 220; // world units shown from the map centre to an edge
const MAP_SIZE = 190;

function el(id) {
  return document.getElementById(id);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.hintTimer = 0;
    this.feedLines = [];
    this.mapPulse = 0;
    this.lastCash = -1;
    this.lastStars = -1;
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
    this.mapCanvas = el('minimap');
    this.mapCtx = this.mapCanvas ? this.mapCanvas.getContext('2d') : null;
    this.speedBox = el('speed');
    this.speedText = el('speed-text');
    this.carHealthBox = el('car-health');
    this.carHealthText = el('car-health-text');
    this.feed = el('feed');
    this.hintBox = el('hint');
    this.vignette = el('vignette');
    this.interactBox = el('interact');
  }

  // North-up map: an arrow drawn pointing up the canvas must be rotated
  // by PI − heading so that it matches the car's world heading.
  static arrowRotation(h) {
    return Math.PI - h;
  }

  state(w) {
    return w ?? this.game;
  }

  show() {
    this.root?.classList.remove('hidden');
  }

  hide() {
    this.root?.classList.add('hidden');
  }

  setMissionName(text) {
    if (this.missionNameBox) this.missionNameBox.textContent = text ?? '';
  }

  setObjective(text) {
    if (this.objectiveBox) this.objectiveBox.textContent = text ?? '';
  }

  // A one-line feed message. Newest at the bottom, old lines fade out
  // after a few seconds so the feed never covers the action.
  showMessage(text) {
    if (!this.feed || !text) return;
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = text;
    this.feed.appendChild(line);
    this.feedLines.push({ node: line, life: 5 });
    while (this.feedLines.length > 4) {
      const old = this.feedLines.shift();
      old.node.remove();
    }
  }

  // A centred hint that stays up for a fixed number of seconds, e.g.
  // the steal prompt or the Pay N Spray prompt.
  showHint(text, seconds = 3) {
    if (!this.hintBox) return;
    if (!text) {
      this.hintBox.textContent = '';
      this.hintBox.classList.add('hidden');
      this.hintTimer = 0;
      return;
    }
    this.hintBox.textContent = text;
    this.hintBox.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  // Red flash round the screen edge when Cole takes a hit.
  flashDamage() {
    if (!this.vignette) return;
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth; // restart the CSS animation
    this.vignette.classList.add('flash');
  }

  // The small "Press E" prompt over the crosshair area.
  showInteract(text) {
    if (!this.interactBox) return;
    if (!text) {
      this.interactBox.classList.add('hidden');
      return;
    }
    this.interactBox.textContent = text;
    this.interactBox.classList.remove('hidden');
  }

  hideInteract() {
    this.showInteract(null);
  }

  // -- readouts ---------------------------------------------------------
  renderHealth(hero) {
    const hp = clamp(Math.round(hero?.health ?? 100), 0, 100);
    if (this.healthBar) {
      this.healthBar.style.width = `${hp}%`;
      this.healthBar.style.background =
        hp > 50 ? '#37d67a' : hp > 25 ? '#ffb02e' : '#ff4d4d';
    }
    if (this.healthText) this.healthText.textContent = String(hp);
  }

  renderCash(cash) {
    const value = Math.round(cash ?? 0);
    if (value === this.lastCash) return;
    this.lastCash = value;
    if (this.cashText) this.cashText.textContent = String(value);
  }

  renderStars(wanted) {
    const stars = clamp(Math.round(wanted ?? 0), 0, 5);
    if (stars === this.lastStars) return;
    this.lastStars = stars;
    if (!this.starsBox) return;
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += `<span class="star${i < stars ? ' lit' : ''}">★</span>`;
    }
    this.starsBox.innerHTML = html;
  }

  renderWeapon(hero) {
    if (!hero) return;
    const isPistol = hero.weapon === 'pistol';
    if (this.ammoBox) {
      this.ammoBox.classList.toggle('hidden', !isPistol);
      if (isPistol && this.ammoText) this.ammoText.textContent = String(hero.ammo ?? 0);
    }
    if (this.crosshair) this.crosshair.classList.toggle('hidden', !isPistol);
  }

  // Speedometer plus the driven car's condition. The tiers match the
  // damage model: full health is perfect, under 60 is dented, under 35
  // smokes, at 0 it will not move.
  renderDrive(hero) {
    const car = hero?.car;
    const driving = !!car;
    if (this.speedBox) this.speedBox.classList.toggle('hidden', !driving);
    if (this.carHealthBox) this.carHealthBox.classList.toggle('hidden', !driving);
    if (!driving) return;
    const mph = Math.round(Math.abs(car.speed ?? 0) * 2.237);
    if (this.speedText) this.speedText.textContent = String(mph);
    const hp = Math.round(car.health ?? 100);
    let label = 'PERFECT';
    if (hp <= 0) label = 'DISABLED';
    else if (hp < 35) label = 'SMOKING';
    else if (hp < 60) label = 'DAMAGED';
    else if (hp < 100) label = 'DENTED';
    if (this.carHealthText) {
      this.carHealthText.textContent = `${hp}% ${label}`;
      this.carHealthText.style.color =
        hp <= 0 ? '#ff4d4d' : hp < 35 ? '#ff8a3c' : hp < 60 ? '#ffb02e' : '#37d67a';
    }
  }

  // -- minimap ----------------------------------------------------------
  toMap(x, z) {
    const s = MAP_SIZE / (MAP_HALF * 2);
    return [(x + MAP_HALF) * s, (z + MAP_HALF) * s];
  }

  drawDot(x, z, r, color) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const [mx, my] = this.toMap(x, z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawDiamond(x, z, r, color, filled = true) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const [mx, my] = this.toMap(x, z);
    ctx.beginPath();
    ctx.moveTo(mx, my - r);
    ctx.lineTo(mx + r, my);
    ctx.lineTo(mx, my + r);
    ctx.lineTo(mx - r, my);
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawSquare(x, z, half, color) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const [mx, my] = this.toMap(x, z);
    ctx.fillStyle = color;
    ctx.fillRect(mx - half, my - half, half * 2, half * 2);
  }

  // Where the current job wants Cole to go. Missions, taxi and courier
  // each publish their target under a different field, so check them
  // in priority order and draw the first one that exists.
  objectiveTarget(w) {
    if (!w) return null;
    const direct = w.objectiveTarget ?? w.missionTarget ?? w.target;
    if (direct && Number.isFinite(direct.x) && Number.isFinite(direct.z)) return direct;
    const missions = w.missions;
    const fromMissions = missions?.target ?? missions?.objectiveTarget;
    if (fromMissions && Number.isFinite(fromMissions.x)) return fromMissions;
    const taxi = w.taxi;
    if (taxi?.phase === 'ride' && taxi.dest) {
      const m = w.markers?.[taxi.dest.key ?? taxi.dest];
      if (m) return m;
      if (Number.isFinite(taxi.dest.x)) return taxi.dest;
    }
    if (taxi?.phase === 'wait' && taxi.client) return taxi.client.pos;
    const courier = w.courier;
    if (courier?.phase === 'deliver' && courier.dest) {
      if (Number.isFinite(courier.dest.x)) return courier.dest;
      const m = w.markers?.[courier.dest.key ?? courier.dest];
      if (m) return m;
    }
    if (courier?.phase === 'none' && typeof missions?.dispatcher === 'function') {
      const d = missions.dispatcher(w);
      if (d && Number.isFinite(d.x)) return { x: d.x, z: d.z };
    }
    return null;
  }

  renderMap(w) {
    const ctx = this.mapCtx;
    const s = this.state(w);
    if (!ctx || !s) return;
    const hero = s.player;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Sea-dark background with a faint street grid so the map reads as
    // a city even before any dots appear.
    ctx.fillStyle = 'rgba(8, 18, 30, 0.82)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.strokeStyle = 'rgba(120, 160, 200, 0.16)';
    ctx.lineWidth = 1;
    for (const g of [-180, -120, -60, 0, 60, 120, 180]) {
      const [gx] = this.toMap(g, 0);
      const [, gy] = this.toMap(0, g);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, MAP_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(MAP_SIZE, gy);
      ctx.stroke();
    }
    // Named places: garage and spray shop matter most, so they get
    // bigger, brighter squares.
    const markers = s.markers ?? {};
    const markerColors = {
      bank: '#ffd75e',
      beach: '#7fd4ff',
      docks: '#c9a06a',
      garage: '#37d67a',
      hideout: '#b388ff',
      hospital: '#ff6b81',
      paintShop: '#ffb02e',
      showroom: '#ff8ad8',
      spray: '#35c4ff',
      warehouse: '#9aa5b1',
    };
    for (const [key, m] of Object.entries(markers)) {
      if (!m || !Number.isFinite(m.x)) continue;
      const big = key === 'spray' || key === 'garage' || key === 'paintShop';
      this.drawSquare(m.x, m.z, big ? 4 : 3, markerColors[key] ?? '#ffffff');
    }
    // Pedestrians as faint grey dots, traffic as white, police as red.
    for (const p of s.peds ?? []) {
      if (p.state === 'down') continue;
      this.drawDot(p.pos.x, p.pos.z, 1.2, 'rgba(200, 205, 215, 0.75)');
    }
    for (const c of s.cars ?? []) {
      if (c === hero?.car) continue;
      this.drawDot(c.pos.x, c.pos.z, 2, c.isPolice ? '#ff4d4d' : '#f2f2f2');
    }
    for (const u of s.policeCars ?? []) this.drawDot(u.pos.x, u.pos.z, 2.6, '#ff4d4d');
    for (const o of s.officers ?? []) this.drawDot(o.pos.x, o.pos.z, 2, '#ff8a5c');
    // Taxi client: yellow diamond. Courier dispatcher / drop-off: purple.
    const taxi = s.taxi;
    if (taxi?.phase === 'wait' && taxi.client) {
      this.drawDiamond(taxi.client.pos.x, taxi.client.pos.z, 5, '#ffd75e');
    }
    const courier = s.courier;
    if (courier?.phase === 'none' && typeof s.missions?.dispatcher === 'function') {
      const d = s.missions.dispatcher(s);
      if (d) this.drawDiamond(d.x, d.z, 5, '#c07bff');
    }
    if (courier?.phase === 'deliver' && courier.dest) {
      const d = Number.isFinite(courier.dest.x) ? courier.dest : s.markers?.[courier.dest.key];
      if (d) this.drawDiamond(d.x, d.z, 5, '#c07bff');
    }
    // Objective: a pulsing diamond that is impossible to miss.
    const target = this.objectiveTarget(s);
    if (target) {
      const pulse = 5 + Math.sin(this.mapPulse * 4) * 1.6;
      this.drawDiamond(target.x, target.z, pulse, '#ffd75e', false);
      this.drawDiamond(target.x, target.z, 3.4, '#ffd75e');
    }
    // The player arrow, last so it sits on top of everything.
    if (hero) {
      const [mx, my] = this.toMap(hero.pos.x, hero.pos.z);
      const rot = HUD.arrowRotation(hero.heading ?? 0);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(rot);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // -- per-frame --------------------------------------------------------
  update(w, dt) {
    const s = this.state(w);
    if (!s) return;
    this.mapPulse += dt;
    const hero = s.player;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.hintBox) {
        this.hintBox.textContent = '';
        this.hintBox.classList.add('hidden');
      }
    }
    for (let i = this.feedLines.length - 1; i >= 0; i--) {
      const line = this.feedLines[i];
      line.life -= dt;
      if (line.life <= 0) {
        line.node.remove();
        this.feedLines.splice(i, 1);
      } else if (line.life < 1) {
        line.node.style.opacity = String(line.life);
      }
    }
    if (hero) {
      this.renderHealth(hero);
      this.renderWeapon(hero);
      this.renderDrive(hero);
    }
    this.renderCash(s.cash ?? s.player?.cash ?? 0);
    this.renderStars(s.wanted ?? s.police?.stars ?? 0);
    this.renderMap(s);
  }
}
