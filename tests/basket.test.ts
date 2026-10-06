// @vitest-environment jsdom
//
// B6 basket: a quantity per ticket type (e.g. 1 Double + 1 Single), the
// trainer's shop items in the same order, a running total, and the class's
// place limit across every line. One ticket and no items still sends the old
// single-ticket request.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CourseCard, ItemCard } from '../src/widget/api';
import { basketPayload, initialTicketValues, summariseBasket, ticketMax } from '../src/widget/basket';

const getCourseByToken = vi.fn();
const getPublicItems = vi.fn();
const createCheckoutSession = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getCourseByToken: (...args: unknown[]) => getCourseByToken(...args),
  getPublicItems: (...args: unknown[]) => getPublicItems(...args),
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

import { DaisyBooking } from '../src/widget/DaisyBooking';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

const CLASS: CourseCard = {
  id: 'c1',
  template_name: 'Baby & Child First Aid',
  template_slug: 'baby-child',
  template_description: null,
  age_range: null,
  event_date: '2026-11-20',
  start_time: '10:00:00',
  end_time: '12:00:00',
  venue_name: 'Guildford Hall',
  venue_postcode: 'GU1 1AA',
  distance_miles: null,
  franchisee_name: 'Feola',
  franchisee_id: 'f1',
  capacity: 12,
  spots_remaining: 8,
  ticket_types: [
    { id: 't-single', name: 'Single', price_pence: 3000, seats_consumed: 1 },
    { id: 't-double', name: 'Double', price_pence: 5000, seats_consumed: 2 },
  ],
};

const BOOK: ItemCard = {
  id: 'fp-book',
  product_id: 'p-book',
  name: 'Baby first aid book',
  description: null,
  kind: 'physical',
  price_pence: 1200,
  vat_rate: null,
  franchisee_id: 'f1',
  franchisee_name: 'Feola',
};
const ELEARN: ItemCard = { ...BOOK, id: 'fp-el', name: 'Paediatric e-learning', kind: 'elearning' };

describe('basket maths', () => {
  it('sums lines and items, and counts places across every ticket line', () => {
    const s = summariseBasket(CLASS, [BOOK], { 'qty_t-double': '1', 'qty_t-single': '1', 'item_fp-book': '2' });
    expect(s.rows.map((r) => r.label)).toEqual(['Single × 1', 'Double × 1', 'Baby first aid book × 2']);
    expect(s.seats).toBe(3);
    expect(s.ticketsPence).toBe(8000);
    expect(s.totalPence).toBe(10400);
    expect(s.fits).toBe(true);
  });

  it('the place limit applies to the whole order, not each line', () => {
    const tight = { ...CLASS, spots_remaining: 3 };
    // Each fits on its own (Double = 2, 2 Singles = 2), together they need 4.
    const s = summariseBasket(tight, [], { 'qty_t-double': '1', 'qty_t-single': '2' });
    expect(s.seats).toBe(4);
    expect(s.fits).toBe(false);
  });

  it('a ticket offers only as many as the pool could seat, capped at 10', () => {
    expect(ticketMax(CLASS.ticket_types[1], 5)).toBe(2);
    expect(ticketMax(CLASS.ticket_types[1], 1)).toBe(0);
    expect(ticketMax(CLASS.ticket_types[0], 40)).toBe(10);
  });

  it('e-learning is one per order, as when bought on its own', () => {
    expect(summariseBasket(CLASS, [ELEARN], { 'qty_t-single': '1', 'item_fp-el': '3' }).items[0].quantity).toBe(1);
  });

  it('one ticket type and no items is the old single-ticket request', () => {
    const s = summariseBasket(CLASS, [BOOK], { 'qty_t-double': '2', 'item_fp-book': '0' });
    expect(basketPayload(s)).toEqual({ ticket_type_id: 't-double', quantity: 2 });
  });

  it('anything more is sent as lines and items', () => {
    const s = summariseBasket(CLASS, [BOOK], { 'qty_t-double': '1', 'qty_t-single': '1', 'item_fp-book': '1' });
    expect(basketPayload(s)).toEqual({
      lines: [
        { ticket_type_id: 't-single', quantity: 1 },
        { ticket_type_id: 't-double', quantity: 1 },
      ],
      items: [{ franchisee_product_id: 'fp-book', quantity: 1 }],
    });
  });

  it('starts with one of the first ticket that fits, as the old form did', () => {
    expect(initialTicketValues(CLASS, {})).toEqual({ 'qty_t-single': '1', 'qty_t-double': '0' });
    expect(initialTicketValues(CLASS, { 'qty_t-double': '2' })).toEqual({
      'qty_t-single': '0',
      'qty_t-double': '2',
    });
  });
});

async function mount(course: CourseCard, items: ItemCard[] = []) {
  getCourseByToken.mockResolvedValue(course);
  getPublicItems.mockResolvedValue(items);
  const el = document.createElement('daisy-booking');
  el.setAttribute('token', 'tok');
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

function choose(root: ShadowRoot, name: string, value: string) {
  const sel = root.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

function fillCustomer(root: ShadowRoot) {
  const set = (name: string, v: string) =>
    ((root.querySelector(`[name="${name}"]`) as HTMLInputElement).value = v);
  set('name', 'Amber');
  set('last', 'Jones');
  set('email', 'amber@example.com');
  set('phone', '07000 000000');
  set('postcode', 'GU1 2BB');
}

async function submit(root: ShadowRoot) {
  (root.querySelector('form.tickets') as HTMLFormElement).dispatchEvent(new Event('submit'));
  await new Promise((r) => setTimeout(r, 0));
}

const summary = (root: ShadowRoot) => root.querySelector('[data-order-summary]')!.textContent ?? '';

describe('basket on the booking form', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getCourseByToken.mockReset();
    getPublicItems.mockReset();
    createCheckoutSession.mockReset().mockResolvedValue({
      checkout_url: 'https://checkout.stripe.com/x',
      session_id: 'cs_1',
      booking_reference: 'R',
    });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false, location: { href: '' } } as unknown as Window);
  });
  afterEach(() => vi.restoreAllMocks());

  it('has a quantity for each ticket type and offers the trainer\'s shop items', async () => {
    const root = await mount(CLASS, [BOOK]);
    expect(getPublicItems).toHaveBeenCalledWith({ franchisee_id: 'f1' });
    expect(root.querySelector('select[name="qty_t-single"]')).not.toBeNull();
    expect(root.querySelector('select[name="qty_t-double"]')).not.toBeNull();
    expect(root.querySelector('select[name="item_fp-book"]')).not.toBeNull();
    expect(root.textContent).toContain('Add to your order');
  });

  it('adding lines updates the running total', async () => {
    const root = await mount(CLASS, [BOOK]);
    expect(summary(root)).toContain('Single × 1');
    expect(summary(root)).toContain('£30.00');
    choose(root, 'qty_t-double', '1');
    choose(root, 'item_fp-book', '1');
    expect(summary(root)).toContain('Double × 1');
    expect(summary(root)).toContain('Baby first aid book × 1');
    expect(summary(root)).toContain('£92.00');
    expect(summary(root)).toContain('Uses 3 places');
  });

  it('sends every line and item in one checkout', async () => {
    const root = await mount(CLASS, [BOOK]);
    choose(root, 'qty_t-double', '1');
    choose(root, 'item_fp-book', '2');
    fillCustomer(root);
    await submit(root);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const input = createCheckoutSession.mock.calls[0][0];
    expect(input.lines).toEqual([
      { ticket_type_id: 't-single', quantity: 1 },
      { ticket_type_id: 't-double', quantity: 1 },
    ]);
    expect(input.items).toEqual([{ franchisee_product_id: 'fp-book', quantity: 2 }]);
    expect(input.ticket_type_id).toBeUndefined();
  });

  it('a single ticket still sends the old request', async () => {
    const root = await mount(CLASS);
    choose(root, 'qty_t-single', '2');
    fillCustomer(root);
    await submit(root);
    const input = createCheckoutSession.mock.calls[0][0];
    expect(input).toMatchObject({ course_instance_id: 'c1', ticket_type_id: 't-single', quantity: 2 });
    expect(input.lines).toBeUndefined();
    expect(input.items).toBeUndefined();
  });

  it('warns and refuses an order bigger than the places left', async () => {
    const root = await mount({ ...CLASS, spots_remaining: 3 });
    choose(root, 'qty_t-double', '1');
    choose(root, 'qty_t-single', '2');
    expect(summary(root)).toContain('need 4 places, but only 3 are left');
    fillCustomer(root);
    await submit(root);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(root.querySelector('.error')?.textContent).toContain('need 4 places');
    // What they chose survives the error.
    expect((root.querySelector('select[name="qty_t-single"]') as HTMLSelectElement).value).toBe('2');
  });

  it('needs at least one ticket', async () => {
    const root = await mount(CLASS, [BOOK]);
    choose(root, 'qty_t-single', '0');
    choose(root, 'item_fp-book', '1');
    expect(summary(root)).toContain('Choose at least one ticket');
    fillCustomer(root);
    await submit(root);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(root.querySelector('.error')?.textContent).toBe('Please choose at least one ticket.');
  });

  it('a class with no trainer id (older server) is tickets only', async () => {
    const root = await mount({ ...CLASS, franchisee_id: undefined }, [BOOK]);
    expect(getPublicItems).not.toHaveBeenCalled();
    expect(root.querySelector('select[name="item_fp-book"]')).toBeNull();
  });

  it("never offers another trainer's items", async () => {
    const root = await mount(CLASS, [{ ...BOOK, franchisee_id: 'someone-else' }]);
    expect(root.querySelector('select[name="item_fp-book"]')).toBeNull();
  });
});
