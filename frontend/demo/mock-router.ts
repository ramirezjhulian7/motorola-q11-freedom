/* ===========================================================================
   Demo router: a dev-only Vite plugin that answers POST /ubus (JSON-RPC) and
   POST /cgi-bin/freedom-api.sh with fictional data, so the UI can be tried or
   developed without a Q11. Enabled by `npm run demo` (vite --mode demo) or
   VITE_DEMO=1. The answers live in mock-core.ts.
   =========================================================================== */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMock } from './mock-core.ts';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function mockRouter(): Plugin {
  return {
    name: 'freedom-demo-router',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('\n  Demo mode: /ubus and /cgi-bin/freedom-api.sh are answered with fictional data.\n');
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!path.startsWith('/ubus') && path !== '/cgi-bin/freedom-api.sh') return next();
        const r = handleMock(path, req.method ?? 'GET', await readBody(req));
        if (r.kind === 'pass') return next();
        if (r.kind === 'down') { req.socket.destroy(); return; }   // "rebooting"
        return send(res, r.status, r.body);
      });
    },
  };
}
