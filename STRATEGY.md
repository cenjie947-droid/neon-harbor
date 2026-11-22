# Neon Harbor — strategy notes

## What the game is

A complete, playable open-world crime game in one static `game/` folder:
a procedural 3D sun-soaked coastal city (downtown towers, a harbor with
a pier and a ferris wheel, docks, and residential blocks), on-foot and
driving play, traffic and pedestrians, stealable cars, a 0–5 star wanted
system with chasing police cars and foot officers who can bust you,
fists and pistol combat with armed gang enemies, five story missions in
order with beacons, timers and cash rewards, a HUD with a live minimap,
start / pause / mission-complete / busted / wasted / ending screens,
localStorage save and continue, and fully synthesised WebAudio sound
(engine, siren, gunshots, music loop).

You play Cole Vance, a getaway driver. Your fixer is Mara Quinn; the
rival boss standing in your way is Dario Venn. The city, the people,
and the story are all invented — no real place, person, or brand.

## The five missions

1. **First Wheels** — steal a car and deliver it to the paint shop.
   Pays $150.
2. **The Pickup** — collect the package for Mara and bring it to her
   garage. Pays $300, and the mission-complete card reads $450 total
   because the first job's $150 is already banked.
3. **Grand Theft Harbor** — steal the target car from the docks under
   guard.
4. **Dockside Heat** — lose a heavy police response and deliver the
   goods.
5. **The Big One** — the final job against Dario Venn's crew, ending
   with the ending screen and free roam.

## The side jobs (free roam, repeatable, never block the story)

- **Taxi.** A walker with a yellow diamond over their head wants a
  ride: walk up, press T, follow the beacon to their destination and
  collect a $40–$80 fare.
- **Courier.** A dispatcher hands Cole a parcel: press C near them,
  follow the beacon to the drop-off within 90 seconds and collect
  $60–$120 by distance.
- **Street race.** A checkered start pad sits on the harbor straight
  at (30, 180). Drive a car onto the pad and press G: a 3-2-1
  countdown, then 3 checkpoint gates — (120, 180), (180, 180),
  (180, 60) — within 90 seconds. The HUD shows the gate counter and
  the seconds left; finishing pays $100 plus $10 per second left,
  capped at $200, through the same cash ledger as the other jobs.
  Free roam only: while a story mission is active the pad shows no
  hint and G does nothing. Leaving the car, or getting busted or
  wasted, cancels the race; it can be run again immediately.

## Pay N Spray and car damage

A marked garage (blue square on the minimap, yellow awning, "PAY N
SPRAY" kiosk) clears wanted stars and repairs cars for $100: drive
onto the pad and press F. Without enough cash, or with nothing to
fix, it says so instead of taking money. Cars take real damage — hard
building hits, shunts, and police rams all cost health. Below 60 a
car loses top speed and acceleration, below 35 it trails smoke from
the hood, and at 0 it is disabled and will not move until the Pay N
Spray fixes it. The HUD shows the driven car's condition next to the
speedometer, and saves record car health too.

## The police helicopter

At 4+ stars a helicopter built from boxes with a spinning rotor
follows Cole at about 40 m, its searchlight tracking him on the
ground. While it is overhead the wanted level stops decaying — it
can see him — and it flies up and away once the heat drops below 3
stars. It shows on the minimap as a red dot with a ring.

## The police, in general

Stealing a car raises heat. Heat decays after a full minute genuinely
unseen, and cruisers spawn 28–42 m away and close in. At 3+ stars
the police park cruisers across the road ahead of Cole instead of
only chasing from behind, so high heat forces a detour or a
smash-through. Foot officers who reach Cole on foot can bust him;
getting busted or wasted costs $25 and respawns him at the hideout.

## Combat

Fists are an unmistakable punch: a swing arc, a whoosh, an on-screen
line on a miss, and a spark burst with "Punch landed!" on a connect;
only nearby pedestrians and enemies are hit. The pistol holds 12
rounds — switch with Q, click to shoot, with a muzzle flash and a
tracer on every shot. Dario's gunmen close in, plant themselves, and
fire in bursts; dropping one sometimes leaves a pistol pickup, and a
health pickup often lies near the ammo.

## Saves

A save records the mission index and the step inside the mission, the
stolen or driven car (model, colour, spot, heading, health), and the
player (position, health, cash) plus the wanted level. Continue
restores all of it and spawns the car at a collision-clear spot, never
inside a building. Old saves still load: a missing field is filled
with a sane default instead of throwing the save away.

## What the screenshots show

1. `1-chase.jpg` (cover) — Cole driving the Comet GT through downtown
   with police cars in pursuit, 3 wanted stars, the minimap, and the
   mission objective on the HUD.
2. `2-title.jpg` — the title screen over the city.
3. `3-drive.jpg` — driving through the streets.
4. `4-mission.jpg` — the mission-complete panel at Mara's garage after
   The Pickup: reward $300, total cash $450.

## What this round did (v12, 2026-11-22)

The last entry round was rejected on transcript checks, not on game
quality: only 13% of counted lines were authored by the recorded
sessions against a 30% bar, because the agents read the old code and
reproduced it nearly verbatim. This round therefore rewrote every
file fresh again in recorded sessions that started after recording
began — all fourteen game modules plus the entrypoint, each authored
from its behavioural spec without reading the old code: state, city,
vehicles, player, pedestrians, audio, effects, main, missions,
police, combat, hud, save, shots, and main.ts — including the small
files the earlier entries missed (.gitignore, LICENSE, README.md,
game/index.html, game/style.css, serve.ts) and STRATEGY.md itself.

On top of the rewrite, the street race and the police helicopter
landed (see above), the HUD gained a race status line and a checkered
race-pad marker, the combat module now takes the swing and shoot calls
from the player module with the state passed in, and modules no
longer import three.js themselves — main passes THREE in. The rewrite
also carried over every fix from the earlier rounds: Pay N Spray, car
damage with smoke and disable, varied pedestrians, the taxi and
courier side jobs, saves that restore the mission, the step inside it
and the car being driven, camera keep-out, steal reach measured to the
oriented body box out to about 5 m, minimap arrow verified as PI minus
heading on a north-up map, heat lasting a full minute genuinely
unseen, an unmistakable punch, roadblocks at 3+ stars, and a
mission-complete card whose reward and total are read from the same
ledger at the same moment ($300 / $450). Submitted with the current
kit.

## What to improve next

- More mission variety: street races as story beats, not just a side job.
- Better police AI: spike strips, helicopter search patterns.
- More ambient city life (shops you can enter, radio stations).
- Performance pass on shadows for low-end machines, and mobile touch controls.
