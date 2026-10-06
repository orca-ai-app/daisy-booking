// @vitest-environment jsdom
//
// A2 (TRI-0041): a class delivered at the customer's own home says "At your
// home" on its card and gives the area, not a venue, on both the postcode
// search and the trainer's own list. A venue class is unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseCard } from '../src/widget/api';
import { locationLine } from '../src/widget/basket';

const getPublicCourses = vi.fn();
const getPublicItems = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getPublicCourses: (...args: unknown[]) => getPublicCourses(...args),
  getPublicItems: (...args: unknown[]) => getPublicItems(...args),
}));

import { DaisyBooking } from '../src/widget/DaisyBooking';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

function course(over: Partial<CourseCard>): CourseCard {
  return {
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
    capacity: 12,
    spots_remaining: 12,
    ticket_types: [{ id: 't1', name: 'Single', price_pence: 3000, seats_consumed: 1 }],
    ...over,
  };
}

const HOME = course({
  id: 'home',
  delivered_at_address: true,
  venue_name: 'Private class held in your own home in TN1, TN2 or TN3',
  venue_postcode: 'tn1 1aa',
});
const VENUE = course({ id: 'venue', delivered_at_address: false });

async function mount(attrs: Record<string, string>) {
  const el = document.createElement('daisy-booking');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

function expectLabels(root: ShadowRoot) {
  const card = (id: string) => root.querySelector(`.card[data-id="${id}"]`)!;
  expect(card('home').querySelector('.home-badge')?.textContent).toBe('At your home');
  expect(card('home').querySelector('.where')?.textContent).toBe('Your home, TN1 area');
  expect(card('venue').querySelector('.home-badge')).toBeNull();
  expect(card('venue').querySelector('.where')?.textContent).toBe('Guildford Hall');
}

describe('"At your home" on home classes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getPublicItems.mockReset().mockResolvedValue([]);
    getPublicCourses.mockReset().mockResolvedValue({
      courses: [HOME, VENUE],
      territory_status: 'active',
      suggest_interest_form: false,
    });
  });

  it('trainer list (franchisee mode)', async () => {
    expectLabels(await mount({ franchisee: '0086' }));
  });

  it('postcode search', async () => {
    const root = await mount({ postcode: 'TN1 1AA' });
    (root.querySelector('form.search') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await new Promise((r) => setTimeout(r, 0));
    expectLabels(root);
  });

  it('the class view says it too', async () => {
    const root = await mount({ franchisee: '0086' });
    (root.querySelector('.card[data-id="home"]') as HTMLElement).click();
    expect(root.querySelector('.home-badge')?.textContent).toBe('At your home');
    expect(root.querySelector('p.sub')?.textContent).toContain('Your home, TN1 area');
  });

  it('falls back to the trainer\'s wording when there is no postcode', () => {
    expect(locationLine({ ...HOME, venue_postcode: null })).toBe(
      'Private class held in your own home in TN1, TN2 or TN3',
    );
    expect(locationLine({ ...HOME, venue_postcode: null, venue_name: null })).toBe('Your home');
    expect(locationLine(VENUE)).toBe('Guildford Hall');
  });
});
