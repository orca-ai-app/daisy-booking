import { describe, it, expect } from 'vitest';
import {
  isSoldOut,
  seatsFor,
  courseDescription,
  type CourseCard,
  type TicketType,
} from '../src/widget/api';

function course(over: Partial<CourseCard> = {}): CourseCard {
  return {
    id: 'c1',
    template_name: 'Baby & Child First Aid',
    template_slug: 'baby-child',
    template_description: 'Template wording.',
    age_range: 'parents and carers',
    event_date: '2026-09-01',
    start_time: '10:00:00',
    end_time: '12:00:00',
    venue_name: 'The Hall',
    venue_postcode: 'SW11 1AA',
    distance_miles: 2.4,
    franchisee_name: 'Feola',
    capacity: 12,
    spots_remaining: 12,
    ticket_types: [],
    ...over,
  };
}

function ticket(over: Partial<TicketType> = {}): TicketType {
  return { id: 't1', name: 'Single', price_pence: 3500, seats_consumed: 1, ...over };
}

describe('isSoldOut', () => {
  it('prefers the server flag', () => {
    expect(isSoldOut(course({ sold_out: true, spots_remaining: 4 }))).toBe(true);
    expect(isSoldOut(course({ sold_out: false, spots_remaining: 0 }))).toBe(false);
  });

  it('falls back to the count when the flag is absent (older API)', () => {
    expect(isSoldOut(course({ spots_remaining: 0 }))).toBe(true);
    expect(isSoldOut(course({ spots_remaining: 1 }))).toBe(false);
  });

  it('treats an over-sold class as sold out', () => {
    expect(isSoldOut(course({ spots_remaining: -1 }))).toBe(true);
  });
});

describe('seatsFor', () => {
  it('reads seats_consumed', () => {
    expect(seatsFor(ticket({ seats_consumed: 2 }))).toBe(2);
  });

  it('defaults to 1 rather than 0 when the value is missing or nonsense', () => {
    expect(seatsFor(ticket({ seats_consumed: 0 }))).toBe(1);
    expect(seatsFor(ticket({ seats_consumed: undefined as unknown as number }))).toBe(1);
    expect(seatsFor(ticket({ seats_consumed: NaN }))).toBe(1);
  });
});

describe('courseDescription (G1)', () => {
  it("prefers the franchisee's own wording", () => {
    expect(courseDescription(course({ description_override: 'Our own class blurb.' }))).toBe(
      'Our own class blurb.',
    );
  });

  it('falls back to the template when the override is missing, null or blank', () => {
    expect(courseDescription(course())).toBe('Template wording.');
    expect(courseDescription(course({ description_override: null }))).toBe('Template wording.');
    expect(courseDescription(course({ description_override: '   ' }))).toBe('Template wording.');
  });

  it('returns empty when there is no description at all', () => {
    expect(courseDescription(course({ template_description: null }))).toBe('');
  });
});

describe('shared pool availability (G11)', () => {
  // One capacity, many ticket types: a Couples ticket needs 2 of the SAME
  // places a Single ticket draws on, so with 1 place left only the Single is
  // purchasable.
  const single = ticket({ id: 'single', name: 'Single', seats_consumed: 1 });
  const couples = ticket({ id: 'couples', name: 'Couples', seats_consumed: 2 });
  const purchasable = (c: CourseCard, t: TicketType) => seatsFor(t) <= c.spots_remaining;

  it('allows both tickets when there is room for the larger one', () => {
    const c = course({ spots_remaining: 2, ticket_types: [single, couples] });
    expect(purchasable(c, single)).toBe(true);
    expect(purchasable(c, couples)).toBe(true);
  });

  it('blocks the couples ticket on the last single place', () => {
    const c = course({ spots_remaining: 1, ticket_types: [single, couples] });
    expect(purchasable(c, single)).toBe(true);
    expect(purchasable(c, couples)).toBe(false);
  });

  it('blocks every ticket when the class is full', () => {
    const c = course({ spots_remaining: 0, ticket_types: [single, couples] });
    expect(purchasable(c, single)).toBe(false);
    expect(purchasable(c, couples)).toBe(false);
  });
});
