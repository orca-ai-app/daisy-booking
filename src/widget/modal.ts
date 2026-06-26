import { STYLES } from './styles';

// A single shared <dialog> that hosts a <daisy-booking> element. Native dialog
// gives us the backdrop, ESC-to-close and focus trap for free. Body scroll is
// locked while open. Styles live in the dialog's own shadow root so Divi/theme
// CSS can't reach in.

let host: HTMLElement | null = null;
let dialog: HTMLDialogElement | null = null;
let prevOverflow = '';

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
  // Backdrop click (clicks landing on the dialog element itself, not its content).
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  dlg.addEventListener('close', () => {
    document.body.style.overflow = prevOverflow;
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
  body.appendChild(widget);

  prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  if (!dialog.open) dialog.showModal();
}

export function close() {
  if (dialog?.open) dialog.close();
}
