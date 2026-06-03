import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { isProcessAlive, isPortInUse, identifyPortHolder } from './process.js';

function listenOnEphemeral(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  it('returns false for an almost-certainly-unused pid', () => {
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });
});

describe('isPortInUse', () => {
  it('detects a bound port and a free one', async () => {
    const { server, port } = await listenOnEphemeral();
    try {
      expect(await isPortInUse(port)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    // After close the port should be free again.
    expect(await isPortInUse(port)).toBe(false);
  });
});

describe('identifyPortHolder', () => {
  it('never throws; returns a string or null', async () => {
    const { server, port } = await listenOnEphemeral();
    try {
      const holder = await identifyPortHolder(port);
      expect(holder === null || typeof holder === 'string').toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns null for a free port', async () => {
    // A port nothing is listening on → no holder.
    const holder = await identifyPortHolder(1);
    expect(holder).toBeNull();
  });
});
