# Classes

**Classes** let one signed-in user (a **teacher**) gather others (their **students**) so the
teacher can follow their progress. It is the first Lexi feature where another person can see a
student's data — so joining is always an explicit, informed **consent** moment, and leaving
revokes access immediately.

Reach it from **👥 Classes** in the top-nav utility cluster (next to 📊 Report). Any signed-in
user can create or join a class — it is **not** owner-gated.

## What Slice 1 ships

- **Create a class** → you become its teacher and get a shareable **join code**.
- **Join by code** → a student enters the code, sees a **consent screen**, and joins.
- **Roster** → the teacher sees who joined (name, email, when, how).
- **Leave / remove** → a student can leave; a teacher can remove a student. Either ends the
  relationship at once.
- **Archive** → the creator can soft-archive a class (it goes inert; it is not hard-deleted).

**Not in this slice:** email invites (join is by **code** only) and the teacher's read-only view
of a student's report. Those are later slices; the data model already leaves a clean seam for
them.

## Roles & ownership

Role is stored **per membership** (`class_members.role ∈ {teacher, student}`), so the same
account can teach one class and be a student in another. The creator is both the immutable owner
(`classes.created_by`, used for archive + the create cap) **and** holds a `role='teacher'`
membership row — which is what lets co-teachers drop in later with no schema change.

## Consent & privacy (the trust story)

Joining shares the student's **whole Lexi report** — vocabulary progress *and* writing bands,
updated live — with the class's teacher(s), for as long as the student is a member. This is
stated plainly on the consent screen before any write, and the affirmative button ("Join &
share") **is** the consent. The student's class page shows a persistent trust card naming exactly
who can see them. Leaving (or being removed) revokes access immediately. The public
`/about` and `/privacy` pages carry the matching honest exception to Lexi's data-isolation
promise.

## Caps

Enforced in the store with an atomic guarded insert (so the last seat can't be double-taken);
over-cap returns **409**. Env-overridable (`lib/classes/config.ts`), defaults:

| Cap | Env var | Default |
|---|---|---|
| Students per class | `CLASS_MAX_STUDENTS` | 50 |
| Active classes per teacher | `CLASS_MAX_CLASSES_PER_TEACHER` | 10 |
| Total memberships per account | `CLASS_MAX_MEMBERSHIPS` | 100 |

## Where it lives (code map)

- **Schema:** `classes` + `class_members` tables in `migrate()` (`lib/db.ts`).
- **Store + caps + types:** `lib/classes/{store,config,types}.ts` (mirrors `lib/feedback/store.ts`).
- **Routes:** `app/api/classes/**` — create/list, detail/patch/archive, join-code
  generate/disable, join preview/redeem, roster, remove-student, leave. All go through
  `withUser`; teacher-only actions throw `ForbiddenError` (→ 403), non-members get 404 on detail
  (existence isn't leaked), over-cap throws `ClassCapError` (→ 409).
- **UI:** `app/(app)/classes/page.tsx` (hub), `app/(app)/classes/[id]/page.tsx` (detail),
  `components/classes/{ConsentDialog,TrustCard}.tsx`; nav link in `components/Nav.tsx`.
- **Data layer:** `KEY_CLASSES` / `useMyClasses` / `useClass` / `revalidateClasses()` in `lib/swr.ts`.
- **Tests:** `tests/routes/classes.test.ts` (caps, authz, idempotency),
  `tests/components/classes-consent.test.tsx` (consent + trust card copy).
