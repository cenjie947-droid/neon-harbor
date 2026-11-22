# Neon Harbor

[![make.fun competition gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/cenjie947-droid/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/cenjie947-droid/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game for the make.fun **gta6-01 "Make GTA 6"** competition.
No Rockstar or GTA names, characters, art, music or map — everything here is invented:
the sun-soaked coastal city of Neon Harbor, getaway driver Cole Vance, his fixer
Mara Quinn, and rival boss Dario Venn.

## The game

Cole just rolled into Neon Harbor with a fast car and a faster reputation. Five jobs
stand between him and the big score:

1. **First Wheels** — steal any car, deliver it to the paint shop.
2. **The Pickup** — grab a package at the docks and race it back to Mara's garage against the clock.
3. **Grand Theft Harbor** — steal the yellow Comet GT from the showroom lot while the police chase.
4. **Dockside Heat** — survive an ambush by Venn's armed crew at the warehouse, then escape.
5. **The Big One** — take the Harbor Bank van through roadblocks to the hideout.

Free roam continues after the story. The city has downtown towers, a harbor and beach
with a pier and ferris wheel, dockside warehouses and residential blocks; traffic
cars and pedestrians fill the streets; police cars and foot officers respond to your
wanted level (0–5 stars); fists and a pistol, health pickups by ammo drops, a HUD
with a live minimap, a start screen, pause menu, and a localStorage save.

## Pay N Spray, car damage, taxi fares

Cars take damage now. Hard crashes and police rams dent them: below 60 health a car
loses speed and acceleration, below 35 it trails smoke, at 0 it is disabled and will
not move. The only fix is the **Pay N Spray** garage on the east side of the city
(blue square on the minimap, yellow awning over the pad): drive onto the pad and
press **F** to pay **$100** — all wanted stars clear and the car comes back to full
health. The HUD shows the driven car's condition next to the speedometer.

In free roam, a **taxi side job** runs in the background: a walker with a yellow
diamond over their head is waiting for a ride. Walk up and press **T** to pick them
up, follow the beacon to their destination, and collect a $40–$80 fare. Fares keep
coming, so it is a repeatable way to earn cash between jobs.

## Street race and the police helicopter

Free roam has a repeatable **street race**: a checkered start line is painted on
the harbor straight (checkered marker on the minimap). Drive a car onto the pad and
press **G** — after a 3-2-1 countdown, thread 3 checkpoint gates across downtown
within 90 seconds. The HUD shows the gate counter and the time left; finishing pays
$100 plus $10 for every second left, capped at $200. Leaving the car, getting busted
or wasted cancels the race. The race only runs in free roam — while a story mission
is active the pad stays quiet and G does nothing.

Push the heat to 4 stars or more and the Harbor PD sends up a **police helicopter**:
it hangs above Cole at about 40 m with a spinning rotor and a searchlight tracking
him on the ground. While it is overhead the wanted level stops decaying — it can
see him — and it only leaves once the heat drops below 3 stars.

## How to play

| Key | Action |
| --- | --- |
| W A S D | Move on foot / drive |
| Mouse | Look / aim (click the game to capture the mouse) |
| Shift | Sprint |
| Space | Jump / handbrake |
| E | Enter or exit a car (steal any parked or traffic car) |
| Click | Punch / shoot |
| Q | Switch weapon (fists / pistol) |
| R | Flip a car upright |
| F | Pay N Spray (drive onto the pad first) |
| T | Pick up a taxi fare (free roam) |
| G | Start street race (on the start pad, free roam) |
| C | Courier job (free roam) |
| P / Esc | Pause |
| M | Mute |

Crimes raise your wanted level: stealing cars, hitting pedestrians, shooting, and
attacking police. Lay low and the heat fades — or pay it off at the Pay N Spray.
Get caught on foot and you're BUSTED; lose all your health and you're WASTED —
either way you respawn at the hideout with a smaller wallet.

## How to run it

```sh
node serve.ts
# open http://localhost:8080
```

Static files only — `game/index.html` plays in desktop Chrome with no network
request. three.js is vendored as a minified build under `game/vendor/`.

## Layout

- `game/` — the game: `index.html`, `style.css`, `src/*.js` (one job per file:
  city, player, vehicles, pedestrians, police, combat, missions, HUD, audio,
  effects, save data, screenshot staging), `vendor/three.module.min.js`.
- `screenshots/` — four real browser renders of the game (cover first).
- `main.ts` — the make.fun entry program (Node 22, stdlib only).
- `serve.ts` — a tiny static server for local play-testing.
