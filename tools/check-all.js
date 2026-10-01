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
  assert.match(refused(C, st, { t: 'borrow', amt: C.CONFIG.debtCap }), /won't carry/);
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
  st.debtAge = C.CONFIG.goonDays - 1;
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
  assert.strictEqual(hurt.debtAge, C.CONFIG.goonDays - 4);
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
scenario('watchers: more heat brings more of them, and Hardclaw', () => {
  let { C, st } = fresh();
  st.heat = 0;
  const calm = C.forceEncounter(st, 'watchers');
  assert.ok(calm.enc.foes.length <= 2);
  assert.ok(!calm.enc.foes.some(f => f.name.includes('Hardclaw')));
  st.heat = 90;
  const hot = C.forceEncounter(st, 'watchers');
  assert.ok(hot.enc.foes.length >= 4);
  assert.ok(hot.enc.foes[0].name.includes('Hardclaw'));
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
scenario('death: health at zero ends the run, scores nothing, and stops play', () => {
  const { C, st } = fresh();
  let dead = null;
  for (let seed = 1; seed < 500 && !dead; seed++) {
    let s = C.forceEncounter(Object.assign(JSON.parse(JSON.stringify(st)), { rng: seed, hp: 3, heat: 90 }), 'watchers');
    s = C.step(s, { t: 'run' }).state;
    if (s.over) dead = s;
  }
  assert.ok(dead, 'nobody ever died at 3 HP against five Watchers');
  assert.strictEqual(dead.over.reason, 'dead');
  assert.strictEqual(dead.over.score, 0);
  assert.strictEqual(dead.hp, 0);
  assert.strictEqual(C.waiting(dead).kind, 'over');
  refused(C, dead, { t: 'run' });
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
  st.enc = { type: 'rival', foes: [{ name: 'Velvet', hp: 14, max: 14 }], n: 1, hostile: false, boss: 'Velvet',
    deal: { side: 'sell', good: 'zoomers', qty: 20, price: 150 }, hitP: 0.28, dmg: [3, 7], loot: [150, 600] };
  assert.strictEqual(C.dealQty(st, st.enc.deal), 13);
  st = ok(C, st, { t: 'deal' });
  assert.strictEqual(st.stash.zoomers, 13);
  assert.strictEqual(st.cash, 2000 - 13 * 150);
  assert.strictEqual(st.enc, null);
});
scenario('rival: hostile crews take half your stash when you give in', () => {
  let { C, st } = fresh();
  setPrices(C, st, 1);
  st = ok(C, st, { t: 'buy', good: 'nip', qty: 9 });
  st.enc = { type: 'rival', foes: [{ name: 'Velvet', hp: 14, max: 14 }], n: 1, hostile: true, boss: 'Velvet', deal: null, hitP: 0.28, dmg: [3, 7], loot: [150, 600] };
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
  const share = C.CONFIG.dropOnFail;
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
  assert.strictEqual(C.carryRisk(st), C.CONFIG.carryWatchMax);
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
scenario('news: headlines move a price within the declared range', () => {
  const { C } = fresh();
  let seen = 0;
  for (let seed = 1; seed < 400; seed++) {
    const st = C.newGame({ seed, days: 30 });
    if (!st.news) continue;
    seen++;
    const g = C.GOOD[st.news.good];
    const p = st.prices[g.id];
    const [lo, hi] = st.news.up ? C.CONFIG.eventUp : C.CONFIG.eventDown;
    const m = (C.PLACE.plaza.mods[g.id] || 1);
    assert.ok(p >= Math.floor(g.lo * m * lo) - 1 && p <= Math.ceil(g.hi * m * hi) + 1, `${g.id} ${p}`);
  }
  assert.ok(seen > 20, `only ${seen} headlines in 400 starts`);
});

// ---- gear
scenario('gear: only sold where stocked, only trades up, and pouches add room', () => {
  let { C, st } = fresh();
  st.cash = 50000;
  assert.match(refused(C, st, { t: 'gear', item: 'fanny' }), /isn't sold/);
  st.loc = 'suburbs';
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
  for (const t of ['buy', 'sell', 'travel', 'finish', 'borrow', 'repay', 'deposit', 'withdraw', 'gear', 'heal',
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
