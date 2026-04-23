# Skills — FlexeTravels prompt architecture (v2)

> **Status:** Opt-in. Default path is unchanged (v1 legacy monolithic prompt). Set `FLEXE_PROMPT_VERSION=skills` to activate v2.

## What is this?

FlexeTravels' chat API (`app/api/chat/route.ts`) has historically built its Claude system prompt from a single monolithic function (`buildSystem()`) containing ~800 tokens of rules, personas, regulatory disclosures, NL→filter mappings, and state-machine logic — all in one place.

This directory is the **v2 architecture**: each domain lives in its own versioned `SKILL.md` file with co-located rule + schema hint + test cases. A tiny loader (`lib/skills/loader.ts`) composes the right skills per turn.

The benefit is **NL→filter consistency**: when the "direct flights ⇒ `maxConnections=0`" rule, the schema, and the few-shot examples live in the same file, Claude sees them in one attention window instead of across a sprawling prompt. See `/root/.claude/plans/what-s-missing-between-our-lexical-blum.md` for the full analysis.

## Versioning

| Version | Status | Prompt source | Activated by |
|---|---|---|---|
| **v1 (legacy)** | Default, production | `buildSystemLegacy()` in `app/api/chat/route.ts` (original monolithic prompt, preserved verbatim) | No env var or `FLEXE_PROMPT_VERSION=legacy` |
| **v2 (skills)** | Opt-in, this branch | `buildSystemSkills()` composed from `.claude/skills/*/SKILL.md` via `lib/skills/loader.ts` | `FLEXE_PROMPT_VERSION=skills` |

## Rollback

Three ways to roll back, ordered easiest → most complete:

1. **Runtime flip (zero redeploy):** unset `FLEXE_PROMPT_VERSION` in Railway. Next request uses v1 legacy. No code change needed.
2. **Branch rollback:** `git checkout main` — v1 legacy code is still untouched on `main`.
3. **Full revert:** `git revert <skills-merge-commit>` once this branch is merged.

**Canary strategy:** activate v2 for a session cohort by setting `FLEXE_PROMPT_VERSION=skills` and gating by `sessionId` hash in code if needed. (Not implemented by default — add only when ready to A/B test.)

## Directory layout

```
.claude/skills/
├── README.md                ← this file
├── TEST_CASES.md            ← aggregated catalog of every skill's tests
├── persona-maya/SKILL.md    ← Maya voice + traveler-type heuristics
├── policy-compliance/SKILL.md ← DOT 24-hour rule, APPR, codeshare disclosure
├── flight-search/SKILL.md   ← NL → Duffel searchFlights params
├── hotel-search/SKILL.md    ← NL → LiteAPI searchHotels params
├── trip-planning/SKILL.md   ← Multi-constraint planning, budget splits
├── response-format/SKILL.md ← No card tags, summary shape, exact-value copying
└── state-machine/SKILL.md   ← browsing / flight_selected / hotel_selected rules
```

## SKILL.md format

Each file has:

1. **YAML frontmatter** — `name`, `description`, `when_to_use`. Consumed by the loader's selector.
2. **Body** — rules, tables, NL→filter mappings, few-shot examples.
3. **Test cases section** — NL query → expected tool call / parameter / behaviour, plus failure patterns to watch for.

## Adding a new skill

1. `mkdir .claude/skills/<new-skill-name>`
2. Write `SKILL.md` with frontmatter + body + test cases.
3. Register it in `lib/skills/loader.ts` — add to `pickSkills()` selection logic if state-conditional, or to the always-loaded list.
4. Add its test rows to `.claude/skills/TEST_CASES.md`.
5. Bump a comment version tag in the file and in this README.

## Improving a skill

1. Edit the `SKILL.md`.
2. Add new regression test rows in its Test cases table BEFORE changing rules (TDD-style).
3. Run through the cases manually in `/chat` with `FLEXE_PROMPT_VERSION=skills` on a dev deploy.
4. Commit with message `skill(<name>): <change>` for easy grep.

## Known constraints

- Skills are **not** the native Claude Skills API (that requires `@anthropic-ai/sdk` + beta headers). They are filesystem `SKILL.md` modules loaded by our own code. This captures ~80% of the benefit without migrating off `@ai-sdk/anthropic`.
- The loader reads files at module load (cold start) and caches in memory. To reload without redeploy, restart the process.
- Test cases are currently manual. A skills-eval harness (planned) will automate them.
