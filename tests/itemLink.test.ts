// @vitest-environment jsdom
//
// Single-item shop link (TRI-0045): <daisy-booking franchisee="0031" item="…">
// opens straight onto that item's purchase view, with Back going to the
// trainer's list; a hidden or unknown item falls back to the list with a
// message.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseCard, ItemCard } from '../src/widget/api';

const getPublicItems = vi.fn();
const getPublicCourses = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getPublicItems: (...args: unknown[]) => getPublicItems(...args),
  getPublicCourses: (...args: unknown[]) => getPublicCourses(...args),
}));

import { DaisyBooking } from '../src/widget/DaisyBooking';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

const ITEM: ItemCard = {
  id: 'fp-anaphylaxis',
  product_id: 'p-anaphylaxis',
  name: 'Anaphylaxis e-Learning Course',
  description: 'Learn to spot and treat anaphylaxis.',
  kind: 'elearning',
  price_pence: 1499,
  vat_rate: null,
  franchisee_id: 'f-0031',
  franchisee_name: 'Feola',
};

const OTHER: ItemCard = { ...ITEM, id: 'fp-book', product_id: 'p-book', name: 'First Aid Book', kind: 'physical' };

const CLASS: CourseCard = {
  id: 'c1',
  template_name: 'Baby & Child First Aid',
  template_slug: 'baby-child',
  template_description: null,
  age_range: null,
  event_date: '2026-10-20',
  start_time: '10:00:00',
  end_time: '12:00:00',
  venue_name: 'Guildford Hall',
  venue_postcode: 'GU1 1AA',
  distance_miles: null,
  franchisee_name: 'Feola',
  capacity: 12,
  spots_remaining: 8,
  ticket_types: [],
};

async function mount(attrs: Record<string, string>) {
  const el = document.createElement('daisy-booking');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  // Let the parallel loads settle and the view render.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

describe('single-item link (TRI-0045)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getPublicItems.mockReset().mockResolvedValue([OTHER, ITEM]);
    getPublicCourses.mockReset().mockResolvedValue({ courses: [CLASS] });
  });

  it("opens straight onto the item's purchase view, loading by franchisee", async () => {
    const root = await mount({ franchisee: '0031', item: 'fp-anaphylaxis' });
    expect(getPublicItems).toHaveBeenCalledTimes(1);
    expect(getPublicItems).toHaveBeenCalledWith({ franchisee_id: '0031' });
    expect(root.querySelector('h2')?.textContent).toBe('Anaphylaxis e-Learning Course');
    expect(root.querySelector('form.item-buy')).not.toBeNull();
    expect(root.textContent).toContain('£14.99');
  });

  it("Back goes to the trainer's list, classes and items", async () => {
    const root = await mount({ franchisee: '0031', item: 'fp-anaphylaxis' });
    const back = root.querySelector('[data-back]') as HTMLButtonElement;
    expect(back.dataset.back).toBe('results');
    back.click();
    expect(root.querySelector('form.item-buy')).toBeNull();
    expect(root.textContent).toContain('Upcoming classes');
    expect(root.textContent).toContain('Available any time');
    expect(root.querySelectorAll('.card.item')).toHaveLength(2);
  });

  it('Back still reaches the list when the trainer has no classes', async () => {
    getPublicCourses.mockResolvedValue({ courses: [] });
    const root = await mount({ franchisee: '0031', item: 'fp-anaphylaxis' });
    (root.querySelector('[data-back]') as HTMLButtonElement).click();
    expect(root.textContent).toContain('Available any time');
    expect(root.querySelector('[data-request-class]')).not.toBeNull();
  });

  it('an item that is not online falls back to the list with a clear message', async () => {
    const root = await mount({ franchisee: '0031', item: 'fp-gone' });
    const notice = root.querySelector('.notice.warn');
    expect(notice?.textContent).toContain("isn't available to buy online");
    expect(root.textContent).toContain('Upcoming classes');
    expect(root.querySelectorAll('.card.item')).toHaveLength(2);
    // The message goes once the customer moves on.
    (root.querySelector('.card.item') as HTMLElement).click();
    expect(root.querySelector('.notice.warn')).toBeNull();
  });

  it('opens the item even when the class list fails to load', async () => {
    getPublicCourses.mockRejectedValue(new Error('boom'));
    const root = await mount({ franchisee: '0031', item: 'fp-anaphylaxis' });
    expect(root.querySelector('form.item-buy')).not.toBeNull();
    expect(root.querySelector('.error')).toBeNull();
  });

  it('never renders the item id into the page', async () => {
    const root = await mount({ franchisee: '0031', item: '<img src=x onerror=alert(1)>' });
    expect(root.querySelector('img[src="x"]')).toBeNull();
    expect(root.innerHTML).not.toContain('onerror');
  });

  it('ignores item without a franchisee (plain finder)', async () => {
    const root = await mount({ item: 'fp-anaphylaxis' });
    expect(getPublicItems).not.toHaveBeenCalled();
    expect(root.querySelector('form.search')).not.toBeNull();
  });

  it('without item, franchisee mode is unchanged', async () => {
    const root = await mount({ franchisee: '0031' });
    expect(root.textContent).toContain('Upcoming classes');
    expect(root.querySelector('form.item-buy')).toBeNull();
  });
});
