# Isolated local Learning verification

This harness uses a **new, disposable PostgreSQL database** and the installed Firebase Auth emulator. It does not read the production `.env`, deploy, send invitations or call an LLM. Run it from a checkout without `.env*` files: Next loads those files independently of the process environment.

Prerequisites already available in the audited machine: PostgreSQL 16 binaries, Node, project dependencies (including transitive `pg`), and Firebase CLI 14.15.1. No new package was installed for this harness. `pg` is a test transport dependency currently provided by the repository's installed dependency tree; pin it explicitly if moving this harness into CI.

1. Initialize a fresh cluster under a temporary path, with user `learning_test`, local trust authentication and port `55439`, listening **only** on `127.0.0.1`.
2. Create the database `unbundle_learning_test`; apply existing SQL migrations in order, then `drizzle/0012_learning.sql` twice. Do not point these steps at any existing database.
3. Set `FIREBASE_TOOLS_ROOT` to the installed `firebase-tools` package directory, then run `node scripts/learning-test/start-auth.mjs`. It listens only on `127.0.0.1:59099` and uses project `demo-unbundle-learning`.
4. Run `node scripts/learning-test/start-app.mjs` from this checkout. It starts Next on `http://127.0.0.1:53100`, generates an ephemeral dummy Firebase service-account key in memory and enables the Auth emulator. There are no real provider credentials.

Use `node scripts/learning-test/start-app.mjs --build` for the actual production build, then `--production` instead of the dev server to run that build with the same isolated services and environment. Stop dev before starting production on the same port. Next's standard production session cookie is marked Secure; HTTP scripts send the received cookie explicitly on loopback, so this does not test HTTPS cookie delivery in a deployed browser.

`start-app.mjs --disabled` starts the same optimized build on loopback port 53103 with the global Learning flag off. `rollback.mjs` verifies existing routes, rejected Learning actions and before/after data digests for both synthetic workspaces. `rollback.mjs --baseline` instead probes a separately built previous application revision on port 53104 with the same isolated environment and additive database schema retained; it never changes application revisions itself. In the recorded audit, the archived baseline e63a2a719410af77982c85522dad6339975f869e was started with a temporary copy of the environment launcher targeting port 53104 and the same local-only SQL adapter.

Set `LEARNING_TEST_OUTPUT` to a temporary directory outside Git and run `node --no-warnings scripts/learning-test/seed.mjs` once. It creates generic operational-ID fixtures and saves the synthetic account manifest outside the checkout. Start `browser-login.mjs` with the same variable; its local `/as/learner-a` and `/as/reviewer-a` routes exchange a real emulator ID token at the existing session endpoint and redirect the browser. This helper must never be deployed.

Run `http-acceptance.mjs`, `client-scan.mjs`, `retention-acceptance.mjs` and `backup-restore.mjs` with the same output variable. The HTTP suite creates a new synthetic learner per run to preserve earlier submissions and calls the same `/api/learning` JSON gateway used by the browser; the gateway reuses existing Learning action validation and authorization. Retention uses separate fixture programs; backup uses an exported transaction snapshot and restores into a new local database. Set `LEARNING_TEST_RUNTIME=production` for HTTP acceptance and client scan against the production server; results are saved separately from development. Earlier direct Server Action results are retained as historical evidence outside Git.

`local-neon.cjs` is a process preload used **only by this harness**. It receives the real Neon HTTP request's SQL and parameters and executes them using `pg` against the exact allowed local database. PostgreSQL constraints, locks and transaction semantics are real; no authorization, query result or score is mocked. The production database module remains unchanged. This adapter is not a claim that the Neon HTTP production transport has been load-tested.

For bounded browser fault tests, the launcher sets `LEARNING_TEST_ISOLATED=true`. Only then does the adapter read the optional fixed file `/private/tmp/unbundle-m1-evidence/transport-control.json`. A `delay-ack` control selects one synthetic attempt UUID, delays its real successful draft update acknowledgement by at most 10000 ms **after the database commit**, consumes the control once and writes a marker without query text or response content. The control expires after 60 seconds. An `unavailable` control rejects the local database transport for `durationMs` of at most 60000; removing the file resets it immediately. Missing, malformed and expired controls have no effect. This mechanism never changes production application code and must not be enabled outside the isolated test harness.

Firebase ID tokens obtained from the emulator must be exchanged through the application's real `POST /api/auth/session` endpoint. Tests must not forge a user header or bypass `auth()`. The unchanged Firebase browser client has no emulator connection: local session endpoint tests and a browser with that genuine session cookie do **not** prove Google/email login UI. Mark that portion separately until tested on an authorized preview.

Use physical installed dependencies in the isolated checkout. An external `node_modules` symlink caused Turbopack root rejection and duplicated request-scope internals during the audit; a local filesystem clone resolved it without changing any application dependencies. Next also replaces `globalThis.fetch` during startup/HMR; the test preload preserves its loopback SQL transport around those wrappers.

Keep session cookies and tokens in temporary files outside Git. Save sanitized results, URLs without tokens, screenshots of synthetic users and direct DB assertions as evidence. At the end stop the app, Auth emulator and PostgreSQL cluster; do not remove records in any other database.


## UX refinements: concurrency and truthful availability

Run `ux-fixture.mjs --setup` once with `LEARNING_TEST_ISOLATED=true` and `LEARNING_TEST_OUTPUT` pointing to a new temporary directory. It creates its own generic browser accounts, workspaces, courses and explicit grants using only the local Auth emulator and PostgreSQL database above. It does not read earlier fixture directories, environment files, customer packs or backups. Its private manifest contains emulator-only credentials and stays outside Git.

Run `ux-fixture.mjs --serve-login` with the same variables to start the authentication-only helper on `127.0.0.1:53102`. Supported examples are `/as/learner?view=activity`, `/as/learner?view=ideas`, `/as/admin?view=admin`, `/as/admin-second?view=admin` and `/as/reviewer?view=review`. The handler exchanges an emulator token at the application's real session endpoint and redirects to an allowlisted page; it never changes memberships, grants or course configuration. The browser fixture is separate from every automated run.

Run `node --no-warnings scripts/learning-test/ux-acceptance.mjs` with those same isolation/output variables. It creates a new fixture namespace each time, so browser drafts and previous receipts remain intact. Add `LEARNING_TEST_RUNTIME=production` only when the running local app uses the optimized build. It verifies:

- settings compare-and-swap for stale and simultaneous managers, with one winning update and one audit;
- no false settings conflicts after unrelated session/grant changes, and unchanged actor/tenant/cohort authorization;
- actual suspension while a learner save waits on a PostgreSQL lock;
- future activity pages without questions, read-only closed drafts, historical feedback and blocked retakes;
- revision conflicts, same-key double submission, recovery history, answer-bank privacy and suppressed aggregates.

The test uses real JSON requests, Firebase session exchange and SQL constraints through the test-only Neon adapter. It inspects serialized React props where necessary; it does not claim browser navigation, dirty-form dialogs, offline behavior, mobile layout or downloads from HTTP alone. Results include source hashes and separate PASS/FAIL counts. Keep failed runs as evidence when correcting the harness. The existing learner suite now signs in directly through the emulator/session endpoint and does not depend on this helper's account names. The existing admin suite uses the selected output directory's `synthetic-fixtures.json` and includes the required settings baseline.

Never run these helpers in a deployed environment. Stop only the recorded test processes after browser and HTTP verification; preserve the temporary data and receipts until the review is complete.
