// Scoped CSS for the Shadow DOM. Daisy design tokens vendored from
// daisy-platform/tailwind.config.ts. Kept as a string so the widget is a single
// self-contained bundle (no external stylesheet, no CSS-loader in lib mode).

export const STYLES = /* css */ `
  :host {
    --daisy-primary: #006FAC;
    --daisy-primary-deep: #005589;
    --daisy-primary-tint: #EDF5FA;
    --daisy-yellow: #FFCB05;
    --daisy-ink: #1A4359;
    --daisy-ink-soft: #2D5570;
    --daisy-muted: #5A7A8F;
    --daisy-line: #D4E1E9;
    --daisy-bg: #F5F9FB;
    --daisy-paper: #FFFFFF;
    --daisy-orange: #DF542F;
    --daisy-green: #67A671;
    --radius: 12px;
    --radius-sm: 8px;
    font-family: 'Poppins', system-ui, -apple-system, sans-serif;
    color: var(--daisy-ink);
    line-height: 1.5;
    display: block;
  }
  * { box-sizing: border-box; }
  .root { background: var(--daisy-bg); border: 1px solid var(--daisy-line); border-radius: var(--radius); padding: 20px; }
  .modal .root { border: none; padding: 0; background: transparent; }
  h2 { font-family: 'Quicksand', sans-serif; font-size: 20px; font-weight: 700; margin: 0 0 4px; color: var(--daisy-ink); }
  p.sub { margin: 0 0 16px; color: var(--daisy-muted); font-size: 14px; }
  label { display: block; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--daisy-muted); margin-bottom: 6px; }
  input, select, textarea {
    width: 100%; min-height: 44px; padding: 10px 12px; font: inherit; color: var(--daisy-ink);
    background: var(--daisy-paper); border: 2px solid var(--daisy-line); border-radius: var(--radius-sm);
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--daisy-primary); }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--daisy-yellow); outline-offset: 1px; }
  .field { margin-bottom: 14px; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; }
  button.primary {
    background: var(--daisy-primary); color: #fff; border: none; border-radius: var(--radius-sm);
    padding: 12px 18px; min-height: 48px; font: inherit; font-weight: 700; cursor: pointer; width: 100%;
  }
  button.primary:hover { background: var(--daisy-primary-deep); }
  button.primary:disabled { opacity: .55; cursor: not-allowed; }
  button.link { background: none; border: none; color: var(--daisy-primary); font: inherit; font-weight: 600; cursor: pointer; padding: 10px 0; min-height: 44px; text-decoration: underline; }
  button.retry {
    background: none; color: var(--daisy-primary); border: 2px solid var(--daisy-primary); border-radius: var(--radius-sm);
    padding: 10px 16px; min-height: 44px; font: inherit; font-weight: 700; cursor: pointer; width: 100%; margin-top: 10px;
  }
  button.retry:hover { background: var(--daisy-primary-tint); }
  button:focus-visible, .card:focus-visible { outline: 3px solid var(--daisy-yellow); outline-offset: 2px; }
  .card {
    background: var(--daisy-paper); border: 1px solid var(--daisy-line); border-radius: var(--radius);
    padding: 14px 16px; min-height: 44px; margin-bottom: 10px; cursor: pointer; transition: border-color .12s, box-shadow .12s;
  }
  .card:hover { border-color: var(--daisy-primary); box-shadow: 0 6px 20px rgba(0,60,100,.10); }
  .card h3 { font-family: 'Quicksand', sans-serif; font-size: 16px; margin: 0 0 4px; color: var(--daisy-ink); }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--daisy-ink-soft); }
  .meta .price { font-weight: 700; color: var(--daisy-primary); }
  .spots { font-size: 12px; color: var(--daisy-green); font-weight: 600; }
  .spots.low { color: var(--daisy-orange); }
  .back { margin-bottom: 12px; }
  .error { color: var(--daisy-orange); font-size: 13px; margin: 8px 0 0; }
  .empty { text-align: center; padding: 24px 8px; color: var(--daisy-muted); }
  .spinner { width: 28px; height: 28px; border: 3px solid var(--daisy-line); border-top-color: var(--daisy-primary); border-radius: 50%; animation: spin .8s linear infinite; margin: 28px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .total { font-size: 16px; font-weight: 700; margin: 4px 0 12px; }
  .notice { background: var(--daisy-primary-tint); border-radius: var(--radius-sm); padding: 12px 14px; font-size: 13px; color: var(--daisy-ink-soft); margin-bottom: 14px; }
  .notice.warn { background: #FCEFE9; border: 1px solid var(--daisy-orange); color: var(--daisy-orange); font-weight: 600; }

  /* Modal (<dialog>) */
  dialog.daisy-modal { border: none; border-radius: var(--radius); padding: 0; max-width: 560px; width: 92vw; box-shadow: 0 20px 60px rgba(0,40,70,.35); }
  dialog.daisy-modal::backdrop { background: rgba(10,40,60,.55); }
  .modal-head { display: flex; justify-content: flex-end; padding: 8px 8px 0; }
  .modal-body { padding: 0 20px 22px; }
  button.close { background: none; border: none; font-size: 22px; line-height: 1; color: var(--daisy-muted); cursor: pointer; padding: 6px 10px; }
  @media (max-width: 560px) {
    dialog.daisy-modal { width: 100vw; height: 100dvh; max-width: none; border-radius: 0; }
  }
`;
