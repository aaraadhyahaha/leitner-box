#!/usr/bin/env node
// Generate benchmark cards as JSONL on stdout.
// Usage: node scripts/gen-cards.mjs <count> [decks=10] [prefix=Bench] > file.jsonl
// Deterministic (mulberry32, seed 1). Every card is unique (its index is in the front).
// ~30% contain LaTeX (inline, display or \ce), ~10% a {{smiles:…}} from 30 valid SMILES.
// One card in ~1000 contains the rare word "zyzzyva"; "energy" is a common word.

const count = Number(process.argv[2] ?? 1000);
const decks = Number(process.argv[3] ?? 10);
const prefix = process.argv[4] ?? 'Bench';
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(decks) || decks < 1) {
  console.error('usage: gen-cards.mjs <count> [decks] [prefix]');
  process.exit(1);
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(1);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const WORDS = ('energy force mass velocity acid base ion bond orbital entropy enthalpy reaction rate ' +
  'equilibrium cell membrane protein enzyme gene allele mitosis meiosis photon wave field charge ' +
  'current voltage resistance capacitor matrix vector integral derivative limit series function ' +
  'theorem proof prime group ring graph tree node history empire treaty river capital language ' +
  'verb noun tense poem novel author century war trade market price supply demand').split(' ');
const SMILES = [
  'CCO', 'C', 'CC', 'CCC', 'C=C', 'C#C', 'O', 'N', 'CO', 'CN', 'CC(=O)O', 'CC(=O)C', 'C1CCCCC1',
  'c1ccccc1', 'c1ccncc1', 'Cc1ccccc1', 'Oc1ccccc1', 'Nc1ccccc1', 'CC(C)O', 'CC(C)C', 'OC(=O)C(O)=O',
  'CC(=O)Oc1ccccc1C(=O)O', 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', 'C(C1C(C(C(C(O1)O)O)O)O)O', 'NCC(=O)O',
  'CC(N)C(=O)O', 'O=C=O', 'C1CC1', 'ClC(Cl)Cl', 'CS(=O)C',
];
const INLINE = ['$x^2 + y^2 = r^2$', '$\\frac{a}{b}$', '$E = mc^2$', '$\\sqrt{2}$', '$\\int_0^1 x\\,dx$', '$\\alpha + \\beta$'];
const DISPLAY = ['$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$', '$$\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$$'];
const CE = ['\\ce{H2O}', '\\ce{2H2 + O2 -> 2H2O}', '\\ce{CO2}', '\\ce{NaCl}', '\\ce{CH4 + 2O2 -> CO2 + 2H2O}'];
const TAGS = Array.from({ length: 30 }, (_, i) => `tag${String(i + 1).padStart(2, '0')}`);

// Skewed deck sizes: deck 1 holds ~40%, the rest share the remainder evenly.
const deckName = (i) => `${prefix} ${String(i + 1).padStart(2, '0')}`;
function deckFor() {
  if (decks === 1 || rnd() < 0.4) return deckName(0);
  return deckName(1 + Math.floor(rnd() * (decks - 1)));
}
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rnd() < 0.15 ? 'energy' : pick(WORDS));
  return out.join(' ');
}

const out = [];
const flush = () => { process.stdout.write(out.join('')); out.length = 0; };
for (let i = 1; i <= count; i++) {
  let front = `${prefix} ${i}: ${words(4 + Math.floor(rnd() * 6))}?`;
  let back = words(3 + Math.floor(rnd() * 10));
  const r = rnd();
  if (r < 0.2) back += ` ${pick(INLINE)}`;
  else if (r < 0.25) back += `\n${pick(DISPLAY)}`;
  else if (r < 0.3) back += ` ${pick(CE)}`;
  if (rnd() < 0.1) back += ` {{smiles:${pick(SMILES)}}}`;
  if (rnd() < 0.001) front += ' zyzzyva';
  const tags = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(TAGS));
  out.push(JSON.stringify({ deck: deckFor(), front, back, tags: [...new Set(tags)] }) + '\n');
  if (out.length >= 5000) flush();
}
flush();
