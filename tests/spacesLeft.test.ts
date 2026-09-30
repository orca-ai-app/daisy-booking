// @vitest-environment jsdom
//
// "Only N spaces left" (TRI-0008): the count shows only in the last quarter of
// a class's places, ceil(capacity × 0.25), never on a class with nothing sold,
// and sold-out is unchanged. Same line on the results cards (search and
// trainer mode) and on the ticket view (/book/:token and the modal).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lowSpacesThreshold,
  spacesLeftMessage,
  type CourseCard,
  type TicketType,
} from '../src/widget/api';

const getPublicCourses = vi.fn();
const getPublicItems = vi.fn();
const getCourseByToken = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getPublicCourses: (...args: unknown[]) => getPublicCourses(...args),
  getPublicItems: (...args: unknown[]) => getPublicItems(...args),
  getCourseByToken: (...args: unknown[]) => getCourseByToken(...args),
}));

import { DaisyBooking } from '../src/widget/DaisyBooking';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

const SINGLE: TicketType = { id: 't1', name: 'Single', price_pence: 3500, seats_consumed: 1 };

function course(over: Partial<CourseCard> = {}): CourseCard {
  return {
    id: 'c1',
    template_name: 'Baby & Child First Aid',
    template_slug: 'baby-child',
    template_description: null,
    age_range: null,
    event_date: '2026-10-20',
    start_time: '10:00:00',
    end_time: '12:00:00',
    venue_name: 'The Hall',
    venue_postcode: 'SW11 1AA',
    distance_miles: null,
    franchisee_name: 'Hannah',
    capacity: 12,
    spots_remaining: 12,
    ticket_types: [SINGLE],
    ...over,
  };
}

describe('lowSpacesThreshold', () => {
  it('is ceil(capacity × 0.25)', () => {
    expect(lowSpacesThreshold(12)).toBe(3);
    expect(lowSpacesThreshold(20)).toBe(5);
    expect(lowSpacesThreshold(10)).toBe(3);
    expect(lowSpacesThreshold(16)).toBe(4);
    expect(lowSpacesThreshold(6)).toBe(2);
    expect(lowSpacesThreshold(4)).toBe(1);
    expect(lowSpacesThreshold(2)).toBe(1);
  });
});

describe('spacesLeftMessage', () => {
  const msg = (capacity: number, spots_remaining: number, sold_out?: boolean) =>
    spacesLeftMessage({ capacity, spots_remaining, sold_out });

  it('hides the count above the last quarter', () => {
    expect(msg(12, 12)).toBeNull();
    expect(msg(12, 4)).toBeNull();
    expect(msg(20, 6)).toBeNull();
  });

  it('shows it at and below the threshold', () => {
    expect(msg(12, 3)).toBe('Only 3 spaces left');
    expect(msg(12, 2)).toBe('Only 2 spaces left');
    expect(msg(20, 5)).toBe('Only 5 spaces left');
  });

  it('is singular for one space', () => {
    expect(msg(12, 1)).toBe('Only 1 space left');
  });

  it('never shows on a class with nothing sold, so tiny classes open clean', () => {
    expect(msg(1, 1)).toBeNull();
    expect(msg(2, 2)).toBeNull();
    expect(msg(4, 4)).toBeNull();
  });

  it('small classes show only at the last place', () => {
    expect(msg(4, 2)).toBeNull();
    expect(msg(4, 1)).toBe('Only 1 space left');
    expect(msg(2, 1)).toBe('Only 1 space left');
  });

  it('shows nothing for sold out (the Sold out line handles it)', () => {
    expect(msg(12, 0)).toBeNull();
    expect(msg(12, 2, true)).toBeNull();
  });

  it('shows nothing when capacity is missing or nonsense', () => {
    expect(msg(0, 1)).toBeNull();
    expect(msg(NaN, 1)).toBeNull();
    expect(spacesLeftMessage({ spots_remaining: 1 } as unknown as CourseCard)).toBeNull();
  });
});

async function mount(attrs: Record<string, string>) {
  const el = document.createElement('daisy-booking');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

describe('spaces line in the widget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getPublicItems.mockReset().mockResolvedValue([]);
    getPublicCourses.mockReset();
    getCourseByToken.mockReset();
  });

  it('trainer mode: a fresh class shows no count, a nearly full one says Only N', async () => {
    getPublicCourses.mockResolvedValue({
      courses: [
        course({ id: 'fresh', spots_remaining: 12 }),
        course({ id: 'half', spots_remaining: 6 }),
        course({ id: 'nearly', spots_remaining: 3 }),
        course({ id: 'last', spots_remaining: 1 }),
        course({ id: 'full', spots_remaining: 0, sold_out: true }),
      ],
    });
    const root = await mount({ franchisee: '0086' });
    const line = (id: string) =>
      root.querySelector(`.card[data-id="${id}"] .spots`)?.textContent?.trim() ?? null;
    expect(line('fresh')).toBeNull();
    expect(line('half')).toBeNull();
    expect(line('nearly')).toBe('Only 3 spaces left');
    expect(line('last')).toBe('Only 1 space left');
    expect(line('full')).toBe('Sold out');
    expect(root.textContent).not.toMatch(/\d+ places? left/);
  });

  it('postcode search uses the same rule', async () => {
    getPublicCourses.mockResolvedValue({
      courses: [course({ id: 'a', capacity: 20, spots_remaining: 5 }), course({ id: 'b', capacity: 20, spots_remaining: 6 })],
      territory_status: 'active',
      suggest_interest_form: false,
    });
    const root = await mount({ postcode: 'SW11 1AA' });
    (root.querySelector('form.search') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('.card[data-id="a"] .spots')?.textContent).toBe('Only 5 spaces left');
    expect(root.querySelector('.card[data-id="b"] .spots')).toBeNull();
  });

  it('/book/:token ticket view: count hidden on a fresh class, shown near the end', async () => {
    getCourseByToken.mockResolvedValue(course({ spots_remaining: 10 }));
    let root = await mount({ token: 'tok' });
    expect(root.querySelector('form.tickets')).not.toBeNull();
    expect(root.querySelector('.spots')).toBeNull();
    expect(root.querySelector('.pool')?.textContent).not.toMatch(/\d/);

    document.body.innerHTML = '';
    getCourseByToken.mockResolvedValue(course({ spots_remaining: 2 }));
    root = await mount({ token: 'tok' });
    expect(root.querySelector('.spots')?.textContent).toBe('Only 2 spaces left');
    expect(root.querySelector('.pool')?.textContent).toContain('2 remaining places');
  });

  it('sold-out ticket view is unchanged', async () => {
    getCourseByToken.mockResolvedValue(course({ spots_remaining: 0, sold_out: true }));
    const root = await mount({ token: 'tok' });
    expect(root.querySelector('.spots.out')?.textContent).toBe('Sold out');
    expect(root.textContent).toContain('This class is sold out');
  });
});
