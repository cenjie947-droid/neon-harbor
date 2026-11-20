// Neon Harbor — the HUD. It paints the health bar, the cash readout, the
// wanted stars, the current objective, the weapon and ammo, the speed and
// car-condition readouts while driving, the scrolling message feed, the
// red damage flash, and a live minimap that tracks Cole through the city.
//
// How the minimap arrow works, since it has pointed the wrong way before:
// the map is north-up, so world +x goes right and world -z (north) goes up,
// which puts world +z (south) at the bottom of the canvas. A heading is
// atan2 of the forward x and z, so heading 0 faces +z — straight down the
// map — and heading PI faces -z, straight up it. The arrow is drawn
// pointing up, tip at -y, so the canvas turn that aims its tip along the
// heading is PI minus the heading: at heading 0 it spins half a turn to
// point down (south), at heading PI it stays pointing up (north). Turning
// it by the bare heading would swap north and south.
import { WORLD, clamp } from './state.js';

const MAP_EDGE = 190;
const MAP_ZOOM = MAP_EDGE / 560;
const FEED_MAX = 4;
const FEED_LIFE_MS = 9000;
const DAMAGE_FLASH_MS = 220;

const PALETTE = {
  mapBack: '#0d1526',
  block: '#232a3a',
  road: '#3a3f4d',
  water: '#1d5f7a',
  sand: '#d9b98a',
  spray: '#4fa8ff',
  beacon: '#ffd23e',
  arrow: '#ffffff',
  arrowEdge: '#111111',
  trafficDot: '#e8e8e8',
  copDot: '#ff4444',
  officerDot: '#ff8888',
  pedDot: '#7dff9e',
  enemyDot: '#ff2222',
  fareDot: '#ffd23e',
  healthy: 'linear-gradient(90deg,#37d67a,#7dff9e)',
  hurt: 'linear-gradient(90deg,#f39c12,#ffd76a)',
  critical: 'linear-gradient(90deg,#e74c3c,#ff7a6a)',
  carOk: '#7dff9e',
  carWorn: '#ffd76a',
  carBad: '#ff7a6a',
  ring: 'rgba(255,255,255,.4)',
};

const HEALTH_BANDS = [
  { above: 50, fill: PALETTE.healthy },
  { above: 25, fill: PALETTE.hurt },
  { above: -1, fill: PALETTE.critical },
];

export class HUD {
  constructor(game) {
    this.game = game;
    const wanted = (id) => document.getElementById(id);
    this.el = {
      hud: wanted('hud'),
      healthBar: wanted('health-bar'),
      healthText: wanted('health-text'),
      cash: wanted('cash-text'),
      ammo: wanted('ammo'),
      ammoText: wanted('ammo-text'),
      stars: wanted('stars'),
      missionName: wanted('mission-name'),
      objective: wanted('objective'),
      crosshair: wanted('crosshair'),
      minimap: wanted('minimap'),
      speed: wanted('speed'),
      speedText: wanted('speed-text'),
      carHealth: wanted('car-health'),
      carHealthText: wanted('car-health-text'),
      feed: wanted('feed'),
      hint: wanted('hint'),
      vignette: wanted('vignette'),
      interact: wanted('interact'),
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
    const node = document.createElement('div');
    node.textContent = text;
    const feed = this.el.feed;
    feed.prepend(node);
    while (feed.childElementCount > FEED_MAX) feed.removeChild(feed.lastChild);
    setTimeout(() => node.parentNode && node.parentNode.removeChild(node), FEED_LIFE_MS);
  }

  showHint(text, seconds = 3) {
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  flashDamage() {
    const veil = this.el.vignette;
    veil.style.opacity = '1';
    setTimeout(() => {
      veil.style.opacity = '0';
    }, DAMAGE_FLASH_MS);
  }

  update(game, dt) {
    const cole = game.player;
    if (!cole) return;
    this.renderHealth(cole);
    this.el.cash.textContent = game.cash;
    this.renderStars(game.wanted);
    this.renderWeapon(cole);
    this.renderDrive(cole);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    this.renderMap(game);
  }

  renderHealth(cole) {
    const hp = clamp(cole.health, 0, 100);
    const band = HEALTH_BANDS.find((b) => hp > b.above);
    const bar = this.el.healthBar;
    bar.style.width = `${hp}%`;
    bar.style.background = band.fill;
    this.el.healthText.textContent = Math.ceil(cole.health);
  }

  renderStars(wanted) {
    const lit = '★';
    const dim = '<span class="off">★</span>';
    this.el.stars.innerHTML = Array.from({ length: 5 }, (_, i) => (i < wanted ? lit : dim)).join('');
  }

  renderWeapon(cole) {
    const aiming = cole.weapon === 'pistol' && !cole.car;
    this.el.ammo.classList.toggle('hidden', !aiming);
    this.el.crosshair.classList.toggle('hidden', !aiming);
    if (aiming) this.el.ammoText.textContent = cole.ammo;
  }

  // Speed while driving, plus the car's condition: green while healthy,
  // amber when dented, red when it is about to quit. Hidden on foot.
  renderDrive(cole) {
    const driving = !!cole.car;
    this.el.speed.classList.toggle('hidden', !driving);
    this.el.carHealth.classList.toggle('hidden', !driving);
    if (!driving) return;
    this.el.speedText.textContent = Math.round(Math.abs(cole.car.speed) * 2.2);
    const hp = Math.max(0, Math.round(cole.car.health));
    this.el.carHealthText.textContent = hp;
    const tone = hp > 60 ? PALETTE.carOk : hp > 30 ? PALETTE.carWorn : PALETTE.carBad;
    this.el.carHealth.style.color = tone;
  }

  renderMap(game) {
    const ctx = this.mapCtx;
    const edge = MAP_EDGE;
    const mid = edge / 2;
    const px = game.player.pos.x;
    const pz = game.player.pos.z;
    const project = (x, z) => ({ x: mid + (x - px) * MAP_ZOOM, y: mid + (z - pz) * MAP_ZOOM });
    const plot = (x, z, r, color) => {
      const at = project(x, z);
      if (at.x < -5 || at.x > edge + 5 || at.y < -5 || at.y > edge + 5) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.clearRect(0, 0, edge, edge);
    ctx.save();
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = PALETTE.mapBack;
    ctx.fillRect(0, 0, edge, edge);
    // City blocks first, then roads over them.
    ctx.fillStyle = PALETTE.block;
    for (let bx = 0; bx < 7; bx++) {
      for (let bz = 0; bz < 7; bz++) {
        const cz = -180 + bz * 60 + 30;
        if (cz > 150) continue;
        const corner = project(-180 + bx * 60 + 10, cz - 20);
        ctx.fillRect(corner.x, corner.y, 40 * MAP_ZOOM, 40 * MAP_ZOOM);
      }
    }
    ctx.strokeStyle = PALETTE.road;
    ctx.lineWidth = Math.max(2, WORLD.roadWidth * MAP_ZOOM);
    const roadRuns = [];
    for (const rx of game.roads.xs) roadRuns.push([project(rx, -240), project(rx, 240)]);
    for (const rz of game.roads.zs) roadRuns.push([project(-240, rz), project(240, rz)]);
    for (const [from, to] of roadRuns) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    // Water to the south, sand band above it.
    const waterAt = project(0, WORLD.waterZ);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, waterAt.y, edge, edge);
    const sandAt = project(0, WORLD.sandZ);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, sandAt.y, edge, waterAt.y - sandAt.y);
    // Pay N Spray: a blue square so the garage is findable on the map.
    if (game.markers.spray) {
      const at = project(game.markers.spray.x, game.markers.spray.z);
      ctx.fillStyle = PALETTE.spray;
      ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
    }
    this.drawObjectiveDiamond(ctx, project, game);
    this.drawMapDots(ctx, plot, game);
    this.drawPlayerArrow(ctx, mid, game);
    ctx.restore();
    ctx.strokeStyle = PALETTE.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Objective marker: a pulsing yellow diamond.
  drawObjectiveDiamond(ctx, project, game) {
    if (!game.beaconTarget) return;
    const at = project(game.beaconTarget.x, game.beaconTarget.z);
    const r = 7 + Math.sin(game.time * 5) * 2;
    const points = [
      [at.x, at.y - r],
      [at.x + r, at.y],
      [at.x, at.y + r],
      [at.x - r, at.y],
    ];
    ctx.fillStyle = PALETTE.beacon;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawMapDots(ctx, plot, game) {
    const groups = [
      [game.traffic, 2.5, PALETTE.trafficDot],
      [game.policeCars, 3.5, PALETTE.copDot],
      [game.officers, 2.5, PALETTE.officerDot],
      [game.peds, 1.8, PALETTE.pedDot],
      [game.enemies, 3, PALETTE.enemyDot],
    ];
    groups.forEach(([list, r, color]) => {
      list.forEach((obj) => plot(obj.pos.x, obj.pos.z, r, color));
    });
    // The waiting taxi fare, if any, shows as a yellow dot.
    if (game.taxi && game.taxi.client) {
      plot(game.taxi.client.pos.x, game.taxi.client.pos.z, 3.5, PALETTE.fareDot);
    }
  }

  // Player arrow, centred, pointing along the heading (see the note at
  // the top of this file for why the rotation is PI - heading).
  drawPlayerArrow(ctx, mid, game) {
    const heading = game.player.car ? game.player.car.heading : game.player.heading;
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(HUD.arrowRotation(heading));
    ctx.fillStyle = PALETTE.arrow;
    ctx.strokeStyle = PALETTE.arrowEdge;
    ctx.lineWidth = 1.5;
    const outline = [
      [0, -8],
      [5.5, 6],
      [0, 3],
      [-5.5, 6],
    ];
    ctx.beginPath();
    outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', mid, 12);
  }
}
