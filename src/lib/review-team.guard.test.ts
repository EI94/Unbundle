import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REVIEW_TEAM_NAME } from "./review-team.ts";

// Guardia del nome del team che valuta (docs/use-case/DESIGN.md §14.2, decisione D2;
// PIANO-LAVORI H3e). In tutto `src/**`:
// 1. nessun ripiego scritto a mano dopo `aiTransformationTeamName` (`|| "AI Transformation"`
//    e simili): il nome passa da `reviewTeamName()` di `src/lib/review-team.ts`;
// 2. il valore predefinito sta solo nella costante: nessun altro letterale e nessun
//    segnaposto lo ripete (anche questo file usa la costante, mai il suo testo);
// 3. nessun articolo né «team» davanti al nome nei testi («Il {teamName}», «team ${…}»,
//    «in coda al team …»): il nome può essere «CoE AI» o «Digital Factory». Il nome si
//    riconosce anche come campo (`params.teamName`) o con l'alias `team`; nei file di H3e
//    in più la ricerca semplice di «team ${» e «Il {teamName}», qualunque sia la variabile.
// SEO, prompt e AI Readiness usano «AI Transformation» come categoria e restano.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = "src/lib/review-team.ts";
/** Questo file: contiene di proposito gli esempi sbagliati che la guardia deve trovare. */
const SELF = "src/lib/review-team.guard.test.ts";

/** I file di H3e che mostrano il nome del team: lo leggono tutti con `reviewTeamName()`. */
const NAMING_FILES = [
  "src/lib/portfolio/external-submission.ts",
  "src/lib/notifications/portfolio-dispatch.ts",
  "src/lib/slack/notifications.ts",
  "src/lib/slack/use-case-agent.ts",
  "src/app/(dashboard)/dashboard/[workspaceId]/portfolio/page.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/portfolio/submit/page.tsx",
] as const;
/** La pagina di condivisione non nomina più il team (D14, H2e): nessuna lettura del nome. */
const SHARE_PAGE = "src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(entry.name)) out.push(relative(repoRoot, path).split(sep).join("/"));
  }
  return out;
}

const files = sourceFiles(join(repoRoot, "src")).filter((file) => file !== SELF);
const read = (file: string) => readFileSync(join(repoRoot, file), "utf8");

/** Riga (da 1) di un indice nel testo. */
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

// ─── 1. Ripiego scritto a mano ───────────────────────────────────────

/**
 * `aiTransformationTeamName` seguito, nella stessa istruzione, da `||` o `??` e da un
 * letterale non vuoto. `?? ""` (valore iniziale di un campo del modulo) resta ammesso.
 */
const HAND_WRITTEN_FALLBACK = /\baiTransformationTeamName\b[^;]{0,60}?(?:\|\||\?\?)\s*(["'`])(?!\1)/g;

function handWrittenFallbacks(text: string): number[] {
  return [...text.matchAll(HAND_WRITTEN_FALLBACK)].map((match) => lineOf(text, match.index ?? 0));
}

test("la guardia riconosce il ripiego scritto a mano", () => {
  const value = JSON.stringify(DEFAULT_REVIEW_TEAM_NAME);
  for (const bad of [
    `const teamName =\n    workspace.aiTransformationTeamName?.trim() || "AI Transformation";`,
    `workspace?.aiTransformationTeamName?.trim() ||\n  'AI Transformation'`,
    `w.aiTransformationTeamName ?? ${value}`,
    "ws.aiTransformationTeamName || `AI Transformation`",
  ]) {
    assert.equal(handWrittenFallbacks(bad).length, 1, bad);
  }
  for (const good of [
    `initialTeamName={workspace.aiTransformationTeamName ?? ""}`,
    "aiTransformationTeamName: reviewTeamName(workspace),",
    `<Input name="aiTransformationTeamName" placeholder="es. CoE AI, Digital Factory…" />`,
    `const raw = formString(formData, "aiTransformationTeamName");\nupdate(id, raw || null);`,
  ]) {
    assert.deepEqual(handWrittenFallbacks(good), [], good);
  }
});

test("nessun ripiego scritto a mano dopo aiTransformationTeamName fuori da review-team.ts", () => {
  const found = files
    .filter((file) => file !== HOME)
    .flatMap((file) => handWrittenFallbacks(read(file)).map((line) => `${file}:${line}`));
  assert.deepEqual(found, [], "il nome del team passa da reviewTeamName() di src/lib/review-team.ts");
});

// ─── 2. Il valore sta solo nella costante ────────────────────────────

const ESCAPED_VALUE = DEFAULT_REVIEW_TEAM_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Il valore come parole intere: «AI Builders» (un nome di prova di un workspace) è un'altra cosa. */
const VALUE_WORDS = new RegExp(String.raw`(?<![\p{L}\p{N}])${ESCAPED_VALUE}(?![\p{L}\p{N}])`, "gu");
/** Il ruolo «AI Builder del cliente» (DESIGN §6, D3): un revisore, non il nome del team. */
const ROLE_AFTER = " del cliente";
/** Un letterale tra virgolette, apici o backtick, su una riga. */
const QUOTED = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

type KnownValueText = { file: string; text: string; why: string };

/**
 * Testi che contengono il valore in file di altri pacchetti (scripts/use-case-test/ownership.json):
 * H3e non li può cambiare. Ogni voce copre il testo esatto una volta sola, nel suo file: una
 * seconda copia dello stesso testo fallisce. Una voce il cui testo non c'è più fallisce anche
 * lei («ogni voce di KNOWN_VALUE_TEXTS copre un testo che c'è»): chi corregge il file toglie
 * la voce, e l'eccezione non resta aperta.
 */
const KNOWN_VALUE_TEXTS: ReadonlyArray<KnownValueText> = [
  {
    file: "src/lib/use-cases/reads.integration.test.ts",
    text: `Persona di prova ${DEFAULT_REVIEW_TEAM_NAME}`,
    why: "H2b: la persona di prova del ruolo «… del cliente», non il nome del team",
  },
  {
    file: "src/lib/use-cases/copy-guard.test.ts",
    text: `La valuta ${DEFAULT_REVIEW_TEAM_NAME}: qui vedi come va.`,
    why: "H2d (proprietario di copy-guard.test.ts): la frase di §5.3 con il nome scritto a mano; va interpolata la costante, poi questa voce si toglie",
  },
];

/** I commenti diventano spazi (stesse righe): bastano quelli a blocco e quelli dopo `//` a inizio riga o dopo uno spazio. */
function blankComments(text: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?:^|(?<=[ \t]))\/\/.*$/gm, blank);
}

/**
 * Le righe dove il valore è scritto a mano, fuori dai commenti e dal ruolo «… del cliente».
 * Nei file di produzione ovunque (stringhe, template, testo JSX, segnaposto); nei test solo
 * nei letterali, perché lì `/…/` e i nomi di prova non sono testi dell'interfaccia.
 */
function valueCopies(file: string, text: string, knownTexts: ReadonlyArray<KnownValueText> = KNOWN_VALUE_TEXTS): number[] {
  const plain = blankComments(text);
  const spans: Array<{ start: number; body: string }> = /\.test\.[cm]?[jt]sx?$/.test(file)
    ? [...plain.matchAll(QUOTED)].map((match) => ({ start: (match.index ?? 0) + 1, body: match[2] }))
    : [{ start: 0, body: plain }];
  const known = knownTexts.filter((entry) => entry.file === file).map((entry) => entry.text);
  /** Per ogni voce, dove sta (nel file) la sola copia che copre: la prima trovata. */
  const covered = new Map<number, number>();
  const lines: number[] = [];
  for (const { start, body } of spans) {
    for (const match of body.matchAll(VALUE_WORDS)) {
      const index = match.index ?? 0;
      if (body.startsWith(ROLE_AFTER, index + match[0].length)) continue;
      const inKnown = known.some((entry, which) => {
        const at = body.lastIndexOf(entry, index);
        if (at === -1 || index >= at + entry.length) return false;
        const copy = covered.get(which) ?? start + at;
        covered.set(which, copy);
        return copy === start + at;
      });
      if (!inKnown) lines.push(lineOf(text, start + index));
    }
  }
  return lines;
}

test("la guardia riconosce il valore scritto a mano", () => {
  const value = DEFAULT_REVIEW_TEAM_NAME;
  for (const [file, bad] of [
    ["x.test.ts", `assert.equal(reviewTeamName(null), "${value}");`],
    ["x.test.ts", `const ok = ["La valuta ${value}: qui vedi come va."];`],
    ["x.test.ts", `assert.ok(text.includes(\`(in coda a ${value}).\`));`],
    ["x.tsx", `<p>La valuta ${value}: qui vedi come va.</p>`],
    ["x.tsx", `<Input placeholder="es. ${value}, CoE AI…" />`],
    ["x.ts", `const fallback = '${value}';`],
  ] as const) {
    assert.equal(valueCopies(file, bad).length, 1, `${file}: ${bad}`);
  }
  // Una voce di KNOWN_VALUE_TEXTS copre una copia sola, anche quando il testo si ripete.
  const known = [{ file: "x.test.ts", text: `La valuta ${value}: qui vedi come va.`, why: "prova" }];
  const once = `const ok = ["La valuta ${value}: qui vedi come va."];`;
  assert.deepEqual(valueCopies("x.test.ts", once, known), [], "la copia nota");
  assert.deepEqual(valueCopies("x.test.ts", `${once}\n${once}\n${once}`, known), [2, 3], "le copie in più");
  assert.deepEqual(valueCopies("x.test.ts", `const ok = ["La valuta ${value}: qui vedi come va.", "La valuta ${value}: qui vedi come va."];`, known).length, 1);
  assert.deepEqual(valueCopies("y.test.ts", once, known), [1], "la voce vale solo nel suo file");
  for (const [file, good] of [
    ["x.test.ts", `assert.equal(reviewTeamName(null), DEFAULT_REVIEW_TEAM_NAME);`],
    ["x.test.ts", `test("l'${value} del cliente decide", () => {});`],
    ["x.test.ts", `// ${value}: il nome predefinito\nconst a = 1;`],
    ["x.test.ts", `assert.doesNotMatch(schemaTs, /${value}/);`],
    ["x.test.ts", `aiTransformationTeamName: "${value}s",`],
    ["x.tsx", `{/* ${value} */}<p>Li valuta {teamName}</p>`],
    ["x.ts", `/**\n * «${value}» è il predefinito.\n */\nconst url = "https://esempio.test"; // ${value}`],
  ] as const) {
    assert.deepEqual(valueCopies(file, good), [], `${file}: ${good}`);
  }
});

/**
 * Le voci che non coprono più esattamente un testo del loro file (fuori dai commenti): il
 * file non c'è più, o il testo non c'è più (corretto dal proprietario), o c'è più volte.
 */
function staleKnownTexts(entries: ReadonlyArray<KnownValueText>, readFile: (file: string) => string | null): string[] {
  return entries.flatMap(({ file, text }) => {
    const source = readFile(file);
    if (source === null) return [`${file}: il file non c'è più`];
    const copies = blankComments(source).split(text).length - 1;
    return copies === 1 ? [] : [`${file}: «${text}» c'è ${copies} volte`];
  });
}

test("la guardia riconosce una voce di KNOWN_VALUE_TEXTS senza più il suo testo", () => {
  const value = DEFAULT_REVIEW_TEAM_NAME;
  const entry = { file: "x.test.ts", text: `La valuta ${value}: qui vedi come va.`, why: "prova" };
  const files: Record<string, string> = {
    once: `const ok = ["La valuta ${value}: qui vedi come va."];`,
    fixed: "const ok = [`La valuta ${DEFAULT_REVIEW_TEAM_NAME}: qui vedi come va.`];",
    twice: `const ok = ["La valuta ${value}: qui vedi come va.", "La valuta ${value}: qui vedi come va."];`,
    comment: `// La valuta ${value}: qui vedi come va.\nconst ok = [];`,
  };
  const check = (name: string | null) => staleKnownTexts([entry], () => (name === null ? null : files[name]));
  assert.deepEqual(check("once"), []);
  assert.equal(check("fixed").length, 1, "il proprietario ha interpolato la costante: la voce si toglie");
  assert.equal(check("twice").length, 1);
  assert.equal(check("comment").length, 1, "un commento non tiene aperta l'eccezione");
  assert.equal(check(null).length, 1, "il file non c'è più");
});

test("ogni voce di KNOWN_VALUE_TEXTS copre un testo che c'è, una volta sola", () => {
  const stale = staleKnownTexts(KNOWN_VALUE_TEXTS, (file) => (existsSync(join(repoRoot, file)) ? read(file) : null));
  assert.deepEqual(stale, [], "togli da KNOWN_VALUE_TEXTS le voci senza più il loro testo");
});

test("il valore predefinito è scritto solo nella costante", () => {
  const found = files
    .filter((file) => file !== HOME)
    .flatMap((file) => valueCopies(file, read(file)).map((line) => `${file}:${line}`));
  assert.deepEqual(found, [], "si usa DEFAULT_REVIEW_TEAM_NAME o reviewTeamName(), mai il testo");
  const literal = new RegExp(`(["'\`])${ESCAPED_VALUE}\\1`, "g");
  assert.equal(read(HOME).match(literal)?.length, 1, "la costante c'è, una volta sola");
});

// ─── 3. Nessun articolo né «team» davanti al nome ────────────────────

/** Chiamate in coda al nome: `teamName.trim()`, `plainNotificationText(teamName).trim()`. */
const CHAIN = String.raw`(?:\.[\w$]+\([^()]*\))*`;
/**
 * Il nome del team in un testo: la variabile, anche come campo (`params.teamName`,
 * `props.teamName`) o con l'alias `team`, la costante o la funzione.
 */
const NAME = String.raw`(?:[\w$]+\.)*(?:teamName|team|DEFAULT_REVIEW_TEAM_NAME|reviewTeamName\([^()]*\))${CHAIN}`;
/** Il nome, anche dentro una chiamata: `escapeSlackText(params.teamName)`, `plainNotificationText(teamName).trim()`. */
const VALUE = String.raw`(?:[\w$.]+\(\s*)?${NAME}\s*\)?${CHAIN}`;
/** `{teamName}` come figlio JSX (non `prop={teamName}` e non `${teamName}`). */
const JSX_NAME = new RegExp(String.raw`(?<![=$\w])\{\s*${VALUE}\s*\}`, "g");
/** `${teamName}`, `${team}`, `${escapeSlackText(teamName)}` e simili dentro un template. */
const TEMPLATE_NAME = new RegExp(String.raw`\$\{\s*${VALUE}\s*\}`, "g");
/** `"in coda al team " + teamName`. */
const CONCAT_NAME = new RegExp(String.raw`(["'\`])((?:(?!\1)[^\\\n]|\\.)*)\1\s*\+\s*${VALUE}`, "g");

/** Articoli, preposizioni articolate e «team»: davanti al nome darebbero «Il Digital Factory». */
const BEFORE_NAME = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
  "al", "allo", "alla", "ai", "agli", "alle",
  "del", "dello", "della", "dei", "degli", "delle",
  "dal", "dallo", "dalla", "dai", "dagli", "dalle",
  "nel", "nello", "nella", "nei", "negli", "nelle",
  "sul", "sullo", "sulla", "sui", "sugli", "sulle",
  "col", "coi", "team",
]);

/** L'ultima parola del testo che precede il nome, senza tag, `{" "}` ed entità. */
function wordBefore(textBefore: string): string | null {
  const plain = textBefore
    .replace(/&apos;|&#39;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\{\s*(["'`])\s*\1\s*\}/g, " ")
    .replace(/<[^<>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trimEnd();
  return plain.match(/([\p{L}]+['’]?|['’])$/u)?.[1]?.toLowerCase() ?? null;
}

/** Vero se la parola davanti al nome è un articolo, una preposizione articolata, un'elisione o «team». */
function badWordBefore(textBefore: string): string | null {
  const word = wordBefore(textBefore);
  if (!word) return null;
  return BEFORE_NAME.has(word) || /['’]$/.test(word) ? word : null;
}

function articlesBeforeName(text: string): Array<{ line: number; word: string }> {
  const out: Array<{ line: number; word: string }> = [];
  for (const pattern of [JSX_NAME, TEMPLATE_NAME]) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const word = badWordBefore(text.slice(Math.max(0, index - 160), index));
      if (word) out.push({ line: lineOf(text, index), word });
    }
  }
  for (const match of text.matchAll(CONCAT_NAME)) {
    const word = badWordBefore(match[2]);
    if (word) out.push({ line: lineOf(text, match.index ?? 0), word });
  }
  return out;
}

test("la guardia riconosce un articolo o «team» davanti al nome", () => {
  for (const bad of [
    "Il team {teamName} lo vedrà nell&apos;inbox",
    `Alla fine ti ringraziamo e il team{" "}\n          <strong>{teamName}</strong> potrà valutare`,
    "Il <strong>{teamName}</strong> lo valuta",
    "`${kind} in coda al team ${plainNotificationText(teamName)}: `",
    "`(in coda al ${escapeSlackText(teamName)}).`",
    `"Ora il team " + teamName + " lo vede."`,
    "Lo valuta l&apos;{teamName}.",
    "Se lo lasci vuoto, decide il {DEFAULT_REVIEW_TEAM_NAME}.",
    "`Grazie: la valuta il ${reviewTeamName(workspace)}.`",
    // Il nome come campo, con un alias o con una chiamata in coda.
    "`in coda al team ${params.teamName}`",
    "`in coda al team ${escapeSlackText(params.teamName)}`",
    "`Grazie: il ${team} lo valuta.`",
    "`Il codice è ${escapeSlackText(code)}: il team ${team} lo valuta.`",
    "Il team <strong>{props.teamName}</strong> lo vedrà",
    "Il team {teamName.trim()} lo vedrà",
    "`in coda al team ${plainNotificationText(teamName).trim()}`",
    `"in coda al team " + params.teamName`,
  ]) {
    assert.equal(articlesBeforeName(bad).length, 1, bad);
  }
  for (const good of [
    "Li valuta <strong>{teamName}</strong> e li posiziona sulla matrice",
    "{teamName} lo vedrà nell&apos;inbox",
    `Alla fine ti ringraziamo e{" "}\n          <strong>{teamName}</strong> potrà valutare`,
    "`${kind} in coda a ${plainNotificationText(teamName)}: `",
    "`Il codice è ${code}: ${team} lo valuta.`",
    "<RankingMatrix teamName={teamName} items={items} />",
    "Se lo lasci vuoto: {DEFAULT_REVIEW_TEAM_NAME}.",
    "Oggi i contributi sono assegnati a <strong>{teamName}</strong>.",
    `"Grazie: " + teamName`,
    "const { useCase, teamName, detailUrl } = params;",
    "`Il codice è ${escapeSlackText(code)}: ${team} lo valuta.`",
    "`in coda a ${escapeSlackText(params.teamName)}`",
    "<strong>{props.teamName}</strong> lo vedrà",
    "Il team del cliente: {team.members.length} persone",
    "Il {teamNameInput} resta",
  ]) {
    assert.deepEqual(articlesBeforeName(good), [], good);
  }
});

test("nessun testo mette un articolo o «team» davanti al nome del team", () => {
  const found = files.flatMap((file) =>
    articlesBeforeName(read(file)).map(({ line, word }) => `${file}:${line} «${word}»`)
  );
  assert.deepEqual(found, [], "il nome va da solo: «li valuta {teamName}», «in coda a {teamName}»");
});

// ─── 3 bis. Ricerca semplice nei file di H3e ─────────────────────────

/** I file di H3e con testi: quelli che leggono il nome, i messaggi di Slack e la pagina di condivisione. */
const PACKAGE_FILES = [
  ...NAMING_FILES,
  "src/lib/slack/new-use-case-message.ts",
  "src/lib/slack/submit-contribution.ts",
  SHARE_PAGE,
] as const;

/**
 * La ricerca di PIANO-LAVORI H3e: «team ${», «team {» e «Il {teamName}» così come sono
 * scritti, qualunque sia il nome della variabile dopo «team». Non `<Team {…}>`.
 */
const PLAIN_PATTERNS = [
  /(?<![<\w])team\s*(?:<[^<>]*>\s*)*\$?\{/gi,
  /\bil\s+(?:<[^<>]*>\s*)*\$?\{\s*(?:[\w$]+\.)*(?:team(?:Name)?\b|DEFAULT_REVIEW_TEAM_NAME|reviewTeamName\()/gi,
];

function plainMentions(text: string): number[] {
  return PLAIN_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => lineOf(text, match.index ?? 0)));
}

test("la ricerca semplice trova «team ${…}» e «Il {teamName}»", () => {
  for (const bad of [
    "`il team ${team} lo valuta`",
    "`in coda al team ${nome}`",
    "Il {teamName} lo vedrà",
    "il ${team} lo valuta",
    "Il <strong>{props.teamName}</strong> lo vedrà",
    `Alla fine ti ringraziamo e il team{" "}\n          <strong>{nome}</strong> potrà valutare`,
    "Il team <strong>{nome}</strong> lo vedrà",
  ]) {
    assert.notDeepEqual(plainMentions(bad), [], bad);
  }
  for (const good of [
    "`Il codice è ${code}: ${team} lo valuta.`",
    "Link valido fino al {expiresOn}.",
    "<Team {...props} />",
    "Il {count} use case",
    "`in coda a ${escapeSlackText(teamName)}`",
  ]) {
    assert.deepEqual(plainMentions(good), [], good);
  }
});

test("nei file di H3e nessun «team ${…}» né «Il {teamName}»", () => {
  const found = PACKAGE_FILES.flatMap((file) => {
    assert.ok(existsSync(join(repoRoot, file)), `${file} non c'è più: aggiorna l'elenco`);
    return plainMentions(read(file)).map((line) => `${file}:${line}`);
  });
  assert.deepEqual(found, [], "il nome va da solo, senza «team» né articolo davanti");
});

// ─── I file di H3e ───────────────────────────────────────────────────

test("i file che mostrano il nome del team lo leggono con reviewTeamName()", () => {
  for (const file of NAMING_FILES) {
    assert.ok(existsSync(join(repoRoot, file)), `${file} non c'è più: aggiorna l'elenco`);
    const text = read(file);
    // `assert.ok` e non `assert.match`: in caso di errore basta il nome del file.
    assert.ok(/import \{[^}]*\breviewTeamName\b[^}]*\} from "(?:@\/lib\/review-team|\.\.\/review-team\.ts)";/.test(text), `${file}: import`);
    assert.ok(/\breviewTeamName\(/.test(text), `${file}: reviewTeamName()`);
  }
  assert.ok(!/aiTransformationTeamName|teamName/.test(read(SHARE_PAGE)), "la vista ridotta non nomina il team (D14)");
});
