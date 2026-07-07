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
}

export interface CourseCard {
  id: string;
  template_name: string;
  template_slug: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue_name: string | null;
  venue_postcode: string | null;
  distance_miles: number | null;
  franchisee_name: string;
  capacity: number;
  spots_remaining: number;
  ticket_types: TicketType[];
}

export interface PublicCoursesResult {
  courses: CourseCard[];
  territory_status: 'active' | 'vacant' | 'none';
  suggest_interest_form: boolean;
}

export interface InterestFormInput {
  postcode: string;
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

export function getPublicCourses(input: {
  postcode: string;
  franchisee_id?: string;
  radius_miles?: number;
}): Promise<PublicCoursesResult> {
  return call<PublicCoursesResult>('get-public-courses', input);
}

export async function getCourseByToken(booking_token: string): Promise<CourseCard | null> {
  const res = await call<PublicCoursesResult>('get-public-courses', { booking_token });
  return res.courses[0] ?? null;
}

export function submitInterestForm(input: InterestFormInput): Promise<{ ok: true; id: string }> {
  return call<{ ok: true; id: string }>('process-interest-form', input);
}

export interface CheckoutInput {
  course_instance_id?: string;
  booking_token?: string;
  ticket_type_id: string;
  quantity: number;
  customer: { first_name: string; last_name: string; email: string; phone?: string; postcode?: string };
  discount_code?: string;
  origin?: string;
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
