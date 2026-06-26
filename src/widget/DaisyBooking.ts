import { STYLES } from './styles';
import { formatDate, formatPence, formatTime, escapeHtml } from './format';
import {
  getPublicCourses,
  getCourseByToken,
  submitInterestForm,
  validateDiscount,
  createCheckoutSession,
  type CourseCard,
} from './api';

type View = 'postcode' | 'searching' | 'results' | 'interest' | 'tickets';

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
      this.error = err instanceof Error ? err.message : 'Could not load that course.';
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
      this.error = err instanceof Error ? err.message : 'Could not search right now.';
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
      this.error = err instanceof Error ? err.message : 'Could not submit right now.';
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
        origin: window.location.origin,
      });
      // The modal/widget can't host Stripe — redirect the whole top window.
      window.top!.location.href = checkout_url;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not start payment.';
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
    } catch {
      out.textContent = '';
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
        ${this.error ? `<p class="error">${escapeHtml(this.error)}</p>` : ''}
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
      <div class="notice">We don't have a trainer covering ${escapeHtml(this.postcode.toUpperCase())} right now.
      Leave your details and we'll let you know when a class is arranged — or arrange one for your group.</div>
      <form class="interest">
        <div class="field"><label for="iname">Your name</label><input id="iname" name="name" /></div>
        <div class="field"><label for="iemail">Email</label><input id="iemail" name="email" type="email" /></div>
        <div class="row">
          <div class="field"><label for="iphone">Phone (optional)</label><input id="iphone" name="phone" /></div>
          <div class="field"><label for="iatt">How many people?</label><input id="iatt" name="attendees" type="number" min="1" value="1" /></div>
        </div>
        <div class="field"><label for="inotes">Anything else? (optional)</label><textarea id="inotes" name="notes" rows="2"></textarea></div>
        <button class="primary" type="submit" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Sending…' : 'Register interest'}</button>
        ${this.error ? `<p class="error">${escapeHtml(this.error)}</p>` : ''}
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
        ${this.error ? `<p class="error">${escapeHtml(this.error)}</p>` : ''}
      </form>`;
  }

  private backBtn(to: View = 'postcode'): string {
    return `<div class="back"><button class="link" data-back="${to}">← Back</button></div>`;
  }

  private wire() {
    const search = this.root.querySelector('form.search');
    search?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.postcode = (this.root.querySelector('#pc') as HTMLInputElement)?.value ?? '';
      void this.search();
    });

    this.root.querySelectorAll('.card').forEach((el) => {
      const go = () => this.selectCourse((el as HTMLElement).dataset.id!);
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    this.root.querySelectorAll('[data-back]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = (el as HTMLElement).dataset.back as View;
        this.error = '';
        this.render();
      }),
    );

    this.root.querySelector('form.interest')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitInterest(e.target as HTMLFormElement);
    });

    this.root.querySelector('form.tickets')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.continueToPayment(e.target as HTMLFormElement);
    });
    this.root.querySelector('#tdiscount')?.addEventListener('blur', () => void this.checkDiscount());
  }
}
