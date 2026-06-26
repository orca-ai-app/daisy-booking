// Entry point: registers the <daisy-booking> custom element and exposes
// window.daisyBooking.open()/close() for the "Book Online" modal trigger.
//
// Two embed patterns (see README):
//   (a) inline:  <daisy-booking franchisee="0042"></daisy-booking>
//   (b) modal:   window.daisyBooking.open({ franchisee: '0042' })

import { DaisyBooking } from './DaisyBooking';
import { open, close } from './modal';

if (!customElements.get('daisy-booking')) {
  customElements.define('daisy-booking', DaisyBooking);
}

window.daisyBooking = { open, close };

export { DaisyBooking, open, close };
