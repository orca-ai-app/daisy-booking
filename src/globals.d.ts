// Build-time constants injected by vite.config.ts `define`.
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

interface DaisyBookingOpenOptions {
  franchisee?: string;
  postcode?: string;
  radius?: number;
}

interface Window {
  daisyBooking: {
    open: (opts?: DaisyBookingOpenOptions) => void;
    close: () => void;
  };
}
