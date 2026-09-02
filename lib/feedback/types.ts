/*
 * Shared feedback types + size caps. Imported by the zod schema
 * (lib/api-schemas.ts), the store (lib/feedback/store.ts) and the client widget
 * (components/FeedbackWidget.tsx) so the three can never drift apart.
 */

/** The category choices offered in the widget's select. */
export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Max message length (chars). Consistent with the app's other long-text caps. */
export const FEEDBACK_MESSAGE_MAX = 4000;

/** Max length of the captured page path/url (defensive; client-supplied). */
export const FEEDBACK_PAGE_MAX = 512;

/** One stored feedback submission. */
export interface FeedbackEntry {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  /** 1–5, or null when the user left it unset (rating is optional). */
  rating: number | null;
  message: string;
  /** The in-app path the widget was opened from (e.g. "/practice"). */
  page: string;
  /** The submitter's User-Agent (captured server-side), or "". */
  user_agent: string;
  created_at: number;
  /** Joined from `users` for the admin list — best-effort, may be "". */
  user_email?: string;
  user_name?: string;
}

/** What a caller submits (the route validates this shape via zod first). */
export interface NewFeedback {
  category: FeedbackCategory;
  rating?: number | null;
  message: string;
  page?: string;
  user_agent?: string;
}
