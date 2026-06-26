// Thin fetch wrapper over the public Daisy Edge Functions. No Supabase SDK —
// keeps the widget bundle tiny. The anon key is public (RLS-gated).

const BASE = `${__SUPABASE_URL__}/functions/v1`;
const ANON = __SUPABASE_ANON_KEY__;

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
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getPublicCourses(input: {
  postcode: string;
  franchisee_id?: string;
  radius_miles?: number;
}): Promise<PublicCoursesResult> {
  return call<PublicCoursesResult>('get-public-courses', input);
}

export function submitInterestForm(input: InterestFormInput): Promise<{ ok: true; id: string }> {
  return call<{ ok: true; id: string }>('process-interest-form', input);
}
