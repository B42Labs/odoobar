import { ipcRenderer } from 'electron';
import type { AppConfig, Config } from '../main/config';
import type { SaveResult, SettingsInit, SettingsState, SignOutResult } from '../main/settings';

// The settings page carries no script of its own. This preload script draws
// the configuration, keeps the edits in a draft until Save, and reports clicks
// to the main process. Its imports from ../main are types only, so the
// compiled script requires nothing but electron, which a sandboxed preload
// script can load.

/** An app of the draft. A new app has the id '' until a save gives it one. */
type DraftApp = { -readonly [Key in keyof AppConfig]: AppConfig[Key] };

interface Draft {
  baseUrl: string;
  launchAtLogin: boolean;
  apps: DraftApp[];
}

/** A copy of the configuration with the keys in the same order, so JSON.stringify tells whether the draft differs. */
const draftOf = (config: Config): Draft => JSON.parse(JSON.stringify(config));

window.addEventListener('DOMContentLoaded', async () => {
  // A page that the main process refuses gets no state, so it draws nothing and sends nothing.
  const init: SettingsInit = await ipcRenderer.invoke('settings:init');
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const baseUrl = byId<HTMLInputElement>('base-url');
  const launchAtLogin = byId<HTMLInputElement>('launch-at-login');
  const apps = byId('apps');
  const add = byId<HTMLButtonElement>('add');
  const signOut = byId<HTMLButtonElement>('sign-out');
  const signOutError = byId('sign-out-error');
  const error = byId('error');
  const save = byId<HTMLButtonElement>('save');
  const picker = byId<HTMLDialogElement>('icon-picker');
  const search = byId<HTMLInputElement>('icon-search');
  const known = new Set(init.icons);
  const { texts } = init.state;

  let saved: SettingsState = init.state;
  let draft = draftOf(saved.config);
  let dirty = false;
  /** The index of the row that records a shortcut. */
  let recording: number | undefined;
  /** The index of the row whose icon the picker sets. */
  let picking: number | undefined;

  document.title = texts.title;
  byId('general-title').textContent = texts.general;
  byId('base-url-label').textContent = texts.baseUrl;
  byId('launch-at-login-label').textContent = texts.launchAtLogin;
  byId('apps-title').textContent = texts.apps;
  byId('column-icon').textContent = texts.icon;
  byId('column-name').textContent = texts.name;
  byId('column-url').textContent = texts.url;
  byId('column-shortcut').textContent = texts.shortcut;
  byId('column-menu-bar').textContent = texts.menuBar;
  add.textContent = texts.add;
  byId('shortcut-hint').textContent = texts.shortcutHint;
  byId('session-title').textContent = texts.session;
  signOut.textContent = texts.signOut;
  byId('sign-out-hint').textContent = texts.signOutHint;
  save.textContent = texts.save;
  byId('picker-title').textContent = texts.pickIcon;
  search.placeholder = texts.searchIcons;
  search.setAttribute('aria-label', texts.searchIcons);
  byId('no-icon').textContent = texts.noIcon;

  const button = (className: string, text: string, label = text) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.setAttribute('aria-label', label);
    return element;
  };

  /** Shows the image of an icon, or of the fallback icon for a name the build has no image of. */
  const showIcon = (image: HTMLImageElement, name: string) => {
    const file = init.iconsUrl + (known.has(name) ? name : init.fallbackIcon);
    image.srcset = `${file}.png 1x, ${file}@2x.png 2x`;
  };

  /** An icon image that loads once it scrolls into view, so the two thousand or so images of the picker load only when it shows them. */
  const iconImage = (name: string) => {
    const image = document.createElement('img');
    image.className = 'icon-image';
    image.alt = '';
    image.loading = 'lazy';
    showIcon(image, name);
    return image;
  };

  const inRow = <T extends HTMLElement>(index: number, selector: string) =>
    apps.children[index]?.querySelector<T>(selector);

  const updateDirty = () => {
    const next = JSON.stringify(draft) !== JSON.stringify(saved.config);
    save.disabled = !next;
    if (next === dirty) return;
    dirty = next;
    ipcRenderer.send('settings:dirty', next);
  };

  /** The notice of the saved shortcut of an app, while the draft still holds that shortcut. */
  const noticeOf = (app: DraftApp) => {
    const before = saved.config.apps.find((candidate) => candidate.id === app.id);
    return app.id !== '' && before?.shortcut === app.shortcut ? (saved.notices[app.id] ?? '') : '';
  };

  const showRecording = (index: number, on: boolean) => {
    const record = inRow<HTMLButtonElement>(index, 'button.record');
    if (!record) return;
    record.setAttribute('aria-pressed', String(on));
    record.textContent = on ? texts.recording : texts.record;
  };

  /** Ends a recording that the page started, for a change of the rows or a save. */
  const stopRecording = () => {
    if (recording === undefined) return;
    ipcRenderer.send('settings:record-stop');
    showRecording(recording, false);
    recording = undefined;
  };

  /** Sets the icon of the row that the picker is open for, and closes the picker. */
  const pick = (name: string) => {
    const app = picking === undefined ? undefined : draft.apps[picking];
    const icon = picking === undefined ? undefined : inRow<HTMLButtonElement>(picking, 'button.icon');
    const image = icon?.querySelector('img');
    if (app && icon && image) {
      app.icon = name;
      icon.dataset.icon = name;
      showIcon(image, name);
      updateDirty();
    }
    picker.close();
  };

  // The grid holds every icon of the build.
  const choices = new Map(
    init.icons.map((name) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.icon = name;
      choice.title = name;
      choice.append(iconImage(name));
      choice.addEventListener('click', () => pick(name));
      return [name, choice];
    }),
  );
  byId('icon-grid').replaceChildren(...choices.values());

  const filterIcons = () => {
    const text = search.value.trim().toLowerCase();
    for (const [name, choice] of choices) choice.hidden = !name.includes(text);
  };
  search.addEventListener('input', filterIcons);
  byId('no-icon').addEventListener('click', () => pick(''));
  // Escape closes the picker as well, without a change.
  picker.addEventListener('close', () => {
    picking = undefined;
  });

  const openPicker = (index: number) => {
    // A recording would take the keys of the search field.
    stopRecording();
    picking = index;
    search.value = '';
    filterIcons();
    picker.showModal();
    search.focus();
  };

  const row = (app: DraftApp, index: number) => {
    const element = document.createElement('div');
    element.className = 'app';
    element.dataset.id = app.id;
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = noticeOf(app);

    const icon = button('icon', '', texts.icon);
    icon.title = texts.icon;
    icon.dataset.icon = app.icon;
    icon.append(iconImage(app.icon));
    icon.addEventListener('click', () => openPicker(index));

    const text = (field: 'name' | 'url' | 'shortcut') => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = field;
      input.value = app[field];
      input.dataset.path = `apps[${index}].${field}`;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', texts[field]);
      input.addEventListener('input', () => {
        app[field] = input.value;
        notice.textContent = noticeOf(app);
        updateDirty();
      });
      return input;
    };

    const record = button('record', texts.record);
    record.setAttribute('aria-pressed', 'false');
    record.addEventListener('click', () => {
      if (recording === index) return stopRecording();
      if (recording === undefined) ipcRenderer.send('settings:record-start');
      else showRecording(recording, false);
      recording = index;
      showRecording(index, true);
    });

    const menuBar = document.createElement('input');
    menuBar.type = 'checkbox';
    menuBar.className = 'menu-bar';
    menuBar.checked = app.menuBar;
    menuBar.dataset.path = `apps[${index}].menuBar`;
    menuBar.title = texts.menuBar;
    menuBar.setAttribute('aria-label', texts.menuBar);
    menuBar.addEventListener('change', () => {
      app.menuBar = menuBar.checked;
      updateDirty();
    });

    const up = button('up', '↑', texts.moveUp);
    up.title = texts.moveUp;
    up.disabled = index === 0;
    up.addEventListener('click', () => move(index, index - 1));
    const down = button('down', '↓', texts.moveDown);
    down.title = texts.moveDown;
    down.disabled = index === draft.apps.length - 1;
    down.addEventListener('click', () => move(index, index + 1));
    const remove = button('remove', texts.remove);
    remove.addEventListener('click', () => {
      stopRecording();
      draft.apps.splice(index, 1);
      changeRows();
    });

    element.append(icon, text('name'), text('url'), text('shortcut'), record, menuBar, up, down, remove, notice);
    return element;
  };

  const renderGeneral = () => {
    baseUrl.value = draft.baseUrl;
    launchAtLogin.checked = draft.launchAtLogin;
  };

  /** Draws the rows anew, which only a change of their number or order needs, so typing keeps the focus. */
  const renderRows = () => {
    apps.replaceChildren(...draft.apps.map(row));
  };

  const changeRows = () => {
    renderRows();
    updateDirty();
  };

  const move = (from: number, to: number) => {
    stopRecording();
    const [app] = draft.apps.splice(from, 1);
    if (app) draft.apps.splice(to, 0, app);
    changeRows();
  };

  baseUrl.addEventListener('input', () => {
    draft.baseUrl = baseUrl.value;
    updateDirty();
  });
  launchAtLogin.addEventListener('change', () => {
    draft.launchAtLogin = launchAtLogin.checked;
    updateDirty();
  });

  add.addEventListener('click', () => {
    stopRecording();
    draft.apps.push({ id: '', name: '', url: '', icon: '', shortcut: '', menuBar: true });
    changeRows();
    inRow<HTMLInputElement>(draft.apps.length - 1, 'input.name')?.focus();
  });

  ipcRenderer.on('settings:recorded', (_event, accelerator: unknown) => {
    if (recording === undefined) return;
    const shortcut = inRow<HTMLInputElement>(recording, 'input.shortcut');
    if (typeof accelerator === 'string' && shortcut) {
      shortcut.value = accelerator;
      // The input event refreshes the draft, the notice, and Save.
      shortcut.dispatchEvent(new Event('input'));
    }
    showRecording(recording, false);
    recording = undefined;
  });

  save.addEventListener('click', async () => {
    stopRecording();
    error.textContent = '';
    for (const field of document.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
    const result: SaveResult = await ipcRenderer.invoke('settings:save', draft);
    if (result.ok) {
      saved = result.state;
      draft = draftOf(saved.config);
      renderGeneral();
      renderRows();
      updateDirty();
      return;
    }
    error.textContent = result.error;
    const invalid = [...document.querySelectorAll<HTMLElement>('[data-path]')].find(
      (field) => result.path !== '' && field.dataset.path === result.path,
    );
    invalid?.setAttribute('aria-invalid', 'true');
    invalid?.focus();
  });

  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const result: SignOutResult = await ipcRenderer.invoke('settings:sign-out');
      signOutError.textContent = result.ok ? '' : result.error;
    } finally {
      signOut.disabled = false;
    }
  });

  renderGeneral();
  renderRows();
  document.body.hidden = false;
});
