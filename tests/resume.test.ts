// @vitest-environment jsdom
//
// Checkout recovery (migration 066): /book/:token?resume=<token> re-fills the
// customer's earlier details, ticket and quantity. A bad or expired token
// leaves the normal empty form.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseCard } from '../src/widget/api';

const getCourseForResume = vi.fn();
const getCourseByToken = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getCourseForResume: (...args: unknown[]) => getCourseForResume(...args),
  getCourseByToken: (...args: unknown[]) => getCourseByToken(...args),
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
  capacity: 12,
  spots_remaining: 8,
  ticket_types: [
    { id: 't-single', name: 'Single', price_pence: 3000, seats_consumed: 1 },
    { id: 't-couple', name: 'Couple', price_pence: 5000, seats_consumed: 2 },
  ],
} as CourseCard;

const RESUME = {
  ticket_type_id: 't-couple',
  quantity: 2,
  discount_code: 'SAVE10',
  service_address: '',
  parking_notes: '',
  first_name: 'Amber',
  last_name: 'Jones',
  email: 'amber@example.com',
  phone: '07000000000',
  postcode: 'GU1 2BB',
};

async function mount(attrs: Record<string, string>) {
  const el = document.createElement('daisy-booking');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

const value = (root: ShadowRoot, name: string) =>
  (root.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value;

describe('checkout recovery resume link', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getCourseForResume.mockReset();
    getCourseByToken.mockReset();
  });

  it('re-fills details, ticket and quantity from a valid resume token', async () => {
    getCourseForResume.mockResolvedValue({ course: CLASS, resume: RESUME });
    const root = await mount({ token: 'tok', resume: 'abc' });
    expect(getCourseForResume).toHaveBeenCalledWith('tok', 'abc');
    expect(getCourseByToken).not.toHaveBeenCalled();
    expect(value(root, 'name')).toBe('Amber');
    expect(value(root, 'last')).toBe('Jones');
    expect(value(root, 'email')).toBe('amber@example.com');
    expect(value(root, 'phone')).toBe('07000000000');
    expect(value(root, 'postcode')).toBe('GU1 2BB');
    expect(value(root, 'discount')).toBe('SAVE10');
    const checked = root.querySelector('input[name="ticket"]:checked') as HTMLInputElement;
    expect(checked.value).toBe('t-couple');
    expect((root.querySelector('select[name="qty"]') as HTMLSelectElement).value).toBe('2');
  });

  it('shows the normal empty form when the token is no good', async () => {
    getCourseForResume.mockResolvedValue({ course: CLASS, resume: null });
    const root = await mount({ token: 'tok', resume: 'expired' });
    expect(value(root, 'name')).toBe('');
    expect(value(root, 'email')).toBe('');
    const checked = root.querySelector('input[name="ticket"]:checked') as HTMLInputElement;
    expect(checked.value).toBe('t-single');
  });

  it('falls back to an affordable ticket when the old one no longer fits', async () => {
    getCourseForResume.mockResolvedValue({
      course: { ...CLASS, spots_remaining: 1 },
      resume: RESUME,
    });
    const root = await mount({ token: 'tok', resume: 'abc' });
    const checked = root.querySelector('input[name="ticket"]:checked') as HTMLInputElement;
    expect(checked.value).toBe('t-single');
    expect(value(root, 'email')).toBe('amber@example.com');
  });

  it('a plain /book/:token link is unchanged', async () => {
    getCourseByToken.mockResolvedValue(CLASS);
    const root = await mount({ token: 'tok' });
    expect(getCourseForResume).not.toHaveBeenCalled();
    expect(value(root, 'name')).toBe('');
  });
});
