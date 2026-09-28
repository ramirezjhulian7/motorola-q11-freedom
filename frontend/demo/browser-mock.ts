/* ===========================================================================
   Static browser demo (GitHub Pages): patches window.fetch so the panel runs
   with the same fictional router as `npm run demo`, with no server at all.
   Only bundled when VITE_STATIC_DEMO=1 (npm run build:pages).
   =========================================================================== */
import { handleMock } from './mock-core.ts';

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  const r = handleMock(url.pathname, method, body);
  if (r.kind === 'pass') return realFetch(input, init);
  await new Promise((ok) => setTimeout(ok, 120));            // feel like a network
  if (r.kind === 'down') throw new TypeError('Failed to fetch (demo reboot)');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

const banner = document.createElement('a');
banner.href = 'https://github.com/ramirezjhulian7/motorola-q11-freedom';
banner.textContent = 'Demo with fictional data. Nothing here touches a real router. Get Q11 Freedom on GitHub';
banner.setAttribute('style', [
  // In the page flow at the top: the phone layout has a fixed bottom nav.
  'display:block', 'padding:6px 12px',
  'font:12px/1.4 system-ui,sans-serif', 'text-align:center', 'color:#0f172a',
  'background:#fbbf24', 'text-decoration:none',
].join(';'));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => document.body.prepend(banner));
else document.body.prepend(banner);
