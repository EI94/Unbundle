# Learning M1 — operator runbook

The feature is **off by default**. The production database has been identified through read-only catalog checks; it has not been migrated or used for application tests. All commands below require a responsible operator to identify the target environment and approve the configuration. Publishing application code does not import a course or enroll anyone. See [RELEASE-HARDENING-2026-10-02.md](RELEASE-HARDENING-2026-10-02.md) for the current release gate and unresolved checks.

## Integration and boundaries

Reuses Firebase sessions and workspace membership, existing workspace layout and UI, and the portfolio `use_cases` pipeline. Training has separate enrollment and capability tables; organization or portfolio roles do not grant access to individual learning results. Every action rechecks session, current membership, workspace, program and object ownership. Reviewer and export scope are explicit and independent. The candidate preserves the survey source already published from the original dirty checkout; it does not introduce a new survey or link anonymous respondents to Learning accounts. Learning does not change readiness tables, the shared auth implementation or invitation rules.

M1 is deterministic and requires no LLM key. M2/M3 are visible as future modules; no open-response grading, coach, autonomous agents or operational integrations are enabled. A case first freezes individual decisions, then releases the prepared example, then accepts reflection/mode and final submission. Required reflection is checked for completeness, not semantic quality. Immutable published programs pin content and marking rules; a new version is a new program record. Existing attempts stay on their original program.

Ideas remain private drafts until explicit submission. Promotion uses the existing portfolio table and scoring helpers with `source=learning`, `needs_inputs`, lifecycle `draft`, a reserved UUID and one atomic creation/link/audit statement. No quiz answer, grade or case response is copied. There is no mandatory AI scoring or outbound notification. One optional idea draft per learner/program is the deliberately narrow M1 scope.

## Before enabling

1. Select an authorized preview with a separate database, working Firebase configuration and synthetic accounts. Never use a survey production URL as a convenient test database.
2. Record application SHA, migration checksum, database identity and private pack version/hash. Review the named visibility notice, retention, assigned reviewers, support contact and content with the responsible owners.
3. Complete an authorized backup and prove its restore into a separate isolated database before changing the target. Preparation or an archive listing alone is not a restore test. The production export is currently **BLOCKED_AUTO_REVIEW**, awaiting direct user consent for its payload and destination; do not retry or use another export path until that is resolved.
4. Follow the explicit migration procedure below. Test `0012_learning.sql` twice only in the isolated rehearsal, checking constraints after both applications. The production catalog checked on 2 October had no Learning tables or triggers. The application never auto-creates them. Do not replay historical migrations against production, run a broad `db:push`, or reset its schema.
5. Configure server-only `LEARNING_ENABLED=true` in preview. Leave production off until its approval and smoke test. Every imported program starts with `feature_enabled=false`.

### Explicit migration 0012

The repository journal ends at `0008_workspace_integration_tokens`; it does not contain 0009–0012. The presence of `drizzle.__drizzle_migrations` in production does not prove which later SQL files were applied. Do not use `npm run db:migrate` for this release: it loads `.env.local` and the incomplete journal cannot apply 0012. Record the explicit migration receipt separately; do not invent or rewrite past journal rows. Reconcile history before adopting the generic runner later.

Before execution, verify the approved host/database and PostgreSQL version, the `public` schema, existing `users`, `workspaces` and `use_cases` UUID primary keys, required DDL privileges, and the absence of conflicting Learning objects. These are preconditions, not permission to apply changes. Stop on unexpected schema differences. `IF NOT EXISTS` does not repair an unrelated or partially incompatible table.

The reviewed SHA-256 of `drizzle/0012_learning.sql` is `d39f2caee006ae392684110a0de169738f81e2c573a0856f00686dbee725b09f`. Recheck it against the tested commit. This file contains no transaction wrapper; the approved client must supply one and stop on the first error. For a `psql` session whose target and credentials have already been configured through the approved private mechanism:

```sh
PGOPTIONS='-c search_path=public -c lock_timeout=5s -c statement_timeout=60s' \
  psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 \
  --file=drizzle/0012_learning.sql
```

Apply once to the authorized production target, with Learning disabled. A timeout or error must roll back the whole transaction; investigate rather than removing the bounds or continuing with partial SQL. Creating foreign keys can briefly lock referenced tables, so use the approved change window. After commit, verify all seven Learning tables, their keys/checks/indexes, the four enabled Learning triggers (including the deferred portfolio-target constraint), and the absence of imported programs before the separate import step. Save client exit status, checksum, database identity, timestamp and catalog checks without secrets or answer data. No readiness tables are altered by 0012.

## Private pack import

The workspace panel now supports the full M1 administrative workflow: **Formazione → Gestisci formazione**. See [ADMIN.md](ADMIN.md) for private import, settings, bulk enrollment, replica changes, session opening, explicit permissions, course visibility, closure, audit and retention. The CLI below remains an operator alternative. The web panel never applies migrations, chooses a database or enables the global environment flag.

Keep the entire private handoff outside the repository and web root. The private bank is stored only in the server database. Do not put it in `/public`, artifacts, screenshots, environment variables prefixed `NEXT_PUBLIC_`, or a public pull request. Restrict database and backup access accordingly.

The CLI loads **no .env files**. Its default is validation/dry run with **no database access**:

```sh
npm run learning:admin -- import \
  --workspace WORKSPACE_UUID --actor MANAGER_USER_UUID \
  --file /private/location/training_pack.json \
  --visibility-policy-file /private/location/approved-notice.txt \
  --retention-days APPROVED_DAYS --title 'Approved course title'
```

For apply, provide `LEARNING_ADMIN_DATABASE_URL` through the approved secret mechanism and append:

```text
--apply --confirm-authorized --environment preview
--confirm-database HOSTNAME[:PORT]/DATABASE --bootstrap-manager
```

`import` creates the immutable program, all replica sessions, a program-wide `manage` grant for the operator and audit. It prints the new program ID/hash, never the answer bank. Same version/hash is idempotent; same version/different hash fails. Production additionally requires `--environment production --production-approved` after explicit responsible approval; those flags are not themselves approval.

## Assign the two replicas

Use existing account-specific workspace invitations and auth first. No emails or invitations are sent by Learning. Do not assume domain membership or increase multi-use invitation limits. Resolve existing **user UUIDs**, not arbitrary email strings.

```sh
npm run learning:admin -- enroll \
  --workspace WORKSPACE_UUID --program PROGRAM_UUID --actor MANAGER_USER_UUID \
  --user LEARNER_USER_UUID --cohort m1-a
```

Repeat for each approved participant with exactly one of `m1-a` or `m1-b`. Run as dry run first, then append the same apply/target confirmation options (without bootstrap). Repeating the same enrollment is safe; assigning a second replica fails. Both replicas reference the same immutable program/version. Dates and offsets come from the private seed and are converted with Europe/Rome, including the October daylight-saving change.

Create grants individually with `grant --user USER_UUID --capability review --cohort m1-a`. Supported capabilities are `manage`, `review`, `aggregate`, `export`; `--cohort all` means program-wide. Grant `aggregate` separately for a classroom/sponsor view and `export` only when named export is approved. A reviewer does not receive export or management implicitly. Use `revoke-grant --grant GRANT_UUID` to revoke.

Then use `enable` with workspace/program/actor and apply confirmations. Scheduled M1 opens checkpoint at +30 minutes, case at +78, final/retake at +105 from the assigned session. These are opening times, not punitive deadlines. For a rehearsal or authorized manual opening use `session --cohort m1-a --status open`; restore `scheduled` afterward. `session --status closed` freezes further writes. No browser clock controls access.

## Links and rehearsal

Routes are under `/dashboard/WORKSPACE_UUID/learning/PROGRAM_UUID`:

- `/m1`, `/m2`, `/m3`: module overview; only M1 activities enabled.
- `/activities/m1-check`, `/activities/m1-case`, `/activities/m1-exit-a`: learner activities.
- `/attempts/ATTEMPT_UUID`: own draft or feedback, including recovery B.
- `/progress`, `/ideas`: own history and voluntary proposal.
- `/manage`, `/manage/ATTEMPT_UUID`: explicit review grant, assigned cohorts only; individual draft content is not exposed.
- `/live`: fixed-scope aggregate view, minimum group size and complementary suppression.
- `/admin`: course administration with an explicit management grant; independent from review/export. The workspace catalog/import page is `/dashboard/WORKSPACE_UUID/learning/admin`.

These are route templates, **not verified production URLs**. Use the evidence report for actual tested localhost URLs. Do not create deck QR codes until two non-admin participants have verified the selected preview/production links and login return.

Rehearse complete M1, wrong essential answer, case two-step flow, refresh/resume, two tabs, interrupted save/submit, learner isolation, revocation, instructor scope, CSV, explicit idea promotion and DB state. Inspect pre-submit HTML/RSC and client bundles for private material. Keep retained evidence synthetic.

## Rollout and rollback

No merge, push or deploy has been performed. Release remains gated by the recorded human authorization and completion of its conditions, including the checks in the current release report. Preserve the already-live survey changes from the original checkout when integrating this branch, and test the combined commit before any release.

1. Deploy an approved tested SHA to preview with global flag off; check existing readiness, invitations, portfolio, MCP and Slack.
2. Complete the authorized backup and isolated restore verification first, then apply the additive migration transaction. Import the private program while disabled, configure grants/enrollment, then enable only the target program and run learner smoke tests.
3. Verify the recorded human release authorization and all its conditions; request approval only where missing. The current request authorizes release conditional on completed checks. The separate authorization for the complete production backup payload and local destination remains pending after automatic review rejection. Do not infer authorization to send invitations or communications from deployment authorization. Repeat smoke tests with authorized accounts; keep a named support owner and prepared teaching fallback.
4. On an incident, use `disable` to hide/block one program immediately through the database-backed setting. A `close` operation preserves past feedback but freezes changes; `disable` also hides reads. The global `LEARNING_ENABLED` value is deployment configuration: changing an environment record alone does not update running Vercel deployments. To disable it globally, activate a reviewed deployment with the flag off or restore the previous immutable deployment. Do not drop tables, reset the database, or alter survey campaigns.
5. Restore the **previous immutable deployment**, not a rebuild of its Git SHA. The verified pre-release target is `dpl_D7ZMtDQgVZSASxrLiMk5yNs6jnGU` (`unbundle-8b7di9ifi-pierpaolo-lauritos-projects-25e7d30a.vercel.app`), recorded on 2 October 2026. It contains the already-live survey changes despite reporting Git SHA `e63a2a719410af77982c85522dad6339975f869e` and `gitDirty=1`; rebuilding that SHA would lose those changes. Reconfirm the active target and retain its deployment identity before release, then use the provider's approved rollback/promotion flow for that exact artifact and verify the production domains. Keep additive tables and all responses intact. The previous artifact has no Learning code. If later re-enabling the candidate, confirmed drafts/submissions remain; unacknowledged browser text remains explicitly unsaved. The historical localhost e63 test proves additive-schema compatibility only, not restoration of the current production survey source.
6. Database restore is a separate approved operation: never overwrite a live survey database to roll back a training feature. First prove restore in an isolated database. Retention and backup handling are covered in the operations review.

If P0 evidence is incomplete, the status is **not ready for the general rehearsal**. Use the declared deck/synthetic case fallback and record deferred verification honestly; do not manufacture attendance, grades, or completed activities.
