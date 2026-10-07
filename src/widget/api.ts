// Thin fetch wrapper over the public Daisy Edge Functions. No Supabase SDK —
// keeps the widget bundle tiny. The anon key is public (RLS-gated).

import { logger } from './logger';

const BASE = `${__SUPABASE_URL__}/functions/v1`;
const ANON = __SUPABASE_ANON_KEY__;

// The origin the widget script is SERVED from (booking.daisyfirstaid.com in
// production, the Netlify URL before DNS cutover). Captured at load via
// document.currentScript. Stripe success/cancel pages live on THIS origin —
// using the embedding page's origin (e.g. www.daisyfirstaid.com on WordPress)
// would send paid customers to a 404. When currentScript is unavailable, fall
// back to the canonical booking origin (build-time define) — never the
// embedding page's origin.
export const SCRIPT_ORIGIN: string = (() => {
  try {
    const src = (document.currentScript as HTMLScriptElement | null)?.src;
    return src ? new URL(src).origin : __BOOKING_ORIGIN__;
  } catch {
    return __BOOKING_ORIGIN__;
  }
})();

/** A failed edge-function call: `network` = fetch threw / no response at all. */
export class ApiError extends Error {
  readonly kind: 'network' | 'server';
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, kind: 'network' | 'server', status?: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
  }
}

export const NETWORK_MESSAGE = 'Check your internet connection and try again.';

/** User-facing message for a failed call, with `(ref XXXX)` when the server sent one. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.kind === 'network') return NETWORK_MESSAGE;
    return err.requestId ? `${err.message} (ref ${err.requestId})` : err.message;
  }
  return fallback;
}

export interface TicketType {
  id: string;
  name: string;
  price_pence: number;
  seats_consumed: number;
  /** Optional session label (e.g. "Morning session") — absent until the API ships it. */
  session_label?: string | null;
  /** VAT rate percentage — when set, prices show "incl. VAT @ {rate}%". */
  vat_rate?: number | null;
  /**
   * Migration 055 (B2B): the price is presented as "ex-VAT + VAT = total".
   * price_pence is ALWAYS the gross amount charged; this only changes display.
   */
  vat_exclusive?: boolean;
}

export interface CourseCard {
  id: string;
  template_name: string;
  /** Instance-level display name (private /book/:token pages) — falls back to template_name. */
  display_name?: string | null;
  template_slug: string;
  template_description: string | null;
  /**
   * The franchisee's own description for this one class. Optional: absent until
   * the API ships it, and null whenever they haven't written one — either way
   * the widget falls back to template_description.
   */
  description_override?: string | null;
  age_range: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  venue_name: string | null;
  venue_postcode: string | null;
  /**
   * The class runs at the customer's own address (home/workplace), so the
   * booking form asks the customer for their address + parking even on the
   * public flow (migration 059). For these, venue_postcode is only the
   * advertised area, not where the class actually happens.
   */
  delivered_at_address?: boolean;
  /**
   * Public or private. Lets the widget mirror the server's checkout address
   * gate exactly (private OR delivered_at_address). Present on the /book/:token
   * path; null on public search (only public rows, so the flag decides).
   */
  visibility?: 'public' | 'private' | null;
  distance_miles: number | null;
  franchisee_name: string;
  /**
   * The trainer running the class (B6 basket): their shop items can be added
   * to the booking, since the whole order is paid to them. Optional so an
   * older server simply means no items on the booking form.
   */
  franchisee_id?: string | null;
  /** Trading name ("Daisy First Aid Redhill") — who the customer books with. */
  franchisee_business?: string | null;
  /** The trainer's page on daisyfirstaid.com, when HQ has recorded it. */
  franchisee_website?: string | null;
  /** Trainer photo (portal Profile upload); widget falls back to the Daisy logo. */
  franchisee_photo?: string | null;
  /** The trainer's own bio, shown in the class view's trainer block. */
  franchisee_about?: string | null;
  capacity: number;
  /**
   * Places left in the class's ONE shared pool. Every ticket type draws from it,
   * so this is the only stock figure there is.
   */
  spots_remaining: number;
  /**
   * Sent by the API since round 2 (G4). Optional so an older deploy still works:
   * `isSoldOut()` falls back to spots_remaining.
   */
  sold_out?: boolean;
  ticket_types: TicketType[];
}

/** True when the class is full. Prefers the server's flag, falls back to the count. */
export function isSoldOut(c: CourseCard): boolean {
  return c.sold_out ?? c.spots_remaining <= 0;
}

/**
 * "Only N spaces left" (TRI-0008, Jenni approved 17 Sep). The count is shown
 * only once a class is down to its last quarter of places, so a fresh class
 * reads clean and the number does the urgency work near the end.
 *
 * Threshold = ceil(capacity × 0.25): 12 → 3, 20 → 5, 10 → 3, 16 → 4, 4 → 1.
 * Two extra rules keep tiny classes sensible:
 *  - a class with nothing sold yet never shows it (so a 1-place class, or a
 *    2–4 place class, never opens with "Only 1 space left");
 *  - capacity missing, zero or below the remaining count shows nothing.
 * Sold-out is not handled here: spotsLine() keeps its own "Sold out".
 */
export const LOW_SPACES_FRACTION = 0.25;

export function lowSpacesThreshold(capacity: number): number {
  return Math.ceil(capacity * LOW_SPACES_FRACTION);
}

/** The "Only N spaces left" line for a class, or null when it should not show. */
export function spacesLeftMessage(c: Pick<CourseCard, 'capacity' | 'spots_remaining' | 'sold_out'>): string | null {
  if (isSoldOut(c as CourseCard)) return null;
  const capacity = Number(c.capacity);
  const left = Number(c.spots_remaining);
  if (!Number.isFinite(capacity) || !Number.isFinite(left) || capacity <= 0) return null;
  if (left >= capacity) return null;
  if (left > lowSpacesThreshold(capacity)) return null;
  return left === 1 ? 'Only 1 space left' : `Only ${left} spaces left`;
}

/**
 * Places a ticket consumes. Defaults to 1 so a ticket type that predates
 * seats_consumed (or an API that omits it) is never treated as free of charge
 * against the pool.
 */
export function seatsFor(t: TicketType): number {
  return Number.isFinite(t.seats_consumed) && t.seats_consumed >= 1 ? t.seats_consumed : 1;
}

/**
 * The description to show for a class: the franchisee's own wording when they
 * have written one (G1), otherwise the template's. Defensive about a missing or
 * blank override so it simply falls back.
 */
export function courseDescription(c: CourseCard): string {
  return c.description_override?.trim() || c.template_description?.trim() || '';
}

export interface PublicCoursesResult {
  courses: CourseCard[];
  territory_status: 'active' | 'vacant' | 'none';
  suggest_interest_form: boolean;
  /** Place name the server matched a town/area search to (G8). */
  resolved_location?: string;
  /**
   * The searched area's own franchisee (active territories only) — their
   * public business contact details, shown when a search finds no classes so
   * the customer reaches the local trainer instead of a dead end.
   */
  local_franchisee?: {
    name: string | null;
    business_name: string | null;
    email: string | null;
    phone: string | null;
    website_url?: string | null;
  };
}

/**
 * An undated product a customer can buy at any time (a book, an e-learning
 * course) rather than a dated class. `id` is the franchisee-product id — that
 * is what checkout expects as `franchisee_product_id`.
 */
export interface ItemCard {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  kind: 'physical' | 'elearning';
  price_pence: number;
  /** VAT rate percentage — when set, prices show "incl. VAT @ {rate}%". */
  vat_rate: number | null;
  franchisee_id: string;
  franchisee_name: string;
}

export interface PublicItemsResult {
  items: ItemCard[];
}

export interface InterestFormInput {
  /** Omitted for a franchisee-page "Request a class" enquiry (no postcode). */
  postcode?: string;
  /** Set for a franchisee-page request so the enquiry emails that trainer. */
  franchisee_id?: string;
  num_attendees: number;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  preferred_dates?: string;
  notes?: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.warn(`Network failure calling ${path}`, { error: String(err) });
    throw new ApiError(NETWORK_MESSAGE, 'network');
  }
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    let requestId: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; request_id?: string };
      if (data.error) message = data.error;
      if (data.request_id) requestId = data.request_id;
    } catch {
      /* non-JSON */
    }
    logger.error(`${path} failed (${res.status}): ${message}`, undefined, requestId);
    throw new ApiError(message, 'server', res.status, requestId);
  }
  try {
    return (await res.json()) as T;
  } catch {
    logger.error(`${path} returned a malformed response`);
    throw new ApiError('Unexpected response from the server.', 'server', res.status);
  }
}

/**
 * `postcode` accepts a UK postcode OR a town/area name (G8) — the server
 * geocodes whichever it is, so the widget never has to tell them apart.
 * With a `franchisee_id` and no postcode, the server returns that
 * franchisee's full upcoming schedule instead of a radius search.
 */
export function getPublicCourses(input: {
  postcode?: string;
  franchisee_id?: string;
  radius_miles?: number;
  /** Server default is 50, capped at 500. The filters narrow client-side, so ask for 500 (TRI-0053). */
  limit?: number;
}): Promise<PublicCoursesResult> {
  return call<PublicCoursesResult>('get-public-courses', input);
}

export async function getCourseByToken(booking_token: string): Promise<CourseCard | null> {
  const res = await call<PublicCoursesResult>('get-public-courses', { booking_token });
  return res.courses[0] ?? null;
}

/** What the customer entered on an abandoned checkout (migration 066). */
export interface ResumeDetails {
  ticket_type_id: string;
  quantity: number;
  discount_code: string;
  service_address: string;
  parking_notes: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  postcode: string;
  /** B6 basket: every ticket line of the abandoned order (absent for a single ticket). */
  lines?: Array<{ ticket_type_id: string; quantity: number }>;
  /** B6 basket: the shop items that were in the order. */
  items?: Array<{ franchisee_product_id: string; quantity: number }>;
}

/**
 * The /book/:token page opened from a checkout recovery email. Same course
 * lookup, plus the earlier details when the resume token is still valid.
 */
export async function getCourseForResume(
  booking_token: string,
  resume: string,
): Promise<{ course: CourseCard | null; resume: ResumeDetails | null }> {
  const res = await call<PublicCoursesResult & { resume?: ResumeDetails }>('get-public-courses', {
    booking_token,
    resume,
  });
  return { course: res.courses[0] ?? null, resume: res.resume ?? null };
}

export function submitInterestForm(input: InterestFormInput): Promise<{ ok: true; id: string }> {
  return call<{ ok: true; id: string }>('process-interest-form', input);
}

/**
 * Undated items for a franchisee/postcode. Never throws: items are an additive
 * extra on top of the class results, so a missing function (404 before deploy),
 * a server error or a malformed body must all degrade to "no items" and leave
 * the class flow completely untouched.
 */
export async function getPublicItems(input: {
  franchisee_id?: string;
  postcode?: string;
}): Promise<ItemCard[]> {
  try {
    const res = await call<PublicItemsResult>('get-public-items', input);
    return Array.isArray(res?.items) ? res.items : [];
  } catch (err) {
    logger.info('No purchasable items available', { error: String(err) });
    return [];
  }
}

export interface CheckoutInput {
  course_instance_id?: string;
  booking_token?: string;
  /** Dated-class path. Omitted when buying an undated item. */
  ticket_type_id?: string;
  /** Undated-item path — mutually exclusive with the course fields above. */
  franchisee_product_id?: string;
  /** Single ticket or single item. Omitted when a basket sends `lines`. */
  quantity?: number;
  /** B6 basket: several ticket types for the class, in place of ticket_type_id + quantity. */
  lines?: Array<{ ticket_type_id: string; quantity: number }>;
  /** B6 basket: the same trainer's shop items, added to the class booking. */
  items?: Array<{ franchisee_product_id: string; quantity: number }>;
  /** Phone and postcode are compulsory since round 2 (G3) — the server rejects a booking without them. */
  customer: { first_name: string; last_name: string; email: string; phone: string; postcode: string };
  discount_code?: string;
  origin?: string;
  /** Private/home/workplace bookings: where the class is delivered (required) and any parking/access notes (optional). */
  service_address?: string;
  parking_notes?: string;
}

export interface DiscountResult {
  valid: boolean;
  reason: string | null;
  amount_off_pence?: number;
}

export function validateDiscount(input: {
  code: string;
  course_instance_id?: string;
  amount_pence?: number;
}): Promise<DiscountResult> {
  return call<DiscountResult>('validate-discount', input);
}

export function createCheckoutSession(
  input: CheckoutInput,
): Promise<{ checkout_url: string; session_id: string; booking_reference: string }> {
  return call('create-checkout-session', input);
}
