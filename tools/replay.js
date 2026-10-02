#!/usr/bin/env node
/*
 * Golden replays: the bots play fixed seeds through step(), and every event
 * line and the final state must match what tools/replay.json recorded.
 *
 *   node tools/replay.js            check against tools/replay.json
 *   node tools/replay.js --record   rewrite tools/replay.json
 *
 * This is what holds the Regular game still. A refactor that should change
 * nothing (moving the rules into the run state, say) proves it here, byte for
 * byte, instead of by eye. A change that is meant to move the game (a balance
 * tweak) fails here first, and is re-recorded on purpose, in the same commit,
 * with the reason in its message. Fails on zero replays.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadCore } = require('./core.js');
const C = loadCore();

const FILE = path.join(__dirname, 'replay.json');
const SEEDS = [1, 7, 42, 99, 314, 2718, 31337, 65535];
const MAX_ACTIONS = 6000;
const record = process.argv.includes('--record');

/* The final state, minus what is allowed to differ between engine versions
 * without changing the game: the preset and rules the run carries (they are
 * inputs, not outcomes). */
function outcome(st) {
  const o = JSON.parse(JSON.stringify(st));
  delete o.rules;
  delete o.preset;
  return o;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function play(seed, days, style) {
  let st = C.newGame({ seed, days, name: 'Bot' });
  const lines = [];
  for (let i = 0; i < MAX_ACTIONS && !st.over; i++) {
    const r = C.step(st, C.botAct(st, style));
    if (r.refused) throw new Error(`seed ${seed} ${days}d ${style}: refused: ${r.refused}`);
    for (const e of r.events) lines.push(`${e.d}|${e.cls}|${e.text}`);
    st = r.state;
  }
  if (!st.over) throw new Error(`seed ${seed} ${days}d ${style}: never ended`);
  return { seed, days, style, score: st.over.score, reason: st.over.reason, day: st.over.day,
    events: lines.length, eventsHash: sha(lines.join('\n')), stateHash: sha(JSON.stringify(outcome(st))) };
}

const runs = [];
for (const days of C.CONFIG.lengths) for (const style of ['careful', 'reckless']) for (const seed of SEEDS) runs.push(play(seed, days, style));
if (!runs.length) { console.error('replay: zero replays proves nothing'); process.exit(1); }

if (record) {
  fs.writeFileSync(FILE, JSON.stringify(runs, null, 1) + '\n');
  console.log(`replay: recorded ${runs.length} runs to tools/replay.json`);
  process.exit(0);
}

const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (want.length !== runs.length) { console.error(`replay: ${runs.length} runs, but replay.json holds ${want.length}`); process.exit(1); }
let bad = 0;
runs.forEach((got, i) => {
  const w = want[i];
  const diff = Object.keys(w).filter(k => w[k] !== got[k]);
  if (diff.length) {
    bad++;
    console.error(`  FAIL  seed ${got.seed}, ${got.days} days, ${got.style}: ${diff.map(k => `${k} ${w[k]} -> ${got[k]}`).join(', ')}`);
  }
});
if (bad) { console.error(`replay: ${bad}/${runs.length} runs differ from tools/replay.json`); process.exit(1); }
console.log(`replay: all ${runs.length} runs match tools/replay.json`);
