import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le server action sono endpoint POST raggiungibili direttamente: il controllo
 * di accesso del layout del dashboard non le copre. Quattro superfici sono
 * state trovate scoperte in produzione (intelligence, blueprints,
 * pre-generate-activities, documents/upload) e una quinta in portfolio: ogni
 * utente registrato poteva leggere e scrivere nel workspace di un altro
 * cliente.
 *
 * Chiudere quei casi non impedisce al prossimo di ricomparire, perche' il
 * difetto e' un controllo MANCANTE e un controllo mancante non lascia tracce
 * nel codice. Questo test quindi non verifica un comportamento: verifica la
 * REGOLA. Scandisce i sorgenti e fallisce se una funzione esportata accetta un
 * workspaceId dall'esterno senza passare da una guardia.
 *
 * Se aggiungi una action legittima che non deve essere protetta (perche' usa un
 * token pubblico, per esempio), aggiungila a PUBLIC_BY_DESIGN con il motivo.
 */

const ACTIONS_DIR = "src/lib/actions";

/**
 * Guardie che verificano l'accesso al workspace, non solo la sessione.
 * `getUserMembership` vale perche' risolve l'appartenenza all'organizzazione
 * del workspace, che e' l'altra strada legittima per avere accesso.
 */
const GUARDS = [
  "requireWorkspaceAccess",
  "getWorkspaceAccessForUser",
  "getUserMembership",
  "assertAssessmentManager",
  "assertAssessmentReviewer",
  "assertWorkspaceInviteManager",
  "assertWorkspaceIntegrationManager",
];

/**
 * Action che accettano un workspaceId ma sono pubbliche per disegno: l'accesso
 * e' autorizzato da un token non indovinabile, non dalla sessione.
 */
const PUBLIC_BY_DESIGN = new Map<string, string>([
  [
    "startOpenSurveyAction",
    "link pubblico della survey: l'autorizzazione e' il token, non la sessione",
  ],
  [
    "saveAiReadinessSurveyDraftAction",
    "compilazione da token personale del rispondente",
  ],
  [
    "submitAiReadinessResponseAction",
    "consegna da token personale del rispondente",
  ],
  [
    "submitUseCaseExpertCaseAction",
    "modulo use case da token personale dell'esperto",
  ],
  [
    "finishUseCaseExpertAction",
    "chiusura modulo use case da token personale dell'esperto",
  ],
  [
    "withdrawAiReadinessBenchmarkConsentAction",
    "portale privacy del rispondente, autorizzato dal suo token",
  ],
  [
    "anonymizeAiReadinessRespondentAction",
    "portale privacy del rispondente, autorizzato dal suo token",
  ],
]);

function actionFiles() {
  return readdirSync(ACTIONS_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name, source: readFileSync(join(ACTIONS_DIR, name), "utf8") }));
}

/** Corpo di ogni funzione esportata, spezzato sul prossimo `export`. */
function exportedFunctions(source: string) {
  const parts = source.split(/\nexport (?:async )?function /g).slice(1);
  return parts.map((part) => {
    const name = part.slice(0, part.search(/[\s(<]/));
    return { name, body: part };
  });
}

function takesWorkspaceId(body: string) {
  const signature = body.slice(0, body.indexOf("{"));
  return /workspaceId\s*:\s*string/.test(signature);
}

test("ogni action che riceve un workspaceId verifica l'accesso a quel workspace", () => {
  const unguarded: string[] = [];

  for (const file of actionFiles()) {
    for (const fn of exportedFunctions(file.source)) {
      if (!takesWorkspaceId(fn.body)) continue;
      if (PUBLIC_BY_DESIGN.has(fn.name)) continue;
      if (GUARDS.some((guard) => fn.body.includes(guard))) continue;
      unguarded.push(`${file.name}: ${fn.name}`);
    }
  }

  assert.deepEqual(
    unguarded,
    [],
    `Action senza verifica di accesso al workspace:\n  ${unguarded.join("\n  ")}\n\n` +
      "Aggiungi `await requireWorkspaceAccess(workspaceId)` in testa, " +
      "oppure registrala in PUBLIC_BY_DESIGN se e' autorizzata da un token."
  );
});

test("requireSession da solo non e' accettato come guardia di workspace", () => {
  // requireSession prova soltanto che qualcuno e' loggato: e' esattamente
  // l'errore che ha lasciato aperte quattro superfici. Non deve finire fra le
  // guardie valide per distrazione.
  assert.equal(GUARDS.includes("requireSession"), false);
  assert.equal(GUARDS.includes("auth"), false);
});

test("le superfici trovate scoperte restano protette", () => {
  const expected: Array<[string, string]> = [
    ["intelligence.ts", "generateCompetitiveAnalysis"],
    ["intelligence.ts", "markAllSignalsRead"],
    ["intelligence.ts", "markSignalAsRead"],
    ["blueprints.ts", "generateBlueprintsAction"],
    ["blueprints.ts", "getLatestBlueprints"],
    ["pre-generate-activities.ts", "preGenerateActivitiesFromDocuments"],
    ["pre-generate-activities.ts", "confirmPreGeneratedActivities"],
    ["portfolio.ts", "markSignalReadAction"],
    ["simulation.ts", "getLatestSimulation"],
  ];

  for (const [fileName, fnName] of expected) {
    const source = readFileSync(join(ACTIONS_DIR, fileName), "utf8");
    const fn = exportedFunctions(source).find((item) => item.name === fnName);
    assert.ok(fn, `${fileName}: ${fnName} non trovata — e' stata rinominata?`);
    assert.ok(
      GUARDS.some((guard) => fn.body.includes(guard)),
      `${fileName}: ${fnName} ha perso la verifica di accesso al workspace`
    );
  }
});

/** Via i commenti: altrimenti una spiegazione del difetto passa per il difetto. */
function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("i documenti caricati non finiscono su un blob pubblico", () => {
  const route = withoutComments(
    readFileSync("src/app/api/documents/upload/route.ts", "utf8")
  );
  assert.ok(
    route.includes('access: "private"'),
    "il blob dei documenti deve essere privato: contiene materiale interno dei clienti"
  );
  assert.equal(
    route.includes('access: "public"'),
    false,
    'rimasto un access: "public" nella route di upload'
  );
  assert.ok(
    route.includes("getWorkspaceAccessForUser"),
    "la route di upload deve verificare l'accesso al workspace, non solo la sessione"
  );
});

test("un secret Slack mancante viene rifiutato in produzione", () => {
  // La verifica della firma e' saltata solo fuori produzione, dove serve a far
  // girare il webhook in locale. In produzione un secret assente deve chiudere
  // la porta, non aprirla: questo test protegge quel ramo.
  const source = withoutComments(
    readFileSync("src/lib/slack/slack-webhook-post.ts", "utf8")
  );
  assert.ok(
    /NODE_ENV\s*===\s*"production"/.test(source),
    "manca il ramo che rifiuta le richieste quando SLACK_SIGNING_SECRET non e' configurato in produzione"
  );
  assert.ok(
    source.includes("verifySlackRequestSignature"),
    "la firma delle richieste Slack deve essere verificata"
  );
});
