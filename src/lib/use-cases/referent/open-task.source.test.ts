import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Rilascio 5 (§5.2, §5.4) sul sorgente: dove si conta «aperto» per una richiesta e dove per una domanda,
// ognuno con la sua decisione; e ogni scrittura che toglie una risposta toglie anche il commento.

const root = fileURLToPath(new URL("../../../..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
const files = [...sources("src"), ...sources("scripts")].map((f) => relative(root, join(root, f)));
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** Le righe di `file` che contengono `needle`, con il loro numero (per un messaggio leggibile). */
function hits(needle: RegExp): string[] {
  const out: string[] = [];
  for (const file of files) {
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (needle.test(line)) out.push(`${file}:${i + 1}`);
    });
  }
  return out;
}

/**
 * Le chiamate a `openItemsCountSql` (le cose aperte di una richiesta, con la conferma da inviare: §5.2)
 * e la decisione per ognuna. Tutte a livello di richiesta: contano la conferma.
 */
const OPEN_TASK_CALLS: Record<string, string> = {
  "src/lib/use-cases/referent/sql.ts": "completeHandledRequestsStatements: le risposte del team non completano una richiesta il cui referente deve ancora confermare",
  "src/lib/db/queries/use-case-notifications.ts": "l'avviso a chi ha chiesto «Nessuna risposta» vale finché qualcosa è aperto, anche la sola conferma",
  "src/lib/db/queries/use-case-referents.ts": "pannello, «Chiedi di nuovo», lettura della richiesta, cron «senza più domande aperte», promemoria",
  "src/lib/db/queries/use-case-referent-dispatch.ts": "le email: i promemoria partono anche senza domande; le parole usano openQuestionsOf (meno la conferma)",
  "src/lib/db/queries/use-case-referent-public.ts": "l'invio delle risposte completa la richiesta solo con niente di aperto, e lo stato dopo l'invio",
  "src/lib/db/queries/use-case-referent-states.ts": "(rilascio 5) lo stato del referente sulle card: «In attesa» e «Nessuna risposta» finché qualcosa è aperto, anche la sola conferma",
  "src/lib/db/queries/use-case-referent-thread.ts": "(rilascio 6) la risposta del referente all'ultimo chiarimento completa la richiesta solo con niente di aperto",
};

/** Le domande aperte una per una (`openItemSql` o `state = 'aperta'` in linea): per domanda, mai la conferma. */
const OPEN_ITEM_CALLS: Record<string, string> = {
  "src/lib/use-cases/referent/sql.ts": "la definizione, la revoca (le domande tornano da chiedere) e la scadenza («Nessuna risposta» con domande o la conferma)",
  "src/lib/db/queries/use-case-referents.ts": "la guardia delle «Senza risposta» e le domande portate da una richiesta revocata",
  "src/lib/db/queries/use-case-referent-files.ts": "il caricamento di un file su una domanda aperta",
  "src/lib/db/queries/use-case-referent-public.ts": "la vista, la bozza e l'invio di una domanda",
};

test("openItemsCountSql: ogni file che lo usa ha la sua decisione (conta la conferma)", () => {
  const using = [...new Set(hits(/openItemsCountSql\(/).map((h) => h.split(":")[0]))].sort();
  assert.deepEqual(using, Object.keys(OPEN_TASK_CALLS).sort());
});

test("openItemSql e «state = 'aperta'» in linea: ogni file ha la sua decisione (per domanda)", () => {
  const using = [...new Set([...hits(/openItemSql\(/), ...hits(/\b\w+\.state = 'aperta'/)].map((h) => h.split(":")[0]))]
    .filter((f) => !f.startsWith("src/lib/db/use-case-hub-referents-ddl.ts"))
    .sort();
  assert.deepEqual(using, Object.keys(OPEN_ITEM_CALLS).sort());
});

test("openItemsCountSql conta la conferma da inviare e (rilascio 6) i chiarimenti in attesa; openQuestionsCountSql solo le domande", () => {
  const sql = read("src/lib/use-cases/referent/sql.ts");
  assert.match(
    sql,
    /export function openItemsCountSql\(request: string\): SqlFragment \{\s+return ucSql`\(\$\{openQuestionsCountSql\(request\)\} \+ \$\{checkPendingCountSql\(request\)\} \+ \$\{openClarificationsCountSql\(request\)\}\)`;/,
  );
  assert.match(sql, /use_case_referent_messages om WHERE om\.request_id = \$\{request\}\.id AND om\.side = 'team' AND om\.kind = 'chiarimento'\s+AND om\.handled_at IS NULL AND om\.removed_at IS NULL/);
  assert.match(sql, /use_case_referent_checks oc WHERE oc\.request_id = \$\{request\}\.id AND oc\.submitted_at IS NULL/);
  // La scadenza: «Nessuna risposta» anche per una richiesta al referente senza domande.
  assert.match(sql, /OR EXISTS \(SELECT 1 FROM use_case_referent_checks c WHERE c\.request_id = r\.id AND c\.submitted_at IS NULL\)\)`;/);
});

test("ogni UPDATE che toglie una risposta (removed_at) toglie anche il commento", () => {
  const bad: string[] = [];
  for (const file of files) {
    const text = read(file);
    for (const m of text.matchAll(/UPDATE use_case_need_answers[\s\S]*?(?:WHERE|`)/g)) {
      if (/removed_at\s*=/.test(m[0]) && !/comment\s*=\s*NULL/.test(m[0])) bad.push(`${file}: ${m[0].slice(0, 80).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(bad, []);
});
