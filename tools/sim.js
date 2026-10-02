#!/usr/bin/env node
/*
 * Plays whole runs with bots, through the same step() door the screen uses.
 *
 *   node tools/sim.js [N] [--verbose]
 *
 * N runs (default 20) at every run length, each with a careful bot and a
 * reckless one (the reckless bot always fights). Fails on:
 *   - a crash, or an action the engine refuses (the bot only offers legal moves)
 *   - a broken invariant after any step: negative cash, bank or debt; a pouch
 *     over capacity; health outside 0..max; heat outside 0..100; a bad price
 *   - a bot changing st.rng while it thinks (bots must not consume randomness)
 *   - a run that never ends
 *   - careful runs finishing in profit outside the target band for their
 *     length, or no deaths at all among the reckless runs. A sim that only
 *     reports "no crashes" cannot tell a working game from one where winning
 *     (or losing) is unreachable -- and the upper bound stops the economy
 *     drifting back to "every run is a win", which it did once already.
 */
'use strict';
const { loadCore } = require('./core.js');
const C = loadCore();

const args = process.argv.slice(2);
const N = Number(args.find(a => /^\d+$/.test(a)) || 20);
const verbose = args.includes('--verbose');
/* Target share of careful-bot runs that finish in profit, per preset and run
 * length. The bot knows every price band, so it is a strong player: a Regular
 * 30-day run should still fail for it sometimes. Longer runs leave time to
 * recover, so they may profit more often, but never trivially. Tourist should
 * almost never lose; Wanted should beat the bot more often than not. */
const PROFIT_BAND = {
  tourist: { 30: [0.9, 1], 60: [0.9, 1], 90: [0.9, 1] },
  regular: { 30: [0.55, 0.95], 60: [0.6, 1], 90: [0.6, 1] },
  wanted:  { 30: [0.25, 0.6], 60: [0.25, 0.7], 90: [0.25, 0.7] },
};
/* Presets where some reckless run must die: combat has to be able to kill. */
const MUST_DIE = ['regular', 'wanted'];
const only = (args.find(a => a.startsWith('--preset=')) || '').slice(9);
const PRESETS = only === 'custom' ? [] : only ? [only] : C.PRESET_IDS;
if (PRESETS.some(p => !PROFIT_BAND[p])) { console.error(`sim: no profit band for ${PRESETS.find(p => !PROFIT_BAND[p])}`); process.exit(1); }
const MAX_ACTIONS = 6000;

if (!(N > 0)) { console.error('sim: N must be at least 1; a sim of zero runs proves nothing'); process.exit(1); }

const failures = [];
function fail(msg) { failures.push(msg); }

function checkInvariants(st, where) {
  const bad = [];
  if (!(st.cash >= 0)) bad.push(`cash ${st.cash}`);
  if (!(st.bank >= 0)) bad.push(`bank ${st.bank}`);
  if (!(st.debt >= 0)) bad.push(`debt ${st.debt}`);
  if (C.used(st) > C.capacity(st)) bad.push(`pouch ${C.used(st)}/${C.capacity(st)}`);
  if (!(st.hp >= 0 && st.hp <= C.R(st).maxHp)) bad.push(`hp ${st.hp}`);
  if (!(st.heat >= 0 && st.heat <= 100)) bad.push(`heat ${st.heat}`);
  if (!(st.day >= 1 && st.day <= st.days)) bad.push(`day ${st.day}`);
  for (const g of C.GOODS) {
    const p = st.prices[g.id];
    if (p !== null && !(Number.isInteger(p) && p > 0)) bad.push(`price ${g.id}=${p}`);
    const q = st.stash[g.id];
    if (q !== undefined && !(Number.isInteger(q) && q > 0)) bad.push(`stash ${g.id}=${q}`);
  }
  for (const k of ['cash', 'bank', 'debt']) if (!Number.isInteger(st[k])) bad.push(`${k} not an integer: ${st[k]}`);
  if (bad.length) fail(`${where}: invariant broken: ${bad.join(', ')}`);
  return !bad.length;
}

function playRun(seed, days, style, preset) { return playRunWith(seed, days, style, { preset }, preset); }
function playRunWith(seed, days, style, opts, label) {
  let st = C.newGame(Object.assign({ seed, days, name: 'Bot' }, opts));
  const where = `${label}, seed ${seed}, ${days} days, ${style}`;
  checkInvariants(st, where);
  for (let i = 0; i < MAX_ACTIONS; i++) {
    if (st.over) return st;
    const rngBefore = st.rng;
    const snapshot = JSON.stringify(st);
    const a = C.botAct(st, style);
    if (st.rng !== rngBefore || JSON.stringify(st) !== snapshot) { fail(`${where}: botAct changed the state`); return null; }
    if (!a) { fail(`${where}: bot had no move on day ${st.day}`); return null; }
    const r = C.step(st, a);
    if (r.refused) { fail(`${where}: day ${st.day}, ${JSON.stringify(a)} refused: ${r.refused}`); return null; }
    st = r.state;
    if (!checkInvariants(st, `${where}, day ${st.day}`)) return null;
  }
  fail(`${where}: run did not end within ${MAX_ACTIONS} actions`);
  return null;
}

const rows = [];
for (const preset of PRESETS) {
let reckDeaths = 0;
for (const days of C.CONFIG.lengths) {
  for (const style of ['careful', 'reckless']) {
    const res = [];
    for (let i = 0; i < N; i++) {
      // Regular keeps the seeds it always had, so its figures stay comparable.
      const seed = C.hash32(days * 1000003 + i * 7919 + (style === 'reckless' ? 17 : 0) + C.PRESET_IDS.indexOf(preset) * 104729 - C.PRESET_IDS.indexOf('regular') * 104729) | 0;
      let st;
      try { st = playRun(seed, days, style, preset); } catch (e) { fail(`${preset}, seed ${seed}, ${days} days, ${style}: crash: ${e.stack}`); st = null; }
      if (st) res.push(st);
    }
    const scores = res.map(s => s.over.score).sort((a, b) => a - b);
    const deaths = res.filter(s => s.over.reason === 'dead').length;
    const profit = res.filter(s => s.over.reason === 'days' && s.over.score > 0).length;
    const median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
    const best = scores.length ? scores[scores.length - 1] : 0;
    rows.push({ preset, days, style, runs: res.length, profit, deaths, median, best });
    if (style === 'reckless') reckDeaths += deaths;
    const [lo, hi] = PROFIT_BAND[preset][days];
    if (style === 'careful' && res.length && (profit / res.length < lo || (hi < 1 && profit / res.length > hi))) {
      fail(`${preset}, ${days} days, careful: ${profit}/${res.length} runs finished in profit; the target band is ${Math.round(lo * 100)}–${Math.round(hi * 100)}%`);
    }
    if (verbose) for (const s of res) console.log(`  ${preset} ${days}d ${style} seed ${s.seed}: ${s.over.reason} ${C.fmt(s.over.score)} (peak ${C.fmt(s.stats.peak)}, won ${s.stats.won}, fled ${s.stats.fled}, busted ${s.stats.busted})`);
  }
}
if (MUST_DIE.includes(preset) && reckDeaths === 0) fail(`${preset}: no reckless run ever died: combat cannot kill you, or the bots never fight`);
}

/* Custom rules have no balance to hold, but every combination of knobs must
 * still play out: no crash, no broken invariant, every run ends. Each run
 * draws its own random step for every knob (from a hash, so it's repeatable). */
if (!only || only === 'custom') {
  let n = 0;
  for (let i = 0; i < N; i++) {
    for (const days of C.CONFIG.lengths) for (const style of ['careful', 'reckless']) {
      const seed = C.hash32(i * 2654435761 + days * 97 + (style === 'reckless' ? 1 : 0)) | 0;
      const custom = Object.fromEntries(C.KNOBS.map((k, j) => [k.id, C.hash32(seed + j * 40503) % k.steps.length]));
      let st;
      try {
        st = playRunWith(seed, days, style, { preset: 'custom', custom }, `custom ${JSON.stringify(custom)}`);
      } catch (e) { fail(`custom ${JSON.stringify(custom)}, seed ${seed}, ${days} days, ${style}: crash: ${e.stack}`); }
      if (st) n++;
    }
  }
  rows.push({ preset: 'custom', days: '*', style: 'random', runs: n, profit: '-', deaths: '-', median: 0, best: 0 });
}

console.log('preset   days  bot        runs  profit  deaths  median score   best score');
for (const r of rows) {
  if (r.preset === 'custom') { console.log(`custom   any   random     ${String(r.runs).padStart(4)}  (safety only: every knob combination plays out)`); continue; }
  console.log(`${r.preset.padEnd(7)}  ${String(r.days).padStart(4)}  ${r.style.padEnd(9)}  ${String(r.runs).padStart(4)}  ${String(r.profit).padStart(6)}  ${String(r.deaths).padStart(6)}  ${C.fmt(r.median).padStart(12)}  ${C.fmt(r.best).padStart(11)}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures.slice(0, 30)) console.error('  ' + f);
  process.exit(1);
}
console.log(`\nsim: ${rows.reduce((n, r) => n + r.runs, 0)} runs, all invariants held`);
