import { describe, it, expect } from 'vitest';
import { createConnection, createServer, type Socket } from 'node:net';
import { createApp, defaultHttpConfig, startHttpServer, closeHttpServer } from './server.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') return reject(new Error('no port'));
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

describe('closeHttpServer', () => {
  it('resolves promptly even with an idle keep-alive socket held open (Ctrl+C hang fix)', async () => {
    const port = await freePort();
    const app = createApp(defaultHttpConfig());
    const server = await startHttpServer(app, port);

    // Open a raw socket and leave it open — this is what a browser tab does.
    // Before the fix, server.close() would wait for it forever.
    const sock: Socket = createConnection({ host: '127.0.0.1', port });
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('error', reject);
    });

    const start = Date.now();
    await closeHttpServer(server);
    const elapsed = Date.now() - start;

    sock.destroy();
    // closeAllConnections() drops the socket immediately, so close() fires fast —
    // well under the 2s backstop (which itself guarantees it never wedges).
    expect(elapsed).toBeLessThan(1500);
  });
});
