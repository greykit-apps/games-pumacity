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
/* Target share of careful-bot runs that finish in profit, per run length. The
 * bot knows every price band, so it is a strong player: a 30-day run should
 * still fail for it sometimes. Longer runs leave time to recover, so they may
 * profit more often, but never trivially. */
const PROFIT_BAND = { 30: [0.55, 0.95], 60: [0.6, 1], 90: [0.6, 1] };
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
  if (!(st.hp >= 0 && st.hp <= C.CONFIG.maxHp)) bad.push(`hp ${st.hp}`);
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

function playRun(seed, days, style) {
  let st = C.newGame({ seed, days, name: 'Bot' });
  const where = `seed ${seed}, ${days} days, ${style}`;
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
let reckDeaths = 0;
for (const days of C.CONFIG.lengths) {
  for (const style of ['careful', 'reckless']) {
    const res = [];
    for (let i = 0; i < N; i++) {
      const seed = C.hash32(days * 1000003 + i * 7919 + (style === 'reckless' ? 17 : 0)) | 0;
      let st;
      try { st = playRun(seed, days, style); } catch (e) { fail(`seed ${seed}, ${days} days, ${style}: crash: ${e.stack}`); st = null; }
      if (st) res.push(st);
    }
    const scores = res.map(s => s.over.score).sort((a, b) => a - b);
    const deaths = res.filter(s => s.over.reason === 'dead').length;
    const profit = res.filter(s => s.over.reason === 'days' && s.over.score > 0).length;
    const median = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
    const best = scores.length ? scores[scores.length - 1] : 0;
    rows.push({ days, style, runs: res.length, profit, deaths, median, best });
    if (style === 'reckless') reckDeaths += deaths;
    const [lo, hi] = PROFIT_BAND[days];
    if (style === 'careful' && res.length && (profit / res.length < lo || (hi < 1 && profit / res.length > hi))) {
      fail(`${days} days, careful: ${profit}/${res.length} runs finished in profit; the target band is ${Math.round(lo * 100)}–${Math.round(hi * 100)}%`);
    }
    if (verbose) for (const s of res) console.log(`  ${days}d ${style} seed ${s.seed}: ${s.over.reason} ${C.fmt(s.over.score)} (peak ${C.fmt(s.stats.peak)}, won ${s.stats.won}, fled ${s.stats.fled}, busted ${s.stats.busted})`);
  }
}
if (reckDeaths === 0) fail('no reckless run ever died: combat cannot kill you, or the bots never fight');

console.log('days  bot        runs  profit  deaths  median score   best score');
for (const r of rows) {
  console.log(`${String(r.days).padStart(4)}  ${r.style.padEnd(9)}  ${String(r.runs).padStart(4)}  ${String(r.profit).padStart(6)}  ${String(r.deaths).padStart(6)}  ${C.fmt(r.median).padStart(12)}  ${C.fmt(r.best).padStart(11)}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures.slice(0, 30)) console.error('  ' + f);
  process.exit(1);
}
console.log(`\nsim: ${rows.reduce((n, r) => n + r.runs, 0)} runs, all invariants held`);
