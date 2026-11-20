// Neon Harbor — the HUD. It paints the health bar, the cash readout,
// the wanted stars, the current objective, the weapon and ammo, the
// speed and car-condition readouts while driving, the scrolling message
// feed, the red damage flash, and a live minimap that tracks Cole
// through the city.
//
// How the minimap arrow works, since it has pointed the wrong way
// before: the map is north-up, so world +x goes right and world -z
// (north) goes up, which puts world +z (south) at the bottom of the
// canvas. A heading is atan2 of the forward x and z, so heading 0
// faces +z — straight down the map — and heading PI faces -z, straight
// up it. The arrow is drawn pointing up, tip at -y, so the canvas turn
// that aims its tip along the heading is PI minus the heading: at
// heading 0 it spins half a turn to point down (south), at heading PI
// it stays pointing up (north). Turning it by the bare heading would
// swap north and south.
import { WORLD, clamp } from './state.js';

const MAP_EDGE = 190;
const MAP_ZOOM = MAP_EDGE / 560;
const FEED_MAX = 4;
const FEED_LIFE_MS = 9000;
const DAMAGE_FLASH_MS = 220;

// Colour table as pairs; buildPalette turns it into the object the
// rest of the file reads.
const PALETTE_PAIRS = [
  ['mapBack', '#0d1526'],
  ['block', '#232a3a'],
  ['road', '#3a3f4d'],
  ['water', '#1d5f7a'],
  ['sand', '#d9b98a'],
  ['spray', '#4fa8ff'],
  ['beacon', '#ffd23e'],
  ['arrow', '#ffffff'],
  ['arrowEdge', '#111111'],
  ['trafficDot', '#e8e8e8'],
  ['copDot', '#ff4444'],
  ['officerDot', '#ff8888'],
  ['pedDot', '#7dff9e'],
  ['enemyDot', '#ff2222'],
  ['fareDot', '#ffd23e'],
  ['healthy', 'linear-gradient(90deg,#37d67a,#7dff9e)'],
  ['hurt', 'linear-gradient(90deg,#f39c12,#ffd76a)'],
  ['critical', 'linear-gradient(90deg,#e74c3c,#ff7a6a)'],
  ['carOk', '#7dff9e'],
  ['carWorn', '#ffd76a'],
  ['carBad', '#ff7a6a'],
  ['ring', 'rgba(255,255,255,.4)'],
];

function buildPalette(pairs) {
  const out = {};
  let i = 0;
  while (i < pairs.length) {
    out[pairs[i][0]] = pairs[i][1];
    i++;
  }
  return out;
}

const PALETTE = buildPalette(PALETTE_PAIRS);

// Health bands as [above, fill] pairs, best first.
const HEALTH_BANDS = [
  [50, PALETTE.healthy],
  [25, PALETTE.hurt],
  [-1, PALETTE.critical],
];

// Car-condition bands as [above, colour] pairs, best first; anything
// at or below the last band is the worst colour.
const CAR_BANDS = [
  [60, PALETTE.carOk],
  [30, PALETTE.carWorn],
];

// Element ids the HUD owns, as [field, id] pairs. The constructor
// walks this table instead of spelling out one lookup per element.
const ELEMENT_IDS = [
  ['hud', 'hud'],
  ['healthBar', 'health-bar'],
  ['healthText', 'health-text'],
  ['cash', 'cash-text'],
  ['ammo', 'ammo'],
  ['ammoText', 'ammo-text'],
  ['stars', 'stars'],
  ['missionName', 'mission-name'],
  ['objective', 'objective'],
  ['crosshair', 'crosshair'],
  ['minimap', 'minimap'],
  ['speed', 'speed'],
  ['speedText', 'speed-text'],
  ['carHealth', 'car-health'],
  ['carHealthText', 'car-health-text'],
  ['feed', 'feed'],
  ['hint', 'hint'],
  ['vignette', 'vignette'],
  ['interact', 'interact'],
];

// A filled disc on a canvas.
function disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// One straight stroke between two points.
function strokeLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// A closed polygon from [x, y] corners, filled and stroked.
function poly(ctx, corners) {
  ctx.beginPath();
  let i = 0;
  while (i < corners.length) {
    if (i === 0) ctx.moveTo(corners[i][0], corners[i][1]);
    else ctx.lineTo(corners[i][0], corners[i][1]);
    i++;
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const [field, id] of ELEMENT_IDS) {
      this.el[field] = document.getElementById(id);
    }
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
    let extra = feed.childElementCount - FEED_MAX;
    while (extra > 0) {
      feed.removeChild(feed.lastChild);
      extra--;
    }
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, FEED_LIFE_MS);
  }

  showHint(text, seconds) {
    const secs = seconds === undefined ? 3 : seconds;
    this.el.hint.textContent = text;
    this.el.hint.classList.remove('hidden');
    this.hintTimer = secs;
  }

  flashDamage() {
    const veil = this.el.vignette;
    veil.style.opacity = '1';
    setTimeout(function () {
      veil.style.opacity = '0';
    }, DAMAGE_FLASH_MS);
  }

  update(w, dt) {
    const hero = w.player;
    if (!hero) return;
    this.renderHealth(hero);
    this.el.cash.textContent = w.cash;
    this.renderStars(w.wanted);
    this.renderWeapon(hero);
    this.renderDrive(hero);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.classList.add('hidden');
    }
    this.renderMap(w);
  }

  renderHealth(hero) {
    const hp = clamp(hero.health, 0, 100);
    let fill = PALETTE.critical;
    let i = 0;
    while (i < HEALTH_BANDS.length) {
      if (hp > HEALTH_BANDS[i][0]) {
        fill = HEALTH_BANDS[i][1];
        break;
      }
      i++;
    }
    const bar = this.el.healthBar;
    bar.style.width = hp + '%';
    bar.style.background = fill;
    this.el.healthText.textContent = Math.ceil(hero.health);
  }

  renderStars(wanted) {
    const parts = [];
    let i = 0;
    while (i < 5) {
      if (i < wanted) parts.push('★');
      else parts.push('<span class="off">★</span>');
      i++;
    }
    this.el.stars.innerHTML = parts.join('');
  }

  renderWeapon(hero) {
    const aiming = hero.weapon === 'pistol' && !hero.car;
    this.el.ammo.classList.toggle('hidden', !aiming);
    this.el.crosshair.classList.toggle('hidden', !aiming);
    if (aiming) this.el.ammoText.textContent = hero.ammo;
  }

  // Speed while driving, plus the car's condition: green while
  // healthy, amber when dented, red when it is about to quit. Hidden
  // on foot.
  renderDrive(hero) {
    const driving = !!hero.car;
    this.el.speed.classList.toggle('hidden', !driving);
    this.el.carHealth.classList.toggle('hidden', !driving);
    if (!driving) return;
    this.el.speedText.textContent = Math.round(Math.abs(hero.car.speed) * 2.2);
    const hp = Math.max(0, Math.round(hero.car.health));
    this.el.carHealthText.textContent = hp;
    let tone = PALETTE.carBad;
    let i = 0;
    while (i < CAR_BANDS.length) {
      if (hp > CAR_BANDS[i][0]) {
        tone = CAR_BANDS[i][1];
        break;
      }
      i++;
    }
    this.el.carHealth.style.color = tone;
  }

  renderMap(w) {
    const ctx = this.mapCtx;
    const edge = MAP_EDGE;
    const mid = edge / 2;
    const px = w.player.pos.x;
    const pz = w.player.pos.z;
    const project = (x, z) => {
      const at = {};
      at.x = mid + (x - px) * MAP_ZOOM;
      at.y = mid + (z - pz) * MAP_ZOOM;
      return at;
    };
    const plot = (x, z, r, color) => {
      const at = project(x, z);
      if (at.x < -5 || at.x > edge + 5 || at.y < -5 || at.y > edge + 5) return;
      ctx.fillStyle = color;
      disc(ctx, at.x, at.y, r);
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
    const blockSize = 40 * MAP_ZOOM;
    let bx = 0;
    while (bx < 7) {
      let bz = 0;
      while (bz < 7) {
        const cz = -180 + bz * 60 + 30;
        if (cz <= 150) {
          const corner = project(-180 + bx * 60 + 10, cz - 20);
          ctx.fillRect(corner.x, corner.y, blockSize, blockSize);
        }
        bz++;
      }
      bx++;
    }
    ctx.strokeStyle = PALETTE.road;
    ctx.lineWidth = Math.max(2, WORLD.roadWidth * MAP_ZOOM);
    const runs = [
      [w.roads.xs, true],
      [w.roads.zs, false],
    ];
    let r = 0;
    while (r < runs.length) {
      const lines = runs[r][0];
      const vertical = runs[r][1];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        let from;
        let to;
        if (vertical) {
          from = project(line, -240);
          to = project(line, 240);
        } else {
          from = project(-240, line);
          to = project(240, line);
        }
        strokeLine(ctx, from.x, from.y, to.x, to.y);
        i++;
      }
      r++;
    }
    // Water to the south, sand band above it.
    const waterAt = project(0, WORLD.waterZ);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, waterAt.y, edge, edge);
    const sandAt = project(0, WORLD.sandZ);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, sandAt.y, edge, waterAt.y - sandAt.y);
    // Pay N Spray: a blue square so the garage is findable on the map.
    if (w.markers.spray) {
      const at = project(w.markers.spray.x, w.markers.spray.z);
      ctx.fillStyle = PALETTE.spray;
      ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
    }
    this.drawObjectiveDiamond(ctx, project, w);
    this.drawMapDots(ctx, plot, w);
    this.drawPlayerArrow(ctx, mid, w);
    ctx.restore();
    ctx.strokeStyle = PALETTE.ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Objective marker: a pulsing yellow diamond.
  drawObjectiveDiamond(ctx, project, w) {
    if (!w.beaconTarget) return;
    const at = project(w.beaconTarget.x, w.beaconTarget.z);
    const r = 7 + Math.sin(w.time * 5) * 2;
    const corners = [
      [at.x, at.y - r],
      [at.x + r, at.y],
      [at.x, at.y + r],
      [at.x - r, at.y],
    ];
    ctx.fillStyle = PALETTE.beacon;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    poly(ctx, corners);
  }

  drawMapDots(ctx, plot, w) {
    const groups = [
      [w.traffic, 2.5, PALETTE.trafficDot],
      [w.policeCars, 3.5, PALETTE.copDot],
      [w.officers, 2.5, PALETTE.officerDot],
      [w.peds, 1.8, PALETTE.pedDot],
      [w.enemies, 3, PALETTE.enemyDot],
    ];
    let g = 0;
    while (g < groups.length) {
      const list = groups[g][0];
      const size = groups[g][1];
      const color = groups[g][2];
      let i = 0;
      while (i < list.length) {
        plot(list[i].pos.x, list[i].pos.z, size, color);
        i++;
      }
      g++;
    }
    // The waiting taxi fare, if any, shows as a yellow dot.
    if (w.taxi && w.taxi.client) {
      plot(w.taxi.client.pos.x, w.taxi.client.pos.z, 3.5, PALETTE.fareDot);
    }
  }

  // Player arrow, centred, pointing along the heading (see the note at
  // the top of this file for why the rotation is PI - heading).
  drawPlayerArrow(ctx, mid, w) {
    const heading = w.player.car ? w.player.car.heading : w.player.heading;
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
    poly(ctx, outline);
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', mid, 12);
  }
}
