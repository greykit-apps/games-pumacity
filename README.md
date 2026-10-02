# PumaCity

**Buy low, sell high, and keep one step ahead of the Watchers.** A
puma-flavoured trading game in the spirit of *Dope Wars*, set on the streets of
PumaCity. You start with $1,500 and owe Casey Benton, The Boss, $8,000 at
10% a day. Ride the
markets across seven districts, gear up, and survive whatever is waiting when
you arrive.

Inspired by *Dope Wars* (John E. Dell, 1984). The trade goods are cat-themed
stand-ins; Skooma and Moonsugar are borrowed from *The Elder Scrolls*
(Bethesda), and The Vault nods to *Fallout*'s shelters. Everything here is
original text and code.

## Play

<https://greykit.com/games/pumacity/>

One `index.html`: no build step, no dependencies, no network at play time.
Saves stay in your browser's `localStorage`.

![Day 12 of a Wanted run at the Starport: the terminal sits over the ship on its pad; the Debt box warns the goons could come any day and names the $4,152 payment that calls them off; a headline has crashed Skooma to a bargain; each price sits on its usual band beside a faint tick for the last price seen; and the Held column shows Catnip bought at $25 now down 44%](screenshots/market.png)

### How a run goes

- **Pick a difficulty, a length** (30, 60 or 90 days) **and a name.**
  - *Tourist*: $5,000 cash against $5,000 of debt at 5% a day, a Boss who
    waits 12 days, and Watchers who look the other way.
  - *Regular*: PumaCity as it comes: $1,500 against $8,000 at 10%, goons
    after 8 days.
  - *Wanted*: $800 against $12,000 at 12%, goons after 6 days, Watchers who
    come more often and forget you more slowly, and fewer headlines.
  - *Custom*: set 18 settings yourself, in five groups (Money, The Boss, The
    Watchers, Luck, Your cat), starting from any of the three above. Each
    setting moves in fixed steps, and the title screen lists what yours change.

  Each difficulty keeps its own high scores. A Custom score carries the rules
  it was played under.
- **Every trip takes a day.** Each district has its own scenery behind the
  terminal. Prices roll fresh at each stop, one or two goods are out of
  stock, and a headline sometimes sends one good's price wild.
- **Read the market.** The *vs usual* column says whether each price is a
  bargain, cheap, fair, steep or sky-high for that good. The Held column
  shows what you paid and how today's price compares.
- **Mind your load.** A heavy load draws the Watchers whatever your heat.
  The Pouch box shows its pull, and the buy row tells you what a purchase
  will do to it before you commit.
- **First run?** A coach line walks you through your first buy and first
  trip, then gets out of the way.
- **The debt compounds 10% a day.** Pay it down at PVN Tower. Go eight days
  without a real payment (at least 10% of what you owe) and The Boss sends
  her goons.
- **On the last day you cash out.** The Boss collects what you owe, and
  anything still in your pouch is worth nothing. Score = cash + bank − debt.
  Top ten per run length, kept locally.
- **If your health hits zero, the run ends there.** A death keeps any debt
  on its score but none of your money, and it ranks below every run played
  out, so dying is never a way out of a losing run.

### The city

| Place | What's special |
|---|---|
| Market Plaza | Start here. Downtown's open-air mall; tourists pay a premium for luxury goods. The outfitter: pouches, weapons, the Kevlar Collar, Sneaky Mittens, Shades. |
| PVN Tower | Casey Benton's tower: a theater at ground level, a nightclub above it, her office in the penthouse. Borrow and repay; Skooma sells high. |
| The Vault | A vault kept for PumaCity's leadership in case of war, run as a bank meanwhile. Money in it is safe and earns 1% a day. |
| The Ranch | An old horse ranch turned grow fields. Cheap 'nip, and the Watchers rarely come out this far (heat cools faster). |
| Starport | Where the ship lands, trading with other ports. Moonsugar and Skooma come in cheap. The Bay 9 outfitter: Hover-Crate and Mech-Claws. |
| The Convention Center | By the starport, a new event every week. Everything sells high. Pickpockets. The Pawphone. |
| Suburbs | Cul-de-sacs of Casey's rentals. The vet patches you up. |

**Goods**, cheapest first: Catnip, Feathers, Nappers, Zoomers, Silvervine,
Psychos, Red Dot, Moonsugar, Skooma.

**Encounters** roll when you arrive:
- **The Watchers.** They come more often, and in bigger numbers, the more
  heat you carry.
- **Rival dealers.** Some offer a deal; some just jump you.
- **Casey Benton.** She names a bribe to make your heat go away, or quietly
  buys your Skooma.
- **The Boss's goons.**
- **Strays** selling gear cheap.
- **Muggers**, and the odd stash in a drainpipe.

Against the Watchers or a rival crew you can **run, fight** (with a weapon) or
**give up**. Every choice shows its cost before you pick it: your odds of
getting away, what a failed run spills, and exactly what giving up loses.

### Controls

| Key | |
|---|---|
| `1`–`9`, `↑` `↓` | select a good |
| `B` / `S` | buy / sell it: `Enter` trades the most you can, or type an amount first. With the mouse, double-click Buy or Sell to trade the max |
| `A` | sell all: everything you carry that someone here is buying |
| `Z` | undo your last trade, for a few seconds after it (or the Undo on the Cash box) |
| `T`, then `1`–`7` | travel: a map of PumaCity opens; pick a district |
| `E` | cash out on the last day; `E` again confirms |
| `V` | this place's shop or office (opens beside the market) |
| `R` `F` `U`, `Y` / `N` | encounters: run, fight, give up; accept or turn down an offer |
| `?` | how to play · `Esc` menu / close |

Encounter keys never share a letter with market keys, and an encounter ignores
input for a moment after it appears. A key you were already pressing in the
market can't answer it by accident. Everything is also a button, and the
layout works at phone width.

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

### Checks

```
node tools/check-assets.js   # every file index.html references exists
node tools/check-all.js      # 70 named rule scenarios
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
  - Wanted: 25–60% at 30 days, 25–70% at 60 and 90.
- no reckless run ever dies on Regular or Wanted
- a Custom run, with a random step on every knob, crashes, breaks an
  invariant or never ends (these runs hold no profit band: Custom can be as
  easy or as hard as you set it)

`--preset=wanted` plays one difficulty; `--preset=custom` plays only the random Custom runs. Figures for 20 runs per cell:

| Difficulty | Days | Bot | Profit | Deaths | Median score |
|---|---|---|---|---|---|
| Tourist | 30 | careful | 20/20 | 0 | $795,661 |
| Tourist | 30 | reckless | 20/20 | 0 | $486,114 |
| Tourist | 60 | careful | 20/20 | 0 | $2,620,469 |
| Tourist | 60 | reckless | 20/20 | 0 | $2,476,493 |
| Tourist | 90 | careful | 20/20 | 0 | $5,765,030 |
| Tourist | 90 | reckless | 20/20 | 0 | $5,197,495 |
| Regular | 30 | careful | 16/20 | 0 | $114,765 |
| Regular | 30 | reckless | 18/20 | 1 | $116,912 |
| Regular | 60 | careful | 18/20 | 0 | $1,428,536 |
| Regular | 60 | reckless | 13/20 | 6 | $1,294,581 |
| Regular | 90 | careful | 17/20 | 2 | $3,983,986 |
| Regular | 90 | reckless | 15/20 | 4 | $4,177,853 |
| Wanted | 30 | careful | 7/20 | 0 | −$81,405 |
| Wanted | 30 | reckless | 13/20 | 0 | $144,058 |
| Wanted | 60 | careful | 7/20 | 2 | −$5,742,867 |
| Wanted | 60 | reckless | 6/20 | 7 | −$505,263 |
| Wanted | 90 | careful | 10/20 | 5 | $1,299,174 |
| Wanted | 90 | reckless | 5/20 | 9 | −$176,988 |

### Debugging

`window.__PC` exposes the following:
- the live `state`
- `act(action)`
- `force('watchers' | 'rival' | 'boss' | 'goons' | 'stray' | 'mugging' | 'stash')`, which starts an encounter now
- `set(patch)`
- `bot(n)`, which lets the bot play `n` moves

### Deploying

Merging to `main` runs `.gitlab-ci.yml`: validate, then rsync to
`greykit.com/games/pumacity/` on DreamHost. The host key is pinned rather than
scanned, and `--delete-excluded` keeps `tools/` and `screenshots/` off the
live site.

## Other Puma games

[PumaRally](https://greykit.com/games/pumarally/) ·
[PumaTriage](https://greykit.com/games/pumatriage/) ·
[PumaHeart](https://greykit.com/games/pumaheart/) ·
[PumaTower](https://greykit.com/games/pumatower/) ·
[more](https://greykit.com/games/)

## Credits

Game design and code by shandower, with AI assistance from Claude.
Inspired by *Dope Wars* by John E. Dell. MIT licensed.
