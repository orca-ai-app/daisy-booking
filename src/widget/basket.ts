// B6 basket (October 2026): several ticket types for one class, plus the same
// trainer's shop items, in one checkout. Pure helpers so the maths is tested
// on its own; DaisyBooking renders and wires the form.

import { seatsFor, type CourseCard, type ItemCard, type TicketType, type CheckoutInput } from './api';

/** Most of one ticket type the form offers (the old "How many?" cap). */
export const MAX_TICKET_QUANTITY = 10;
/** Same cap as buying an item on its own. */
export const MAX_ITEM_QUANTITY = 20;

/** Form field holding how many of a ticket type are wanted. */
export const ticketField = (id: string) => `qty_${id}`;
/** Form field holding how many of a shop item are wanted. */
export const itemField = (id: string) => `item_${id}`;

/**
 * Most of this ticket the class could ever hold on its own: how many fit in
 * the remaining pool (a 2-place Double halves it), capped at 10. 0 when even
 * one will not fit.
 */
export function ticketMax(t: TicketType, remaining: number): number {
  return Math.max(0, Math.min(MAX_TICKET_QUANTITY, Math.floor(remaining / seatsFor(t))));
}

/** E-learning is one access code per purchase; physical items come in multiples. */
export function itemMax(item: ItemCard): number {
  return item.kind === 'elearning' ? 1 : MAX_ITEM_QUANTITY;
}

export interface BasketLine {
  label: string;
  amountPence: number;
}

export interface BasketSummary {
  lines: Array<{ ticket: TicketType; quantity: number }>;
  items: Array<{ item: ItemCard; quantity: number }>;
  rows: BasketLine[];
  /** Places the chosen tickets take from the class's one shared pool. */
  seats: number;
  ticketsPence: number;
  totalPence: number;
  /** False when the chosen tickets need more places than the class has left. */
  fits: boolean;
}

function count(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * What the customer has chosen, read from the form's values: each ticket line
 * and shop item with a quantity above zero, the rows for the running order
 * summary, the places used and the total. Prices are the gross price charged
 * (price_pence is always VAT-inclusive); a discount code is applied at checkout.
 */
export function summariseBasket(
  course: CourseCard,
  items: ItemCard[],
  values: Record<string, string>,
): BasketSummary {
  const lines = course.ticket_types
    .map((ticket) => ({ ticket, quantity: count(values[ticketField(ticket.id)]) }))
    .filter((l) => l.quantity > 0);
  const chosenItems = items
    .map((item) => ({ item, quantity: Math.min(count(values[itemField(item.id)]), itemMax(item)) }))
    .filter((i) => i.quantity > 0);
  const rows: BasketLine[] = [
    ...lines.map((l) => ({
      label: `${l.ticket.name} × ${l.quantity}`,
      amountPence: l.ticket.price_pence * l.quantity,
    })),
    ...chosenItems.map((i) => ({
      label: `${i.item.name} × ${i.quantity}`,
      amountPence: i.item.price_pence * i.quantity,
    })),
  ];
  const seats = lines.reduce((s, l) => s + seatsFor(l.ticket) * l.quantity, 0);
  const ticketsPence = lines.reduce((s, l) => s + l.ticket.price_pence * l.quantity, 0);
  const totalPence = rows.reduce((s, r) => s + r.amountPence, 0);
  return {
    lines,
    items: chosenItems,
    rows,
    seats,
    ticketsPence,
    totalPence,
    fits: seats <= course.spots_remaining,
  };
}

/**
 * The ticket part of the checkout request. One ticket type and no items is
 * sent exactly as before (ticket_type_id + quantity), so it works against the
 * current server too; anything more is sent as `lines` and `items`.
 */
export function basketPayload(
  summary: BasketSummary,
): Pick<CheckoutInput, 'ticket_type_id' | 'quantity' | 'lines' | 'items'> {
  if (summary.lines.length === 1 && summary.items.length === 0) {
    return { ticket_type_id: summary.lines[0].ticket.id, quantity: summary.lines[0].quantity };
  }
  return {
    lines: summary.lines.map((l) => ({ ticket_type_id: l.ticket.id, quantity: l.quantity })),
    items: summary.items.map((i) => ({ franchisee_product_id: i.item.id, quantity: i.quantity })),
  };
}

/**
 * Starting quantities for the ticket form. Anything already in the values
 * (typed before an error re-render, or put back by a recovery link) is kept
 * where it still fits; otherwise the first ticket the class can seat starts
 * at 1, which is what the old single-ticket form pre-selected.
 */
export function initialTicketValues(
  course: CourseCard,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  let any = false;
  for (const t of course.ticket_types) {
    const max = ticketMax(t, course.spots_remaining);
    const want = Math.min(count(values[ticketField(t.id)]), max);
    out[ticketField(t.id)] = String(want);
    if (want > 0) any = true;
  }
  if (!any) {
    const first = course.ticket_types.find((t) => ticketMax(t, course.spots_remaining) > 0);
    if (first) out[ticketField(first.id)] = '1';
  }
  return out;
}

/**
 * A2 (TRI-0041): a class delivered at the customer's own address. Its venue
 * fields only describe the area it is offered in, so the card says "At your
 * home" and gives the area, never a venue name to travel to.
 */
export function isHomeClass(c: Pick<CourseCard, 'delivered_at_address'>): boolean {
  return c.delivered_at_address === true;
}

/**
 * The location line for a class card or the class view. A home class reads as
 * the area it covers: the postcode district of its advertised postcode
 * ("TN1 1AA" gives "Your home, TN1 area"), or the trainer's own wording when
 * there is no postcode. A venue class shows its venue as before.
 */
export function locationLine(c: CourseCard): string {
  if (isHomeClass(c)) {
    const district = (c.venue_postcode ?? '').trim().toUpperCase().split(/\s+/)[0];
    if (district) return `Your home, ${district} area`;
    return (c.venue_name ?? '').trim() || 'Your home';
  }
  return c.venue_name ?? c.venue_postcode ?? '';
}
