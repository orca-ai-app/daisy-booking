/**
 * November batch (daisy-platform migration 073): two optional questions on
 * the class booking form.
 *
 * - "Who's coming?": names and emails of the people the booker is booking
 *   for (Feola, TRI-0046/0054/0086). Shown on every class booking, not only
 *   multi-place ones, because a council or nursery office often books ONE
 *   member of staff and the booker is not the attendee.
 * - "How did you hear about us?" (Hannah, TRI-0056).
 *
 * Option keys mirror daisy-platform supabase/functions/_shared/bookerExtras.ts
 * and the CHECK constraint in migration 073. Keep all three in step.
 */
import { escapeHtml } from "./format";

export const HEARD_ABOUT_OPTIONS: ReadonlyArray<{ key: string; label: string }> =
  [
    { key: "facebook", label: "Facebook" },
    { key: "instagram", label: "Instagram" },
    { key: "google", label: "Google search" },
    { key: "daisy_website", label: "The Daisy First Aid website" },
    { key: "recommendation", label: "Recommended by a friend or family member" },
    {
      key: "nursery_school_workplace",
      label: "Through a nursery, school or workplace",
    },
    { key: "been_before", label: "I've been to a Daisy class before" },
    { key: "other", label: "Other" },
  ];

export const ATTENDEE_DETAILS_MAX = 2000;
export const HEARD_ABOUT_OTHER_MAX = 200;

const OPTIONAL =
  '<span style="color:var(--daisy-muted);font-weight:normal;">(optional)</span>';

/** The two questions' HTML, re-filled from `values` after an error re-render. */
export function bookerExtrasHtml(values: Record<string, string>): string {
  const who = values.attendee_details ?? "";
  const heard = values.heard_about ?? "";
  const other = values.heard_about_other ?? "";
  const options = HEARD_ABOUT_OPTIONS.map(
    (o) =>
      `<option value="${o.key}"${o.key === heard ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
  ).join("");
  return `
        <div class="field">
          <label for="twho">Who's coming? ${OPTIONAL}</label>
          <textarea id="twho" name="attendee_details" rows="3" maxlength="${ATTENDEE_DETAILS_MAX}" placeholder="e.g. Sam Lee, sam@example.com">${escapeHtml(who)}</textarea>
          <p class="hint">Booking for someone else, or for more than one person? Add the name and email address of everyone coming, so your trainer can get everything ready. Your own details above stay as the person booking and paying.</p>
        </div>
        <div class="field">
          <label for="theard">How did you hear about us? ${OPTIONAL}</label>
          <select id="theard" name="heard_about" data-heard-about>
            <option value=""${heard ? "" : " selected"}>Choose one</option>
            ${options}
          </select>
        </div>
        <div class="field" data-heard-other ${heard === "other" ? "" : "hidden"}>
          <label for="theardother">Tell us where ${OPTIONAL}</label>
          <input id="theardother" name="heard_about_other" maxlength="${HEARD_ABOUT_OTHER_MAX}" value="${escapeHtml(other)}" />
        </div>`;
}

/** What goes to create-checkout-session. Empty answers are left out. */
export function readBookerExtras(data: FormData): {
  attendee_details?: string;
  heard_about?: string;
  heard_about_other?: string;
} {
  const who = String(data.get("attendee_details") ?? "").trim();
  const heard = String(data.get("heard_about") ?? "").trim();
  const other = String(data.get("heard_about_other") ?? "").trim();
  const known = HEARD_ABOUT_OPTIONS.some((o) => o.key === heard);
  return {
    ...(who ? { attendee_details: who.slice(0, ATTENDEE_DETAILS_MAX) } : {}),
    ...(known ? { heard_about: heard } : {}),
    ...(known && heard === "other" && other
      ? { heard_about_other: other.slice(0, HEARD_ABOUT_OTHER_MAX) }
      : {}),
  };
}
