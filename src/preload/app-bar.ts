import { ipcRenderer } from 'electron';
import type { BarState } from '../main/window';

// The app bar page carries no script of its own. This preload script draws
// the state that the main process sends and reports clicks. Its import from
// ../main is a type only, so the compiled script requires nothing but
// electron, which a sandboxed preload script can load.

window.addEventListener('DOMContentLoaded', async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const back = byId<HTMLButtonElement>('back');
  const forward = byId<HTMLButtonElement>('forward');
  const reload = byId<HTMLButtonElement>('reload');
  const apps = byId('apps');
  const settings = byId<HTMLButtonElement>('settings');
  const update = byId<HTMLButtonElement>('update');
  const notice = byId('notice');
  const noticeText = byId('notice-text');
  const retry = byId<HTMLButtonElement>('retry');

  const name = (button: HTMLButtonElement, text: string) => {
    button.title = text;
    button.setAttribute('aria-label', text);
  };

  const render = (state: BarState) => {
    name(back, state.texts.back);
    name(forward, state.texts.forward);
    name(reload, state.texts.reload);
    back.disabled = !state.nav.back;
    forward.disabled = !state.nav.forward;
    reload.disabled = !state.nav.reload;
    apps.replaceChildren(
      ...state.apps.map((app) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.appId = app.id;
        button.textContent = app.name;
        if (app.id === state.activeId) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => ipcRenderer.send('app-bar:press', app.id));
        if (app.close === undefined) return button;
        // An app that a link opened has a button that closes it, in one frame with its name.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'close';
        close.dataset.closeId = app.id;
        close.textContent = '×';
        name(close, app.close);
        close.addEventListener('click', () => ipcRenderer.send('app-bar:close', app.id));
        const both = document.createElement('span');
        both.append(button, close);
        return both;
      }),
    );
    update.hidden = state.update === undefined;
    update.textContent = state.update?.label ?? '';
    update.title = state.update?.hint ?? '';
    name(settings, state.texts.settings);
    notice.hidden = state.notice === undefined;
    noticeText.textContent = state.notice?.text ?? '';
    retry.hidden = state.notice?.retry !== true;
    retry.textContent = state.texts.retry;
    document.body.hidden = false;
  };

  settings.addEventListener('click', () => ipcRenderer.send('app-bar:settings'));
  back.addEventListener('click', () => ipcRenderer.send('app-bar:go', 'back'));
  forward.addEventListener('click', () => ipcRenderer.send('app-bar:go', 'forward'));
  reload.addEventListener('click', () => ipcRenderer.send('app-bar:reload'));
  retry.addEventListener('click', () => ipcRenderer.send('app-bar:reload'));
  update.addEventListener('click', () => ipcRenderer.send('app-bar:update'));
  ipcRenderer.on('app-bar:state', (_event, state: BarState) => render(state));
  render(await ipcRenderer.invoke('app-bar:init'));
});
