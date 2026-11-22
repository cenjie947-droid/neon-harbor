# Neon Harbor

[![make.fun competition gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/cenjie947-droid/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/cenjie947-droid/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game built for the make.fun gta6-01
competition. You are Cole Vance, a getaway driver in Neon Harbor, a
sun-soaked coastal city of downtown towers, a harbor with a pier and a
ferris wheel, docks, and quiet residential blocks. Your fixer is Mara
Quinn; the man standing between you and the big score is rival boss
Dario Venn. No real city, person, or brand appears in the game — the
city, the people, and the story are all invented.

## What you do

- **Five story missions, in order:** First Wheels, The Pickup, Grand
  Theft Harbor, Dockside Heat, and The Big One. Follow the gold beacon,
  beat the timer, and get paid.
- **Drive anything.** Steal parked cars, outrun the police, and watch
  the wanted stars climb from 0 to 5. At 3+ stars the police park
  cruisers across the road ahead of you; at 4+ stars a helicopter
  follows you with a searchlight and your wanted level stops decaying
  while it is overhead.
- **Pay N Spray.** Drive onto the garage pad and pay $100 to clear every
  wanted star and fully repair your car. Cars take real damage: hard
  hits slow them down, heavy damage trails smoke, and a car at 0 health
  will not move until it is fixed.
- **Side jobs in free roam.** Pick up taxi fares ($40–$80), run courier
  parcels against a 90-second clock ($60–$120), or line up on the
  checkered start pad on the harbor straight and press G for a street
  race: 3 gates, 90 seconds, $100–$200 for finishing.
- **Fight back.** Fists with a visible swing arc, or a pistol (12 ammo)
  once you find one. Dario's gunmen close in, plant themselves, and fire
  in bursts — drop them and they sometimes leave a pistol or a medkit.
- **Save and continue.** The pause menu saves your mission, the step
  inside it, your car, and your cash; Continue puts you back exactly
  where you were.

## Keys

| Key | Action |
| --- | ------ |
| WASD | Walk / drive |
| Mouse | Look (click the scene to capture the mouse, or hold and drag) |
| Shift | Sprint |
| Space | Jump / handbrake |
| E | Steal or exit a car, use Pay N Spray |
| Click | Punch / shoot |
| Q | Switch fists / pistol |
| R | Restart the mission |
| F | Pay N Spray |
| T | Taxi job |
| C | Courier job |
| G | Street race |
| P / Esc | Pause |
| M | Mute |

## How to run it

```sh
node serve.ts
```

Then open <http://localhost:8080> in a desktop browser. No build step,
no network requests — the game is plain static files.

## Layout

- `game/` — the whole game: `index.html`, `style.css`, `src/*.js`
  (state, city, vehicles, player, pedestrians, audio, effects, main,
  missions, police, combat, hud, save, shots), and `vendor/` with the
  vendored three.js.
- `screenshots/` — the four submission screenshots.
- `main.ts` — the entry program: packs `game/` and `screenshots/` into
  the output folder and writes `dossier.json`.
- `serve.ts` — the tiny local static server.
