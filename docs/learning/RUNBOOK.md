# Learning M1 — operator runbook

The feature is **off by default**. No production database was selected, migrated or tested by this implementation. All commands below require a responsible operator to identify the target environment and approve the configuration. Publishing application code does not import a course or enroll anyone.

## Integration and boundaries

Reuses Firebase sessions and workspace membership, existing workspace layout and UI, and the portfolio `use_cases` pipeline. Training has separate enrollment and capability tables; organization or portfolio roles do not grant access to individual learning results. Every action rechecks session, current membership, workspace, program and object ownership. Reviewer and export scope are explicit and independent. No readiness tables, anonymous respondent linkage, survey forms, survey actions, auth implementation or invitation rules were changed.

M1 is deterministic and requires no LLM key. M2/M3 are visible as future modules; no open-response grading, coach, autonomous agents or operational integrations are enabled. A case first freezes individual decisions, then releases the prepared example, then accepts reflection/mode and final submission. Required reflection is checked for completeness, not semantic quality. Immutable published programs pin content and marking rules; a new version is a new program record. Existing attempts stay on their original program.

Ideas remain private drafts until explicit submission. Promotion uses the existing portfolio table and scoring helpers with `source=learning`, `needs_inputs`, lifecycle `draft`, a reserved UUID and one atomic creation/link/audit statement. No quiz answer, grade or case response is copied. There is no mandatory AI scoring or outbound notification. One optional idea draft per learner/program is the deliberately narrow M1 scope.

## Before enabling

1. Select an authorized preview with a separate database, working Firebase configuration and synthetic accounts. Never use a survey production URL as a convenient test database.
2. Record application SHA, migration checksum, database identity and private pack version/hash. Review the named visibility notice, retention, assigned reviewers, support contact and content with the responsible owners.
3. Snapshot/backup the target database. Apply `drizzle/0012_learning.sql` in a transaction using the approved database console/client, then apply it a second time and check constraints. The application never auto-creates training tables. Do not run a broad `db:push` or schema reset.
4. Existing migration journal is incomplete for 0009–0011. The new migration is intentionally applied explicitly rather than silently modifying old journal history. Reconcile deployment history before using the generic migration command.
5. Configure server-only `LEARNING_ENABLED=true` in preview. Leave production off until its approval and smoke test. Every imported program starts with `feature_enabled=false`.

## Private pack import

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

These are route templates, **not verified production URLs**. Use the evidence report for actual tested localhost URLs. Do not create deck QR codes until two non-admin participants have verified the selected preview/production links and login return.

Rehearse complete M1, wrong essential answer, case two-step flow, refresh/resume, two tabs, interrupted save/submit, learner isolation, revocation, instructor scope, CSV, explicit idea promotion and DB state. Inspect pre-submit HTML/RSC and client bundles for private material. Keep retained evidence synthetic.

## Rollout and rollback

There is no automatic merge, push or deploy. Integrate this branch only after preserving the in-progress survey changes from the original checkout; rebase/retest that combined commit before any release.

1. Deploy an approved tested SHA to preview with global flag off; check existing readiness, invitations, portfolio, MCP and Slack.
2. Apply additive migration/backup, import disabled private program, grants/enrollment, then enable only the target program and run learner smoke tests.
3. Obtain explicit release approval before production migration, deployment, invitations or communications. Repeat smoke tests with authorized accounts; keep a named support owner and prepared teaching fallback.
4. On an incident, use `disable` to hide/block one program or set `LEARNING_ENABLED=false` to disable Learning globally. Do not drop tables, reset the database, or alter survey campaigns. A `close` operation preserves past feedback but freezes changes; `disable` also hides reads.
5. Restore the previous application SHA with the flag off. Additive tables remain intact. Re-enabling resumes confirmed drafts/submissions; unacknowledged browser text remains explicitly unsaved. The old application does not import Learning or require its tables when the flag is off.
6. Database restore is a separate approved operation: never overwrite a live survey database to roll back a training feature. First prove restore in an isolated database. Retention and backup handling are covered in the operations review.

If P0 evidence is incomplete, the status is **not ready for the general rehearsal**. Use the declared deck/synthetic case fallback and record deferred verification honestly; do not manufacture attendance, grades, or completed activities.
