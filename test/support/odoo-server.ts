import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OdooServer {
  /** The address to use as baseUrl, such as http://127.0.0.1:49152. */
  readonly baseUrl: string;
  readonly port: number;
  /** The path of every page request so far, in order. A request that is no GET has its method in front. */
  readonly requests: string[];
  /** Ends every login, as an expiry on the server does. */
  expireSessions(): void;
  close(): Promise<void>;
}

export interface OdooServerOptions {
  /**
   * Asks for a login, as Odoo does: a page request without the cookie of a
   * login gets a redirect to /web/login with the path as `redirect`. That
   * page holds a form, and posting it sets the cookie `session_id` for a week
   * and redirects back. With the cookie of a login, a request for that page
   * goes straight to its `redirect`.
   */
  readonly login?: boolean;
}

/**
 * Stands in for an Odoo instance on 127.0.0.1. Every path but /favicon.ico
 * gets a page that names the path and holds a text field and a link that
 * asks for a new tab. A `frame` query parameter adds a frame with that
 * address, and the page sets `window.framed` once the frame has loaded or
 * failed. A `redirect` query parameter gets a redirect to that address
 * instead of a page. Port 0 picks a free port.
 */
export function startOdooServer(port = 0, options: OdooServerOptions = {}): Promise<OdooServer> {
  const requests: string[] = [];
  const sessions = new Set<string>();
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/favicon.ico') {
      response.writeHead(404).end();
      return;
    }
    requests.push(request.method === 'GET' ? path : `${request.method} ${path}`);
    const url = new URL(path, 'http://127.0.0.1');
    const query = url.searchParams;
    if (options.login) {
      const cookie = /(?:^|; )session_id=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
      const loggedIn = cookie !== undefined && sessions.has(cookie);
      if (url.pathname === '/web/login') {
        if (request.method === 'POST') {
          const id = randomUUID();
          sessions.add(id);
          response.writeHead(303, {
            location: query.get('redirect') ?? '/odoo',
            'set-cookie': `session_id=${id}; Max-Age=604800; Path=/; HttpOnly`,
          });
          response.end();
          return;
        }
        const redirect = query.get('redirect');
        if (loggedIn && redirect) {
          response.writeHead(303, { location: redirect }).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><title>${path}</title><h1 id="path">${path}</h1><form id="login" method="post"><button>Log in</button></form>`,
        );
        return;
      }
      if (!loggedIn) {
        response.writeHead(303, { location: `/web/login?redirect=${encodeURIComponent(path)}` }).end();
        return;
      }
    }
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
        expireSessions: () => sessions.clear(),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
