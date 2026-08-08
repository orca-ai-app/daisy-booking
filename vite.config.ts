import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Public booking config. The Supabase URL + anon key are PUBLIC (the anon key
// is RLS-gated and already ships in the daisy-platform browser bundle), so they
// are safe to bake into the widget. Override via env at build if needed.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://dmvajkreuwknjqxyxmlv.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtdmFqa3JldXdrbmpxeHl4bWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzczMDUsImV4cCI6MjA5Mjk1MzMwNX0.sbhF52EG3y3C0LRNKH40BhoSDMh_Mw7XOZSHXlb7O70';

// Canonical origin the standalone booking pages live on — used as the
// SCRIPT_ORIGIN fallback when document.currentScript is unavailable. Must never
// fall back to the embedding page's origin (WordPress has no success page).
const BOOKING_ORIGIN = process.env.VITE_BOOKING_ORIGIN ?? 'https://booking.daisyfirstaid.com';

export default defineConfig({
  define: {
    __SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
    __SUPABASE_ANON_KEY__: JSON.stringify(SUPABASE_ANON_KEY),
    __BOOKING_ORIGIN__: JSON.stringify(BOOKING_ORIGIN),
  },
  build: {
    target: 'es2021',
    // The standalone pages (/book/:token, /booking/success, /booking/cancelled,
    // /shop/success, /shop/cancelled) are hand-written HTML under public/ and
    // are copied verbatim into dist/ — they are deliberately NOT rollup inputs,
    // because a lib build takes a single entry and adding inputs would break the
    // one-file widget bundle below.
    //
    // Single self-contained IIFE bundle at a versioned path so v2 can ship
    // later without breaking live embeds. One <script> tag, no chunks.
    lib: {
      entry: resolve(__dirname, 'src/widget/index.ts'),
      name: 'daisyBooking',
      formats: ['iife'],
      fileName: () => 'widget/v1/daisy-booking.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, assetFileNames: 'widget/v1/[name][extname]' },
    },
    cssCodeSplit: false,
    minify: 'esbuild',
  },
});
