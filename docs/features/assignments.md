# Assignments

**Assignments** let a **teacher**, inside a [class](classes.md), give students a specific piece of
the platform's **existing** content to work on, and see who has done it. Slice 1 ships **vocabulary
set** assignments; the design is built as **one extensible flow** so future content kinds (writing
tasks, grammar, listening) drop in as adapters with **no schema or UI change**.

## The spine: `kind + ref` + the AssignableKind adapter

An assignment never hardcodes "vocab" or "writing". It names its content by a **kind** (a registry
key, e.g. `vocab_collection`) + a **ref** (the stable content id — a collection id). Everything
kind-specific lives behind one server-side adapter interface (`lib/assignments/kinds/kind.ts`):

- **list/pick** the content for the teacher's picker (`listPickable`),
- **resolve** a ref into a display **ContentCard** with a `doHref` deep-link into the EXISTING
  doing-flow (`resolveCard`),
- **measure** a student's completion (`progressFor` / `progressForMany`).

The client **never switches on kind** — the server hands it a card (title/emoji/`doHref`) and a
progress verdict, and the pages just render cards, a "Start →" link and a status pill. Adding a kind
= implement the adapter + register it in `lib/assignments/kinds/index.ts` + add the string to
`ASSIGNMENT_KINDS` (`lib/assignments/types.ts`). The picker's tab strip and the completion column are
registry-driven, so a new kind lights up automatically. The vocab adapter lives in
`lib/assignments/kinds/vocab.ts`.

## What Slice 1 ships (vocab-collection assignments)

- **Create** — from a class, a teacher picks a vocabulary set (a **public** catalog pack *or* their
  **own private** set), selects **specific students**, sets an optional **due date**, and assigns.
- **Do it** — the student's assignment routes them into the **existing** practice flow via
  `/practice?collection=<id>` (the same deep-link the "Study →" button uses). No parallel player.
- **Completion** — "**practised at least once**": a student is done once they have ≥ 1 practice
  attempt on any word in the set. Derived **live** from existing attempt data — no new tracking.
- **See it** — the student sees "Assigned to you" on `/classes` and per-class; the teacher sees a
  per-student completion grid on the assignment page, with **overdue** flagged (past due + not done).

## Assign-grants-visibility (private sets)

A student can only practise content they can **see**. Public packs are visible to everyone; a
teacher's **private** collection is not. So **the assignment target row IS the visibility grant**: a
student targeted by an active `vocab_collection` assignment may practise that private collection —
`/practice?collection=<id>` works for them — even though it stays out of their collection list.

This is one extension to the single visibility choke point, `collectionVisibleTo`
(`lib/store.ts`): the grant is derived **live** from *(a target row) AND (current class membership)
AND (the assignment un-archived) AND (the class un-archived)*. So **every** revocation path works
with no cleanup:

- archive the assignment → grant gone;
- remove the student from the class (or they leave) → grant gone;
- archive the class → grant gone.

Public collections short-circuit before the grant query runs, so they pay nothing. No parallel
sharing model was invented — the existing collection-visibility model is simply extended.

## Data model (additive, no `SCHEMA_VERSION` bump)

Two tables in `migrate()` (`lib/db.ts`), created `IF NOT EXISTS` like the class tables:

- **`assignments`** — `id, class_id, content_kind, content_ref, title, instructions, criteria
  (JSON completion rule, '' ⇒ kind default), due_at, created_by, created_at, archived_at`.
  Indexed by `(class_id, archived_at)` and `created_by`.
- **`assignment_targets`** — one row per targeted student: `(assignment_id, user_id, created_at)`,
  PK `(assignment_id, user_id)`, indexed by `user_id`. Reuses the class `(class_id, user_id)` seam;
  membership/active-ness is re-checked live, so a removed student's assignment (and grant) vanishes.

A student's assignments resolve through `assignment_targets` × `class_members` × `classes` (all
un-archived), so removal from the class is instant and total — mirroring how leaving a class revokes
report access.

## Roles & authorization

- **Create / edit / archive** an assignment — **teacher only** (`ForbiddenError` → 403); over the
  per-class cap (`ASSIGNMENT_MAX_PER_CLASS`, default 200) → 409; a bad content ref or no valid
  targeted student → 400.
- **A student** sees only **their own** assignments and progress; a class member who isn't a target
  gets 404 on an assignment (existence not leaked), and a non-member gets 404 on a class's list.
- **The teacher's completion grid** reads each targeted student's derived progress only after
  confirming the caller teaches the class and the student is a current member — the same trust
  discipline as the report seam, and the completion data (stage counts / "did they practise") is a
  strict subset of the report a student already consented to share on joining.

## Where it lives (code map)

- **Schema:** `assignments` + `assignment_targets` in `migrate()` (`lib/db.ts`); the visibility
  grant in `collectionVisibleTo` (`lib/store.ts`).
- **Spine + adapters:** `lib/assignments/kinds/{kind,vocab,index}.ts`; shared types
  `lib/assignments/types.ts`; caps/errors `lib/assignments/config.ts`; live completion queries
  `lib/assignments/progress.ts`.
- **Store:** `lib/assignments/store.ts` — `assignmentsStore.forUser(userId)` (all authz here, like
  `lib/classes/store.ts`).
- **Routes:** `app/api/classes/[id]/assignments` (GET list / POST create),
  `app/api/assignments` (GET the caller's own), `app/api/assignments/[assignmentId]`
  (GET detail / PATCH / DELETE-archive), `app/api/assignments/content` (picker content),
  `app/api/assignments/kinds` (picker tabs). Schemas in `lib/api-schemas.ts`;
  `AssignmentCapError` → 409 / `AssignmentInputError` → 400 mapped by name in `lib/api.ts`.
- **UI:** the teacher **Assignments** section + **New assignment** picker on `/classes/[id]`
  (`components/assignments/{TeacherAssignments,NewAssignmentDialog}.tsx`); the assignment page
  `app/(app)/assignments/[assignmentId]` (teacher grid / student card); "Assigned to you" on
  `/classes` and per class (`components/assignments/{AssignedToYou,StudentClassAssignments,
  StudentAssignmentCard,parts}.tsx`).
- **Data layer:** `KEY_MY_ASSIGNMENTS`, `classAssignmentsKey`, `assignmentKey`,
  `useMyAssignments` / `useClassAssignments` / `useAssignment` / `useAssignableContent` /
  `useAssignmentKinds` / `revalidateAssignments()` in `lib/swr.ts`.
- **Tests:** `tests/routes/assignments.test.ts` — teacher-only create, specific-student targeting,
  the private-content grant **and its revocation** (archive / remove / class-archive), completion
  derivation, live overdue, and the 404 gates.

## Deferred to later slices

Writing-prompt assignments (a drop-in `writing_prompt` adapter — Slice 2), whole-class targeting,
teacher-chosen completion criteria, a richer completion dashboard, and notifications.
