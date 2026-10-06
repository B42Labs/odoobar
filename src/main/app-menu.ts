import { fill, type Messages } from './messages';

/** Where the source code of OdooBar lives. The About dialog links to it. */
export const REPOSITORY_URL = 'https://github.com/B42Labs/odoobar';

/**
 * One entry of the app menu, in the form of Electron's menu template. This
 * module never imports electron, so its unit tests run in plain Node.js.
 */
export interface MenuEntry {
  readonly label?: string;
  readonly role?:
    | 'hide'
    | 'hideOthers'
    | 'unhide'
    | 'quit'
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'pasteAndMatchStyle'
    | 'delete'
    | 'selectAll'
    | 'resetZoom'
    | 'zoomIn'
    | 'zoomOut'
    | 'toggleDevTools'
    | 'window'
    | 'minimize'
    | 'zoom'
    | 'close'
    | 'front';
  readonly type?: 'separator';
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly click?: () => void;
  readonly submenu?: MenuEntry[];
}

/** What the entries of the app menu without a role do. */
export interface AppMenuActions {
  about(): void;
  /** Opens the settings window. Absent while OdooBar has no configuration: during the first-start prompt. */
  readonly settings?: (() => void) | undefined;
}

/**
 * The menu that macOS shows in the menu bar while OdooBar is in front. It
 * replaces Electron's default menu and keeps the keys of that menu that the
 * windows rely on: those of Edit, the zoom of a page, the developer tools,
 * and those of Window with ⌘W. It has no entry that reloads a page, since ⌘R
 * belongs to the window and a reload of the settings would drop unsaved edits.
 */
export function appMenu(messages: Messages, actions: AppMenuActions): MenuEntry[] {
  const texts = messages.appMenu;
  const separator: MenuEntry = { type: 'separator' };
  const { settings } = actions;
  return [
    {
      // macOS shows the name of the app bundle here, whatever the label says.
      label: 'OdooBar',
      submenu: [
        { label: texts.about, click: () => actions.about() },
        separator,
        {
          label: messages.menuBar.settings,
          accelerator: 'Command+,',
          enabled: settings !== undefined,
          click: () => settings?.(),
        },
        separator,
        { role: 'hide', label: texts.hide },
        { role: 'hideOthers', label: texts.hideOthers },
        { role: 'unhide', label: texts.showAll },
        separator,
        { role: 'quit', label: texts.quit },
      ],
    },
    {
      label: texts.edit,
      submenu: [
        { role: 'undo', label: texts.undo },
        { role: 'redo', label: texts.redo },
        separator,
        { role: 'cut', label: texts.cut },
        { role: 'copy', label: texts.copy },
        { role: 'paste', label: texts.paste },
        { role: 'pasteAndMatchStyle', label: texts.pasteAndMatchStyle },
        { role: 'delete', label: texts.delete },
        { role: 'selectAll', label: texts.selectAll },
      ],
    },
    {
      label: texts.view,
      submenu: [
        { role: 'resetZoom', label: texts.actualSize },
        { role: 'zoomIn', label: texts.zoomIn },
        { role: 'zoomOut', label: texts.zoomOut },
        separator,
        { role: 'toggleDevTools', label: texts.developerTools },
      ],
    },
    {
      // With this role, macOS lists the open windows at the end of the menu.
      role: 'window',
      label: texts.window,
      submenu: [
        { role: 'minimize', label: texts.minimize },
        { role: 'zoom', label: texts.zoom },
        { role: 'close', label: texts.close },
        separator,
        { role: 'front', label: texts.bringAllToFront },
      ],
    },
  ];
}

/** What the About dialog says. The first button closes it, the second opens REPOSITORY_URL in the browser. */
export interface AboutDialog {
  readonly message: string;
  readonly detail: string;
  readonly buttons: string[];
}

export function aboutDialog(messages: Messages, version: string): AboutDialog {
  const { about } = messages;
  return {
    message: 'OdooBar',
    detail: `${fill(about.version, { version })}\n\n${REPOSITORY_URL}`,
    buttons: [about.ok, about.repository],
  };
}
