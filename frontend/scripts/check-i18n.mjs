// Checks that every t('...') key in src/ has a Spanish entry in src/i18n/es/*.json,
// that placeholders match, and lists unused entries. Exit 1 on missing keys.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const unescape = (s, q) => s.replace(new RegExp('\\\\([\\\\' + q + 'nt])', 'g'), (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
const used = new Map();
const re = /\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
for (const f of walk(root)) {
  for (const m of readFileSync(f, 'utf8').matchAll(re)) {
    const key = m[1] != null ? unescape(m[1], "'") : m[2] != null ? unescape(m[2], '"') : unescape(m[3], '`');
    used.set(key, f.slice(root.length));
  }
}
const es = {};
const dir = join(root, 'i18n/es');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(dir, f), 'utf8')))) {
    if (k in es && es[k] !== v) console.log(`conflict: "${k}" (${f})`);
    es[k] = v;
  }
}
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let bad = 0;
for (const [k, f] of used) {
  if (!(k in es)) { console.log(`missing: "${k}" (${f})`); bad++; }
  else if (vars(k) !== vars(es[k])) { console.log(`placeholders differ: "${k}"`); bad++; }
}
const unused = Object.keys(es).filter((k) => !used.has(k));
for (const k of unused) console.log(`unused: "${k}"`);
console.log(`${used.size} keys, ${bad} problems, ${unused.length} unused`);
process.exit(bad ? 1 : 0);
