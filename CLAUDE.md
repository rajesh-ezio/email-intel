@AGENTS.md

# Email Pattern Finder — project knowledge

A Next.js app on Vercel that **finds and verifies corporate email addresses**. The
main consumer is a **Clay workflow** that calls the HTTP API endpoints.

**Deploys:** the project is **Git-connected** — pushing to `main` **auto-deploys** to
production. You can also deploy manually with `vercel --prod`. ⚠️ The
`email-pattern-finder.vercel.app` alias (the URL Clay calls) is a **manually pinned alias**
that does NOT auto-update on deploy — after shipping, repoint it
(`vercel alias set <deployment-url> email-pattern-finder.vercel.app`) or add it as a
Production domain in project settings so it follows `main`.

## Endpoints (`app/api/`)

- **`POST /api/find-email`** — the core flow. Body: `firstName`, `lastName`,
  `companyDomain`, optional `patternCount` (default 1, clamped 1–12). Generates
  candidate emails from learned patterns, verifies them in ranked order, returns the
  first hit. Requires `Authorization: Bearer <API_SECRET>`.
- **`POST /api/seed-patterns`** — feeds **known real emails** (from Clay) so the system
  learns each domain's pattern. Accepts a single object or an array. Requires API_SECRET.
- **`POST /api/verify`** — standalone single-email verification (also used by Clay).

## Verification logic (Reoon → Enrichley)

The decision is driven by Reoon's **`status`** field, **not** `is_safe_to_send`:

| Reoon `status` | Action |
|---|---|
| `safe` | ✅ valid — accept, no Enrichley |
| `catch_all` or `unknown` | → Enrichley; accept only if Enrichley `valid === true` |
| anything else (`invalid`, `disabled`, `disposable`, `inbox_full`, `role_account`, `spamtrap`) | ❌ reject, no Enrichley |

Reoon **power-mode** statuses (the only ones that occur): `safe`, `invalid`, `disabled`,
`disposable`, `inbox_full`, `catch_all`, `role_account`, `spamtrap`, `unknown`.
There is **no `valid` status** in power mode — `safe` is the positive one.

## Credit awareness (IMPORTANT)

- **Reoon is cheap; Enrichley is expensive — minimize Enrichley.**
- Enrichley is spent **only** on `catch_all`/`unknown` domains. Clean domains resolve via
  Reoon alone (0 Enrichley).
- On a catch-all domain you pay **1 Enrichley per pattern tried** until one validates, so
  fewer-attempts-before-hit = fewer Enrichley calls. The levers are **pattern ordering**
  and **domain memory**.

## Data model (Vercel KV / Upstash Redis)

- **`patterns:{domain}`** → JSON `{pattern: count}`. The **seed store**. Written **only**
  by `/seed-patterns`, from **real known emails**. This is **ground truth** — NEVER write
  find-email output here (it would contaminate it; see invariants).
- **`verified:{domain}`** → hash of `pattern::tried` / `pattern::found`. The **discovery
  store**, written by `/find-email` on every attempt. Used in ranking.
- **`global:pattern_rank`** → JSON `{pattern: count}`. Cross-domain fallback ranking.
  Updated by `/seed-patterns` **and** by `/find-email` confirmed hits.
- **`meta:{domain}`** → `{firstSeen, lastUpdated, seedCount}`.
- **`emaildomain:{companyDomain}`** → the actual email domain (maps a website domain to
  the mail domain, e.g. `bank.in → aubank.in`).

## Pattern ranking (`pickTopPatterns`)

Order, best first: **verified** (`found >= 1`, highest rate first) → **seeded** (by count)
→ **global rank** → fallback `first.last`. Patterns with `tried >= 2` and zero `found` are
suppressed. The loop **stops at the first success**.

## Policy: verified-only (no unverified guessing)

**Every returned email must be confirmed by a live Reoon/Enrichley call.** The tool does
**not** return seed-based guesses without verifying them.

**Known limitation (accepted on purpose):** anti-probe / catch-all mail servers (banks:
kotak, barclays, icici, aubank…) return false negatives — Reoon says `invalid`/`catch_all`
even for valid mailboxes, and Enrichley can't validate them. For those domains `/find-email`
returns `all_patterns_failed` even when we hold hundreds of confirmed real-email seeds (e.g.
kotak.com = `first.last`, 228 samples). The owner chose verified-only over returning
high-probability-but-unconfirmed addresses. (A "trusted-seed" short-circuit that returned
seed-based guesses was built and then **removed by request** — do not reintroduce it without
explicit approval.)

## `Verification` result values

- `reoon_safe` — Reoon confirmed safe.
- `enrichley_valid` — Enrichley confirmed on a `catch_all`/`unknown`.
- `all_patterns_failed` — nothing found (includes anti-probe/catch-all domains the verifier can't confirm).
- `skipped_bad_name` — name too short/invalid.

## Critical invariants / gotchas

- **Seeds (`patterns:`) come ONLY from real known emails.** Do **not** feed `/find-email`'s
  `Found Email` back into `/seed-patterns` — keep the seed store ground-truth-only.
- `/find-email` writes discoveries to `verified:`, **not** `patterns:` — by design, to keep
  seeds clean. Discoveries still help future lookups via the `verified:` ranking path.
- **`main` auto-deploys** (Git-connected); `vercel --prod` also works. The
  `email-pattern-finder.vercel.app` alias is manual — it won't follow a new deploy unless
  repointed or set as a Production domain.
- `patternCount` is the Enrichley ceiling per lookup (up to that many on catch-all domains).

## Local dev / deploy

```bash
vercel link                   # link to the email-pattern-finder project
vercel env pull .env.local    # restores REOON, ENRICHLEY, API_SECRET, KV vars
npm install
vercel dev                    # run locally
vercel --prod                 # deploy to production
```
Env vars live in the Vercel project: `REOON_API_KEY`, `ENRICHLEY_API_KEY`, `API_SECRET`,
`KV_*` / `REDIS_URL`.

## Optimizations shipped 2026-06-30

1. Trust a single confirmed hit (`found >= 1` instead of `tried >= 2`).
2. Reoon **status**-based decision (was `is_safe_to_send`); `inbox_full` now rejected.
3. `/find-email` confirmed hits feed `global:pattern_rank`.

Policy: **verified-only**. (A trusted-seed short-circuit was built then removed by request.)
