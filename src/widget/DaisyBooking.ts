import { STYLES } from './styles';
import { formatDate, formatPence, formatTime, escapeHtml } from './format';
import {
  getPublicCourses,
  getCourseByToken,
  submitInterestForm,
  validateDiscount,
  createCheckoutSession,
  errorMessage,
  SCRIPT_ORIGIN,
  type CourseCard,
} from './api';
import { logger } from './logger';

type View = 'postcode' | 'searching' | 'results' | 'interest' | 'tickets';

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * <daisy-booking franchisee="0042" theme="light" radius="15">
 *
 * Public booking widget. Renders into a Shadow DOM so WordPress/Divi CSS can't
 * bleed in. Postcode search → course list → ticket + customer capture. The pay
 * step (Stripe Checkout redirect) is wired in Wave 11.
 */
export class DaisyBooking extends HTMLElement {
  private root: ShadowRoot;
  private view: View = 'postcode';
  private postcode = '';
  private courses: CourseCard[] = [];
  private selected: CourseCard | null = null;
  private error = '';
  private busy = false;
  private canRetrySearch = false;

  static get observedAttributes() {
    return ['franchisee', 'theme', 'radius'];
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    if (this.getAttribute('postcode')) this.postcode = this.getAttribute('postcode')!;
    const token = this.getAttribute('token');
    if (token) {
      // /book/:token — single-course mode: jump straight to the ticket form.
      this.view = 'searching';
      this.render();
      void this.loadByToken(token);
      return;
    }
    this.render();
  }

  private async loadByToken(token: string) {
    try {
      const course = await getCourseByToken(token);
      if (course) {
        this.courses = [course];
        this.selected = course;
        this.view = 'tickets';
      } else {
        this.error = 'This booking link is no longer available.';
        this.view = 'postcode';
      }
    } catch (err) {
      this.error = errorMessage(err, 'Could not load that course.');
      this.view = 'postcode';
    }
    this.render();
  }

  private get franchiseeId(): string | undefined {
    return this.getAttribute('franchisee') || undefined;
  }
  private get radius(): number | undefined {
    const r = Number(this.getAttribute('radius'));
    return Number.isFinite(r) && r > 0 ? r : undefined;
  }

  // --- actions --------------------------------------------------------------

  private async search() {
    const pc = this.postcode.trim();
    if (!UK_POSTCODE_RE.test(pc)) {
      this.error = 'Please enter a valid UK postcode.';
      this.render();
      return;
    }
    this.error = '';
    this.canRetrySearch = false;
    this.view = 'searching';
    this.render();
    try {
      const result = await getPublicCourses({
        postcode: pc,
        franchisee_id: this.franchiseeId,
        radius_miles: this.radius,
      });
      this.courses = result.courses;
      this.view = result.courses.length > 0 ? 'results' : result.suggest_interest_form ? 'interest' : 'results';
    } catch (err) {
      this.error = errorMessage(err, 'Could not search right now.');
      this.canRetrySearch = true;
      this.view = 'postcode';
    }
    this.render();
  }

  private selectCourse(id: string) {
    this.selected = this.courses.find((c) => c.id === id) ?? null;
    if (this.selected) {
      this.view = 'tickets';
      this.error = '';
      this.render();
      // The results list may be stale by the time a parent opens the checkout
      // step — re-check availability before they fill in the whole form.
      void this.refreshSpots();
    }
  }

  private async refreshSpots() {
    const course = this.selected;
    const pc = this.postcode.trim();
    if (!course || !pc) return;
    try {
      const result = await getPublicCourses({
        postcode: pc,
        franchisee_id: this.franchiseeId,
        radius_miles: this.radius,
      });
      // Bail if the user has already navigated away from this course.
      if (this.view !== 'tickets' || this.selected?.id !== course.id) return;
      const fresh = result.courses.find((c) => c.id === course.id);
      if (fresh && fresh.spots_remaining > 0) {
        this.selected = fresh;
        return;
      }
      // Patch the DOM in place (a full re-render would wipe anything typed).
      const form = this.root.querySelector('form.tickets');
      if (!form || form.querySelector('.soldout')) return;
      const note = document.createElement('div');
      note.className = 'notice warn soldout';
      note.setAttribute('role', 'alert');
      note.textContent =
        'Sorry — this class has just sold out. Please go back and choose another class.';
      form.prepend(note);
      const submit = form.querySelector('button.primary') as HTMLButtonElement | null;
      if (submit) submit.disabled = true;
      logger.warn('Course sold out between search and checkout', { course_id: course.id });
    } catch {
      // Best-effort check only — the server re-validates at checkout.
    }
  }

  private async submitInterest(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const attendees = Number(data.get('attendees'));
    if (!name || !EMAIL_RE.test(email) || !(attendees >= 1)) {
      this.error = 'Please enter your name, a valid email, and how many people.';
      this.render();
      return;
    }
    this.busy = true;
    this.render();
    try {
      await submitInterestForm({
        postcode: this.postcode.trim(),
        num_attendees: attendees,
        contact_name: name,
        contact_email: email,
        contact_phone: String(data.get('phone') ?? '').trim() || undefined,
        notes: String(data.get('notes') ?? '').trim() || undefined,
      });
      this.root.querySelector('.root')!.innerHTML = `
        <div class="empty">
          <h2>Thank you</h2>
          <p class="sub">We've registered your interest in ${escapeHtml(this.postcode.toUpperCase())}.
          A local trainer will be in touch.</p>
        </div>`;
    } catch (err) {
      this.error = errorMessage(err, 'Could not submit right now.');
      this.busy = false;
      this.render();
    }
  }

  private async continueToPayment(form: HTMLFormElement) {
    const data = new FormData(form);
    const ticketId = String(data.get('ticket') ?? '');
    const first = String(data.get('name') ?? '').trim();
    const last = String(data.get('last') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const discountCode = String(data.get('discount') ?? '').trim();
    if (!ticketId || !first || !last || !EMAIL_RE.test(email)) {
      this.error = 'Please choose a ticket and enter your first name, last name and a valid email.';
      this.render();
      return;
    }
    this.error = '';
    this.busy = true;
    this.render();
    // Open the payment tab SYNCHRONOUSLY on the click (popup blockers allow
    // it here, not after the await) so the customer keeps the website open to
    // check details while paying (Jenni, M3 feedback §2). If the browser
    // blocks it anyway, fall back to redirecting this window as before.
    let payTab: Window | null = null;
    try {
      payTab = window.open('about:blank', '_blank');
    } catch {
      payTab = null;
    }
    try {
      const { checkout_url } = await createCheckoutSession({
        course_instance_id: this.selected!.id,
        ticket_type_id: ticketId,
        quantity: 1,
        discount_code: discountCode || undefined,
        customer: {
          first_name: first,
          last_name: last,
          email,
          phone: String(data.get('phone') ?? '').trim() || undefined,
          postcode: String(data.get('postcode') ?? '').trim() || undefined,
        },
        // The booking site's own origin (where /booking/success lives) — NOT
        // the embedding page's origin (WordPress has no success page).
        origin: SCRIPT_ORIGIN,
      });
      // The modal/widget can't host Stripe — send the payment tab there (or
      // this window when the popup was blocked).
      if (payTab && !payTab.closed) {
        payTab.location.href = checkout_url;
        // Leave the widget usable behind the payment tab.
        this.busy = false;
        this.render();
      } else {
        window.top!.location.href = checkout_url;
      }
    } catch (err) {
      if (payTab && !payTab.closed) payTab.close();
      this.error = errorMessage(err, 'Could not start payment.');
      this.busy = false;
      this.render();
    }
  }

  // Live discount preview on the tickets view.
  private async checkDiscount() {
    const input = this.root.querySelector('#tdiscount') as HTMLInputElement | null;
    const out = this.root.querySelector('.discount-note');
    const code = input?.value.trim();
    if (!code || !out) return;
    out.textContent = 'Checking…';
    const ticketId = (this.root.querySelector('input[name="ticket"]:checked') as HTMLInputElement)?.value;
    const ticket = this.selected!.ticket_types.find((t) => t.id === ticketId);
    try {
      const res = await validateDiscount({
        code,
        course_instance_id: this.selected!.id,
        amount_pence: ticket?.price_pence,
      });
      if (res.valid) {
        out.textContent = res.amount_off_pence
          ? `Code applied — ${formatPence(res.amount_off_pence)} off.`
          : 'Code applied.';
        (out as HTMLElement).style.color = 'var(--daisy-green)';
      } else {
        out.textContent = res.reason ?? 'That code cannot be used.';
        (out as HTMLElement).style.color = 'var(--daisy-orange)';
      }
    } catch (err) {
      // Don't clear silently — the code may still be fine; checkout re-validates it.
      logger.warn('Discount check failed', { error: String(err) });
      out.textContent = "We couldn't check that code — you can still book, or try again.";
      (out as HTMLElement).style.color = 'var(--daisy-orange)';
    }
  }

  // --- rendering ------------------------------------------------------------

  private render() {
    this.root.innerHTML = `<style>${STYLES}</style><div class="root">${this.body()}</div>`;
    this.wire();
  }

  private body(): string {
    switch (this.view) {
      case 'searching':
        return `<h2>Searching…</h2><div class="spinner"></div>`;
      case 'results':
        return this.resultsView();
      case 'interest':
        return this.interestView();
      case 'tickets':
        return this.ticketsView();
      default:
        return this.postcodeView();
    }
  }

  private postcodeView(): string {
    return `
      <h2>Find a first aid class near you</h2>
      <p class="sub">Enter your postcode to see upcoming Daisy First Aid classes.</p>
      <form class="search">
        <div class="field">
          <label for="pc">Postcode</label>
          <input id="pc" name="postcode" placeholder="e.g. SW11 1AA" value="${escapeHtml(this.postcode)}" autocomplete="postal-code" />
        </div>
        <button class="primary" type="submit">Search</button>
        ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ''}
        ${this.error && this.canRetrySearch ? `<button class="retry" type="button" data-retry>Try again</button>` : ''}
      </form>`;
  }

  private resultsView(): string {
    if (this.courses.length === 0) {
      return `
        ${this.backBtn()}
        <div class="empty">
          <h2>No upcoming classes near ${escapeHtml(this.postcode.toUpperCase())}</h2>
          <p class="sub">There are no classes scheduled here just yet. Please check back soon.</p>
        </div>`;
    }
    const cards = this.courses
      .map((c) => {
        const priceFrom = c.ticket_types.length
          ? Math.min(...c.ticket_types.map((t) => t.price_pence))
          : c.ticket_types[0]?.price_pence ?? 0;
        const dist = c.distance_miles != null ? ` · ${c.distance_miles} mi` : '';
        const low = c.spots_remaining <= 3;
        return `
          <div class="card" data-id="${c.id}" role="button" tabindex="0">
            <h3>${escapeHtml(c.template_name)}</h3>
            ${c.age_range ? `<div class="agerange">Suitable for ${escapeHtml(c.age_range)}</div>` : ''}
            ${c.template_description ? `<p class="desc">${escapeHtml(truncate(c.template_description, 140))}</p>` : ''}
            <div class="meta">
              <span>${formatDate(c.event_date)}</span>
              <span>${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
              <span>${escapeHtml(c.venue_name ?? c.venue_postcode ?? '')}${dist}</span>
              <span class="price">from ${formatPence(priceFrom)}</span>
            </div>
            <div class="spots ${low ? 'low' : ''}">${c.spots_remaining} place${c.spots_remaining === 1 ? '' : 's'} left</div>
          </div>`;
      })
      .join('');
    return `${this.backBtn()}<h2>Classes near ${escapeHtml(this.postcode.toUpperCase())}</h2><p class="sub">${this.courses.length} upcoming</p>${cards}`;
  }

  private interestView(): string {
    return `
      ${this.backBtn()}
      <h2>No classes near you yet</h2>
      <div class="notice">We don't have a course listed in ${escapeHtml(this.postcode.toUpperCase())} right now.
      Please leave your details and we'll direct you to one nearby or help arrange a private course for your group.</div>
      <form class="interest">
        <div class="field"><label for="iname">Your name</label><input id="iname" name="name" /></div>
        <div class="field"><label for="iemail">Email</label><input id="iemail" name="email" type="email" /></div>
        <div class="row">
          <div class="field"><label for="iphone">Phone (optional)</label><input id="iphone" name="phone" /></div>
          <div class="field"><label for="iatt">How many people?</label><input id="iatt" name="attendees" type="number" min="1" value="1" /></div>
        </div>
        <div class="field"><label for="inotes">Please describe the course you require and anything else</label><textarea id="inotes" name="notes" rows="3"></textarea></div>
        <button class="primary" type="submit" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Sending…' : 'Register interest'}</button>
        ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      </form>`;
  }

  private ticketsView(): string {
    const c = this.selected!;
    const tickets = c.ticket_types
      .map(
        (t, i) => `
        <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:500;color:var(--daisy-ink);margin-bottom:8px;">
          <input type="radio" name="ticket" value="${t.id}" ${i === 0 ? 'checked' : ''} style="width:auto;" />
          ${escapeHtml(t.name)} — ${formatPence(t.price_pence)}
        </label>`,
      )
      .join('');
    return `
      ${this.backBtn('results')}
      <h2>${escapeHtml(c.template_name)}</h2>
      <p class="sub">${formatDate(c.event_date)} · ${formatTime(c.start_time)}–${formatTime(c.end_time)} · ${escapeHtml(c.venue_name ?? c.venue_postcode ?? '')}</p>
      ${c.age_range ? `<div class="agerange">Suitable for ${escapeHtml(c.age_range)}</div>` : ''}
      ${c.template_description ? `<p class="desc full">${escapeHtml(c.template_description)}</p>` : ''}
      <form class="tickets">
        <div class="field"><label>Ticket</label>${tickets}</div>
        <div class="row">
          <div class="field"><label for="tname">First name</label><input id="tname" name="name" /></div>
          <div class="field"><label for="tlast">Last name</label><input id="tlast" name="last" /></div>
        </div>
        <div class="field"><label for="temail">Email</label><input id="temail" name="email" type="email" /></div>
        <div class="row">
          <div class="field"><label for="tphone">Phone (optional)</label><input id="tphone" name="phone" /></div>
          <div class="field"><label for="tpc">Postcode (optional)</label><input id="tpc" name="postcode" /></div>
        </div>
        <div class="field">
          <label for="tdiscount">Discount code (optional)</label>
          <input id="tdiscount" name="discount" placeholder="Have a code?" />
          <p class="discount-note" style="font-size:12px;margin:6px 0 0;"></p>
        </div>
        <button class="primary" type="submit" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Starting payment…' : 'Continue to payment'}</button>
        ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      </form>`;
  }

  private backBtn(to: View = 'postcode'): string {
    return `<div class="back"><button class="link" data-back="${to}">← Back</button></div>`;
  }

  // Run an event handler defensively: an unexpected throw becomes a logged
  // error plus a visible message instead of a silently dead widget.
  private guard(label: string, fn: () => void | Promise<void>) {
    const fail = (err: unknown) => {
      logger.error(`Unhandled error in ${label}`, { error: String(err) });
      this.error = 'Something went wrong. Please try again.';
      this.busy = false;
      this.render();
    };
    try {
      const result = fn();
      if (result instanceof Promise) result.catch(fail);
    } catch (err) {
      fail(err);
    }
  }

  private wire() {
    const search = this.root.querySelector('form.search');
    search?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.guard('search', () => {
        this.postcode = (this.root.querySelector('#pc') as HTMLInputElement)?.value ?? '';
        return this.search();
      });
    });

    this.root.querySelector('[data-retry]')?.addEventListener('click', () =>
      this.guard('retry-search', () => {
        // Re-read the field in case the postcode was edited before retrying.
        const pc = (this.root.querySelector('#pc') as HTMLInputElement | null)?.value;
        if (pc != null) this.postcode = pc;
        return this.search();
      }),
    );

    this.root.querySelectorAll('.card').forEach((el) => {
      const go = () => this.guard('select-course', () => this.selectCourse((el as HTMLElement).dataset.id!));
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    this.root.querySelectorAll('[data-back]').forEach((el) =>
      el.addEventListener('click', () =>
        this.guard('back', () => {
          this.view = (el as HTMLElement).dataset.back as View;
          this.error = '';
          this.render();
        }),
      ),
    );

    this.root.querySelector('form.interest')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.guard('interest-form', () => this.submitInterest(e.target as HTMLFormElement));
    });

    this.root.querySelector('form.tickets')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.guard('checkout', () => this.continueToPayment(e.target as HTMLFormElement));
    });
    this.root
      .querySelector('#tdiscount')
      ?.addEventListener('blur', () => this.guard('discount-check', () => this.checkDiscount()));
  }
}
