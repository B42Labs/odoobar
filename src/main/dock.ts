/** The seam between the Dock decisions and macOS. dock-ui.ts is the Electron side. */
export interface DockUi {
  show(): void;
  hide(): void;
}

/**
 * Decides when OdooBar has a Dock icon: while one of its windows is open.
 * macOS shows the menu of an app in the menu bar only while the app has a
 * Dock icon, so the icon comes with the first window and goes with the last.
 */
export class Dock {
  private readonly open = new Set<string>();

  constructor(private readonly ui: DockUi) {}

  /** A window is about to show. A window that is open already changes nothing. */
  opened(window: string): void {
    if (this.open.has(window)) return;
    this.open.add(window);
    if (this.open.size === 1) this.ui.show();
  }

  /** A window closed or was hidden. A window that is not open changes nothing. */
  closed(window: string): void {
    if (this.open.delete(window) && this.open.size === 0) this.ui.hide();
  }
}
