// @vitest-environment jsdom
//
// November batch (daisy-platform migration 073): "Who's coming?" and "How did
// you hear about us?" on the class booking form. Both optional, shown on every
// class booking (a council or nursery office often books ONE member of staff),
// never on the shop-item form.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseCard } from '../src/widget/api';
import { readBookerExtras } from '../src/widget/bookerExtras';

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
  template_name: 'Level 3 Paediatric First Aid',
  template_slug: 'level-3',
  template_description: null,
  age_range: null,
  event_date: '2026-12-20',
  start_time: '09:30:00',
  end_time: '16:30:00',
  venue_name: 'Guildford Hall',
  venue_postcode: 'GU1 1AA',
  distance_miles: null,
  franchisee_name: 'Feola',
  capacity: 12,
  spots_remaining: 8,
  ticket_types: [{ id: 't-single', name: 'Single', price_pence: 15000, seats_consumed: 1 }],
} as CourseCard;

async function mount() {
  const el = document.createElement('daisy-booking');
  el.setAttribute('token', 'tok');
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el.shadowRoot!;
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("Who's coming and How did you hear about us", () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getCourseByToken.mockReset();
    getPublicItems.mockReset();
    getPublicItems.mockResolvedValue([]);
    getCourseByToken.mockResolvedValue(CLASS);
  });

  it('shows both questions on a one-place class booking, optional', async () => {
    const root = await mount();
    const who = root.querySelector('textarea[name="attendee_details"]') as HTMLTextAreaElement;
    const heard = root.querySelector('select[name="heard_about"]') as HTMLSelectElement;
    expect(who).not.toBeNull();
    expect(who.required).toBe(false);
    expect(heard).not.toBeNull();
    expect(heard.required).toBe(false);
    expect(heard.value).toBe('');
  });

  it('reveals the Other text box only when Other is chosen', async () => {
    const root = await mount();
    const other = root.querySelector('[data-heard-other]') as HTMLElement;
    expect(other.hidden).toBe(true);
    const heard = root.querySelector('select[name="heard_about"]') as HTMLSelectElement;
    heard.value = 'other';
    heard.dispatchEvent(new Event('change'));
    expect(other.hidden).toBe(false);
    heard.value = 'google';
    heard.dispatchEvent(new Event('change'));
    expect(other.hidden).toBe(true);
  });
});

describe('readBookerExtras', () => {
  it('sends the answers, trimmed', () => {
    expect(
      readBookerExtras(
        fd({ attendee_details: '  Sam Lee, sam@x.com  ', heard_about: 'other', heard_about_other: ' Radio ' }),
      ),
    ).toEqual({ attendee_details: 'Sam Lee, sam@x.com', heard_about: 'other', heard_about_other: 'Radio' });
  });

  it('leaves blank answers out, so old payloads are unchanged', () => {
    expect(readBookerExtras(fd({ attendee_details: '  ', heard_about: '' }))).toEqual({});
  });

  it('drops the Other text unless Other is chosen, and unknown keys', () => {
    expect(readBookerExtras(fd({ heard_about: 'google', heard_about_other: 'x' }))).toEqual({
      heard_about: 'google',
    });
    expect(readBookerExtras(fd({ heard_about: 'tiktok' }))).toEqual({});
  });
});
