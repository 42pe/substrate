import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import {
  isProcessAlive,
  isPortInUse,
  identifyPortHolder,
  portCandidates,
  bindFirstFreePort,
  NoFreePortError,
} from './process.js';

/** Bind a throwaway net server to `port`; rejects with EADDRINUSE if taken. */
function bindNet(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', (e) => {
      s.close();
      reject(e);
    });
    s.once('listening', () => resolve(s));
    s.listen(port, '127.0.0.1');
  });
}

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

describe('portCandidates', () => {
  it('lists the preferred port first, then the range', () => {
    expect(portCandidates(7475, 7475, 7479)).toEqual([7475, 7476, 7477, 7478, 7479]);
  });

  it('never repeats the preferred port when it sits inside the range', () => {
    expect(portCandidates(7477, 7475, 7479)).toEqual([7477, 7475, 7476, 7478, 7479]);
  });

  it('handles a preferred outside the range', () => {
    expect(portCandidates(3000, 7475, 7477)).toEqual([3000, 7475, 7476, 7477]);
  });
});

describe('bindFirstFreePort', () => {
  it('returns the first candidate when it is free', async () => {
    const { server, port } = await listenOnEphemeral();
    await new Promise<void>((r) => server.close(() => r())); // free it again
    const bound = await bindFirstFreePort([port, port + 1], (p) => bindNet(p));
    try {
      expect(bound.port).toBe(port);
    } finally {
      bound.value.close();
    }
  });

  it('skips an occupied preferred and binds the next free candidate', async () => {
    const { server, port: occupied } = await listenOnEphemeral();
    let bound: { port: number; value: Server } | undefined;
    try {
      bound = await bindFirstFreePort([occupied, occupied + 1, occupied + 2], (p) => bindNet(p));
      expect(bound.port).toBe(occupied + 1);
    } finally {
      bound?.value.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('throws NoFreePortError when every candidate is in use', async () => {
    const a = await listenOnEphemeral();
    const b = await listenOnEphemeral();
    try {
      await expect(bindFirstFreePort([a.port, b.port], (p) => bindNet(p))).rejects.toBeInstanceOf(
        NoFreePortError,
      );
    } finally {
      await new Promise<void>((r) => a.server.close(() => r()));
      await new Promise<void>((r) => b.server.close(() => r()));
    }
  });

  it('rethrows a non-EADDRINUSE error immediately', async () => {
    const boom = Object.assign(new Error('nope'), { code: 'EACCES' });
    await expect(bindFirstFreePort([1, 2, 3], () => Promise.reject(boom))).rejects.toBe(boom);
  });
});
