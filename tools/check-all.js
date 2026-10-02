#!/usr/bin/env node
/*
 * Named rule scenarios against the core cut out of index.html.
 *
 *   node tools/check-all.js
 *
 * Each scenario builds a state, pokes at it through step() and asserts what
 * the rules say should happen. A run that finds no scenarios fails: a check
 * that checks nothing must never read as a pass.
 */
'use strict';
const assert = require('assert');
const { loadCore, coreSource } = require('./core.js');

const scenarios = [];
function scenario(name, fn) { scenarios.push({ name, fn }); }

/* Fresh core per scenario, so no scenario can leak into the next. */
function fresh(opts) {
  const C = loadCore();
  const st = C.newGame(Object.assign({ seed: 12345, days: 30, name: 'Test' }, opts || {}));
  // The scenarios do their arithmetic from $2,000 in hand, independent of
  // whatever the tuned starting cash is; 'start: the declared position' pins that.
  st.cash = 2000;
  return { C, st };
}
/* Step that must succeed. */
function ok(C, st, a) {
  const r = C.step(st, a);
  assert.strictEqual(r.refused, null, `${JSON.stringify(a)} was refused: ${r.refused}`);
  return r.state;
}
function refused(C, st, a) {
  const r = C.step(st, a);
  assert.ok(r.refused, `${JSON.stringify(a)} should have been refused`);
  assert.strictEqual(r.state, st, 'a refused step must return the input state untouched');
  return r.refused;
}
/* A market where every good is in stock at a known price. */
function setPrices(C, st, price) {
  for (const g of C.GOODS) st.prices[g.id] = price;
  st.enc = null;
}
/* Travel somewhere without an encounter getting in the way of the assertion. */
function travelQuiet(C, st, to) {
  for (let seed = 1; seed < 500; seed++) {
    const s = JSON.parse(JSON.stringify(st));
    s.rng = seed;
    const r = C.step(s, { t: 'travel', to });
    if (!r.refused && !r.state.enc && !r.state.over) return r.state;
  }
  throw new Error('no quiet trip found');
}

// ---- data
scenario('custom: every knob reaches Regular, and every preset is reachable on the knobs', () => {
  const { C } = fresh();
  for (const k of C.KNOBS) assert.ok(C.stepOf(k, C.RULES) >= 0, `${k.id} has no step matching Regular`);
  for (const id of C.PRESET_IDS) assert.deepStrictEqual(C.customRules(C.choicesFor(C.presetRules(id))), C.presetRules(id), `${id} cannot be rebuilt on the knobs`);
  assert.deepStrictEqual(C.customRules({}), C.RULES, 'no choices means Regular');
  assert.deepStrictEqual(C.rulesChanges(C.RULES), [], 'Regular changes nothing');
});
scenario('custom: the engine applies only listed steps; anything else falls back to Regular', () => {
  const { C } = fresh();
  const junk = { startCash: 99, debtRate: -1, goonDays: 2.5, maxHp: '0', eventSize: null, nonsense: 3, finds: 1e9 };
  assert.deepStrictEqual(C.customRules(junk), C.RULES, 'out-of-range, fractional, string and unknown choices are all ignored');
  const rich = C.KNOBS.find(k => k.id === 'startCash');
  const i = rich.steps.indexOf(10000);
  const st = C.newGame({ seed: 3, days: 30, preset: 'custom', custom: { startCash: i } });
  assert.strictEqual(st.preset, 'custom');
  assert.strictEqual(st.cash, 10000);
  assert.strictEqual(st.rules.debtRate, C.RULES.debtRate, 'knobs not chosen stay Regular');
  const wild = C.customRules({ eventSize: 2 });
  assert.deepStrictEqual([wild.eventUp, wild.eventDown], [[4, 8], [0.1, 0.25]], 'a step can set several rules together');
});
scenario('presets: Regular is the defaults; the others start and charge on their own rules', () => {
  const { C } = fresh();
  assert.deepStrictEqual(C.PRESET_IDS, ['tourist', 'regular', 'wanted']);
  assert.deepStrictEqual(C.presetRules('regular'), C.RULES);
  const plain = C.newGame({ seed: 5, days: 30 });
  assert.strictEqual(plain.preset, 'regular', 'no preset given means Regular');
  assert.strictEqual(C.newGame({ seed: 5, days: 30, preset: 'nightmare' }).preset, 'regular', 'an unknown preset means Regular');
  for (const id of ['tourist', 'wanted']) {
    const R = C.presetRules(id);
    const st = C.newGame({ seed: 5, days: 30, preset: id });
    assert.strictEqual(st.preset, id);
    assert.deepStrictEqual(st.rules, R);
    assert.strictEqual(st.cash, R.startCash);
    assert.strictEqual(st.debt, R.startDebt);
    assert.ok(st.log.some(l => l.text.includes(`at ${Math.round(R.debtRate * 100)}% a day`)), `${id}: the welcome line states its own rate`);
    const next = travelQuiet(C, st, 'ranch');
    assert.strictEqual(next.debt, Math.round(R.startDebt * (1 + R.debtRate)), `${id}: the debt grows at its own rate`);
  }
});
scenario('presets: every change names a rule that exists', () => {
  const { C } = fresh();
  for (const id of C.PRESET_IDS) {
    for (const k of Object.keys(C.PRESETS[id].rules)) assert.ok(k in C.RULES, `${id} sets '${k}', which is not a rule; a typo here would change nothing`);
    assert.ok(C.PRESETS[id].name && C.PRESETS[id].blurb, `${id} needs a name and a blurb for the title screen`);
  }
});
scenario('rules: a run carries its own copy, and the engine reads that copy', () => {
  const { C, st } = fresh();
  assert.deepStrictEqual(st.rules, C.RULES, 'a new run starts on the default rules');
  assert.notStrictEqual(st.rules, C.RULES, 'a copy, not the shared defaults');
  // Change this run's rules only: the debt and the bank follow them overnight.
  st.rules.debtRate = 0.25;
  st.rules.bankRate = 0.5;
  st.bank = 1000;
  const debt = st.debt;
  const next = travelQuiet(C, st, 'ranch');
  assert.strictEqual(next.debt, Math.round(debt * 1.25));
  assert.strictEqual(next.bank, 1500);
  assert.strictEqual(C.RULES.debtRate, 0.10, 'the defaults are untouched');
  // A run's rules survive the trip, so a save keeps what it started with.
  assert.strictEqual(next.rules.debtRate, 0.25);
});
scenario('data: nine goods, seven places, unique ids, sane bands', () => {
  const { C } = fresh();
  assert.strictEqual(C.GOODS.length, 9);
  assert.strictEqual(C.PLACES.length, 7);
  assert.strictEqual(new Set(C.GOODS.map(g => g.id)).size, 9);
  assert.strictEqual(new Set(C.PLACES.map(p => p.id)).size, 7);
  for (const g of C.GOODS) assert.ok(g.lo > 0 && g.lo < g.hi && g.name && g.blurb, g.id);
  for (let i = 1; i < C.GOODS.length; i++) assert.ok(C.GOODS[i].lo > C.GOODS[i - 1].lo, 'goods are listed cheapest first');
});
scenario('data: every shop item exists, and every gear item is sold somewhere', () => {
  const { C } = fresh();
  const sold = new Set();
  for (const P of C.PLACES) for (const id of P.shop) { assert.ok(C.GEAR[id], `${P.id} sells unknown ${id}`); sold.add(id); }
  for (const id of Object.keys(C.GEAR)) {
    assert.ok(sold.has(id), `${id} is never sold`);
    assert.ok(C.SLOTS.includes(C.GEAR[id].slot), `${id} has unknown slot`);
  }
  for (const P of C.PLACES) assert.ok(P.blurb && P.special && P.name, P.id);
});
scenario('data: the places the plan names have their specials', () => {
  const { C } = fresh();
  assert.ok(C.PLACE.plaza.shop.includes('fanny') && C.PLACE.plaza.shop.includes('spray'), 'the outfitter is at Market Plaza');
  assert.strictEqual(C.PLACE.suburbs.shop.length, 0, 'the Suburbs keep only the vet');
  assert.strictEqual(C.PLACE.pvn.service, 'loan');
  assert.strictEqual(C.PLACE.vault.service, 'bank');
  assert.strictEqual(C.PLACE.suburbs.service, 'vet');
  assert.ok(C.PLACE.ranch.mods.nip < 1, "'nip is cheap at The Ranch");
  assert.ok(C.PLACE.starport.mods.moonsugar < 1 && C.PLACE.starport.mods.skooma < 1);
  assert.ok(C.PLACE.pvn.mods.skooma > 1, 'Skooma sells high at PVN Tower');
  assert.ok(C.PLACE.plaza.mods.skooma > 1, 'tourists pay a premium for luxury goods');
  assert.ok(C.PLACE.starport.shop.includes('hovercrate') && C.PLACE.starport.shop.includes('mech'));
});
scenario('core: never touches the page, the clock or storage', () => {
  const src = coreSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Code patterns, not bare words: the story text is allowed a tinted window.
  for (const re of [/\bwindow\./, /\bdocument\./, /localStorage/, /sessionStorage/, /Date\.now/, /new Date/, /Math\.random/]) {
    assert.ok(!re.test(src), `the core uses ${re}`);
  }
});

// ---- the start
scenario('start: the declared position', () => {
  const C = loadCore();
  const st = C.newGame({ seed: 12345, days: 30 });
  assert.strictEqual(st.day, 1);
  assert.strictEqual(st.loc, 'plaza');
  assert.strictEqual(st.cash, 1500);
  assert.strictEqual(st.debt, 8000);
  assert.strictEqual(st.hp, 100);
  assert.strictEqual(C.capacity(st), 100);
  assert.strictEqual(C.used(st), 0);
  assert.strictEqual(st.enc, null);
  const out = C.GOODS.filter(g => st.prices[g.id] === null).length;
  assert.ok(out <= 2, 'at most two goods are out of stock');
});
scenario('start: run length is one of 30, 60 or 90', () => {
  const { C } = fresh();
  for (const d of [30, 60, 90]) assert.strictEqual(C.newGame({ seed: 1, days: d }).days, d);
  assert.strictEqual(C.newGame({ seed: 1, days: 45 }).days, 30);
});
scenario('start: a long name is cut by characters, never mid-emoji', () => {
  const { C } = fresh();
  const st = C.newGame({ seed: 1, name: 'abcdefghijklmno\u{1F406}xyz' });
  assert.strictEqual(Array.from(st.name).length, 16);
  assert.ok(st.name.endsWith('\u{1F406}'), JSON.stringify(st.name));
  assert.strictEqual(C.newGame({ seed: 1, name: '   ' }).name, 'Stray');
});
scenario('replay: the same seed and moves give the same run', () => {
  const { C } = fresh();
  const play = () => {
    let st = C.newGame({ seed: 777, days: 30 });
    for (let i = 0; i < 400 && !st.over; i++) st = C.step(st, C.botAct(st)).state;
    return JSON.stringify(st);
  };
  assert.strictEqual(play(), play());
});
scenario('save: a state round-trips through JSON and plays on identically', () => {
  let { C, st } = fresh();
  for (let i = 0; i < 60 && !st.over; i++) st = C.step(st, C.botAct(st)).state;
  const copy = JSON.parse(JSON.stringify(st));
  assert.deepStrictEqual(copy, st);
  const a = C.botAct(st);
  assert.deepStrictEqual(C.step(copy, a).state, C.step(st, a).state);
});

// ---- trading
scenario('buy: moves cash and stash exactly', () => {
  let { C, st } = fresh();
  setPrices(C, st, 30);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 10 });
  assert.strictEqual(st.cash, 1700);
  assert.strictEqual(st.stash.nip, 10);
  assert.strictEqual(st.cost.nip, 300);
});
scenario('buy: refused when the pouch is full', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 100 });
  assert.match(refused(C, st, { t: 'buy', good: 'feathers', qty: 1 }), /room/);
});
scenario('buy: refused when the cash is short', () => {
  const { C, st } = fresh();
  setPrices(C, st, 1000);
  assert.match(refused(C, st, { t: 'buy', good: 'nip', qty: 3 }), /afford/);
});
scenario('buy: refused for a good out of stock, or a silly quantity', () => {
  const { C, st } = fresh();
  setPrices(C, st, 10);
  st.prices.nip = null;
  assert.match(refused(C, st, { t: 'buy', good: 'nip', qty: 1 }), /Nobody/);
  refused(C, st, { t: 'buy', good: 'feathers', qty: 0 });
  refused(C, st, { t: 'buy', good: 'feathers', qty: -5 });
  refused(C, st, { t: 'buy', good: 'feathers', qty: 'lots' });
  refused(C, st, { t: 'buy', good: 'nothing', qty: 1 });
});
scenario('sell: pays the price and keeps the average cost of what is left', () => {
  let { C, st } = fresh();
  setPrices(C, st, 20);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 10 });
  st.prices.nip = 50;
  st = ok(C, st, { t: 'sell', good: 'nip', qty: 4 });
  assert.strictEqual(st.cash, 2000 - 200 + 200);
  assert.strictEqual(st.stash.nip, 6);
  assert.strictEqual(st.cost.nip, 120);
  st = ok(C, st, { t: 'sell', good: 'nip', qty: 6 });
  assert.strictEqual(st.stash.nip, undefined);
  assert.strictEqual(st.cost.nip, undefined);
  refused(C, st, { t: 'sell', good: 'nip', qty: 1 });
});
scenario('sell all: sells everything someone here buys, and keeps the rest', () => {
  let { C, st } = fresh();
  setPrices(C, st, 10);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 5 });
  st = ok(C, st, { t: 'buy', good: 'feathers', qty: 3 });
  st = ok(C, st, { t: 'buy', good: 'zoomers', qty: 2 });
  st.prices.nip = 40; st.prices.feathers = 70; st.prices.zoomers = null;
  const cash = st.cash;
  st = ok(C, st, { t: 'sellall' });
  assert.strictEqual(st.cash, cash + 5 * 40 + 3 * 70);
  assert.strictEqual(st.stash.nip, undefined);
  assert.strictEqual(st.stash.feathers, undefined);
  assert.strictEqual(st.stash.zoomers, 2, 'nobody here buys Zoomers, so they stay');
  assert.ok(!C.waiting(st).options.includes('sellall'));
  refused(C, st, { t: 'sellall' });
});
scenario('sell: a big sale raises heat, and Shades halve it', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = ok(C, st, { t: 'buy', good: 'skooma', qty: 10 });
  st.prices.skooma = 4000;
  const a = ok(C, st, { t: 'sell', good: 'skooma', qty: 10 });
  assert.strictEqual(a.heat, 8);
  st.gear.shades = 'shades';
  const b = ok(C, st, { t: 'sell', good: 'skooma', qty: 10 });
  assert.strictEqual(b.heat, 4);
});

// ---- days, debt and the bank
scenario('travel: takes a day, compounds the debt 10% and the bank 1%', () => {
  let { C, st } = fresh();
  st.bank = 10000;
  st.debt = 5500;
  st = travelQuiet(C, st, 'ranch');
  assert.strictEqual(st.day, 2);
  assert.strictEqual(st.loc, 'ranch');
  assert.strictEqual(st.debt, 6050);
  assert.strictEqual(st.bank, 10100);
  st = travelQuiet(C, st, 'vault');
  assert.strictEqual(st.debt, 6655);
  assert.strictEqual(st.bank, 10201);
});
scenario('travel: refused to where you already are, or to nowhere', () => {
  const { C, st } = fresh();
  refused(C, st, { t: 'travel', to: 'plaza' });
  refused(C, st, { t: 'travel', to: 'moon' });
});
scenario('heat: cools each day, faster at The Ranch', () => {
  let { C, st } = fresh();
  st.heat = 50;
  const a = travelQuiet(C, st, 'vault');
  assert.strictEqual(a.heat, 46);
  const b = travelQuiet(C, st, 'ranch');
  assert.strictEqual(b.heat, 40);
});
scenario('loan: only at PVN Tower, capped, and a real repayment resets the clock', () => {
  let { C, st } = fresh();
  refused(C, st, { t: 'borrow', amt: 100 });
  st.loc = 'pvn';
  st.debt = 5500;
  st.debtAge = 7;
  st = ok(C, st, { t: 'borrow', amt: 1000 });
  assert.strictEqual(st.debt, 6500);
  assert.strictEqual(st.cash, 3000);
  assert.match(refused(C, st, { t: 'borrow', amt: C.RULES.debtCap }), /won't carry/);
  st = ok(C, st, { t: 'repay', amt: 100 });
  assert.strictEqual(st.debtAge, 7, 'a token payment does not count');
  st = ok(C, st, { t: 'repay', amt: 1000 });
  assert.strictEqual(st.debtAge, 0);
  assert.strictEqual(st.debt, 5400);
  refused(C, st, { t: 'repay', amt: 999999 });
});
scenario('bank: only at The Vault; deposits and withdrawals balance', () => {
  let { C, st } = fresh();
  refused(C, st, { t: 'deposit', amt: 100 });
  st.loc = 'vault';
  st = ok(C, st, { t: 'deposit', amt: 1500 });
  assert.strictEqual(st.cash, 500);
  assert.strictEqual(st.bank, 1500);
  refused(C, st, { t: 'deposit', amt: 501 });
  refused(C, st, { t: 'withdraw', amt: 1501 });
  st = ok(C, st, { t: 'withdraw', amt: 1500 });
  assert.strictEqual(st.cash, 2000);
});
scenario('goons: come after the debt goes unpaid too long, and never in PVN Tower', () => {
  let { C, st } = fresh();
  st.debtAge = C.RULES.goonDays - 1;
  let seen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = JSON.parse(JSON.stringify(st));
    s.rng = seed;
    const r = C.step(s, { t: 'travel', to: 'ranch' });
    if (r.state.enc && r.state.enc.type === 'goons') seen++;
    const p = C.step(s, { t: 'travel', to: 'pvn' });
    assert.ok(!(p.state.enc && p.state.enc.type === 'goons'), 'goons in PVN Tower');
  }
  assert.ok(seen > 5, `goons came ${seen} times in 60 trips`);
  st.debtAge = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = JSON.parse(JSON.stringify(st));
    s.rng = seed;
    const r = C.step(s, { t: 'travel', to: 'ranch' });
    assert.ok(!(r.state.enc && r.state.enc.type === 'goons'), 'goons with a fresh debt');
  }
});
scenario('goons: paying clears the clock; refusing costs health and cash', () => {
  let { C, st } = fresh();
  st.debtAge = 12;
  st = C.forceEncounter(st, 'goons');
  const demand = st.enc.demand;
  const paid = ok(C, st, { t: 'pay' });
  assert.strictEqual(paid.debt, 8000 - demand);
  assert.strictEqual(paid.debtAge, 0);
  assert.strictEqual(paid.enc, null);
  const hurt = ok(C, st, { t: 'refuse' });
  assert.ok(hurt.hp < 100 && hurt.cash < 2000 && hurt.debt < 8000);
  assert.strictEqual(hurt.debtAge, C.RULES.goonDays - 4);
  // a short clock (Custom's 4 days) is never reset by a refusal: they come back
  for (const goonDays of [4, 5, 6]) {
    const s = JSON.parse(JSON.stringify(st));
    s.rules.goonDays = goonDays;
    const h = ok(C, s, { t: 'refuse' });
    assert.ok(h.debtAge > 0 && h.debtAge < goonDays, `goonDays ${goonDays}: refusing left the clock at ${h.debtAge}`);
    assert.ok(goonDays - h.debtAge <= 4, `goonDays ${goonDays}: back in ${goonDays - h.debtAge} days`);
  }
});

// ---- the end
scenario('end: travel is refused on the last day, and cashing out only then', () => {
  let { C, st } = fresh();
  refused(C, st, { t: 'finish' });
  st.day = 30;
  assert.ok(C.waiting(st).options.includes('finish'));
  refused(C, st, { t: 'travel', to: 'ranch' });
  st = ok(C, st, { t: 'finish' });
  assert.strictEqual(st.over.reason, 'days');
  assert.match(refused(C, st, { t: 'buy', good: 'nip', qty: 1 }), /over/);
});
scenario('end: the debt is paid from cash, then the bank; a shortfall scores negative', () => {
  let { C, st } = fresh();
  st.day = 30;
  st.cash = 3000; st.bank = 4000; st.debt = 5500;
  const a = ok(C, st, { t: 'finish' });
  assert.strictEqual(a.over.score, 1500);
  assert.strictEqual(a.cash, 0);
  assert.strictEqual(a.bank, 1500);
  st.cash = 1000; st.bank = 1000;
  const b = ok(C, st, { t: 'finish' });
  assert.strictEqual(b.over.score, -3500);
});
scenario('end: unsold goods are worth nothing', () => {
  let { C, st } = fresh();
  setPrices(C, st, 10);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 10 });
  st.day = 30;
  st.debt = 0;
  st = ok(C, st, { t: 'finish' });
  assert.strictEqual(st.over.score, 1900);
  assert.strictEqual(st.over.unsold, 10);
});
scenario('end: a full bot run reaches day N and scores', () => {
  for (const days of [30, 60, 90]) {
    let { C, st } = fresh({ days, seed: 99 });
    for (let i = 0; i < 6000 && !st.over; i++) st = ok(C, st, C.botAct(st));
    assert.ok(st.over, `${days}-day run never ended`);
    if (st.over.reason === 'days') assert.strictEqual(st.day, days);
  }
});

// ---- encounters
scenario('watchers: no weapon means no fight', () => {
  let { C, st } = fresh();
  st = C.forceEncounter(st, 'watchers');
  assert.deepStrictEqual(C.waiting(st).options, ['run', 'surrender']);
  refused(C, st, { t: 'fight' });
  st.gear.weapon = 'spray';
  assert.deepStrictEqual(C.waiting(st).options, ['run', 'fight', 'surrender']);
});
scenario('watchers: an encounter blocks the market until it is resolved', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = C.forceEncounter(st, 'watchers');
  refused(C, st, { t: 'buy', good: 'nip', qty: 1 });
  refused(C, st, { t: 'travel', to: 'ranch' });
});
scenario('watchers: surrender confiscates the whole stash and fines you', () => {
  let { C, st } = fresh();
  setPrices(C, st, 10);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 20 });
  st = ok(C, st, { t: 'buy', good: 'feathers', qty: 20 });
  st.bank = 5000;
  st.heat = 60;
  st = C.forceEncounter(st, 'watchers');
  st = ok(C, st, { t: 'surrender' });
  assert.strictEqual(C.used(st), 0);
  assert.deepStrictEqual(st.cost, {});
  assert.strictEqual(st.cash, 1600 - 400);
  assert.strictEqual(st.bank, 5000, 'the bank is untouched');
  assert.ok(st.heat <= 10);
  assert.strictEqual(st.enc, null);
});
scenario('watchers: giving up with nothing on you is a fine, and keeps your heat', () => {
  let { C, st } = fresh();
  st.heat = 80;
  st.cash = 0;
  st.bank = 500000;
  st = C.forceEncounter(st, 'watchers');
  st = ok(C, st, { t: 'surrender' });
  assert.strictEqual(st.heat, 80, 'a clean surrender must not wash heat');
  assert.strictEqual(st.cash, 0);
  st.cash = 3000;
  st = C.forceEncounter(st, 'watchers');
  st = ok(C, st, { t: 'surrender' });
  assert.strictEqual(st.cash, 2700, 'the loitering fine is 10% of cash on you');
  assert.strictEqual(st.heat, 80);
});
scenario('watchers: more heat brings more of them, and Joyeuse', () => {
  let { C, st } = fresh();
  st.heat = 0;
  const calm = C.forceEncounter(st, 'watchers');
  assert.ok(calm.enc.foes.length <= 2);
  assert.ok(!calm.enc.foes.some(f => f.name.includes('Joyeuse')));
  st.heat = 90;
  const hot = C.forceEncounter(st, 'watchers');
  assert.ok(hot.enc.foes.length >= 4);
  assert.ok(hot.enc.foes[0].name.includes('Joyeuse'));
});
scenario('combat: a won fight pays out and raises heat', () => {
  let { C, st } = fresh();
  st.gear.weapon = 'mech';
  st.hp = 100;
  let won = false;
  for (let seed = 1; seed < 200 && !won; seed++) {
    let s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed }), 'watchers');
    while (s.enc && !s.over) s = ok(C, s, { t: 'fight' });
    if (!s.over) { won = true; assert.ok(s.cash > 2000); assert.ok(s.heat >= 15); assert.strictEqual(s.stats.won, 1); }
  }
  assert.ok(won, 'never won a fight with Mech-Claws');
});
scenario('combat: the Kevlar Collar takes damage off', () => {
  const { C, st } = fresh();
  const total = collar => {
    let hurt = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, heat: 90, gear: Object.assign({}, st.gear, { armour: collar ? 'collar' : null }) }), 'watchers');
      const r = C.step(s, { t: 'run' }).state;
      hurt += 100 - r.hp;
    }
    return hurt;
  };
  const bare = total(false);
  const guarded = total(true);
  assert.ok(guarded < bare * 0.75, `collar ${guarded} vs bare ${bare}`);
});
scenario('death: health at zero ends the run, scores no more than nothing, and stops play', () => {
  const { C, st } = fresh();
  let dead = null;
  for (let seed = 1; seed < 500 && !dead; seed++) {
    let s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, hp: 3, heat: 90 }), 'watchers');
    s = C.step(s, { t: 'run' }).state;
    if (s.over) dead = s;
  }
  assert.ok(dead, 'nobody ever died at 3 HP against five Watchers');
  assert.strictEqual(dead.over.reason, 'dead');
  assert.strictEqual(dead.over.score, Math.min(C.netWorth(dead), 0));
  assert.ok(dead.over.score < 0, 'a death in debt keeps the debt on its score');
  assert.strictEqual(dead.hp, 0);
  assert.strictEqual(C.waiting(dead).kind, 'over');
  refused(C, dead, { t: 'run' });
});
scenario('scores: dying never ranks above playing a run out', () => {
  const { C } = fresh();
  const board = [
    { name: 'died rich', score: 0, dead: true },
    { name: 'finished deep in debt', score: -250000, dead: false },
    { name: 'died in debt', score: -4000, dead: true },
    { name: 'finished well', score: 90000, dead: false },
  ].sort(C.scoreOrder).map(e => e.name);
  assert.deepStrictEqual(board, ['finished well', 'finished deep in debt', 'died rich', 'died in debt']);
});
scenario('mugging: takes cash on you, never the bank', () => {
  let { C, st } = fresh();
  st.bank = 9000;
  st = C.forceEncounter(st, 'mugging');
  assert.ok(st.cash < 2000 && st.cash > 0);
  assert.strictEqual(st.bank, 9000);
  assert.strictEqual(st.enc, null, 'a mugging is over before you can react');
});
scenario('boss: a bribe clears heat; refusing raises it', () => {
  let { C, st } = fresh();
  st.heat = 40;
  st.cash = 50000;
  st = C.forceEncounter(st, 'boss');
  assert.strictEqual(st.enc.ask, 'bribe');
  const paid = ok(C, st, { t: 'pay' });
  assert.strictEqual(paid.heat, 0);
  assert.strictEqual(paid.cash, 50000 - st.enc.amount);
  const refusedIt = ok(C, st, { t: 'refuse' });
  assert.strictEqual(refusedIt.heat, 60);
});
scenario('boss: no bribe you cannot afford, and no bribe when there is no heat', () => {
  let { C, st } = fresh();
  st.heat = 40;
  st.cash = 10;
  st = C.forceEncounter(st, 'boss');
  assert.deepStrictEqual(C.waiting(st).options, ['refuse']);
  let { st: cool } = fresh();
  cool.heat = 0;
  cool = C.forceEncounter(cool, 'boss');
  assert.strictEqual(cool.enc, null);
});
scenario('boss: buys your Skooma at a premium', () => {
  let { C, st } = fresh();
  st.stash.skooma = 5;
  st.cost.skooma = 50000;
  let found = null;
  for (let seed = 1; seed < 50 && !found; seed++) {
    const s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed }), 'boss');
    if (s.enc && s.enc.ask === 'skooma') found = s;
  }
  assert.ok(found);
  assert.ok(found.enc.price > C.GOOD.skooma.hi);
  const sold = ok(C, found, { t: 'sell' });
  assert.strictEqual(sold.stash.skooma, undefined);
  assert.strictEqual(sold.cash, 2000 + 5 * found.enc.price);
});
scenario('rival: a deal moves only what fits your pouch and wallet', () => {
  let { C, st } = fresh();
  st.enc = { type: 'rival', foes: [{ name: 'Jad', hp: 14, max: 14 }], n: 1, hostile: false, boss: 'Jad',
    deal: { side: 'sell', good: 'zoomers', qty: 20, price: 150 }, hitP: 0.28, dmg: [3, 7], loot: [150, 600] };
  assert.strictEqual(C.dealQty(st, st.enc.deal), 13);
  st = ok(C, st, { t: 'deal' });
  assert.strictEqual(st.stash.zoomers, 13);
  assert.strictEqual(st.cash, 2000 - 13 * 150);
  assert.strictEqual(st.enc, null);
});
scenario('rival: selling a rival a big load raises heat like a market sale', () => {
  let { C, st } = fresh();
  st.stash = { skooma: 10 };
  st.cost = { skooma: 0 };
  const deal = { side: 'buy', good: 'skooma', qty: 10, price: 20000 };
  const rival = s => Object.assign(JSON.parse(JSON.stringify(s)), { enc: { type: 'rival', foes: [{ name: 'Jad', hp: 14, max: 14 }], n: 1, hostile: false, boss: 'Jad', deal, hitP: 0.28, dmg: [3, 7], loot: [150, 600] } });
  const sold = ok(C, rival(st), { t: 'deal' });
  assert.strictEqual(sold.cash, 2000 + 200000);
  const mkt = JSON.parse(JSON.stringify(st));
  setPrices(C, mkt, 20000);
  const street = ok(C, mkt, { t: 'sell', good: 'skooma', qty: 10 });
  assert.ok(sold.heat > 0, 'the deal added no heat');
  assert.strictEqual(sold.heat, street.heat, 'the same sale, the same heat');
  // and a small deal, like a small sale, adds none
  const tiny = rival(Object.assign(JSON.parse(JSON.stringify(st)), { stash: { nip: 5 }, cost: {} }));
  tiny.enc.deal = { side: 'buy', good: 'nip', qty: 5, price: 30 };
  const small = ok(C, tiny, { t: 'deal' });
  assert.strictEqual(small.heat, 0);
});
scenario('rival: hostile crews take half your stash when you give in', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 9 });
  st.enc = { type: 'rival', foes: [{ name: 'Jad', hp: 14, max: 14 }], n: 1, hostile: true, boss: 'Jad', deal: null, hitP: 0.28, dmg: [3, 7], loot: [150, 600] };
  st = ok(C, st, { t: 'surrender' });
  assert.strictEqual(st.stash.nip, 4);
});
scenario('stray: sells the next pouch or weapon cheap', () => {
  let { C, st } = fresh();
  st = C.forceEncounter(st, 'stray');
  const e = st.enc;
  assert.ok(['fanny', 'spray'].includes(e.item));
  assert.ok(e.price < C.GEAR[e.item].price);
  st = ok(C, st, { t: 'buy' });
  assert.strictEqual(st.gear[C.GEAR[e.item].slot], e.item);
});
scenario('stash: found goods never overfill the pouch', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 98 });
  for (let seed = 1; seed < 40; seed++) {
    const s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed }), 'stash');
    assert.ok(C.used(s) <= C.capacity(s));
  }
});

scenario('getaway: a failed run spills part of every load, and a light one can come through', () => {
  const { C, st } = fresh();
  st.stash = { nip: 10, skooma: 2 };
  st.cost = { nip: 100, skooma: 20000 };
  let failed = null;
  for (let seed = 1; seed < 300 && !failed; seed++) {
    const s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, heat: 90 }), 'watchers');
    const r = C.step(s, { t: 'run' }).state;
    if (r.enc) failed = r;
  }
  assert.ok(failed, 'never failed a getaway');
  const share = C.RULES.dropOnFail;
  assert.strictEqual(failed.stash.nip, 10 - Math.floor(10 * share));
  assert.strictEqual(failed.stash.skooma, 2 - Math.floor(2 * share));
  assert.ok(failed.log.some(l => /spill/.test(l.text)));
});
scenario('watchers: a heavy load draws them, capped', () => {
  const { C, st } = fresh();
  assert.strictEqual(C.carryRisk(st), 0);
  st.stash = { skooma: 3 };
  assert.ok(C.carryRisk(st) > 0);
  st.stash = { skooma: 500 };
  assert.strictEqual(C.carryRisk(st), C.RULES.carryWatchMax);
  const count = load => {
    let n = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, stash: load, cost: {}, enc: null });
      const r = C.step(s, { t: 'travel', to: 'vault' }).state;
      if (r.enc && r.enc.type === 'watchers') n++;
    }
    return n;
  };
  const light = count({}), heavy = count({ skooma: 100 });
  assert.ok(heavy > light * 2, `heavy ${heavy} vs light ${light}`);
});
scenario('watchers: the load risk shown before a buy is the risk after it', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st.cash = 100000;
  st = ok(C, st, { t: 'buy', good: 'moonsugar', qty: 4 });
  const shown = C.carryRiskWith(st, 'skooma', 6);
  st = ok(C, st, { t: 'buy', good: 'skooma', qty: 6 });
  assert.strictEqual(C.carryRisk(st), shown);
  assert.ok(shown > 0 && shown <= C.RULES.carryWatchMax);
});
scenario('map: the Watcher odds shown for a district are the odds rolled on arrival', () => {
  const { C, st } = fresh();
  st.heat = 47;
  st.stash = { moonsugar: 6 };
  st.cost = { moonsugar: 60000 };
  for (const P of C.PLACES) {
    if (P.id === st.loc) continue;
    const shown = C.arrivalWatchOdds(st, P.id);
    const arrived = travelQuiet(C, st, P.id);
    assert.strictEqual(C.watchOdds(arrived, arrived.heat, P), shown, P.id);
  }
});
scenario('map: the Watcher odds are a probability, never over 100%', () => {
  const { C, st } = fresh();
  st.heat = 100;
  st.stash = { skooma: 200 };
  st.cost = { skooma: 0 };
  // Regular at full heat and a maxed load would read 104% at the Starport uncapped
  for (const P of C.PLACES) assert.ok(C.watchOdds(st, 100, P) <= 1, `${P.id}: ${C.watchOdds(st, 100, P)}`);
  assert.strictEqual(C.watchOdds(st, 100, C.PLACE.starport), 1);
  assert.ok(C.arrivalWatchOdds(st, 'starport') <= 1);
  // the custom knobs' worst case
  st.rules = Object.assign(JSON.parse(JSON.stringify(C.RULES)), { watchBase: 0.12, carryWatchMax: 0.5 });
  assert.strictEqual(C.watchOdds(st, 100, C.PLACE.starport), 1);
});
scenario('map: the Watcher odds hold when the goons are also due', () => {
  const { C, st } = fresh();
  st.heat = 100;
  st.stash = { skooma: 200 };
  st.cost = { skooma: 0 };
  st.debtAge = C.RULES.goonDays + 3;
  assert.strictEqual(C.arrivalWatchOdds(st, 'starport'), 1, 'the test needs certain Watchers');
  for (let seed = 1; seed <= 200; seed++) {
    const s = Object.assign(JSON.parse(JSON.stringify(st)), { rng: C.hash32(seed) | 0 });
    const r = C.step(s, { t: 'travel', to: 'starport' }).state;
    assert.ok(r.enc && r.enc.type === 'watchers', `seed ${seed}: shown 100%, got ${r.enc ? r.enc.type : 'nothing'}`);
  }
  // at middling odds the Watchers still come about as often as shown, goons or not
  st.heat = 30; st.stash = {}; st.cost = {};
  const shown = C.arrivalWatchOdds(st, 'ranch');
  let n = 0;
  const N = 2000;
  for (let seed = 1; seed <= N; seed++) {
    const s = Object.assign(JSON.parse(JSON.stringify(st)), { rng: C.hash32(seed * 31) | 0 });
    const r = C.step(s, { t: 'travel', to: 'ranch' }).state;
    if (r.enc && r.enc.type === 'watchers') n++;
  }
  assert.ok(Math.abs(n / N - shown) < 0.03, `shown ${shown.toFixed(3)}, came ${(n / N).toFixed(3)}`);
});
scenario('map: goons are shown as due exactly when they can be waiting tomorrow', () => {
  const { C, st } = fresh();
  st.debtAge = C.RULES.goonDays - 2;
  assert.ok(!C.goonsDue(st));
  st.debtAge = C.RULES.goonDays - 1;
  assert.ok(C.goonsDue(st));
  let seen = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const r = C.step(Object.assign(JSON.parse(JSON.stringify(st)), { rng: C.hash32(seed) | 0 }), { t: 'travel', to: 'ranch' }).state;
    if (r.enc && r.enc.type === 'goons') seen++;
  }
  assert.ok(seen > 0, 'goons never came when shown as due');
  st.debt = 0;
  assert.ok(!C.goonsDue(st));
});
scenario('news: headlines move a price within the declared range', () => {
  const { C } = fresh();
  let seen = 0;
  for (let seed = 1; seed < 400; seed++) {
    const st = C.newGame({ seed, days: 30 });
    if (!st.news) continue;
    seen++;
    const g = C.GOOD[st.news.good];
    const p = st.prices[g.id];
    const [lo, hi] = st.news.up ? C.RULES.eventUp : C.RULES.eventDown;
    const m = (C.PLACE.plaza.mods[g.id] || 1);
    assert.ok(p >= Math.floor(g.lo * m * lo) - 1 && p <= Math.ceil(g.hi * m * hi) + 1, `${g.id} ${p}`);
  }
  assert.ok(seen > 20, `only ${seen} headlines in 400 starts`);
});

scenario('costs: what a choice says it costs is what it costs', () => {
  for (const type of ['watchers', 'rival']) {
    for (const load of [{}, { nip: 9, psychos: 3 }]) {
      const { C, st } = fresh();
      st.cash = 4321; st.stash = Object.assign({}, load); st.cost = {};
      let s = C.forceEncounter(st, type);
      if (type === 'rival') s.enc.hostile = true;
      const cost = C.giveUpCost(s);
      const r = C.step(s, { t: 'surrender' }).state;
      assert.strictEqual(C.used(s) - C.used(r), cost.units, `${type} ${JSON.stringify(load)} units`);
      assert.strictEqual(s.cash - r.cash, cost.cash, `${type} ${JSON.stringify(load)} cash`);
    }
  }
  const { C, st } = fresh();
  st.cash = 5000; st.debtAge = 12;
  const g = C.forceEncounter(st, 'goons');
  const take = C.goonTake(g);
  const r = C.step(g, { t: 'refuse' }).state;
  assert.strictEqual(g.cash - r.cash, take);
  assert.strictEqual(g.debt - r.debt, take);
  const w = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { heat: 90 }), 'watchers');
  const p = C.runChance(w);
  let got = 0;
  for (let seed = 1; seed <= 2000; seed++) if (!C.step(Object.assign(JSON.parse(JSON.stringify(w)), { rng: C.hash32(seed) | 0 }), { t: 'run' }).state.enc) got++;
  assert.ok(Math.abs(got / 2000 - p) < 0.04, `shown ${p}, measured ${got / 2000}`);
});

// ---- gear
scenario('gear: only sold where stocked, only trades up, and pouches add room', () => {
  let { C, st } = fresh();
  st.cash = 50000;
  st.loc = 'suburbs';
  assert.ok(!C.waiting(st).options.includes('gear'), 'no shop in the Suburbs');
  refused(C, st, { t: 'gear', item: 'fanny' });
  st.loc = 'starport';
  assert.match(refused(C, st, { t: 'gear', item: 'fanny' }), /isn't sold/);
  st.loc = 'plaza';
  st = ok(C, st, { t: 'gear', item: 'saddle' });
  assert.strictEqual(C.capacity(st), 160);
  assert.match(refused(C, st, { t: 'gear', item: 'fanny' }), /better/);
  assert.match(refused(C, st, { t: 'gear', item: 'saddle' }), /already/);
  st.loc = 'starport';
  st = ok(C, st, { t: 'gear', item: 'hovercrate' });
  assert.strictEqual(C.capacity(st), 220);
});
scenario('gear: Sneaky Mittens make running away more likely', () => {
  const { C, st } = fresh();
  const escapes = mittens => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, heat: 60, gear: Object.assign({}, st.gear, { mittens: mittens ? 'mittens' : null }) }), 'watchers');
      if (!C.step(s, { t: 'run' }).state.enc) n++;
    }
    return n;
  };
  const bare = escapes(false);
  const sneaky = escapes(true);
  assert.ok(sneaky > bare * 1.3, `mittens ${sneaky} vs bare ${bare}`);
});
scenario("gear: the Pawphone's tip is tomorrow's real prices", () => {
  let { C, st } = fresh();
  st.cash = 5000;
  st.loc = 'convention';
  st = ok(C, st, { t: 'gear', item: 'pawphone' });
  assert.ok(st.tip && st.tip.day === 2 && st.tip.loc !== 'convention');
  const tip = st.tip;
  const arrived = travelQuiet(C, st, tip.loc);
  for (const g of C.GOODS) {
    if (arrived.news && arrived.news.good === g.id) continue;
    assert.strictEqual(arrived.prices[g.id], tip.prices[g.id], g.id);
  }
});
scenario('vet: heals what you can afford, only in the Suburbs', () => {
  let { C, st } = fresh();
  st.hp = 40;
  refused(C, st, { t: 'heal' });
  st.loc = 'suburbs';
  st.cash = 300;
  st = ok(C, st, { t: 'heal' });
  assert.strictEqual(st.hp, 60);
  assert.strictEqual(st.cash, 0);
});

// ---- the screen's key tables (read from the page source)
scenario('page: the whole page script compiles', () => {
  // The other scenarios load only the rules core. This compiles everything in
  // the page's <script>, so a syntax error in the screen code (a duplicate
  // declaration, a stray brace) fails here instead of blanking the live page.
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1 && scripts.join('').length > 10000, 'page script not found');
  for (const src of scripts) new (require('vm').Script)(src, { filename: 'index.html' });
});
scenario('keys: encounter keys share no letter with market keys, and cover every choice', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const mk = html.match(/const MARKET_KEYS = (\[[^\]]*\]);/);
  const ek = html.match(/const ENC_KEYS = (\{[^\n]*\});/);
  assert.ok(mk && ek, 'MARKET_KEYS or ENC_KEYS not found in index.html');
  const market = new Function(`return ${mk[1]}`)();
  const enc = new Function(`return ${ek[1]}`)();
  assert.ok(market.length >= 15 && Object.keys(enc).length >= 6, 'key tables look empty');
  for (const k of Object.keys(enc)) assert.ok(!market.includes(k), `'${k}' is both a market key and an encounter key`);
  const covered = new Set(Object.values(enc).flat());
  for (const t of ['run', 'fight', 'surrender', 'deal', 'leave', 'sell', 'decline', 'pay', 'refuse', 'buy']) {
    assert.ok(covered.has(t), `no key for the encounter choice '${t}'`);
  }
  assert.ok(/ENC_KEYS\[k\]/.test(html), 'the encounter key handler does not read ENC_KEYS');
});

scenario('cheat: the Konami code adds $25,000, clears heat, marks the run, and changes nothing else', () => {
  let { C, st } = fresh();
  st.heat = 73;
  st.stash = { nip: 4 };
  st.cost = { nip: 40 };
  const before = JSON.parse(JSON.stringify(st));
  const after = C.cheat(st);
  assert.deepStrictEqual(st, before, 'cheat must not modify its input');
  assert.strictEqual(after.cash, before.cash + C.CHEAT_CASH);
  assert.strictEqual(C.CHEAT_CASH, 25000);
  assert.strictEqual(after.heat, 0);
  assert.ok(after.stats.cheated);
  for (const k of ['debt', 'bank', 'hp', 'day', 'loc', 'rng', 'days']) assert.deepStrictEqual(after[k], before[k], k);
  assert.deepStrictEqual(after.stash, before.stash);
  assert.ok(/likes you/.test(after.log[after.log.length - 1].text));
  ok(C, after, C.botAct(after));
});

scenario('undo: reverses a trade exactly, heat included, and refuses anything else', () => {
  let { C, st } = fresh();
  setPrices(C, st, 4000);
  st.cash = 100000;
  st = ok(C, st, { t: 'buy', good: 'skooma', qty: 10 });
  const before = st;
  const sold = ok(C, st, { t: 'sell', good: 'skooma', qty: 10 });
  assert.ok(sold.heat > before.heat, 'the sale should have raised heat');
  const undone = C.undoTrade(before, sold);
  for (const k of ['cash', 'stash', 'cost', 'heat', 'stats', 'day', 'rng', 'loc', 'debt']) assert.deepStrictEqual(undone[k], before[k], k);
  assert.ok(/undone/.test(undone.log[undone.log.length - 1].text));
  ok(C, undone, C.botAct(undone));
  const all = ok(C, before, { t: 'sellall' });
  assert.strictEqual(C.undoTrade(before, all).cash, before.cash);
  const moved = travelQuiet(C, before, 'ranch');
  assert.strictEqual(C.undoTrade(before, moved), null, 'a trip must not be undoable');
  const paid = Object.assign(JSON.parse(JSON.stringify(before)), { loc: 'pvn' });
  assert.strictEqual(C.undoTrade(paid, ok(C, paid, { t: 'repay', amt: 100 })), null, 'a repayment is not a trade');
  assert.strictEqual(C.undoTrade(before, before), null, 'nothing happened, nothing to undo');
});

// ---- the door
scenario('step: never modifies the state it was given', () => {
  let { C, st } = fresh();
  for (let i = 0; i < 200 && !st.over; i++) {
    const before = JSON.stringify(st);
    const r = C.step(st, C.botAct(st));
    assert.strictEqual(JSON.stringify(st), before);
    st = r.state;
  }
});
scenario('step: every option waiting() offers is one the engine can act on', () => {
  const { C } = fresh();
  const GENERIC = "You can't do that right now.";
  const tried = new Set();
  const tryAll = (st, label) => {
    for (const t of C.waiting(st).options) {
      const r = C.step(st, { t, to: st.loc === 'ranch' ? 'vault' : 'ranch', good: 'nip', qty: 1, amt: 1, item: C.PLACE[st.loc].shop[0] });
      assert.notStrictEqual(r.refused, GENERIC, `${label}: offered ${t} but the engine has no such action`);
      tried.add(t);
    }
  };
  for (const P of C.PLACES) {
    const { st } = fresh();
    setPrices(C, st, 5);
    st.loc = P.id; st.cash = 100000; st.stash.nip = 5; st.cost.nip = 25; st.hp = 50;
    tryAll(st, P.id);
    st.day = st.days;
    tryAll(st, P.id + ' (last day)');
  }
  for (const type of ['watchers', 'rival', 'boss', 'goons', 'stray']) {
    for (let seed = 1; seed <= 30; seed++) {
      const { st } = fresh({ seed });
      st.cash = 100000; st.heat = 50; st.debtAge = 20; st.gear.weapon = 'spray'; st.stash.skooma = 2; st.stash.nip = 3;
      const s = C.forceEncounter(st, type);
      if (s.enc) tryAll(s, type);
    }
  }
  for (const t of ['buy', 'sell', 'sellall', 'travel', 'finish', 'borrow', 'repay', 'deposit', 'withdraw', 'gear', 'heal',
    'run', 'fight', 'surrender', 'deal', 'leave', 'pay', 'refuse', 'decline']) {
    assert.ok(tried.has(t), `never got to try ${t}`);
  }
});
scenario('step: an unknown action is refused, not a crash', () => {
  const { C, st } = fresh();
  refused(C, st, { t: 'teleport' });
  refused(C, st, null);
});

// ---- run
let failed = 0;
for (const s of scenarios) {
  try { s.fn(); console.log(`  ok    ${s.name}`); } catch (e) { failed++; console.log(`  FAIL  ${s.name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
}
if (!scenarios.length) { console.error('check-all: no scenarios found; a check that checks nothing must not pass'); process.exit(1); }
console.log(`\n${scenarios.length - failed}/${scenarios.length} scenarios passed`);
process.exit(failed ? 1 : 0);
