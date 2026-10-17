# PumaCity: development

One `index.html`: no build step, no dependencies, no network at play time. Every sound is synthesized in the page with Web Audio.

## How it's built

The rules are data plus a DOM-free engine, which sit between the
`// ===== @core-begin =====` and `// ===== @core-end =====` markers in
`index.html`. The screen below them only talks to the core through
`newGame`, `step(state, action)` and `waiting(state)`.

- **One way in.** `step` never modifies the state it is given. It returns the
  new state, the log lines the move produced, or a reason it refused. A
  refused move returns the input untouched.
- **The state is plain JSON, and it is the whole save.** Its randomness is one
  32-bit LCG whose state lives in `st.rng`, so a seed replays a run exactly.
- **A run carries its own rules.** `RULES` holds the defaults (the Regular
  game): money, interest, the goons' patience, heat, headline and encounter
  odds. `newGame` copies them into `st.rules`, and the engine reads them
  through `R(st)`, never the defaults. A save keeps the rules it started
  with; a save from before this gets the defaults.
- **Difficulties are rules too.** A preset is a short list of changes to the
  defaults. Custom rules are 18 knobs, each a fixed list of steps; a choice is
  an index into that list, so the engine can only ever apply a listed step
  (anything else falls back to Regular's). Every preset is reachable on the
  knobs, which is what makes *start from Wanted* exact.
- **Bots play through the same door.** They read the state and never advance
  the RNG.
- **Sound reads the move, never the other way round.** `cuesFor(before,
  action, result)` picks a move's sounds from what it did: a till for a sale,
  the siren when the Watchers are waiting, a thump when you're hit. It sits in
  the core so the checks can play it, and changes nothing, so a run sounds
  however you like and replays the same. The synth itself is screen-side.

## Checks

```
node tools/check-assets.js   # every file index.html references exists
node tools/check-all.js      # 76 named rule scenarios
node tools/replay.js         # fixed seeds replay exactly as recorded
node tools/sim.js 20         # bots play whole runs; invariants after every step
```

`tools/core.js` cuts the core block out of `index.html` and evaluates it, so
the checks run exactly the code the browser runs. CI runs all four on every
pipeline. Each check has been seen failing against a deliberately broken rule
before it was trusted. `check-all.js` refuses to pass with zero scenarios, and
`sim.js` and `replay.js` refuse zero runs.

`replay.js` holds the Regular game still. Bots play 48 fixed-seed runs, and
every event line and the final state must hash to what `tools/replay.json`
recorded. A refactor that should change nothing proves it there; a change
that is meant to move the game (a balance tweak) fails there first, and is
re-recorded on purpose with `node tools/replay.js --record` in the same
commit, with the reason in its message.

`sim.js` fails if:
- a run crashes, the engine refuses a bot's move, or a bot moves the RNG
- an invariant breaks: cash, bank or debt goes negative, the pouch goes over
  capacity, or health or heat leaves its range
- a run never ends
- the share of careful runs finishing in profit leaves its difficulty's
  target band. The bot knows every price band, so it's a strong player.
  - Tourist: at least 90%.
  - Regular: 55–95% at 30 days, at least 60% at 60 and 90. The upper bound
    exists because the first economy let every run win.
  - Wanted: 25–65% at 30 days, where it bites; 30–85% at 60 and 40–95% at
    90, since a debt that has stopped compounding is one a long run can
    catch. The lower bounds keep Wanted from becoming Regular.
- no reckless run ever dies on Regular or Wanted
- a Custom run, with a random step on every knob, crashes, breaks an
  invariant or never ends (these runs hold no profit band: Custom can be as
  easy or as hard as you set it)

`--preset=wanted` plays one difficulty; `--preset=custom` plays only the random Custom runs. Figures for 20 runs per cell:

| Difficulty | Days | Bot | Profit | Deaths | Median score |
|---|---|---|---|---|---|
| Tourist | 30 | careful | 20/20 | 0 | $737,264 |
| Tourist | 30 | reckless | 20/20 | 0 | $484,468 |
| Tourist | 60 | careful | 20/20 | 0 | $2,338,286 |
| Tourist | 60 | reckless | 20/20 | 0 | $2,128,143 |
| Tourist | 90 | careful | 20/20 | 0 | $5,121,214 |
| Tourist | 90 | reckless | 19/20 | 1 | $5,675,814 |
| Regular | 30 | careful | 18/20 | 0 | $267,231 |
| Regular | 30 | reckless | 17/20 | 2 | $168,012 |
| Regular | 60 | careful | 19/20 | 0 | $1,301,550 |
| Regular | 60 | reckless | 16/20 | 3 | $1,495,033 |
| Regular | 90 | careful | 19/20 | 0 | $2,374,977 |
| Regular | 90 | reckless | 15/20 | 5 | $3,718,872 |
| Wanted | 30 | careful | 11/20 | 0 | $15,529 |
| Wanted | 30 | reckless | 10/20 | 1 | $36,390 |
| Wanted | 60 | careful | 11/20 | 2 | $542,201 |
| Wanted | 60 | reckless | 9/20 | 5 | $0 |
| Wanted | 90 | careful | 16/20 | 0 | $1,231,384 |
| Wanted | 90 | reckless | 14/20 | 4 | $1,139,896 |

## Debugging

`window.__PC` exposes the following:
- the live `state`
- `act(action)`
- `force('watchers' | 'rival' | 'boss' | 'goons' | 'stray' | 'mugging' | 'stash')`, which starts an encounter now
- `set(patch)`
- `bot(n)`, which lets the bot play `n` moves

## Deploying

Merging to `main` runs `.gitlab-ci.yml`: validate, then rsync to
`greykit.com/games/pumacity/` on DreamHost. The host key is pinned rather than
scanned, and `--delete-excluded` keeps `tools/` and `screenshots/` off the
live site.

## Icon and share card

`icon.svg` is drawn by hand. Every other image in the page's `<head>` is
rendered from it, so if it changes, re-render all of them. From this
directory:

```bash
for s in 16 32 48; do rsvg-convert -w $s -h $s icon.svg -o favicon-${s}x${s}.png; done
python3 -c "from PIL import Image; i=[Image.open(f'favicon-{s}x{s}.png') for s in (48,32,16)]; i[0].save('favicon.ico', sizes=[(16,16),(32,32),(48,48)], append_images=i[1:])"
rm favicon-48x48.png
../../greykit-meta/tools/make-assets.sh . --accent '#54f2ff' --bg '#05070f' --font mono \
  --wordmark 'Puma[City]' --desc 'Buy low, sell high, and stay one step ahead of the Watchers.' \
  --tagline 'A trading game in the spirit of Dope Wars'
```

The last command writes `og.png` and `apple-touch-icon.png`. The GitLab project
avatar is a copy of `apple-touch-icon.png`, so upload that again too:

```bash
glab api --method PUT projects/87145400 --form "avatar=@apple-touch-icon.png"
```
