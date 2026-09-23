// Build-time constants injected by vite.config.ts `define`.
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __BOOKING_ORIGIN__: string;

interface DaisyBookingOpenOptions {
  franchisee?: string;
  postcode?: string;
  radius?: number;
  /** Pre-filter by course family id, e.g. 'paediatric' or 'workplace'. */
  courseType?: string;
  /** Pre-filter by month, 'YYYY-MM'. */
  month?: string;
}

interface Window {
  daisyBooking: {
    open: (opts?: DaisyBookingOpenOptions) => void;
    close: () => void;
  };
  /** Dump the logger's sessionStorage ring buffer (last 50 entries). */
  __daisyDebug?: () => unknown[];
  /** Guard so the logger's global hooks are only registered once. */
  __daisyLoggerInit?: boolean;
}
