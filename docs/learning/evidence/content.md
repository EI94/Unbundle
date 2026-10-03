# Content, import boundary and deterministic grading evidence

Recorded 1 October 2026, 20:17 Europe/Rome. Branch `codex/m1-training`, starting commit `e63a2a719410af77982c85522dad6339975f869e`. These checks ran on the implementation working tree; the final delivery report must identify the resulting tested commit.

## Passed

- `node --no-warnings --test src/lib/learning/pack.test.ts`: **45 passed, 0 failed, 0 skipped**. Generic public fixtures only. Covers strict version/schema/reference validation; unknown and duplicate IDs; private-policy invariants; six session UTC conversions; invalid dates and DST gaps/ambiguity; allowlisted learner payload; 100 stable-order/grading permutations; thresholds and essential errors; incomplete/forged submissions; required reflection and mode; Unicode length; independent recovery and human-rubric essential gating.
- The supplied private package was read directly from a temporary directory outside the repository and passed the TypeScript import validator: **3 modules, 8 activities, 37 items**. No seed, key, prompt, question text, client name or answer was written into test evidence.
- Direct semantic checks of that package using the implemented TypeScript functions: **21 assertions passed**. All objective activities with correct answers; all-second-option submissions for completion gates; both future human rubrics with essential-error gating; all six session durations. The learner DTOs were also checked not to contain the corresponding private feedback text before submission.
- Supplied Python reference suite: **35 passed, 0 failed**. This independently checks the source content, corrected negative/positive route case, synthetic accounting data, dates, three platform windows, references and deterministic scoring. It is a content/reference check, not application security evidence.
- `npx eslint src/lib/learning/pack.ts src/lib/learning/grading.ts src/lib/learning/types.ts src/lib/learning/pack.test.ts src/lib/learning/test-fixture.ts`: passed.
- `npx tsc --noEmit --pretty false`: passed at the time of these checks. Other agents continued integration work afterward; final validation must rerun this command on the delivery commit.

## Reproduce private import validation without copying the package

Set `LEARNING_PRIVATE_PACK` to the authorized external private JSON file, then run from the repository:

```sh
node --no-warnings --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { parseTrainingPack } from './src/lib/learning/pack.ts';
const pack = parseTrainingPack(JSON.parse(readFileSync(process.env.LEARNING_PRIVATE_PACK, 'utf8')));
console.log({ status: 'PASS', modules: pack.modules.length, activities: pack.activities.length, items: pack.items.length });
JS
```

This command does not contact a database, publish content, or output private content.

## Not proven by these checks

Auth, workspace/role/object isolation, persisted concurrency, atomic submission, browser HTML/RSC/bundle disclosure, actual reviewer access, availability, backups and rollback require the separate application integration evidence. Passing these unit/content checks alone does not make M1 ready for the classroom.

## Exact private package · local HTTP integration

Recorded 1 October 2026, 20:55 Europe/Rome. **11 checks PASS, 0 final failures** on the optimized local application. Run ID: `6a0c3f67-6ebf-4e3b-b0e8-dc13b0534d7c`.

The external private file was imported through the real administrative CLI into a new synthetic workspace, assigned to two synthetic learners, opened explicitly for testing and exercised through the real session endpoint and Server Actions. Activity IDs verified: `m1-check`, `m1-case` (individual decisions, then reflection and declared mode), `m1-exit-a`, `m1-exit-b`. Scoped reviewer access and persisted history/audit were checked. Cleanup: **PASS**, including the temporary private program and synthetic DB/Auth accounts.

| Cohort ID | Local start | Local end | Timezone |
| --- | --- | --- | --- |
| `m1-a` | 2026-10-05 14:30 | 2026-10-05 16:30 | Europe/Rome |
| `m1-b` | 2026-10-07 10:00 | 2026-10-07 12:00 | Europe/Rome |

File SHA-256: `609837c3c10f94155ab973a6b3c71eb9625f9e9a198715e317aa365515a3dc8d`. Validated package hash: `94bca525d4784a30136f5f82bbf6579aa7d795179129ecf3b94acb4918f9cfdb`.

No package contents, client names, individual answers, solution text or credentials were copied into Git evidence. The private harness and historical sanitized execution record remain outside Git at `/private/tmp/unbundle-m1-evidence/private-pack-http.mjs` and `private-pack-http-server-actions-results.json`. Two preliminary harness assertions were corrected before the final run: JSONB object-key ordering and the presence of an opaque route ID in a denied page's framework payload. Neither correction changed application code or weakened the check for private feedback disclosure. This is local integration evidence, not an authorized production publish or a verified participant URL for the real environment.

## Exact private package · final JSON gateway

Repeated 1 October 2026, 21:22 Europe/Rome, after the final local build: **11 checks PASS, 0 failures**. Run ID `64c056d2-3dd4-4e0e-bbdc-4b4a59c982a3`. The same exact external file and validated-package hashes above were used. All mutations crossed the real same-origin `POST /api/learning` endpoint with genuine emulator session cookies; the prior Server Actions result is preserved separately.

The checks cover real CLI import/enable/enrollment/cohort grant/opening; both M1 calendar replicas; private-bank redaction before submission; checkpoint scoring; the case's decision lock before revealing its example; reflection and declared mode; exit A with an essential error; independent recovery B preserving A; submitted evidence with cohort-scoped review; and complete atomic persisted history/audit. Both dates remain 5 October 2026 14:30 and 7 October 2026 10:00 in `Europe/Rome`.

Cleanup **PASS**: the temporary private program and all DB/Auth fixtures created by this run were removed. The sanitized result is preserved outside Git at `/private/tmp/unbundle-m1-evidence/private-pack-json-precommit-results.json`. This proves the local final JSON transport with the supplied content; it does not verify deployment, production accounts, or an authorized real participant URL.
