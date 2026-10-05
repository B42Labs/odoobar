import { ipcRenderer } from 'electron';
import type { BarState } from '../main/window';

// The app bar page carries no script of its own. This preload script draws
// the state that the main process sends and reports clicks. Its import from
// ../main is a type only, so the compiled script requires nothing but
// electron, which a sandboxed preload script can load.

window.addEventListener('DOMContentLoaded', async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const apps = byId('apps');
  const settings = byId<HTMLButtonElement>('settings');
  const notice = byId('notice');
  const noticeText = byId('notice-text');
  const retry = byId<HTMLButtonElement>('retry');

  const render = (state: BarState) => {
    apps.replaceChildren(
      ...state.apps.map((app) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.appId = app.id;
        button.textContent = app.name;
        if (app.id === state.activeId) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => ipcRenderer.send('app-bar:press', app.id));
        return button;
      }),
    );
    settings.title = state.texts.settings;
    settings.setAttribute('aria-label', state.texts.settings);
    notice.hidden = state.notice === undefined;
    noticeText.textContent = state.notice?.text ?? '';
    retry.hidden = state.notice?.retry !== true;
    retry.textContent = state.texts.retry;
    document.body.hidden = false;
  };

  settings.addEventListener('click', () => ipcRenderer.send('app-bar:settings'));
  retry.addEventListener('click', () => ipcRenderer.send('app-bar:retry'));
  ipcRenderer.on('app-bar:state', (_event, state: BarState) => render(state));
  render(await ipcRenderer.invoke('app-bar:init'));
});
