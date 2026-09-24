import { STYLES } from './styles';

// A single shared <dialog> that hosts a <daisy-booking> element. Native dialog
// gives us the backdrop, ESC-to-close and focus trap for free. Body scroll is
// locked while open. Styles live in the dialog's own shadow root so Divi/theme
// CSS can't reach in.

let host: HTMLElement | null = null;
let dialog: HTMLDialogElement | null = null;
let prevBodyOverflow = '';
let prevHtmlOverflow = '';

function build(): { host: HTMLElement; dialog: HTMLDialogElement } {
  const h = document.createElement('div');
  h.className = 'modal';
  const shadow = h.attachShadow({ mode: 'open' });
  const dlg = document.createElement('dialog');
  dlg.className = 'daisy-modal';
  dlg.innerHTML = `
    <div class="modal-head"><button class="close" aria-label="Close">×</button></div>
    <div class="modal-body"></div>`;
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style, dlg);
  document.body.appendChild(h);

  dlg.querySelector('.close')!.addEventListener('click', () => close());

  // Scroll the body ourselves on wheel. Divi's smoothscroll.js (and similar
  // host-page scripts) cancel every wheel event and walk up from event.target
  // looking for something scrollable; Shadow DOM retargets our events to the
  // host <div class="modal">, so they only ever find <body>, which is locked,
  // and nothing moves. Verified live on daisyfirstaid.com (TRI-0021, Feola,
  // Mac, 24 Sep). Touch scrolling is not intercepted, hence desktop-only.
  const body = dlg.querySelector<HTMLElement>('.modal-body')!;
  body.addEventListener(
    'wheel',
    (e) => {
      const dy =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * body.clientHeight : e.deltaY;
      body.scrollTop += dy;
      e.preventDefault();
      e.stopPropagation();
    },
    { passive: false },
  );

  // Backdrop click (clicks landing on the dialog element itself, not its content).
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  dlg.addEventListener('close', () => {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.style.overflow = prevHtmlOverflow;
  });
  return { host: h, dialog: dlg };
}

export function open(opts: DaisyBookingOpenOptions = {}) {
  if (!host || !dialog) {
    const built = build();
    host = built.host;
    dialog = built.dialog;
  }
  const body = dialog.querySelector('.modal-body')!;
  body.innerHTML = '';
  const widget = document.createElement('daisy-booking');
  if (opts.franchisee) widget.setAttribute('franchisee', opts.franchisee);
  if (opts.postcode) widget.setAttribute('postcode', opts.postcode);
  if (opts.radius) widget.setAttribute('radius', String(opts.radius));
  if (opts.courseType) widget.setAttribute('course-type', opts.courseType);
  if (opts.month) widget.setAttribute('month', opts.month);
  body.appendChild(widget);

  // Lock BOTH <html> and <body>. Many WordPress/Divi themes make the real
  // scroller the documentElement (or a page wrapper), so locking body alone
  // leaves the page scrolling behind the modal (Feola, Mac, 24 Sep).
  prevBodyOverflow = document.body.style.overflow;
  prevHtmlOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  if (!dialog.open) dialog.showModal();
}

export function close() {
  if (dialog?.open) dialog.close();
}
