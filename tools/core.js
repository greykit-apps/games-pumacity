/*
 * Loads the game's rules out of index.html for the Node tools.
 *
 * The page is one file, so the rules cannot be imported. Everything between
 * the @core markers is data and DOM-free rules; this cuts that block out and
 * evaluates it, so the checks run the exact code the browser runs rather than
 * a copy that could drift.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const EXPORTS = [
  'VERSION', 'CONFIG', 'GOODS', 'GOOD', 'PLACES', 'PLACE', 'GEAR', 'SLOTS',
  'newGame', 'step', 'waiting', 'forceEncounter', 'botAct', 'encOptions', 'dealQty',
  'capacity', 'used', 'free', 'netWorth', 'canUpgrade', 'hash32', 'fmt',
];

function coreSource() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const begin = html.indexOf('// ===== @core-begin =====');
  const end = html.indexOf('// ===== @core-end =====');
  if (begin < 0 || end < 0 || end < begin) throw new Error('index.html: @core markers not found');
  return html.slice(begin, end);
}

function loadCore() {
  return new Function(`'use strict';\n${coreSource()}\nreturn { ${EXPORTS.join(', ')} };`)();
}

module.exports = { loadCore, coreSource };
