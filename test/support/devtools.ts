import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface Page {
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

/** Polls `check` every 100 ms until it returns a value other than undefined. */
export async function waitUntil<T>(
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${timeoutMs} ms`);
    await sleep(100);
  }
}

/**
 * The DevTools port of an app launched with --remote-debugging-port=0.
 * Chromium writes the port it picked to DevToolsActivePort in the user data
 * directory.
 */
export function devtoolsPort(userDataDir: string, timeoutMs: number): Promise<number> {
  return waitUntil(
    () => {
      try {
        const port = Number(readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
        return port > 0 ? port : undefined;
      } catch (error) {
        // Chromium has not written the file yet.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    timeoutMs,
    'DevToolsActivePort',
  );
}

/** The windows that currently show a page. */
export async function listPages(port: number): Promise<Page[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = (await response.json()) as (Page & { type: string })[];
  return targets.filter((target) => target.type === 'page');
}

export function waitForPage(port: number, urlSuffix: string, timeoutMs: number): Promise<Page> {
  return waitUntil(
    async () => (await listPages(port)).find((page) => page.url.endsWith(urlSuffix)),
    timeoutMs,
    `a page ending in ${urlSuffix}`,
  );
}

/** Sends a DevTools command to the page and returns its result. Rejects when the page closes first. */
function send(page: Page, method: string, params: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id !== 1) return;
      socket.close();
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.addEventListener('close', () => reject(new Error(`${page.url} closed before it answered`)));
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${page.url}`)));
  });
}

/** Runs `expression` in the page and returns its value. Rejects when the page closes first. */
export async function evaluate(page: Page, expression: string): Promise<unknown> {
  const { result, exceptionDetails: failure } = (await send(page, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as {
    result?: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  if (failure) throw new Error(failure.exception?.description ?? failure.text);
  return result?.value;
}

/** Loads `url` in the page the way the main process would, so 'will-navigate' does not fire. */
export async function navigate(page: Page, url: string): Promise<void> {
  const { errorText } = (await send(page, 'Page.navigate', { url })) as { errorText?: string };
  if (errorText) throw new Error(`cannot load ${url}: ${errorText}`);
}

/**
 * The first-start prompt of an app launched with --remote-debugging-port=0,
 * once its preload script has filled in the texts. The page keeps its body
 * hidden until then, so a bundle without the preload script never gets here.
 */
export async function waitForPrompt(userDataDir: string): Promise<{ port: number; page: Page }> {
  const port = await devtoolsPort(userDataDir, 30_000);
  const page = await waitForPage(port, '/renderer/first-start.html', 15_000);
  await waitUntil(
    async () => ((await evaluate(page, 'document.body !== null && !document.body.hidden')) === true ? true : undefined),
    5_000,
    'the first-start texts',
  );
  return { port, page };
}
