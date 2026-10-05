import { ipcRenderer } from 'electron';
import type { FirstStartTexts, SubmitResult } from '../main/startup';

// The first-start page carries no script of its own. This preload script fills
// in its texts and sends the form to the main process. Its imports from
// ../main are types only, so the compiled script requires nothing but
// electron, which a sandboxed preload script can load.

window.addEventListener('DOMContentLoaded', async () => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const input = byId<HTMLInputElement>('base-url');
  const error = byId('error');

  byId('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result: SubmitResult = await ipcRenderer.invoke('first-start:submit', input.value);
    error.textContent = result.ok ? '' : result.error;
  });
  byId('quit').addEventListener('click', () => window.close());

  const texts: FirstStartTexts = await ipcRenderer.invoke('first-start:init');
  byId('title').textContent = texts.title;
  byId('label').textContent = texts.label;
  byId('hint').textContent = texts.hint;
  byId('save').textContent = texts.save;
  byId('quit').textContent = texts.quit;
  document.body.hidden = false;
  input.focus();
});
