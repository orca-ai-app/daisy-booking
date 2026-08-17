import { STYLES } from './styles';
import { formatDate, formatPence, formatTime, escapeHtml } from './format';
import {
  getPublicCourses,
  getPublicItems,
  getCourseByToken,
  submitInterestForm,
  validateDiscount,
  createCheckoutSession,
  errorMessage,
  isSoldOut,
  courseDescription,
  seatsFor,
  SCRIPT_ORIGIN,
  type CourseCard,
  type ItemCard,
  type TicketType,
  type CheckoutInput,
} from './api';
import { logger } from './logger';

type View = 'postcode' | 'searching' | 'results' | 'interest' | 'tickets' | 'item';

const MAX_ITEM_QUANTITY = 20;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Loosest possible phone check (G3): people write +44, 0044, spaces, brackets
// and dashes, and rejecting a real number is far worse than accepting an odd
// one. Just insist on enough digits to be a phone number at all.
const PHONE_DIGITS_RE = /\d/g;
const MIN_PHONE_DIGITS = 10;

/**
 * <daisy-booking franchisee="0042" theme="light" radius="15">
 *
 * Public booking widget. Renders into a Shadow DOM so WordPress/Divi CSS can't
 * bleed in. Postcode search → course list → ticket + customer capture. The pay
 * step (Stripe Checkout redirect) is wired in Wave 11.
 *
 * Alongside dated classes a franchisee may offer undated items (books,
 * e-learning) that are on sale at any time — they render under the class
 * results and share the same customer-capture form and checkout redirect.
 */
export class DaisyBooking extends HTMLElement {
  private root: ShadowRoot;
  private view: View = 'postcode';
  /** What the customer typed into the search box: a postcode OR a town (G8). */
  private postcode = '';
  /** The place name the server matched a town search to, when it was a town. */
  private resolvedLocation: string | null = null;
  private courses: CourseCard[] = [];
  private selected: CourseCard | null = null;
  private items: ItemCard[] = [];
  private selectedItem: ItemCard | null = null;
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
    // Franchisee-filtered embed: their undated items are on sale regardless of
    // postcode, so surface them on the landing view too.
    if (this.franchiseeId) void this.loadItems();
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
    // G8: a postcode OR a town/area. The server geocodes either, so the only
    // thing worth rejecting here is an input too short to mean anything.
    if (pc.length < 2) {
      this.error = 'Please enter a postcode or a town.';
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
      // When we searched a town, show the place the server actually matched
      // ("Chipping Norton") rather than echoing back what was typed.
      this.resolvedLocation = result.resolved_location ?? null;
      this.view = result.courses.length > 0 ? 'results' : result.suggest_interest_form ? 'interest' : 'results';
    } catch (err) {
      this.error = errorMessage(err, 'Could not search right now.');
      this.canRetrySearch = true;
      this.view = 'postcode';
    }
    this.render();
    // Items are an additive extra — fetch them after the classes are on screen
    // so they can never delay or break the search itself.
    void this.loadItems();
  }

  /**
   * Load the franchisee's undated items and, when there are any, re-render so
   * the "Available any time" section appears. getPublicItems never throws, so a
   * missing/failing endpoint simply leaves `items` empty and renders nothing.
   */
  private async loadItems() {
    if (!this.franchiseeId && !this.postcode.trim()) return;
    const items = await getPublicItems({
      franchisee_id: this.franchiseeId,
      postcode: this.postcode.trim() || undefined,
    });
    if (items.length === 0) return;
    this.items = items;
    // Only repaint the list views — never clobber a form the customer is
    // partway through filling in.
    if (this.view === 'results' || this.view === 'interest') this.render();
  }

  private selectCourse(id: string) {
    const course = this.courses.find((c) => c.id === id) ?? null;
    // Sold-out classes are listed (G4) but not bookable — the card is inert.
    if (course && isSoldOut(course)) return;
    this.selected = course;
    if (this.selected) {
      this.view = 'tickets';
      this.error = '';
      this.render();
      // The results list may be stale by the time a parent opens the checkout
      // step — re-check availability before they fill in the whole form.
      void this.refreshSpots();
    }
  }

  private selectItem(id: string) {
    this.selectedItem = this.items.find((i) => i.id === id) ?? null;
    if (this.selectedItem) {
      this.view = 'item';
      this.error = '';
      this.render();
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
      if (fresh && !isSoldOut(fresh)) {
        // Places may have gone since the search without the class selling out.
        // Re-render so the shared-pool count and each ticket's availability
        // (G11) reflect the truth — safe here because a partial sale can only
        // be detected on entry to this view, before anything has been typed.
        const changed = fresh.spots_remaining !== course.spots_remaining;
        this.selected = fresh;
        if (changed) this.render();
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
    const discountCode = String(data.get('discount') ?? '').trim();
    if (!ticketId) {
      this.error = 'Please choose a ticket.';
      this.render();
      return;
    }
    // G11: never let a customer pay for a ticket the class can no longer seat.
    const ticket = this.selected!.ticket_types.find((t) => t.id === ticketId);
    if (ticket && seatsFor(ticket) > this.selected!.spots_remaining) {
      this.error = 'That ticket needs more places than this class has left. Please choose another.';
      this.render();
      return;
    }
    const invalid = this.customerError(data);
    if (invalid) {
      this.error = invalid;
      this.render();
      return;
    }
    this.error = '';
    this.busy = true;
    this.render();
    await this.startCheckout({
      course_instance_id: this.selected!.id,
      ticket_type_id: ticketId,
      quantity: 1,
      discount_code: discountCode || undefined,
      customer: this.readCustomer(data),
    });
  }

  private async buyItem(form: HTMLFormElement) {
    const data = new FormData(form);
    const item = this.selectedItem!;
    const invalid = this.customerError(data);
    if (invalid) {
      this.error = invalid;
      this.render();
      return;
    }
    // E-learning is one access code per purchase; physical items can be bought
    // in multiples.
    const requested = item.kind === 'elearning' ? 1 : Number(data.get('quantity') ?? 1);
    const quantity =
      Number.isFinite(requested) && requested >= 1
        ? Math.min(Math.floor(requested), MAX_ITEM_QUANTITY)
        : 1;
    this.error = '';
    this.busy = true;
    this.render();
    await this.startCheckout({
      franchisee_product_id: item.id,
      quantity,
      customer: this.readCustomer(data),
    });
  }

  /**
   * Validate the shared customer fields. Returns a message to show, or '' when
   * everything is fine. Phone and postcode are compulsory (G3): franchisees
   * could not chase a no-show or confirm the right class without them. One
   * message at a time, naming the field, so the customer knows what to fix.
   */
  private customerError(data: FormData): string {
    const first = String(data.get('name') ?? '').trim();
    const last = String(data.get('last') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();
    const postcode = String(data.get('postcode') ?? '').trim();
    if (!first) return 'Please enter your first name.';
    if (!last) return 'Please enter your last name.';
    if (!EMAIL_RE.test(email)) return 'Please enter a valid email address.';
    if (!phone) return 'Please enter your phone number, so we can reach you about your booking.';
    if ((phone.match(PHONE_DIGITS_RE) ?? []).length < MIN_PHONE_DIGITS) {
      return 'Please enter a valid phone number.';
    }
    if (!postcode) return 'Please enter your postcode.';
    if (!UK_POSTCODE_RE.test(postcode)) return 'Please enter a valid UK postcode.';
    return '';
  }

  private readCustomer(data: FormData): CheckoutInput['customer'] {
    return {
      first_name: String(data.get('name') ?? '').trim(),
      last_name: String(data.get('last') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim(),
      postcode: String(data.get('postcode') ?? '').trim(),
    };
  }

  /**
   * Shared payment hand-off for both classes and items: create the session,
   * then send the customer to Stripe. Assumes the caller has already set
   * `busy` and re-rendered (the payment tab must be opened on the click).
   */
  private async startCheckout(input: Omit<CheckoutInput, 'origin'>) {
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
        ...input,
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
      case 'item':
        return this.itemView();
      default:
        return this.postcodeView();
    }
  }

  private postcodeView(): string {
    return `
      <h2>Find a first aid class near you</h2>
      <p class="sub">Enter your postcode or town to see upcoming Daisy First Aid classes.</p>
      <form class="search">
        <div class="field">
          <label for="pc">Postcode or town</label>
          <input id="pc" name="postcode" placeholder="e.g. SW11 1AA or Battersea" value="${escapeHtml(this.postcode)}" autocomplete="postal-code" />
          <p class="hint">A postcode or a town name both work.</p>
        </div>
        <button class="primary" type="submit">Search</button>
        ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ''}
        ${this.error && this.canRetrySearch ? `<button class="retry" type="button" data-retry>Try again</button>` : ''}
      </form>
      ${this.itemsSection()}`;
  }

  /**
   * How the searched area is written back to the customer. A town search shows
   * the place the server matched ("Chipping Norton"); a postcode is upper-cased
   * as before. Upper-casing a town name would shout it.
   */
  private get locationLabel(): string {
    return this.resolvedLocation ?? this.postcode.toUpperCase();
  }

  private resultsView(): string {
    if (this.courses.length === 0) {
      return `
        ${this.backBtn()}
        <div class="empty">
          <h2>No upcoming classes near ${escapeHtml(this.locationLabel)}</h2>
          <p class="sub">There are no classes scheduled here just yet. Please check back soon.</p>
        </div>
        ${this.itemsSection()}`;
    }
    const cards = this.courses
      .map((c) => {
        const priceFrom = c.ticket_types.length
          ? Math.min(...c.ticket_types.map((t) => t.price_pence))
          : 0;
        const dist = c.distance_miles != null ? ` · ${c.distance_miles} mi` : '';
        const full = isSoldOut(c);
        const desc = courseDescription(c);
        return `
          <div class="card${full ? ' full' : ''}" data-id="${c.id}"
               ${full ? 'aria-disabled="true"' : 'role="button" tabindex="0"'}>
            <h3>${escapeHtml(c.template_name)}</h3>
            ${c.age_range ? `<div class="agerange">Suitable for ${escapeHtml(c.age_range)}</div>` : ''}
            ${desc ? `<p class="desc">${escapeHtml(truncate(desc, 140))}</p>` : ''}
            <div class="meta">
              <span>${formatDate(c.event_date)}</span>
              <span>${formatTime(c.start_time)}–${formatTime(c.end_time)}</span>
              <span>${escapeHtml(c.venue_name ?? c.venue_postcode ?? '')}${dist}</span>
              <span class="price">from ${formatPence(priceFrom)}</span>
            </div>
            ${this.spotsLine(c)}
          </div>`;
      })
      .join('');
    // Count what they can actually book, and mention the full ones separately,
    // rather than claiming N upcoming when some are closed (G4).
    const soldOut = this.courses.filter((c) => isSoldOut(c)).length;
    const open = this.courses.length - soldOut;
    const summary =
      soldOut === 0
        ? `${open} upcoming · each has a date and a venue`
        : open === 0
          ? `${soldOut} upcoming, all currently full`
          : `${open} available · ${soldOut} currently full`;
    return `${this.backBtn()}<h2>Classes near ${escapeHtml(this.locationLabel)}</h2><p class="sub">${summary}</p>${cards}${this.itemsSection()}`;
  }

  /**
   * The one true availability line for a class (G11). Every ticket type draws
   * from the SAME pool, so the remaining number is shown once, on the class,
   * never per ticket.
   */
  private spotsLine(c: CourseCard): string {
    if (isSoldOut(c)) {
      return `<div class="spots out">Sold out</div>`;
    }
    const low = c.spots_remaining <= 3;
    return `<div class="spots ${low ? 'low' : ''}">${c.spots_remaining} place${c.spots_remaining === 1 ? '' : 's'} left</div>`;
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
      </form>
      ${this.itemsSection()}`;
  }

  private ticketsView(): string {
    const c = this.selected!;
    const remaining = c.spots_remaining;
    // A ticket is purchasable only if the shared pool can seat it (G11).
    const affordable = c.ticket_types.filter((t) => seatsFor(t) <= remaining);
    const firstAffordableId = affordable[0]?.id;
    const tickets = c.ticket_types.map((t) => this.ticketOption(t, remaining, firstAffordableId)).join('');
    const desc = courseDescription(c);
    const canBook = !isSoldOut(c) && affordable.length > 0;
    return `
      ${this.backBtn('results')}
      <h2>${escapeHtml(c.display_name || c.template_name)}</h2>
      <p class="sub">${formatDate(c.event_date)} · ${formatTime(c.start_time)}–${formatTime(c.end_time)} · ${escapeHtml(c.venue_name ?? c.venue_postcode ?? '')}</p>
      ${c.age_range ? `<div class="agerange">Suitable for ${escapeHtml(c.age_range)}</div>` : ''}
      ${desc ? `<p class="desc full">${escapeHtml(desc)}</p>` : ''}
      ${this.spotsLine(c)}
      ${
        canBook
          ? ''
          : `<div class="notice warn" role="alert">${
              isSoldOut(c)
                ? 'This class is sold out. Please go back and choose another class.'
                : 'There are not enough places left for any of the tickets on this class.'
            }</div>`
      }
      <form class="tickets">
        <div class="field">
          <label>Ticket</label>
          ${
            remaining > 0
              ? `<p class="pool">All tickets come out of the same ${remaining} remaining place${remaining === 1 ? '' : 's'}.</p>`
              : ''
          }
          ${tickets}
        </div>
        ${this.customerFields()}
        <div class="field">
          <label for="tdiscount">Discount code (optional)</label>
          <input id="tdiscount" name="discount" placeholder="Have a code?" />
          <p class="discount-note" style="font-size:12px;margin:6px 0 0;"></p>
        </div>
        <button class="primary" type="submit" ${this.busy || !canBook ? 'disabled' : ''}>${this.busy ? 'Starting payment…' : 'Continue to payment'}</button>
        ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      </form>`;
  }

  /**
   * One ticket radio (G11). Every ticket draws on the class's single shared
   * pool, so a ticket needing more places than remain is disabled and says why
   * rather than being hidden: seeing "Couples — not enough places left" tells
   * the customer something useful, silently dropping the option does not.
   */
  private ticketOption(t: TicketType, remaining: number, firstAffordableId?: string): string {
    // Both fields are optional until the API ships them — render nothing when absent.
    const vat = this.vatNote(t.vat_rate);
    const session = t.session_label
      ? `<span style="font-size:12px;color:var(--daisy-muted);">${escapeHtml(t.session_label)}</span>`
      : '';
    const seats = seatsFor(t);
    const available = seats <= remaining;
    // Only ever pre-select something the customer can actually buy.
    const checked = available && t.id === firstAffordableId ? 'checked' : '';
    // "Uses 2 places" is worth spelling out for a Couples/family ticket, and
    // meaningless for a single, so only say it when it is more than one.
    const seatNote = seats > 1 ? `Uses ${seats} places` : '';
    const note = available
      ? seatNote
      : `Not enough places left${seats > 1 ? ` — needs ${seats} places` : ''}`;
    return `
        <label class="ticket${available ? '' : ' unavailable'}">
          <input type="radio" name="ticket" value="${t.id}" ${checked} ${available ? '' : 'disabled'} style="width:auto;" />
          <span style="display:flex;flex-direction:column;">
            <span>${escapeHtml(t.name)} — ${formatPence(t.price_pence)}${vat}</span>
            ${session}
            ${note ? `<span class="ticket-note${available ? '' : ' warn'}">${escapeHtml(note)}</span>` : ''}
          </span>
        </label>`;
  }

  /**
   * Customer capture, shared by the class ticket form and the item buy form.
   * Phone and postcode are compulsory since round 2 (G3) — field order and
   * styling are unchanged, only the labels and the `required` flags.
   */
  private customerFields(): string {
    return `
        <div class="row">
          <div class="field"><label for="tname">First name</label><input id="tname" name="name" required /></div>
          <div class="field"><label for="tlast">Last name</label><input id="tlast" name="last" required /></div>
        </div>
        <div class="field"><label for="temail">Email</label><input id="temail" name="email" type="email" required /></div>
        <div class="row">
          <div class="field"><label for="tphone">Phone</label><input id="tphone" name="phone" type="tel" autocomplete="tel" required /></div>
          <div class="field"><label for="tpc">Postcode</label><input id="tpc" name="postcode" autocomplete="postal-code" required /></div>
        </div>`;
  }

  /** "incl. VAT @ N%" note, rendered only when the API supplies a rate. */
  private vatNote(rate: number | null | undefined): string {
    return typeof rate === 'number' && rate > 0
      ? ` <span style="font-size:12px;color:var(--daisy-muted);">incl. VAT @ ${rate}%</span>`
      : '';
  }

  /**
   * "Available any time" — undated items shown beneath the class results.
   * Returns '' when there are none, so the class flow is untouched whenever the
   * items endpoint is missing, failing or simply empty.
   */
  private itemsSection(): string {
    if (this.items.length === 0) return '';
    const cards = this.items
      .map((item) => {
        const elearning = item.kind === 'elearning';
        const tag = elearning ? 'E-learning' : 'Book';
        return `
          <div class="card item" data-item-id="${escapeHtml(item.id)}" role="button" tabindex="0">
            <div class="tag ${elearning ? 'elearning' : 'physical'}">${tag}</div>
            <h3>${escapeHtml(item.name)}</h3>
            ${item.description ? `<p class="desc">${escapeHtml(truncate(item.description, 140))}</p>` : ''}
            <div class="meta">
              <span class="price">${formatPence(item.price_pence)}${this.vatNote(item.vat_rate)}</span>
            </div>
            <button class="buy" type="button" data-item-id="${escapeHtml(item.id)}">Buy now</button>
          </div>`;
      })
      .join('');
    return `
      <h2 class="items-head">Available any time</h2>
      <p class="sub">No date needed — buy these online whenever you like.</p>
      ${cards}`;
  }

  private itemView(): string {
    const item = this.selectedItem!;
    const elearning = item.kind === 'elearning';
    // Items can be reached from the results list or straight off the landing
    // view of a franchisee embed — go back wherever the customer came from.
    const back: View = this.courses.length > 0 ? 'results' : 'postcode';
    const quantity = elearning
      ? ''
      : `
        <div class="field">
          <label for="iqty">How many?</label>
          <select id="iqty" name="quantity">
            ${Array.from(
              { length: MAX_ITEM_QUANTITY },
              (_, n) => `<option value="${n + 1}">${n + 1}</option>`,
            ).join('')}
          </select>
        </div>`;
    // F8: we do NOT hand out an access link on payment. Daisy buy licence keys
    // and enrol each customer by hand through elearnhere, which does not happen
    // in the evening or at the weekend, so the promise is "by email, typically
    // within 48 hours" and never "it's in your confirmation email".
    const delivery = elearning
      ? `<div class="notice">This is an online course — there's no class to attend. Once you've paid,
      we'll set up your access and email your details separately, typically within 48 hours.</div>`
      : `<div class="notice">This is a physical item bought online, not a class. We'll confirm your
      order by email and post it out to you.</div>`;
    return `
      ${this.backBtn(back)}
      <div class="tag ${elearning ? 'elearning' : 'physical'}">${elearning ? 'E-learning' : 'Book'}</div>
      <h2>${escapeHtml(item.name)}</h2>
      <p class="sub">Sold by ${escapeHtml(item.franchisee_name)}</p>
      ${item.description ? `<p class="desc full">${escapeHtml(item.description)}</p>` : ''}
      ${delivery}
      <p class="total">${formatPence(item.price_pence)}${this.vatNote(item.vat_rate)}</p>
      <form class="item-buy">
        ${quantity}
        ${this.customerFields()}
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

    // `:not(.item)` — item cards share the .card styling but have their own
    // handler. `:not(.full)` — a sold-out class is listed but inert (G4).
    this.root.querySelectorAll('.card:not(.item):not(.full)').forEach((el) => {
      const go = () => this.guard('select-course', () => this.selectCourse((el as HTMLElement).dataset.id!));
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    this.root.querySelectorAll('.card.item').forEach((el) => {
      const go = () =>
        this.guard('select-item', () => this.selectItem((el as HTMLElement).dataset.itemId!));
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    // The Buy button lives inside the clickable card — stop the click bubbling
    // so the card handler doesn't fire a second time.
    this.root.querySelectorAll('button.buy').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.guard('buy-item', () => this.selectItem((el as HTMLElement).dataset.itemId!));
      }),
    );

    this.root.querySelector('form.item-buy')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.guard('item-checkout', () => this.buyItem(e.target as HTMLFormElement));
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
