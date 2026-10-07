// @vitest-environment jsdom
//
// W5: "Request a class" opened directly from a website button. mode="request"
// with a franchisee opens straight onto that trainer's Request a class form,
// whether or not they have classes, and submits to that trainer (never the
// postcode route). Trainer mode with classes gets a "Can't find a date?" link.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseCard } from '../src/widget/api';

const getPublicCourses = vi.fn();
const getPublicItems = vi.fn();
const submitInterestForm = vi.fn();

vi.mock('../src/widget/api', async (importActual) => ({
  ...(await importActual<typeof import('../src/widget/api')>()),
  getPublicCourses: (...args: unknown[]) => getPublicCourses(...args),
  getPublicItems: (...args: unknown[]) => getPublicItems(...args),
  submitInterestForm: (...args: unknown[]) => submitInterestForm(...args),
}));

import { DaisyBooking } from '../src/widget/DaisyBooking';
import { open } from '../src/widget/modal';

if (!customElements.get('daisy-booking')) customElements.define('daisy-booking', DaisyBooking);

const CLASS: CourseCard = {
  id: 'c1',
  template_name: 'Baby & Child First Aid',
  template_slug: 'baby-child',
  template_description: null,
  age_range: null,
  event_date: '2026-10-20',
  start_time: '10:00:00',
  end_time: '12:00:00',
  venue_name: 'Hertford Hall',
  venue_postcode: 'SG14 1AA',
  distance_miles: null,
  franchisee_name: 'Hannah',
  capacity: 12,
  spots_remaining: 12,
  ticket_types: [],
};

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(attrs: Record<string, string>) {
  const el = document.createElement('daisy-booking');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await tick();
  await tick();
  return el.shadowRoot!;
}

function fill(root: ShadowRoot) {
  (root.querySelector('#iname') as HTMLInputElement).value = 'Sam Parent';
  (root.querySelector('#iemail') as HTMLInputElement).value = 'sam@example.com';
  (root.querySelector('#iatt') as HTMLInputElement).value = '4';
  (root.querySelector('#inotes') as HTMLTextAreaElement).value = 'A Saturday for our NCT group';
  (root.querySelector('form.interest') as HTMLFormElement).dispatchEvent(new Event('submit'));
}

describe('mode="request" (W5)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getPublicCourses.mockReset().mockResolvedValue({ courses: [CLASS] });
    getPublicItems.mockReset().mockResolvedValue([]);
    submitInterestForm.mockReset().mockResolvedValue({ ok: true, id: 'x' });
  });

  it('opens straight onto the Request a class form without loading anything', async () => {
    const root = await mount({ franchisee: '0086', mode: 'request' });
    expect(root.querySelector('h2')?.textContent).toBe('Request a class');
    expect(root.querySelector('form.interest')).not.toBeNull();
    expect(root.querySelector('[data-back]')).toBeNull();
    expect(getPublicCourses).not.toHaveBeenCalled();
    expect(getPublicItems).not.toHaveBeenCalled();
  });

  it('submits to that trainer, never the postcode route, even if a postcode is set', async () => {
    const root = await mount({ franchisee: '0086', mode: 'request', postcode: 'SG14 1AA' });
    fill(root);
    await tick();
    expect(submitInterestForm).toHaveBeenCalledTimes(1);
    const input = submitInterestForm.mock.calls[0][0];
    expect(input.franchisee_id).toBe('0086');
    expect(input.postcode).toBeUndefined();
    expect(input.num_attendees).toBe(4);
    expect(input.notes).toBe('A Saturday for our NCT group');
    expect(root.textContent).toContain('Request sent');
  });

  it('accepts the mode case-insensitively', async () => {
    const root = await mount({ franchisee: '0086', mode: ' Request ' });
    expect(root.querySelector('form.interest')).not.toBeNull();
  });

  it("offers the trainer's classes, which then lead back to the form", async () => {
    const root = await mount({ franchisee: '0086', mode: 'request' });
    (root.querySelector('[data-show-classes]') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect(getPublicCourses).toHaveBeenCalledWith({ franchisee_id: '0086', limit: 500 });
    expect(root.textContent).toContain('Upcoming classes');
    (root.querySelector('[data-request-class]') as HTMLButtonElement).click();
    expect(root.querySelector('form.interest')).not.toBeNull();
    // Now there is a list behind the form, so Back returns to it.
    expect((root.querySelector('[data-back]') as HTMLElement).dataset.back).toBe('results');
    expect(root.querySelector('[data-show-classes]')).toBeNull();
  });

  it('without a franchisee it is the plain finder', async () => {
    const root = await mount({ mode: 'request' });
    expect(root.querySelector('form.search')).not.toBeNull();
    expect(root.querySelector('form.interest')).toBeNull();
  });

  it('the modal passes mode through', async () => {
    // jsdom has no <dialog>.showModal.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    open({ franchisee: '0086', mode: 'request' });
    const host = document.querySelector('div.modal') as HTMLElement;
    const widget = host.shadowRoot!.querySelector('daisy-booking') as HTMLElement;
    expect(widget.getAttribute('mode')).toBe('request');
    expect(widget.getAttribute('franchisee')).toBe('0086');
    await tick();
    expect(widget.shadowRoot!.querySelector('form.interest')).not.toBeNull();
  });
});

describe("trainer mode: Can't find a date? link (W5)", () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    getPublicCourses.mockReset().mockResolvedValue({ courses: [CLASS] });
    getPublicItems.mockReset().mockResolvedValue([]);
    submitInterestForm.mockReset().mockResolvedValue({ ok: true, id: 'x' });
  });

  it('shows under the class list and opens the trainer request form', async () => {
    const root = await mount({ franchisee: '0086' });
    const link = root.querySelector('[data-request-class]') as HTMLButtonElement;
    expect(link.textContent).toBe("Can't find a date? Request a class");
    link.click();
    expect(root.querySelector('h2')?.textContent).toBe('Request a class');
    fill(root);
    await tick();
    expect(submitInterestForm.mock.calls[0][0].franchisee_id).toBe('0086');
  });

  it('is not added to postcode search results', async () => {
    getPublicCourses.mockResolvedValue({
      courses: [CLASS],
      territory_status: 'active',
      suggest_interest_form: false,
    });
    const root = await mount({ postcode: 'SG14 1AA' });
    (root.querySelector('form.search') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await tick();
    expect(root.textContent).toContain('Classes near');
    expect(root.querySelector('[data-request-class]')).toBeNull();
  });

  it('the no-classes call to action is unchanged', async () => {
    getPublicCourses.mockResolvedValue({ courses: [] });
    const root = await mount({ franchisee: '0086' });
    expect(root.textContent).toContain('New dates on the way');
    expect(root.querySelectorAll('[data-request-class]')).toHaveLength(1);
  });
});
