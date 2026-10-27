import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Ruoli che si sovrappongono (SPEC Parte 3, §P3.8): le aree di Unbundle restano separate.
// - «Chiedi al referente», la campanella e «Raccolta informazioni» non leggono mai i corsi (iscrizioni,
//   avanzamento, tentativi, risultati): nessuna tabella `learning_*`, nessun modulo della Formazione.
// - La Formazione non legge mai referenti, richieste, risposte o notifiche degli use case.
// - La pagina pubblica `/rispondi/<token>` non dipende dalla sessione: il proxy non la tocca, e le sue
//   rotte non leggono la sessione, non rimandano alla dashboard e non chiedono di accedere.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SOURCE = /\.(ts|tsx|mjs|js|cjs)$/;
const TEST_FILE = /\.test\.(ts|tsx|mjs|js|cjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) {
    if (SOURCE.test(dir) && !TEST_FILE.test(dir)) out.push(dir);
    return out;
  }
  for (const entry of readdirSync(abs)) walk(`${dir}/${entry}`, out);
  return out;
}
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** I moduli dell'area che leggono o mostrano referenti, richieste, notifiche e avanzamento. */
const HUB_FILES = [
  "src/lib/use-cases/referent",
  "src/lib/use-cases/info-progress.ts",
  "src/lib/use-cases/notices.ts",
  "src/lib/notifications",
  "src/lib/actions/use-case-referents.ts",
  "src/lib/actions/notifications.ts",
  "src/lib/db/queries/bell-state.ts",
  "src/lib/db/queries/use-case-notifications.ts",
  "src/lib/db/queries/use-case-info-progress.ts",
  "src/app/api/cron/use-case-referents",
  "src/app/api/workspaces/[workspaceId]/bell",
  "src/app/rispondi",
  "src/app/api/rispondi",
  "src/components/use-cases",
  "src/components/portfolio/notifications-bell.tsx",
  "src/components/portfolio/workspace-topbar.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases",
].flatMap((p) => walk(p));
const HUB_FILES_QUERIES = readdirSync(join(ROOT, "src/lib/db/queries"))
  .filter((f) => /^use-case-referent[^/]*\.ts$/.test(f) && !TEST_FILE.test(f))
  .map((f) => `src/lib/db/queries/${f}`);

/** La Formazione. */
const COURSE_FILES = ["src/lib/learning", "src/components/learning", "src/app/(dashboard)/dashboard/[workspaceId]/learning", "src/app/api/learning"].flatMap((p) => walk(p));

const COURSE_REFERENCE = /learning_[a-z_]+|@\/lib\/learning\b|from\s+["'][./]*learning\/|learningEnrollments|learningAttempts|learningPrograms/;
const REFERENT_REFERENCE = /use_case_referent|use_case_need_answers|use_case_need_files|use_case_notifications|use_case_requester_emails|uc_contacts|use-cases\/referent|use-case-referent|use-case-notifications|use-case-info-progress|notifications\/bell/;

test("l'area dei referenti non legge mai i corsi", () => {
  const files = [...HUB_FILES, ...HUB_FILES_QUERIES];
  assert.ok(files.includes("src/lib/use-cases/referent/people.ts"), "il controllo trova i moduli della Parte 3");
  assert.ok(files.includes("src/lib/db/queries/use-case-referent-base.ts"));
  const bad = files.filter((f) => COURSE_REFERENCE.test(read(f)));
  assert.deepEqual(bad, [], "nessun dato o modulo della Formazione nei moduli di «Chiedi al referente», della campanella e dell'avanzamento");
});

test("la Formazione non legge mai referenti, richieste, risposte o notifiche degli use case", () => {
  assert.ok(COURSE_FILES.length > 0, "il controllo trova i file della Formazione");
  const bad = COURSE_FILES.filter((f) => REFERENT_REFERENCE.test(read(f)));
  assert.deepEqual(bad, []);
});

test("prova dei controlli", () => {
  assert.ok(COURSE_REFERENCE.test("SELECT 1 FROM learning_enrollments"));
  assert.ok(COURSE_REFERENCE.test('import { x } from "@/lib/learning/schema"'));
  assert.equal(COURSE_REFERENCE.test("// la Formazione resta separata"), false);
  assert.ok(REFERENT_REFERENCE.test("FROM use_case_referent_requests"));
  assert.ok(REFERENT_REFERENCE.test('from "@/lib/db/queries/use-case-notifications"'));
});

test("la pagina pubblica non dipende dalla sessione", () => {
  const proxy = read("src/proxy.ts");
  const matcher = /matcher:\s*\[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
  assert.ok(matcher.includes("/dashboard/:path*"), "il proxy ha ancora il suo matcher");
  assert.doesNotMatch(matcher, /rispondi|\/:path\*"\s*,\s*"\/"|"\/\(\.\*\)"/, "il proxy non tocca /rispondi");
  const publicFiles = [...walk("src/app/rispondi"), ...walk("src/app/api/rispondi")];
  const SESSION = /@\/lib\/auth\b|\bauth\(\)|getServerSession|requireSession|getCollaboratorAccess|requireWorkspaceAccess|\bredirect\(|\/login\b|\/dashboard\b/;
  const bad = publicFiles.filter((f) => SESSION.test(read(f)));
  assert.deepEqual(bad, [], "le rotte pubbliche non leggono la sessione e non rimandano alla dashboard o al login");
  // Il modulo che le rotte pubbliche importano non legge la sessione.
  assert.doesNotMatch(read("src/lib/db/queries/use-case-referent-public.ts"), SESSION);
});
