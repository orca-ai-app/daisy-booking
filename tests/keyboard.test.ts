// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DaisyBooking } from '../src/widget/DaisyBooking';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

describe('keyboard isolation (TRI-0042)', () => {
  it('keeps key events from its inputs away from host-page listeners', () => {
    const el = document.createElement('daisy-booking');
    document.body.appendChild(el);
    const input = document.createElement('input');
    el.shadowRoot!.appendChild(input);
    let hostSaw = 0;
    const onKey = () => hostSaw++;
    window.addEventListener('keydown', onKey);
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true });
    input.dispatchEvent(ev);
    window.removeEventListener('keydown', onKey);
    expect(hostSaw).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves key events from non-field elements alone', () => {
    const el = document.createElement('daisy-booking');
    document.body.appendChild(el);
    const div = document.createElement('div');
    el.shadowRoot!.appendChild(div);
    let hostSaw = 0;
    const onKey = () => hostSaw++;
    window.addEventListener('keydown', onKey);
    div.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }));
    window.removeEventListener('keydown', onKey);
    expect(hostSaw).toBe(1);
  });
});
