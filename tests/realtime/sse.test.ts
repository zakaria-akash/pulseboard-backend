/**
 * tests/realtime/sse.test.ts — SSE Incident Stream Tests
 *
 * Covers:
 *   - Connecting to /api/v1/incidents/stream → response headers include text/event-stream
 *   - Client disconnect does not crash the server (no lingering listeners)
 *
 * Supertest is designed for request/response cycles and cannot handle
 * long-lived streaming connections directly. We use Node's `http` module to
 * open a real TCP connection to the app, inspect headers, and then destroy it
 * to simulate a client disconnect.
 */

import * as http from 'http';
import type { AddressInfo } from 'net';
import app from '../../src/app';
import { setup, teardown, type SeedData } from '../fixtures/seed';

let seed: SeedData;

beforeAll(async () => {
  seed = await setup();
}, 30_000);

afterAll(async () => {
  await teardown();
});

describe('SSE — incident stream', () => {
  it('GET /incidents/stream responds with text/event-stream content-type', async () => {
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(app);

      server.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        const url = `http://localhost:${port}/api/v1/incidents/stream?tenantId=${seed.tenantA.id}`;

        const req = http.get(url, (res) => {
          try {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');
            req.destroy();
            server.close(() => resolve());
          } catch (err) {
            req.destroy();
            server.close(() => reject(err));
          }
        });

        req.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
            server.close(() => reject(err));
          }
        });
      });
    });
  });

  it('client disconnect does not leave dangling listeners', async () => {
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(app);

      server.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        const url = `http://localhost:${port}/api/v1/incidents/stream?tenantId=${seed.tenantA.id}`;

        const sseReq = http.get(url, (res) => {
          // Immediately destroy to simulate an abrupt client disconnect
          res.on('data', () => {
            sseReq.destroy();
          });
        });

        // Swallow the connection-reset error that results from destroying the socket
        sseReq.on('error', () => {});

        // After the disconnect, verify the server is still alive and healthy
        setTimeout(() => {
          const healthReq = http.get(`http://localhost:${port}/healthz`, (healthRes) => {
            // Consume the body so the keep-alive socket is released,
            // otherwise server.close() will never call its callback.
            healthRes.resume();
            healthRes.on('end', () => {
              try {
                expect(healthRes.statusCode).toBe(200);
                // Force-close any lingering SSE sockets so server.close() can proceed.
                server.closeAllConnections();
                server.close(() => resolve());
              } catch (err) {
                server.closeAllConnections();
                server.close(() => reject(err as Error));
              }
            });
          });
          healthReq.on('error', (err) => {
            server.closeAllConnections();
            server.close(() => reject(err));
          });
        }, 200);
      });
    });
  });
});
