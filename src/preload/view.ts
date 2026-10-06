import { ipcRenderer } from 'electron';

// The only script that OdooBar adds to the pages of a view. It changes
// nothing on a page. It hears a click on a link before the page does and asks
// the main process whether the link opens another app of OdooBar. Then the
// window shows that app, and the page never hears of the click, so it stays
// where it is. Odoo draws each app of its home page and of its app menu as
// such a link. Every other click reaches the page untouched.

window.addEventListener(
  'click',
  (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    // `href` is the full address, resolved against the address of the page.
    if (ipcRenderer.sendSync('view:link', link.href) !== true) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
