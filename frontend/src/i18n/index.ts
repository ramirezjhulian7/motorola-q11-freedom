/* ===========================================================================
   UI language. Strings are written in English in the code and wrapped in t();
   the Spanish text lives in es/*.json, keyed by the English string.
   The language is read once at load; changing it reloads the app, so t() also
   works in module-level constants and non-React code.
   =========================================================================== */
import app from './es/app.json';
import devices from './es/devices.json';
import network from './es/network.json';
import mesh from './es/mesh.json';
import lib from './es/lib.json';

export type Lang = 'en' | 'es';

const KEY = 'freedom.lang';
const ES: Record<string, string> = { ...app, ...devices, ...network, ...mesh, ...lib };

// per browser, a convenience only: storage may be unavailable
export const lang: Lang = (() => { try { return localStorage.getItem(KEY) === 'es' ? 'es' : 'en'; } catch { return 'en'; } })();
document.documentElement.lang = lang;

/** Translate an English UI string; `{name}` placeholders are filled from vars. Missing → English. */
export function t(s: string, vars?: Record<string, string | number>): string {
  const out = (lang === 'es' && ES[s]) || s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  location.reload();
}
