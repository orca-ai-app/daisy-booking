// Client-side logger for the booking widget. Three sinks:
//   1. console (all levels, `[daisy]` prefix)
//   2. sessionStorage ring buffer (last 50) — inspect via window.__daisyDebug()
//   3. the public log-client-event edge function (warn/error only, debounced,
//      capped at 5 events per page session)
// Logging must never break booking: every path swallows its own failures.

type Level = 'info' | 'warn' | 'error';

const ENDPOINT = `${__SUPABASE_URL__}/functions/v1/log-client-event`;
const ANON = __SUPABASE_ANON_KEY__;
const SOURCE = 'browser:booking';
const BUFFER_KEY = 'daisy_debug';
const BUFFER_MAX = 50;
const SHIP_CAP = 5; // max events shipped per page session (also the per-call max)
const DEBOUNCE_MS = 2000;

interface ShippedEvent {
  level: 'warn' | 'error';
  source: string;
  message: string;
  request_id?: string;
  context?: Record<string, unknown>;
}

let queue: ShippedEvent[] = [];
let shipped = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function readBuffer(): unknown[] {
  try {
    return JSON.parse(sessionStorage.getItem(BUFFER_KEY) ?? '[]') as unknown[];
  } catch {
    return [];
  }
}

function remember(level: Level, message: string, context?: Record<string, unknown>) {
  try {
    const buffer = readBuffer();
    buffer.push({ t: new Date().toISOString(), level, message, ...(context ? { context } : {}) });
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(buffer.slice(-BUFFER_MAX)));
  } catch {
    /* sessionStorage unavailable (private mode etc.) — console still works */
  }
}

function flush(final = false) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0 || shipped >= SHIP_CAP) return;
  const events = queue.slice(0, SHIP_CAP - shipped);
  queue = [];
  shipped += events.length;
  try {
    // keepalive fetch doubles as a beacon on pagehide but, unlike
    // navigator.sendBeacon, can carry the anon-key headers the function needs.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ events }),
      keepalive: final,
    }).catch(() => undefined);
  } catch {
    /* fire and forget — never throw from logging */
  }
}

function log(level: Level, message: string, context?: Record<string, unknown>, requestId?: string) {
  try {
    const method = level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
    if (context) method.call(console, `[daisy] ${message}`, context);
    else method.call(console, `[daisy] ${message}`);
    remember(level, message, context);
    if (level !== 'info') {
      queue.push({
        level,
        source: SOURCE,
        message,
        ...(requestId ? { request_id: requestId } : {}),
        ...(context ? { context } : {}),
      });
      if (!timer) timer = setTimeout(() => flush(), DEBOUNCE_MS);
    }
  } catch {
    /* never throw from logging */
  }
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>, requestId?: string) =>
    log('warn', message, context, requestId),
  error: (message: string, context?: Record<string, unknown>, requestId?: string) =>
    log('error', message, context, requestId),
};

/** Register the global error hooks + debug helper. Safe to call more than once. */
export function initLogger() {
  try {
    if (window.__daisyLoggerInit) return;
    window.__daisyLoggerInit = true;
    window.__daisyDebug = () => readBuffer();
    // addEventListener (not window.onerror) so we never clobber the host page's handlers.
    window.addEventListener('error', (event) => {
      logger.error(`Uncaught error: ${event.message}`, {
        filename: event.filename || undefined,
        line: event.lineno || undefined,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      logger.error(`Unhandled rejection: ${String(event.reason)}`);
    });
    window.addEventListener('pagehide', () => flush(true));
  } catch {
    /* never throw from logging */
  }
}
