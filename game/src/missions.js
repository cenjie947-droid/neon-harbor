// Neon Harbor — the story: five jobs for Cole Vance, from his fixer Mara Quinn,
// against rival boss Dario Venn. Each mission has steps, a beacon, a timer
// where it matters, and a cash reward.
import { dist2D, clamp } from './state.js';

export const MISSIONS = [
  {
    name: 'First Wheels',
    reward: 150,
    briefing: 'Mara Quinn: "Cole, welcome to Neon Harbor. First job is simple — grab any car on the street and bring it to the paint shop on Harbor Row. Don\'t scratch it. Actually, scratch it. I don\'t care."',
    steps: [
      { type: 'steal', text: 'Steal any car — walk up to one and press E' },
      { type: 'drive', target: 'paintShop', radius: 8, text: 'Drive the car to the paint shop' },
    ],
  },
  {
    name: 'The Pickup',
    reward: 300,
    briefing: 'Mara Quinn: "A package is waiting at the docks, Pier 9. Pick it up on foot, then get it back to my garage. Fast. The harbor cops get nosy after dark."',
    steps: [
      { type: 'drive', target: 'docks', radius: 9, text: 'Drive to the docks' },
      { type: 'pickup', target: 'docks', radius: 5, text: 'Get out and grab the package' },
      { type: 'timed', target: 'garage', radius: 9, seconds: 90, text: 'Get the package to Mara\'s garage — 90 seconds!' },
    ],
  },
  {
    name: 'Grand Theft Harbor',
    reward: 600,
    briefing: 'Mara Quinn: "A yellow Comet GT is sitting in the showroom lot on Meridian. Dario Venn wants it too, so the cops will be all over you the second you take it. Steal it. Bring it to the garage."',
    steps: [
      { type: 'stealSpecific', car: 'comet', text: 'Steal the yellow Comet GT from the showroom lot' },
      { type: 'drive', target: 'garage', radius: 9, text: 'Lose the heat and deliver the Comet GT to the garage', wanted: 2 },
    ],
  },
  {
    name: 'Dockside Heat',
    reward: 900,
    briefing: 'Mara Quinn: "Venn\'s crew is holding my warehouse on the east docks. Go in loud. Take them all down, then get back to the hideout before the PD locks the whole pier down."',
    steps: [
      { type: 'goto', target: 'warehouse', radius: 10, text: 'Go to the warehouse on the east docks' },
      { type: 'ambush', text: 'Take down Venn\'s crew' },
      { type: 'goto', target: 'hideout', radius: 9, text: 'Escape to the hideout' },
    ],
  },
  {
    name: 'The Big One',
    reward: 2500,
    briefing: 'Mara Quinn: "This is it, Cole. The Harbor Bank van leaves at dusk. Take the van, punch through every roadblock Venn bought, and bring it to the hideout. Do this and we own this city."',
    steps: [
      { type: 'enterSpecific', car: 'bankvan', text: 'Take the armored bank van' },
      { type: 'drive', target: 'hideout', radius: 10, text: 'Drive the van to the hideout — through the roadblocks!', wanted: 4 },
    ],
  },
];

export class Missions {
  constructor(G) {
    this.G = G;
    this.ambushSpawned = false;
    this.ambushCount = 0;
  }

  mission() { return MISSIONS[this.G.missionIndex] || null; }
  step() {
    const m = this.mission();
    return m ? m.steps[this.G.missionStep] : null;
  }

  startMission(G, index, showBriefing = true) {
    G.missionIndex = index;
    G.missionStep = 0;
    G.missionActive = true;
    G.missionDone = false;
    G.missionTimer = 0;
    this.ambushSpawned = false;
    const m = MISSIONS[index];
    if (!m) { this.setFreeRoam(G); return; }
    G.hud.setMissionName(`Mission ${index + 1}: ${m.name}`);
    if (showBriefing) {
      G.mode = 'briefing';
      document.getElementById('briefing-title').textContent = `MISSION ${index + 1} — ${m.name}`;
      document.getElementById('briefing-text').textContent = m.briefing;
      document.getElementById('briefing').classList.remove('hidden');
    }
    this.applyStep(G);
  }

  applyStep(G) {
    const s = this.step();
    if (!s) return;
    G.hud.setObjective(s.text);
    const targetName = s.target;
    if (targetName && G.markers[targetName]) {
      G.beacon.position.copy(G.markers[targetName]);
      G.beacon.visible = true;
      G.beaconTarget = G.markers[targetName];
    } else {
      G.beacon.visible = false;
      G.beaconTarget = null;
    }
    if (s.type === 'ambush' && !this.ambushSpawned) {
      this.ambushSpawned = true;
      const w = G.markers.warehouse;
      const spots = [[w.x + 8, w.z + 4], [w.x - 8, w.z + 6], [w.x + 4, w.z - 8], [w.x - 6, w.z - 6]];
      for (const [x, z] of spots) G.combat.spawnEnemy(G, x, z);
      this.ambushCount = 4;
      G.hud.showMessage('Ambush! Venn\'s crew is here — take them down!');
      G.audio.fail();
    }
    if (s.wanted) G.police.addWanted(G, s.wanted - G.wanted > 0 ? s.wanted - G.wanted : 0, 'The heat is on!');
    if (s.type === 'timed') G.missionTimer = s.seconds;
  }

  setFreeRoam(G) {
    G.missionActive = false;
    G.beacon.visible = false;
    G.beaconTarget = null;
    G.hud.setMissionName('Free Roam');
    G.hud.setObjective('Neon Harbor is yours — explore, steal cars, stay out of trouble.');
  }

  advance(G) {
    const m = this.mission();
    G.missionStep++;
    if (G.missionStep >= m.steps.length) {
      this.completeMission(G);
    } else {
      this.applyStep(G);
      G.audio.chime();
    }
  }

  completeMission(G) {
    const m = this.mission();
    G.cash += m.reward;
    G.stats.missionsDone++;
    G.missionActive = false;
    G.beacon.visible = false;
    G.beaconTarget = null;
    G.audio.missionComplete();
    G.missionIndex++;
    G.missionStep = 0;
    G.save.save(G);
    if (G.missionIndex >= MISSIONS.length) {
      // ending
      G.mode = 'ending';
      document.getElementById('ending-stats').textContent =
        `Total earned: $${G.cash}  •  Cars stolen: ${G.stats.carsStolen}  •  Crimes: ${G.stats.crimes}`;
      document.getElementById('ending-screen').classList.remove('hidden');
      G.hud.setMissionName('Free Roam');
      G.hud.setObjective('Neon Harbor is yours — explore, steal cars, stay out of trouble.');
      G.missionDone = true;
      return;
    }
    document.getElementById('mission-panel-title').textContent = 'MISSION COMPLETE';
    document.getElementById('mission-panel-text').textContent = `${m.name} — nicely driven, Cole.`;
    document.getElementById('mission-panel-reward').textContent = `Reward: $${m.reward}  •  Total cash: $${G.cash}`;
    document.getElementById('mission-panel').classList.remove('hidden');
    G.mode = 'mission-complete';
  }

  failMission(G, reason) {
    G.hud.showMessage(reason + ' — mission restarted.');
    G.audio.fail();
    this.startMission(G, G.missionIndex, false);
    G.mode = 'playing';
  }

  update(G, dt) {
    if (!G.missionActive || G.mode !== 'playing') return;
    const s = this.step();
    if (!s) return;
    const p = G.player;
    const at = (name, radius) => {
      const t = G.markers[name];
      return t && dist2D(p.pos.x, p.pos.z, t.x, t.z) < radius;
    };
    switch (s.type) {
      case 'steal':
        if (p.car) this.advance(G);
        break;
      case 'stealSpecific':
        if (p.car && p.car.special === s.car) this.advance(G);
        break;
      case 'enterSpecific':
        if (p.car && p.car.special === s.car) this.advance(G);
        break;
      case 'goto':
        if (at(s.target, s.radius)) this.advance(G);
        break;
      case 'drive':
        if (p.car && at(s.target, s.radius)) this.advance(G);
        break;
      case 'pickup':
        if (!p.car && at(s.target, s.radius)) {
          G.hud.showMessage('Package secured. The cops noticed — go!');
          G.police.addWanted(G, 1, 'You grabbed the package!');
          this.advance(G);
        }
        break;
      case 'timed': {
        G.missionTimer -= dt;
        G.hud.setObjective(`${s.text} — ${Math.max(0, Math.ceil(G.missionTimer))}s`);
        if (G.missionTimer <= 0) { this.failMission(G, 'Too slow — the package window closed'); return; }
        if (p.car && at(s.target, s.radius)) this.advance(G);
        break;
      }
      case 'ambush':
        if (this.ambushSpawned && G.enemies.length === 0) this.advance(G);
        break;
      default:
        break;
    }
  }

  onEnemyKilled(G) {
    // ambush progress is read live from G.enemies in update()
  }

  onBusted(G) {
    const loss = Math.min(G.cash, Math.max(25, Math.round(G.cash * 0.1)));
    G.cash -= loss;
    G.mode = 'busted';
    G.audio.fail();
    G.audio.setSiren(false);
    document.getElementById('busted-screen').classList.remove('hidden');
    G.hud.showMessage(`Busted! Bail cost you $${loss}.`);
  }

  onWasted(G) {
    const loss = Math.min(G.cash, Math.max(25, Math.round(G.cash * 0.1)));
    G.cash -= loss;
    G.mode = 'wasted';
    G.audio.fail();
    G.audio.setSiren(false);
    document.getElementById('wasted-screen').classList.remove('hidden');
    G.hud.showMessage(`Wasted! The hospital bill was $${loss}.`);
  }

  respawn(G) {
    const p = G.player;
    if (p.car) { p.car.speed = 0; p.car = null; }
    p.pos.set(G.markers.hideout.x, 0, G.markers.hideout.z);
    p.heading = 0;
    p.health = p.maxHealth;
    p.ammo = Math.max(6, p.ammo);
    G.police.clearWanted(G);
    G.save.save(G);
    document.getElementById('busted-screen').classList.add('hidden');
    document.getElementById('wasted-screen').classList.add('hidden');
    G.mode = 'playing';
    G.hud.showMessage('Back on the street. Stay sharp, Cole.');
  }
}
