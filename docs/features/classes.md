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

**Also available (Slice 3):** invite specific people by **email** — see below. Slice 1 join is by
**code**; Slice 3 adds targeted invites on top of it without changing the code path.

## What Slice 2 ships — the teacher reads a student's report

The payoff of the whole feature: a teacher clicks a student on the **roster → View →** and sees
that student's **full report** (vocabulary + writing), **read-only**, framed *"Read-only · shared
with you because \<name\> is in this class."* No edit, no act-as — only the same aggregates the
student sees on their own `/report`.

- **The report page is shared, not forked.** The `/report` render body (every tile + chart) was
  extracted into a pure `components/report/ReportView.tsx` that takes `{ vocab, writing }`. The
  learner's own `/report` feeds it from its own SWR (`KEY_STATS` + `KEY_WRITING_STATS`); the
  teacher page feeds it from **route 17**. Same component ⇒ the teacher sees byte-identical output
  (a jsdom parity test guards this). The `/report` refactor is purely internal — no visual change.
- **Live, never a snapshot.** Route 17 computes the report from the student's data *at request
  time* via `getStore().forUser(studentId)` + `writingStore.forUser(studentId)`. So the moment a
  student leaves (or is removed), the teacher's next request fails authorization — **revocation is
  instant and total**, for free.

### The trust-critical seam (route 17)

`GET /api/classes/[id]/students/[studentId]/report` is the **only** place in the app `forUser()`
is called with an id **other than the caller's** — a bug here would leak a student's entire
history. Its authorization is `classesStore.forUser(caller).teachesStudent(classId, studentId)`
and **nothing looser**: the caller must hold a `role='teacher'` row **and** the target a
`role='student'` row, both in *this* class. **Every** failure — not a teacher here, teacher of a
*different* class, a student/non-teacher member, the target not a student here, the class absent —
returns **404** (never 403, which would confirm the class exists; existence is never leaked). The
response sends `MUTABLE_JSON_CACHE_HEADERS` (`private, no-store`). An adversarial route test
(`tests/routes/classes.test.ts`) pins every one of those cases.

## What Slice 3 ships — email invites (invite-by-link)

A teacher can invite **specific people by email**, not just broadcast a join code.

- **No mail infrastructure.** Lexi has no email provider, so this slice ships **invite-by-link**
  (captain decision, locked): the teacher enters email(s); Lexi creates a `class_invites` row per
  address, each with an opaque **token**, and returns a **copyable accept link**
  (`/classes?invite=<token>`) the teacher sends through **their own** channel (email, chat). **No
  real email is sent, and no mail provider was added.** Real outbound email is a **future
  enhancement** — it drops in behind these same routes (the token model is already shaped for it)
  once the captain picks a provider.
- **Idempotent.** Re-inviting the same address **updates** its row (new token, back to pending),
  never duplicates — enforced by `UNIQUE(class_id, email)`. Emails are trimmed + lowercased;
  non-email entries in a batch are dropped rather than failing it.
- **The invited user's banner.** On `/classes`, a pending invite appears as an actionable
  **⚠ You've been invited** banner (fed by `GET /api/classes/invites`, matched to the caller's
  **account email**) with **[Accept] [Decline]**. Opening an accept link lands on the same hub and
  auto-opens the matching invite's consent.
- **Accepting is a CONSENT event.** Accept routes through the **same** whole-report consent screen
  as the code-join (`ConsentDialog`) — there is **no silent auto-join**, even for a pending invite
  waiting when a user first signs in. Accepting takes a seat with the **same last-seat-guarded
  insert** as join-by-code (`joined_via='invite'`); over-cap → **409** and the invite stays
  pending (a freed seat lets them retry). Declining marks it `declined` and creates no membership.
- **Seat only on accept.** A pending invite consumes **no** seat, so creating invites never
  blocks on the class cap — it only **warns** (non-blocking) when pending + students would exceed
  it.
- **Email-match is the authz.** Accept/decline resolve the caller's **account** email
  (`getUserEmail`, never a client-supplied one) and require it to match the invite — **any**
  mismatch (or no resolvable email) → **404**, so an invite's existence is never leaked to anyone
  but its recipient. Create/revoke are **teacher-only** (→ 403).

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

- **Schema:** `classes` + `class_members` + `class_invites` tables in `migrate()` (`lib/db.ts`).
  `class_invites` has `UNIQUE(class_id,email)` (idempotency), `UNIQUE(token)` (link lookup) and an
  `(email,status)` index ("invites for me").
- **Store + caps + types:** `lib/classes/{store,config,types}.ts` (mirrors `lib/feedback/store.ts`).
  Invite email-match resolves the caller's email via `getUserEmail` (`lib/auth/store.ts`).
- **Routes:** `app/api/classes/**` — create/list, detail/patch/archive, join-code
  generate/disable, join preview/redeem, roster, remove-student, leave, **the teacher report
  view** (`[id]/students/[studentId]/report`, route 17), and the **email invites** (Slice 3):
  `[id]/invites` (POST create, teacher), `[id]/invites/[inviteId]` (DELETE revoke, teacher),
  `invites` (GET the caller's pending invites), `invites/[inviteId]/accept` (POST — consent write,
  email-matched), `invites/[inviteId]/decline` (POST). All go through `withUser`; teacher-only
  actions throw `ForbiddenError` (→ 403), non-members get 404 on detail (existence isn't leaked),
  over-cap throws `ClassCapError` (→ 409), route 17's `teachesStudent` failure → 404, an
  email-mismatched accept/decline → 404. (The static `invites` segment resolves ahead of the
  dynamic `[id]`.)
- **Report compute:** `lib/report-data.ts` — `vocabStatsFor(userId)` / `writingStatsFor(userId)`,
  the single source of truth for the `/api/stats` + `/api/writing/stats` bodies, reused by route
  17 so its payload can't drift. Shared payload types live in `lib/report.ts`.
- **UI:** `app/(app)/classes/page.tsx` (hub — join box, **invite banner**, teaching/enrolled),
  `app/(app)/classes/[id]/page.tsx` (detail, roster **View →** links, **Invite by email** section),
  `app/(app)/classes/[id]/students/[studentId]/page.tsx` (teacher report view),
  `components/report/ReportView.tsx` (shared tiles + charts),
  `components/classes/{ConsentDialog,TrustCard,InviteBanner}.tsx`; nav link in `components/Nav.tsx`.
- **Data layer:** `KEY_CLASSES` / `KEY_INVITES` / `useMyClasses` / `useClass` / `useMyInvites` /
  `useStudentReport` / `revalidateClasses()` in `lib/swr.ts` (the student-report **and** invite
  keys live under the `KEY_CLASSES` prefix, so `revalidateClasses()` clears them after a roster or
  invite change).
- **Tests:** `tests/routes/classes.test.ts` (caps, authz, join + **invite** idempotency, the
  **invite accept seat-guard** + email-match authz, **route 17 adversarial seam**),
  `tests/components/classes-consent.test.tsx` (consent + trust card copy),
  `tests/components/classes-invite-banner.test.tsx` (invite banner accept → consent flow),
  `tests/components/report-view-parity.test.tsx` (own-report vs teacher-view render parity).
