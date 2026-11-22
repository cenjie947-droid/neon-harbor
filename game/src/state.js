// Neon Harbor — shared game state (round 6 fresh rewrite).
// Owns the single state object every module reads and writes. Nothing in
// here touches the DOM, the renderer, or the network: it is plain data
// plus the tiny helpers that keep the cash / heat / job ledgers consistent.
// The factory takes THREE so the player position can be a real Vector3
// (other modules call .set() / .x / .z on it) without this file importing
// the vendored three.js build itself.

export function createGameState(THREE) {
  // Landmark spots, shared by city building, missions, jobs and the HUD.
  // Keys must stay exactly these ten: the test driver asserts the set.
  const markers = {
    bank: { x: -60, z: -60 },
    beach: { x: 0, z: 212 },
    docks: { x: -150, z: 110 },
    garage: { x: -120, z: 60 },
    hideout: { x: 0, z: -180 },
    hospital: { x: 120, z: -120 },
    paintShop: { x: 60, z: 120 },
    showroom: { x: 180, z: 60 },
    spray: { x: 120, z: 60 },
    warehouse: { x: -180, z: 120 },
  };

  const G = {
    // --- clock -----------------------------------------------------------
    // Game seconds since the run started. Advances only while playing.
    time: 0,

    // --- the player ------------------------------------------------------
    player: {
      pos: new THREE.Vector3(0, 0, -150),
      heading: 0, // facing, radians; 0 = +z (south), PI = -z (north)
      speed: 0,
      camYaw: 0,
      camPitch: -0.32,
      punchAnim: 0, // seconds left of the swing animation
      shootCooldown: 0,
      ammo: 0,
      invuln: 0, // seconds of post-hit / post-respawn grace
      walkPhase: 0, // leg-swing phase while walking
      hasPistol: false,
      weapon: 'fists', // 'fists' | 'pistol'
      car: null, // the car record being driven, or null on foot
      onGround: true,
      vy: 0, // vertical velocity while jumping / falling
      moving: false, // set each frame by the player controller
    },

    // --- world collections ----------------------------------------------
    cars: [], // every traffic / parked / mission car record
    policeCars: [], // cruisers chasing Cole (records live in cars too)
    officers: [], // foot officers who can grab Cole
    peds: [], // pedestrians
    colliders: [], // { x, z, hw, hd } axis-aligned building boxes

    // --- ledgers ---------------------------------------------------------
    wanted: 0, // 0..5 stars
    cash: 0,
    health: 100,

    // --- story progress --------------------------------------------------
    mission: 0, // index of the current story mission (0-based)
    missionStep: 0, // beat inside the current mission
    missionActive: false, // true while a story mission is running

    // --- free-roam jobs --------------------------------------------------
    taxi: {
      phase: 'idle', // idle | wait | ride | done
      client: null, // pedestrian record waiting for a cab
      dest: null, // marker record { key, x, z }
      fare: 0,
      timer: 0,
    },
    courier: {
      phase: 'idle', // idle | carry
      dest: null, // marker record { key, x, z }
      reward: 0,
      timer: 0, // seconds left on the 90 s drop-off clock
      hasParcel: false,
    },
    race: {
      phase: 'idle', // idle | countdown | running | done
      gate: 0, // next checkpoint index
      timer: 0, // seconds left on the 90 s race clock
      checkpoints: [], // [{ x, z }] filled when a race starts
      countdown: 0,
    },

    // --- module handles (filled in by main as systems boot) -------------
    markers,
    city: null,
    vehicles: null,
    playerController: null,
    pedsSystem: null,
    fx: null, // effects system
    audio: null, // audio system
    hud: null,
    missions: null,
    police: null,
    combat: null,
    save: null,

    // --- heat bookkeeping (owned by the police module) -------------------
    heat: {
      unseenFor: 0, // seconds since any police unit last saw Cole
      lastSeenAt: -999,
    },
  };

  return G;
}

// Bank cash through the one ledger every job and mission shares, so a
// mission-complete card and the HUD can never disagree about the total:
// both read G.cash after this runs. Returns the new total.
export function bankCash(G, amount) {
  G.cash = Math.max(0, G.cash + amount);
  return G.cash;
}

// Reset everything a busted / wasted respawn is supposed to clear: full
// health, no heat, and any free-roam job cancelled cleanly. Story progress
// (mission / missionStep) is deliberately untouched — the mission module
// decides whether the player retries the mission or drops back to free roam.
export function resetAfterCaught(G) {
  G.health = 100;
  G.wanted = 0;
  G.heat.unseenFor = 0;
  G.heat.lastSeenAt = -999;
  G.player.invuln = 3;
  if (G.taxi) {
    G.taxi.phase = 'idle';
    G.taxi.client = null;
    G.taxi.dest = null;
    G.taxi.fare = 0;
    G.taxi.timer = 0;
  }
  if (G.courier) {
    G.courier.phase = 'idle';
    G.courier.dest = null;
    G.courier.reward = 0;
    G.courier.timer = 0;
    G.courier.hasParcel = false;
  }
  if (G.race) {
    G.race.phase = 'idle';
    G.race.gate = 0;
    G.race.timer = 0;
    G.race.checkpoints = [];
    G.race.countdown = 0;
  }
}

// Fresh-job record factories, so missions / jobs never hand-roll the shape.
export function newTaxiJob() {
  return { phase: 'idle', client: null, dest: null, fare: 0, timer: 0 };
}

export function newCourierJob() {
  return { phase: 'idle', dest: null, reward: 0, timer: 0, hasParcel: false };
}

export function newRaceJob() {
  return { phase: 'idle', gate: 0, timer: 0, checkpoints: [], countdown: 0 };
}

export default createGameState;
