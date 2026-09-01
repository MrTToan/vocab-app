# Lexi — Feature Guide

Plain-language docs for **how each part of the app behaves today**. One file per feature.

- For architecture / code map → `TECH.md`
- For the product vision & requirements → `PRD.md`
- For setup → `docs/SETUP-*.md`

The app has **two modules** — Vocabulary and IELTS Writing — reachable from the top nav, with a
cross-skill Report. A SaaS-style landing page sits at `/`.

## Vocabulary
1. [Word progression](word-progression.md) — the stage ladder & how Lexi picks what you study
2. [Exercise types](exercise-types.md) — the exercises and how each is graded
3. [Explore mode](explore-mode.md) — the 🔀 "new words" toggle
4. [Question bank](question-bank.md) — pre-generated + self-refilling questions
5. [Adding words](adding-words.md) — enrichment, duplicate & spelling checks, single add, paste-a-list import (CSV as advanced)
6. [Collections](collections.md) — curated word groups (private + public packs) + scoped practice

## Writing
7. [IELTS writing feedback](writing-feedback.md) — Task 1 & Task 2, band scoring, inline corrections

## Across the app
8. [Progress tracking](progress-tracking.md) — the cross-skill `/report` (vocab + writing charts; `/progress` redirects here)
9. [AI providers](ai-providers.md) — the fallback chain & running with no key
10. [Data & storage](data-and-storage.md) — what's stored, where, and backups
11. [Admin portal](admin.md) — the owner-only usage dashboard at `/admin`
