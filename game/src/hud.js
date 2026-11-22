// hud.js — every pixel of the Neon Harbor HUD and every screen.
//
// The HUD owns the DOM: health, cash, ammo, wanted stars, mission name,
// objective, timer, speed, car condition, the feed, the hint line, the
// minimap, the damage flash, the interact prompt, and the title / pause /
// mission-complete / busted / wasted / ending / briefing screens.
//
// Other modules talk to the HUD through small setter methods (setObjective,
// feed, setTimer, setInteract, ...). The game loop calls update(dt) once a
// frame; update() pulls the live numbers out of G and repaints. Buttons on
// the screens dispatch to handlers the entry program registers with on()
// or bindButtons() — the HUD never assumes it knows how to start a
// mission, it just reports that the button was pressed.
//
// Minimap rule (verified, do not change): the map is north-up and the
// player arrow rotates by PI minus the heading, so a car pointing north
// draws an arrow pointing up.

const WORLD_EXTENT = 235; // half-width of the mapped world, in metres
const FEED_KEEP = 5;
const RACE_START = { x: 30, z: 180 }; // checkered start pad, harbour straight

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function el(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

export class HUD {
  constructor(G, handlers) {
    this.G = G || {};
    this.handlers = {};
    if (handlers) {
      for (const key of Object.keys(handlers)) this.handlers[key] = handlers[key];
    }
    // Button callbacks the entry program may set directly.
    this.onStart = null;
    this.onContinue = null;
    this.onResume = null;
    this.onRestartMission = null;
    this.onSave = null;
    this.onQuitTitle = null;
    this.onMissionOk = null;
    this.onBusted = null;
    this.onWasted = null;
    this.onEnding = null;
    this.onBriefing = null;

    this._objective = '';
    this._missionName = '';
    this._timer = null; // seconds left, or null when no timer runs
    this._feed = [];
    this._hint = '';
    this._interact = null;
    this._flash = 0; // damage flash strength 0..1
    this._raceLine = '';
    this._lastStars = -1;

    // Grab every element the page contract promises.
    this.e = {};
    const ids = [
      'app', 'scene', 'hud', 'hud-top-left', 'health-wrap', 'health-bar',
      'health-text', 'cash', 'cash-text', 'ammo', 'ammo-text',
      'hud-top-right', 'stars', 'mission-name', 'objective', 'crosshair',
      'minimap', 'speed', 'speed-text', 'car-health', 'car-health-text',
      'feed', 'hint', 'vignette', 'interact', 'title-screen', 'btn-start',
      'btn-continue', 'pause-menu', 'btn-resume', 'btn-restart-mission',
      'btn-save', 'btn-quit-title', 'pause-save-note', 'mission-panel',
      'mission-panel-title', 'mission-panel-text', 'mission-panel-reward',
      'btn-mission-ok', 'busted-screen', 'btn-busted', 'wasted-screen',
      'btn-wasted', 'ending-screen', 'ending-stats', 'btn-ending',
      'briefing', 'briefing-title', 'briefing-text', 'btn-briefing',
      'race-status',
    ];
    for (const id of ids) this.e[id] = el(id);

    // The minimap canvas needs a fixed backing size to draw crisply.
    if (this.e['minimap']) {
      if (!this.e['minimap'].width) this.e['minimap'].width = 176;
      if (!this.e['minimap'].height) this.e['minimap'].height = 176;
      this._mapCtx = this.e['minimap'].getContext('2d');
    } else {
      this._mapCtx = null;
    }

    this._wireButtons();
    this.showTitle();
  }

  // The driver (and the north-up contract) depends on this exact mapping.
  static arrowRotation(heading) {
    return Math.PI - heading;
  }

  // -- button wiring ---------------------------------------------------------

  _wireButtons() {
    const pairs = [
      ['btn-start', 'start'],
      ['btn-continue', 'continue'],
      ['btn-resume', 'resume'],
      ['btn-restart-mission', 'restartMission'],
      ['btn-save', 'save'],
      ['btn-quit-title', 'quitTitle'],
      ['btn-mission-ok', 'missionOk'],
      ['btn-busted', 'busted'],
      ['btn-wasted', 'wasted'],
      ['btn-ending', 'ending'],
      ['btn-briefing', 'briefing'],
    ];
    for (const [id, action] of pairs) {
      const button = this.e[id];
      if (!button) continue;
      button.addEventListener('click', () => this._press(action));
    }
  }

  // Register a handler: hud.on('start', () => game.start()).
  on(action, fn) {
    this.handlers[action] = fn;
    return this;
  }

  bindButtons(handlers) {
    if (!handlers) return this;
    for (const key of Object.keys(handlers)) this.handlers[key] = handlers[key];
    return this;
  }

  _press(action) {
    const prop = 'on' + action.charAt(0).toUpperCase() + action.slice(1);
    const fn = this.handlers[action] || this[prop];
    if (typeof fn === 'function') {
      try { fn(); } catch (err) { /* a handler error must not kill the HUD */ }
      return;
    }
    // No handler registered: do the obvious local thing so the screen
    // never dead-ends, and try the shared-state fallbacks.
    this._fallback(action);
  }

  _fallback(action) {
    const G = this.G;
    if (action === 'missionOk') this.hideMissionPanel();
    if (action === 'briefing') this.hideBriefing();
    if (action === 'busted' || action === 'wasted') {
      this.hideScreens(['busted-screen', 'wasted-screen']);
    }
    if (action === 'save') {
      const saver = G.save || G.saver;
      try {
        if (saver && typeof saver.save === 'function') saver.save(G);
        else if (saver && typeof saver.saveGame === 'function') saver.saveGame(G);
      } catch (err) { /* ignore */ }
    }
    if (action === 'start') {
      try {
        if (typeof G.startGame === 'function') G.startGame();
        else if (typeof window !== 'undefined' && window.__game && typeof window.__game.start === 'function') window.__game.start();
      } catch (err) { /* ignore */ }
    }
    if (action === 'continue') {
      try {
        if (typeof G.continueGame === 'function') G.continueGame();
        else if (typeof window !== 'undefined' && window.__game && typeof window.__game.continue === 'function') window.__game.continue();
      } catch (err) { /* ignore */ }
    }
    if (action === 'resume') {
      try {
        if (typeof G.resumeGame === 'function') G.resumeGame();
        else if (typeof window !== 'undefined' && window.__game && typeof window.__game.resume === 'function') window.__game.resume();
      } catch (err) { /* ignore */ }
    }
  }

  // -- readouts the loop refreshes --------------------------------------------

  _wanted() {
    const G = this.G;
    if (G.police && typeof G.police.stars === 'number') return G.police.stars;
    if (typeof G.wanted === 'number') return G.wanted;
    if (G.police && typeof G.police.wanted === 'number') return G.police.wanted;
    return 0;
  }

  _race() {
    const G = this.G;
    return G.race || G.raceJob || (G.missions && G.missions.race) || null;
  }

  _heli() {
    const G = this.G;
    if (G.police && G.police.heli) return G.police.heli;
    return G.heli || null;
  }

  _heading() {
    const player = this.G.player;
    if (!player) return 0;
    if (player.car && typeof player.car.heading === 'number') return player.car.heading;
    return player.heading || 0;
  }

  update(dt) {
    const G = this.G;
    const player = G.player || {};
    const step = typeof dt === 'number' ? dt : 0.016;

    // Health.
    const health = clamp(typeof player.health === 'number' ? player.health : 100, 0, 100);
    if (this.e['health-bar']) this.e['health-bar'].style.width = health + '%';
    if (this.e['health-text']) this.e['health-text'].textContent = String(Math.round(health));
    if (this.e['health-bar']) {
      this.e['health-bar'].style.background = health > 55 ? '#37d67a' : health > 25 ? '#ffb02e' : '#ff4d4d';
    }

    // Cash and ammo.
    if (this.e['cash-text']) this.e['cash-text'].textContent = '$' + Math.round(G.cash || 0);
    const ammo = player.weapon === 'pistol' ? (player.ammo || 0) : null;
    if (this.e['ammo-text']) this.e['ammo-text'].textContent = ammo === null ? '—' : String(ammo);
    if (this.e['ammo']) this.e['ammo'].style.display = player.weapon === 'pistol' ? '' : 'none';

    // Wanted stars.
    const stars = clamp(Math.round(this._wanted()), 0, 5);
    if (this.e['stars'] && stars !== this._lastStars) {
      this._lastStars = stars;
      this.e['stars'].textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    }

    // Mission name and objective (+ timer line).
    if (this.e['mission-name'] && this.e['mission-name'].textContent !== this._missionName) {
      this.e['mission-name'].textContent = this._missionName;
    }
    this._renderObjective();

    // Speed and car condition.
    const car = player.car;
    if (car) {
      const mph = Math.abs(car.speed || 0) * 2.237;
      if (this.e['speed-text']) this.e['speed-text'].textContent = Math.round(mph) + ' mph';
      if (this.e['car-health-text']) this.e['car-health-text'].textContent = Math.round(car.health ?? 100) + '%';
      if (this.e['speed']) this.e['speed'].style.display = '';
      if (this.e['car-health']) this.e['car-health'].style.display = '';
    } else {
      if (this.e['speed-text']) this.e['speed-text'].textContent = '0 mph';
      if (this.e['car-health-text']) this.e['car-health-text'].textContent = '—';
      if (this.e['speed']) this.e['speed'].style.display = 'none';
      if (this.e['car-health']) this.e['car-health'].style.display = 'none';
    }

    // Race status line.
    this._renderRace();

    // Crosshair: only on foot, only while playing.
    if (this.e['crosshair']) {
      const playing = !G.mode || G.mode === 'playing';
      this.e['crosshair'].style.display = playing && !car ? '' : 'none';
    }

    // Damage flash decay + low-health heartbeat on the vignette.
    if (this._flash > 0) this._flash = Math.max(0, this._flash - step * 2.2);
    if (this.e['vignette']) {
      const low = health < 30 ? 0.25 + 0.15 * Math.sin((G.time || 0) * 5) : 0;
      const strength = Math.max(this._flash * 0.55, low);
      this.e['vignette'].style.opacity = String(clamp(strength, 0, 0.85));
    }

    this._drawMinimap();
  }

  render(dt) { this.update(dt); }
  refresh() { this.update(0.016); }
  draw(dt) { this.update(dt); }

  _renderObjective() {
    const node = this.e['objective'];
    if (!node) return;
    let text = this._objective;
    if (this._timer !== null && this._timer !== undefined && this._timer > 0) {
      text += (text ? '\n' : '') + Math.ceil(this._timer) + 's left';
    }
    if (node.textContent !== text) node.textContent = text;
  }

  _renderRace() {
    const node = this.e['race-status'];
    if (!node) return;
    const race = this._race();
    let line = '';
    if (race) {
      if (race.phase === 'countdown') {
        line = 'Race starting… get ready!';
      } else if (race.phase === 'run') {
        const total = race.totalGates || (Array.isArray(race.gates) ? race.gates.length : 0) || 3;
        const gate = (typeof race.gate === 'number' ? race.gate : 0) + 1;
        const secs = typeof race.timer === 'number' ? Math.ceil(race.timer) : 0;
        line = 'RACE  Gate ' + gate + '/' + total + '  ·  ' + secs + 's left';
      } else if (race.phase === 'done' || race.phase === 'finished') {
        line = 'Race finished!';
      }
    }
    if (line !== this._raceLine) {
      this._raceLine = line;
      node.textContent = line;
      node.style.display = line ? '' : 'none';
    }
  }

  // -- setters other modules call ----------------------------------------------

  setObjective(text) {
    this._objective = text || '';
    this._renderObjective();
    return this;
  }
  showObjective(text) { return this.setObjective(text); }
  objective(text) { return this.setObjective(text); }

  setMissionName(name) {
    this._missionName = name || '';
    if (this.e['mission-name']) this.e['mission-name'].textContent = this._missionName;
    return this;
  }
  setMission(name) { return this.setMissionName(name); }
  missionName(name) { return this.setMissionName(name); }

  setTimer(seconds) {
    this._timer = (seconds === null || seconds === undefined) ? null : seconds;
    this._renderObjective();
    return this;
  }
  showTimer(seconds) { return this.setTimer(seconds); }
  timer(seconds) { return this.setTimer(seconds); }
  clearTimer() { return this.setTimer(null); }

  feed(text) {
    if (!text) return this;
    this._feed.push(String(text));
    while (this._feed.length > FEED_KEEP) this._feed.shift();
    const node = this.e['feed'];
    if (node) node.textContent = this._feed.join('\n');
    return this;
  }
  addFeed(text) { return this.feed(text); }
  showFeed(text) { return this.feed(text); }
  message(text) { return this.feed(text); }
  pushFeed(text) { return this.feed(text); }

  hint(text) {
    this._hint = text || '';
    const node = this.e['hint'];
    if (node) {
      node.textContent = this._hint;
      node.style.display = this._hint ? '' : 'none';
    }
    return this;
  }
  setHint(text) { return this.hint(text); }
  showHint(text) { return this.hint(text); }
  clearHint() { return this.hint(''); }

  setInteract(text) {
    this._interact = text || null;
    const node = this.e['interact'];
    if (node) {
      node.textContent = this._interact || '';
      node.style.display = this._interact ? '' : 'none';
    }
    return this;
  }
  showInteract(text) { return this.setInteract(text); }
  hideInteract() { return this.setInteract(null); }

  flashDamage() {
    this._flash = 1;
    return this;
  }
  damageFlash() { return this.flashDamage(); }

  setCash(amount) {
    this.G.cash = amount;
    if (this.e['cash-text']) this.e['cash-text'].textContent = '$' + Math.round(amount || 0);
    return this;
  }

  setHealth(amount) {
    if (this.G.player) this.G.player.health = amount;
    return this;
  }

  setAmmo(amount) {
    if (this.G.player) this.G.player.ammo = amount;
    return this;
  }

  setStars(count) {
    if (this.G.police) this.G.police.stars = count;
    else this.G.wanted = count;
    this._lastStars = -1;
    return this;
  }

  setRaceStatus(line) {
    this._raceLine = null;
    const node = this.e['race-status'];
    if (node) {
      node.textContent = line || '';
      node.style.display = line ? '' : 'none';
    }
    return this;
  }
  showRaceStatus(line) { return this.setRaceStatus(line); }

  // -- screens -------------------------------------------------------------------

  _show(id) {
    const node = this.e[id];
    if (node) node.classList.remove('hidden');
  }
  _hide(id) {
    const node = this.e[id];
    if (node) node.classList.add('hidden');
  }

  hideScreens(ids) {
    for (const id of ids) this._hide(id);
    return this;
  }

  hideAllScreens() {
    return this.hideScreens([
      'title-screen', 'pause-menu', 'mission-panel', 'busted-screen',
      'wasted-screen', 'ending-screen', 'briefing',
    ]);
  }

  showTitle() {
    this.hideAllScreens();
    this._show('title-screen');
    if (this.e['hud']) this.e['hud'].classList.add('hidden');
    const hasSave = this.G.save && typeof this.G.save.hasSave === 'function'
      ? this.G.save.hasSave()
      : (typeof localStorage !== 'undefined' && !!localStorage.getItem('neon-harbor-save-v1'));
    if (this.e['btn-continue']) {
      this.e['btn-continue'].classList.toggle('hidden', !hasSave);
    }
    return this;
  }

  showHud() {
    if (this.e['hud']) this.e['hud'].classList.remove('hidden');
    return this;
  }

  hideHud() {
    if (this.e['hud']) this.e['hud'].classList.add('hidden');
    return this;
  }

  showPause() {
    this._show('pause-menu');
    return this;
  }
  hidePause() {
    this._hide('pause-menu');
    return this;
  }

  showMissionPanel(data) {
    const info = data || {};
    const reward = info.reward !== undefined ? info.reward : 0;
    const total = info.total !== undefined ? info.total : (this.G.cash || 0);
    if (this.e['mission-panel-title']) {
      this.e['mission-panel-title'].textContent = info.title || 'Mission Complete';
    }
    if (this.e['mission-panel-text']) {
      this.e['mission-panel-text'].textContent = info.text || '';
    }
    if (this.e['mission-panel-reward']) {
      // One element, both numbers, read from the same ledger at the
      // same moment — the reward and the total can never disagree.
      this.e['mission-panel-reward'].textContent =
        'Reward $' + Math.round(reward) + '   Total cash $' + Math.round(total);
    }
    this._show('mission-panel');
    return this;
  }
  showMissionComplete(reward, total, title, text) {
    return this.showMissionPanel({ reward, total, title, text });
  }
  hideMissionPanel() {
    this._hide('mission-panel');
    return this;
  }

  showBusted() {
    this.hideAllScreens();
    this._show('busted-screen');
    return this;
  }
  showWasted() {
    this.hideAllScreens();
    this._show('wasted-screen');
    return this;
  }

  showEnding(statsText) {
    this.hideAllScreens();
    if (this.e['ending-stats'] && statsText !== undefined) {
      this.e['ending-stats'].textContent = statsText;
    }
    this._show('ending-screen');
    return this;
  }

  showBriefing(title, text) {
    if (this.e['briefing-title']) this.e['briefing-title'].textContent = title || 'Briefing';
    if (this.e['briefing-text']) this.e['briefing-text'].textContent = text || '';
    this._show('briefing');
    return this;
  }
  hideBriefing() {
    this._hide('briefing');
    return this;
  }

  setSaveNote(text) {
    if (this.e['pause-save-note']) this.e['pause-save-note'].textContent = text || '';
    return this;
  }

  // -- minimap ---------------------------------------------------------------------

  _toMap(x, z, size) {
    const half = size / 2;
    return [
      half + (x / WORLD_EXTENT) * half,
      half + (z / WORLD_EXTENT) * half,
    ];
  }

  _drawMinimap() {
    const ctx = this._mapCtx;
    const canvas = this.e['minimap'];
    if (!ctx || !canvas) return;
    const G = this.G;
    const size = canvas.width;
    const half = size / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(8, 18, 30, 0.88)';
    ctx.fillRect(0, 0, size, size);

    // Streets: a regular grid, matching the road layout.
    ctx.strokeStyle = 'rgba(120, 140, 160, 0.5)';
    ctx.lineWidth = 1;
    const roads = [-180, -120, -60, 0, 60, 120, 180];
    for (const r of roads) {
      const [mx] = this._toMap(r, 0, size);
      const [, mz] = this._toMap(0, r, size);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, mz); ctx.lineTo(size, mz); ctx.stroke();
    }

    // Water along the east edge.
    ctx.fillStyle = 'rgba(40, 110, 160, 0.55)';
    const [waterX] = this._toMap(205, 0, size);
    ctx.fillRect(waterX, 0, size - waterX, size);

    const dot = (x, z, color, radius) => {
      const [mx, mz] = this._toMap(x, z, size);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, mz, radius, 0, Math.PI * 2); ctx.fill();
    };

    // Pay N Spray: a blue square.
    if (G.markers && G.markers.spray) {
      const [mx, mz] = this._toMap(G.markers.spray.x, G.markers.spray.z, size);
      ctx.fillStyle = '#3aa0ff';
      ctx.fillRect(mx - 4, mz - 4, 8, 8);
    }

    // Mission / job markers from the markers table.
    if (G.markers) {
      for (const key of Object.keys(G.markers)) {
        if (key === 'spray') continue;
        const m = G.markers[key];
        if (!m) continue;
        // Only the active destination gets a gold diamond; the rest stay
        // quiet grey dots so the map never turns into confetti.
        const active = G.activeMarker === key ||
          (G.missions && G.missions.destinationKey === key);
        if (active) {
          const [mx, mz] = this._toMap(m.x, m.z, size);
          ctx.fillStyle = '#ffd23e';
          ctx.beginPath();
          ctx.moveTo(mx, mz - 6); ctx.lineTo(mx + 6, mz);
          ctx.lineTo(mx, mz + 6); ctx.lineTo(mx - 6, mz);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    // Street race: checkered start pad, then a ring on the next gate.
    {
      const [sx, sz] = this._toMap(RACE_START.x, RACE_START.z, size);
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#111111';
          ctx.fillRect(sx - 5 + i * 5, sz - 5 + j * 5, 5, 5);
        }
      }
      const race = this._race();
      const nextGate = race && (race.nextGate || (Array.isArray(race.gates) ? race.gates[race.gate || 0] : null));
      if (race && race.phase === 'run' && nextGate) {
        const [gx, gz] = this._toMap(nextGate.x, nextGate.z, size);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(gx, gz, 7, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Taxi client waiting for a ride: a yellow diamond.
    if (G.taxi && G.taxi.phase === 'wait' && G.taxi.client) {
      const [mx, mz] = this._toMap(G.taxi.client.pos.x, G.taxi.client.pos.z, size);
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.moveTo(mx, mz - 5); ctx.lineTo(mx + 5, mz);
      ctx.lineTo(mx, mz + 5); ctx.lineTo(mx - 5, mz);
      ctx.closePath(); ctx.fill();
    }

    // Courier drop-off: a green diamond.
    if (G.courier && G.courier.phase === 'deliver' && G.courier.dropPos) {
      const [mx, mz] = this._toMap(G.courier.dropPos.x, G.courier.dropPos.z, size);
      ctx.fillStyle = '#37d67a';
      ctx.beginPath();
      ctx.moveTo(mx, mz - 5); ctx.lineTo(mx + 5, mz);
      ctx.lineTo(mx, mz + 5); ctx.lineTo(mx - 5, mz);
      ctx.closePath(); ctx.fill();
    }

    // Police cruisers: small blue dots. The helicopter: a red dot + ring.
    if (Array.isArray(G.policeCars)) {
      for (const cruiser of G.policeCars) {
        if (cruiser && cruiser.pos) dot(cruiser.pos.x, cruiser.pos.z, '#7fb8ff', 2.5);
      }
    }
    const heli = this._heli();
    if (heli && heli.pos) {
      const [hx, hz] = this._toMap(heli.pos.x, heli.pos.z, size);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(hx, hz, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, hz, 8, 0, Math.PI * 2); ctx.stroke();
    }

    // Player arrow, north-up: rotation is PI minus the heading.
    const player = G.player;
    if (player && player.pos) {
      const [px, pz] = this._toMap(player.pos.x, player.pos.z, size);
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(HUD.arrowRotation(this._heading()));
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // Compass tick: north is up, always.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('N', half - 3, 11);
  }
}

export { HUD as Hud };
export default HUD;
