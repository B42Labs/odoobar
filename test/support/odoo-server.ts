import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OdooServer {
  /** The address to use as baseUrl, such as http://127.0.0.1:49152. */
  readonly baseUrl: string;
  readonly port: number;
  /** The path of every page request so far, in order. */
  readonly requests: string[];
  close(): Promise<void>;
}

/**
 * Stands in for an Odoo instance on 127.0.0.1. Every path but /favicon.ico
 * gets a page that names the path and holds a text field and a link that
 * asks for a new tab. A `frame` query parameter adds a frame with that
 * address, and the page sets `window.framed` once the frame has loaded or
 * failed. A `redirect` query parameter gets a redirect to that address
 * instead of a page. Port 0 picks a free port.
 */
export function startOdooServer(port = 0): Promise<OdooServer> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/favicon.ico') {
      response.writeHead(404).end();
      return;
    }
    requests.push(path);
    const query = new URL(path, 'http://127.0.0.1').searchParams;
    const redirect = query.get('redirect');
    if (redirect) {
      response.writeHead(302, { location: redirect }).end();
      return;
    }
    const frame = query.get('frame');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><title>${path}</title><h1 id="path">${path}</h1><input id="note" /><a id="new-tab" target="_blank" href="/odoo/linked">linked</a>` +
        (frame ? `<iframe src="${frame}" onload="window.framed = true"></iframe>` : ''),
    );
  });
  return new Promise((resolve, reject) => {
    // A failed listen, such as EADDRINUSE, emits 'error' and no 'listening'.
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const actual = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${actual}`,
        port: actual,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
