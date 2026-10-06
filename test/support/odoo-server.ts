import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OdooServer {
  /** The address to use as baseUrl, such as http://127.0.0.1:49152. */
  readonly baseUrl: string;
  readonly port: number;
  /** The path of every page request so far, in order. A request that is no GET has its method in front. */
  readonly requests: string[];
  /** The path of every request for the menu document so far, in order. `requests` holds none of them. */
  readonly menuRequests: string[];
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
  /**
   * The menu document of the instance. /web/webclient/load_menus answers
   * with it as JSON, and lets the browser keep the answer for a year, as
   * Odoo before 19 does. With `login`, only a request with the cookie of a
   * login gets it. Every other request for the menu document gets a 404
   * without one, as does each request without this option.
   */
  readonly menus?: unknown;
}

/**
 * Stands in for an Odoo instance on 127.0.0.1. Every path but /favicon.ico
 * gets a page that names the path and holds a text field and a link that
 * asks for a new tab. A `frame` query parameter adds a frame with that
 * address, and the page sets `window.framed` once the frame has loaded or
 * failed. A `redirect` query parameter gets a redirect to that address
 * instead of a page. /web/service-worker.js is an empty service worker that
 * may take the scope /odoo, as the one of Odoo does. The paths that start
 * with /web/webclient/load_menus are those of the menu document, which the
 * option `menus` describes. Port 0 picks a free port.
 */
export function startOdooServer(port = 0, options: OdooServerOptions = {}): Promise<OdooServer> {
  const requests: string[] = [];
  const menuRequests: string[] = [];
  const sessions = new Set<string>();
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/favicon.ico') {
      response.writeHead(404).end();
      return;
    }
    if (path === '/web/service-worker.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/odoo' }).end();
      return;
    }
    const url = new URL(path, 'http://127.0.0.1');
    const query = url.searchParams;
    const cookie = /(?:^|; )session_id=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    const loggedIn = cookie !== undefined && sessions.has(cookie);
    // OdooBar asks for the menu document after every page, so these requests stay off the list of the pages.
    if (url.pathname.startsWith('/web/webclient/load_menus')) {
      menuRequests.push(path);
      const answers = options.menus !== undefined && url.pathname === '/web/webclient/load_menus';
      if (!answers || (options.login && !loggedIn)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=31536000',
      });
      response.end(JSON.stringify(options.menus));
      return;
    }
    requests.push(request.method === 'GET' ? path : `${request.method} ${path}`);
    if (options.login) {
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
        menuRequests,
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
