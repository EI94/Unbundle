# Course administration — isolated verification

Local verification on 2 October 2026 (Europe/Rome), against the dedicated `codex/m1-training` checkout. No production database, survey response, real account, email, invitation, provider login or LLM call was used. The server uses the unchanged real session endpoint with Firebase Auth emulator tokens; the test-only Neon transport executes the real parameterized SQL against PostgreSQL 16 on loopback.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Final optimized Next build | PASS | `build-admin-final.log` |
| Lint and TypeScript | PASS | `lint-final.log`, `typecheck-final.log` |
| Existing regression suites | 109 PASS: auth 5, collaboration 4, readiness 44, portfolio 16, MCP 11, Slack 29 | Local test outputs; MCP and Slack logs retained |
| Learning tests | 72 pure tests PASS; 7 database tests skipped in the generic run, then 7/7 PASS in the isolated PostgreSQL run | `learning-unit.log`, `database-integration.log` |
| Admin HTTP security and lifecycle suite | 34 PASS, 0 FAIL | `admin-acceptance-production-latest.json` |
| Admin content isolation | PASS: two HTML pages, two RSC responses, 24 actual browser scripts; no private marker or `correct_option_ids` | `ADMIN-33` inside the admin receipt |
| Existing participant HTTP suite | 35 PASS, 0 FAIL | `regression/http-acceptance-production.json` |
| Participant content isolation | PASS: HTML, RSC and 23 actual browser scripts | `regression/client-scan-production.json` |
| Global feature flag off, existing routes and data integrity | 3 PASS | `regression/rollback-global-flag.json` |
| Admin catalog, detail and import while global flag is off | 3 PASS; unavailable JSON without redirect or caching | `admin-flagoff.json` |
| Concurrent learner/admin operations | 4 PASS, with four isolation-guard checks | [Concurrency reproduction](../../../scripts/learning-test/admin-concurrency.md) |
| Browser administration and participant journey | Reported separately; actual UI plus database receipt checks | [Browser evidence](admin-browser.md), `admin-browser-database-check.json` |
| Fifty concurrent participants after adding database locks | PASS locally: 400/400 requests; p95 autosave 96.6 ms, submit 164.9 ms, progress 295.8 ms; 50 immutable receipts and exactly 50 submission audits, retries equal; own fixtures cleaned | `load-production-results.json` |

Sanitized receipts, including the historical failures, are committed under [results/admin-20261002](results/admin-20261002). Raw logs remain local under `/private/tmp/unbundle-admin-evidence-20261002` and the ignored `learning-evidence-private/admin-20261002` in the delivered checkout. Earlier M1 evidence was preserved. The admin suite records source hashes, the current commit and whether the working tree was modified. A working-tree run is not represented as a tested final commit. The separate local `admin-verification.private.json` receipt binds those source hashes to the final commit and records the subsequent read-only smoke check.

## What the 34 HTTP checks exercise

The suite uses real HTTP requests to `/api/learning/admin`, the same JSON gateway used by the new administration UI. Every run creates independent synthetic workspaces and programs; it leaves the browser course and previous receipts untouched.

- Authentication, current workspace membership and effective-role precedence. Only the existing `exec_sponsor` and `transformation_lead` workspace/organization roles may bootstrap a new course. An organization membership takes precedence over a workspace membership.
- Missing/foreign Origin, forwarded-host spoofing, malformed JSON, unknown operations, unexpected envelope properties, media type and an oversized body are rejected. The request limit is 5 MB (5,000,000 bytes). Responses do not redirect or permit caching.
- Inspection exposes only safe pack metadata. Import creates immutable versioned content, sessions, one explicit management grant and one audit event atomically; the course starts disabled. Reimport is idempotent. Different content with an existing version conflicts; publishing a new version preserves the old pack.
- Workspace administrator status alone does not grant management or individual results for an existing course. Management does not imply review, aggregate or export. An explicit export-only grant exposes a reachable CSV control without granting the review page; its CSV contains only the authorized cohort, and revocation removes access.
- Workspace, program, session, enrollment and grant identifiers are checked together. Scoped managers see only their cohort's enrollments, grants, sessions and audit; cannot modify global course settings or lifecycle; cannot grant management or broader capabilities; cannot revoke another cohort's or global grants.
- Enrollment batches are atomic, require current members and reject duplicate UUID aliases. Repeated enrollment is idempotent. Moving is permitted before work and denied after either an attempt or an idea draft; revocation stops writes while preserving existing work.
- Removing a manager's workspace membership immediately denies reads and mutations. A grant held by a former member cannot satisfy the final-manager safeguard. Concurrent self-revocation by two managers leaves exactly one active unscoped manager.
- Course enable, disable, close and reopen, plus session open, closed and scheduled, control actual learner writes. M2/M3 sessions cannot be opened through this M1 administration surface. Draft identity survives allowed reopen/reactivation.
- Settings and mutations produce bounded safe audit DTOs. Purge requires an unscoped manager, exact course confirmation, closed/archived status and elapsed retention. Expiry is advanced only for the run's disposable fixture. Purge deletes only that program's attempts/idea drafts, preserves enrollment/audit and another program, and returns zero on repetition.

The SQL concurrency harness executes the actual DAL and guard with an explicitly synthetic identity adapter. Its PostgreSQL lock tests are distinct from the HTTP suite's real emulator/session authorization tests; neither is a production-provider claim.

## Failures found and retested

1. **Cross-cohort permission revocation — actual product failure.** The initial expanded development run had 30 PASS / 1 FAIL. A scoped manager could revoke another cohort's review grant because an inner SQL alias shadowed the target grant alias. The authority alias was made distinct. The regression now tests both another cohort and a global capability. The development retest passed 33/33; the final optimized run passed 34/34 including the added export-only UI path. The failing receipt remains `admin-acceptance-development-08fff0b2-153a-49fe-bc42-3dde27d5f6de.json`.
2. **Incorrect HTTP assertion in the first harness.** A protected server-rendered page was expected to return 404; Next's streamed error boundary can return HTTP 200 while omitting the protected content. That run was 28 PASS / 1 FAIL. The revised check enables the course and verifies the missing protected review content, absent implicit grants and rejected CSV access. This was a test expectation correction, not an authorization fix.
3. **Two development bootstrap aborts.** During concurrent compilation/HMR, `/api/auth/session` returned 500 with an internal Next JSON parse failure. Those invocations stopped before creating their suite fixtures or running checks. They remain in `admin-acceptance-development-second.log` and `admin-acceptance-development-fixed.log`. No retry was hidden inside assertions and no authentication code was changed. Optimized build/session/HTTP runs passed.
4. **Export-only navigation gap found in UI review.** An explicit export grant had a working server operation but no reachable control unless review was also granted. The program overview now exposes the existing CSV control for export-only users. `ADMIN-34` verifies the control, scoped output, absence of review access and revocation.
5. **Local sandbox restriction in the MCP suite.** The first execution could not bind a loopback port (`EPERM`). The approved isolated rerun passed all 11 checks. This was an environment block, not a hidden product failure.

## Reproduction and limits

Follow the isolated cluster, emulator and application setup in `scripts/learning-test/README.md`. The admin harness requires the original generic fixture manifest at `/private/tmp/unbundle-m1-evidence/synthetic-fixtures.json`. Set `LEARNING_TEST_OUTPUT` to a separate temporary directory, then run `scripts/learning-test/admin-acceptance.mjs --setup`. `--serve-login` provides the loopback-only browser helper on port 53102; no argument runs the acceptance suite. Set `LEARNING_TEST_RUNTIME=production` when testing the optimized application. Do not run dev and production simultaneously on port 53100.

The regression run used new synthetic workspace/program records and the already synthetic emulator users. No prior program, receipt or browser fixture was reset. No deployment or merge occurred. Local results do not verify provider sign-in UI, emailed invitations, deployed HTTPS behavior, Neon production transport, real infrastructure load, assistive technology, or an authorized remote preview. Those checks retain their separate blocked status until actually performed in an authorized environment.
