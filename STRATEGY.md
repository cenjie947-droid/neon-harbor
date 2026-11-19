# Neon Harbor — strategy notes

## What the game does

A complete, playable open-world crime game in one static `game/` folder:
a procedural 3D sunset city (downtown, harbor/beach with pier and ferris wheel,
docks, residential blocks), on-foot and driving play, traffic and pedestrians,
stealable cars, a 0–5 star wanted system with chasing police cars and foot
officers who can bust you, fists and pistol combat with armed gang enemies,
five story missions in order with beacons, timers and cash rewards, a HUD with
a live minimap, start/pause/mission-complete/busted/wasted/ending screens,
localStorage save/continue, and fully synthesised WebAudio sound (engine,
siren, gunshots, music loop).

## What the screenshots show

1. `1-chase.jpg` (cover) — the play scene: Cole driving the Comet GT through
   downtown with police cars in pursuit, 3 wanted stars, the minimap, and the
   mission objective on the HUD.
2. `2-title.jpg` — the title screen over the city.
3. `3-drive.jpg` — driving through the city streets.
4. `4-mission.jpg` — the mission-complete panel at Mara's garage after
   The Pickup: reward $300, total cash $450 (job 1's $150 already banked).

## What this round fixed (v3, 2026-11-19)

Real-browser testing on 2026-11-18 caught a batch of defects, and this
round cleared them:

- **Save/Continue restores the whole situation.** A save now records the
  job, the beat inside it, and the car being driven (model, colour, spot,
  heading); Continue puts Cole back mid-beat in that same car. If the car
  genuinely cannot be recovered, the job restarts from its first beat and
  the screen says why — never a silent reset with the car gone.
- **The camera stays out of walls.** A keep-out pass runs every frame
  (horizontal push-out plus a sight-line pull-in), and a fresh or continued
  game snaps the camera to a clear spot behind Cole instead of lerping in
  from the title orbit across the city.
- **The steal prompt works from any side of a car**, measured to the car's
  oriented body box out to about 5 m, nose and tail included.
- **The minimap arrow was verified against its own geometry** (rotation is
  PI − heading on a north-up map) and is now covered by a pure-function
  check, so north can no longer read as south.
- **Heat lasts.** A star now needs a full minute genuinely unseen — no
  police line of sight — before it drops, and any fresh crime restarts
  that clock. Police cars spawn 28–42 m away on a road instead of 45–65 m,
  with one more cruiser than the star count, so the chase is actually
  visible and audible.
- **A punch is unmistakable now**: a sweeping arc, a whoosh burst and an
  on-screen line even on a clean miss, a spark burst and "Punch landed!"
  on a connect.
- **The mission-complete card can no longer disagree with itself.** Its
  reward and total are read from the same ledger at the same moment, and
  the staged screenshot renders through that same card (The Pickup: $300
  reward, $450 total).
- **Mouse look is robust.** Clicks are heard on the window in the capture
  phase (menu clicks filtered by target), pointer lock is requested on the
  canvas, and a held drag still turns the camera when lock is refused.
- **Brighter daylight.** The sun, sky fill and exposure were lifted so the
  city reads as a sun-soaked modern city, not an evening haze.

## What to improve next

- More mission variety: side jobs (taxi fares, courier runs, street races).
- Better police AI: roadblocks, spike strips, helicopter at 4+ stars.
- Car damage model with smoke, and a repair shop.
- More pedestrians variety and ambient city life (shops you can enter, radio).
- A proper wanted-evade mechanic (pay-and-spray to clear stars).
- Performance pass on shadows for low-end machines, and mobile touch controls.
