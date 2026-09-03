/*
 * Shared class-feature types + size caps. Imported by the zod schemas
 * (lib/api-schemas.ts), the store (lib/classes/store.ts) AND the client pages
 * (app/(app)/classes/**, lib/swr.ts) so the layers can never drift apart. This
 * file must stay dependency-free of any server-only module so the client can
 * import the shapes.
 *
 * Role is stored PER MEMBERSHIP (class_members.role), never folded into
 * `classes` — that invariant is the seam a later assignments phase leans on
 * (design report §2.3). Slice 1 builds classes + class_members only; the
 * `class_invites` table and email invites are a later slice.
 */

/** A member's role WITHIN one class. Per-membership, so a user can teach one
 *  class and be a student in another. */
export const CLASS_ROLES = ["teacher", "student"] as const;
export type ClassRole = (typeof CLASS_ROLES)[number];

/** How a membership row came to exist (audit only). */
export const JOINED_VIA = ["creator", "code", "invite"] as const;
export type JoinedVia = (typeof JOINED_VIA)[number];

/** Length caps — consistent with the `collections` name/description/emoji caps. */
export const CLASS_NAME_MAX = 80;
export const CLASS_DESCRIPTION_MAX = 500;
export const CLASS_EMOJI_MAX = 8;

/** A join code is 8 chars from an unambiguous base32 alphabet (≈40 bits). */
export const JOIN_CODE_LENGTH = 8;
/** Crockford-ish alphabet: no 0/O/1/I/L to keep spoken/typed codes unambiguous. */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** One row of the `classes` table. */
export interface ClassRow {
  id: string;
  name: string;
  description: string;
  emoji: string;
  created_by: string;
  /** Active join code, or null when join-by-code is disabled. */
  join_code: string | null;
  created_at: number;
  /** NULL ⇒ active; set ⇒ soft-archived. */
  archived_at: number | null;
}

/** One row of the `class_members` junction table. */
export interface ClassMemberRow {
  class_id: string;
  user_id: string;
  role: ClassRole;
  joined_via: JoinedVia | null;
  joined_at: number;
}

/** A class in the caller's "Classes I teach" list. */
export interface TeachingClass {
  id: string;
  name: string;
  emoji: string;
  description: string;
  studentCount: number;
  join_code: string | null;
  created_at: number;
}

/** A class in the caller's "Classes I'm in" list (student membership). */
export interface EnrolledClass {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** Display names of the class's teacher(s). */
  teacherNames: string[];
  joined_at: number;
}

/** The hub payload (GET /api/classes). `invites` is always [] in Slice 1
 *  (email invites are a later slice); the field is kept for forward-compat. */
export interface MyClassesData {
  teaching: TeachingClass[];
  enrolled: EnrolledClass[];
  invites: never[];
}

/** One roster row a teacher sees. */
export interface RosterEntry {
  user_id: string;
  name: string;
  email: string;
  joined_at: number;
  joined_via: JoinedVia | null;
}

/** GET /api/classes/[id] — a discriminated union on the caller's role. */
export type ClassDetail =
  | {
      role: "teacher";
      class: ClassRow;
      students: RosterEntry[];
      studentCount: number;
      archived: boolean;
    }
  | {
      role: "student";
      class: Pick<ClassRow, "id" | "name" | "emoji" | "description">;
      teachers: { user_id: string; name: string }[];
      joined_at: number;
      archived: boolean;
    };

/** GET /api/classes/join?code= — the consent-screen preview (no write). */
export interface JoinPreview {
  class: { id: string; name: string; emoji: string };
  teacher: { name: string };
  /** Plain-language consent copy the server and client keep in sync. */
  consent: string;
}

/** The one line of consent copy — the WHOLE-report warning, stated once. */
export const CONSENT_NOTICE =
  "Joining shares your whole Lexi report with this class's teacher — your " +
  "vocabulary progress and your writing bands, updated live. You can leave " +
  "any time to stop it.";
