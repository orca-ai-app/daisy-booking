# daisy-booking

Public booking surface for Daisy First Aid — the WordPress-embeddable booking **widget** plus the
standalone booking/success pages (Wave 11). Part of the three-repo Daisy platform; it consumes the
shared Supabase project via public Edge Functions (`get-public-courses`, `process-interest-form`, and
in Wave 11 `validate-discount` + `create-checkout-session`). No Supabase SDK — just `fetch()`.

- **Stack:** Vite + TypeScript + native Web Components + Shadow DOM. No React. Target ≤ 50 KB gzipped.
- **Output:** a single self-contained script at `dist/widget/v1/daisy-booking.js`.
- **Style isolation:** Shadow DOM + vendored Daisy design tokens, so Divi/theme CSS can't bleed in.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 — local harness (stands in for a WP page)
npm run build      # → dist/widget/v1/daisy-booking.js
npm run test
npm run typecheck && npm run lint
```

The Supabase URL + anon key are public (the anon key is RLS-gated) and baked in at build via
`vite.config.ts`. Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to point at another env.

## Embedding on WordPress (Divi)

The widget ships as one script served from `https://booking.daisyfirstaid.com/widget/v1/daisy-booking.js`.

**Pattern A — inline finder on a page.** Drop a Divi *Code* module with:

```html
<script src="https://booking.daisyfirstaid.com/widget/v1/daisy-booking.js" defer></script>
<daisy-booking radius="15"></daisy-booking>
```

Optional attributes: `franchisee="0042"` (filter to one franchisee's courses), `radius="15"` (miles),
`theme="light"`.

**Pattern B — "Book Online" button → modal.** Keep Emma's existing Divi button; give it the class
`book-online-trigger` and add this once on the page (Code module):

```html
<script src="https://booking.daisyfirstaid.com/widget/v1/daisy-booking.js" defer></script>
<script>
  document.querySelectorAll('.book-online-trigger').forEach((b) =>
    b.addEventListener('click', (e) => { e.preventDefault(); window.daisyBooking.open({}); }),
  );
</script>
```

`window.daisyBooking.open({ franchisee, postcode, radius })` opens the booking modal in-page; the only
hard redirect is the Stripe payment step itself (Wave 11).

## Status

- **Wave 10 (done):** postcode search → course list → ticket + customer capture; interest form for
  vacant territories; inline + modal embeds.
- **Wave 11 (next):** discount validation, `create-checkout-session`, Stripe Checkout redirect, and the
  standalone `/book/:token` private-booking page + `/booking/success`.
