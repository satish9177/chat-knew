import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { Application } from './app.js';

const assets: Record<string, [string, string]> = {
  '/dashboard': ['dashboard.html', 'text/html'],
  '/overlay': ['overlay.html', 'text/html'],
  '/dashboard.css': ['dashboard.css', 'text/css'],
  '/dashboard.js': ['dashboard.js', 'text/javascript'],
  '/overlay.css': ['overlay.css', 'text/css'],
  '/overlay.js': ['overlay.js', 'text/javascript'],
};

export function startServer(app: Application) {
  const token = randomBytes(24).toString('hex');
  const authorized = (value: string | null) => {
    const candidate = Buffer.from(value ?? '');
    const expected = Buffer.from(token);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  };
  const allowedHost = (host: string | undefined) => host === `127.0.0.1:${app.config.port}`;
  const allowedOrigin = (origin: string | undefined) => !origin || origin === `http://127.0.0.1:${app.config.port}`;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    const reply = (status: number, payload: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };
    if (!allowedHost(request.headers.host) || !allowedOrigin(request.headers.origin)) { reply(403, { error: 'Loopback origin required' }); return; }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${app.config.port}`);
    const asset = assets[url.pathname];
    const publicAsset = !!asset && url.pathname.includes('.');
    if (!publicAsset && !authorized(url.searchParams.get('token'))) { reply(401, { error: 'Use the tokenized URL printed by the local app' }); return; }
    if (request.method === 'GET' && asset) {
      try {
        const bytes = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        response.end(bytes);
      } catch { reply(500, { error: 'Local page unavailable' }); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/state') { reply(200, app.snapshot()); return; }
    if (request.method === 'POST' && url.pathname === '/api/control') {
      if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'JSON required' }); return; }
      let data = '';
      try {
        for await (const chunk of request) {
          data += chunk;
          if (data.length > 4096) { reply(413, { error: 'Request too large' }); return; }
        }
        const body: unknown = JSON.parse(data);
        if (typeof body !== 'object' || body === null || !('action' in body) || typeof body.action !== 'string') throw new Error('Invalid action');
        const scenarioId = 'scenarioId' in body && typeof body.scenarioId === 'string' ? body.scenarioId : undefined;
        app.control(body.action, scenarioId);
        broadcast();
        reply(200, app.snapshot());
      } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
      return;
    }
    reply(404, { error: 'Not found' });
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const views = new WeakMap<WebSocket, string>();
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${app.config.port}`);
    if (url.pathname !== '/ws' || !allowedHost(request.headers.host) || !allowedOrigin(request.headers.origin) || !authorized(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      views.set(client, url.searchParams.get('view') === 'overlay' ? 'overlay' : 'dashboard');
      sockets.emit('connection', client);
    });
  });
  const send = (client: WebSocket) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 1_000_000) { client.terminate(); return; }
    client.send(JSON.stringify(views.get(client) === 'overlay' ? app.overlayPacket() : { type: 'state', state: app.snapshot() }));
  };
  sockets.on('connection', (client) => { client.on('error', () => {}); send(client); });
  function broadcast() { for (const client of sockets.clients) send(client); }
  const timer = setInterval(() => { app.update(); broadcast(); }, 100);
  server.on('close', () => clearInterval(timer));
  server.listen(app.config.port, '127.0.0.1');
  return {
    server, token,
    close: () => { clearInterval(timer); for (const client of sockets.clients) client.terminate(); sockets.close(); server.close(); },
  };
}
