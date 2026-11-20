import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Le regole della pagina «Contesto» che si leggono nei sorgenti (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §7, §11.3):
// il vecchio indirizzo reindirizza con un 307 vero; «Da confermare» non c'è per chi non è di Lateral Space; ogni testo
// a schermo viene da CONTEXT_TEXT; i componenti del browser non importano moduli del server; le rotte hanno i tempi
// del piano.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path: string) => existsSync(new URL(path, ROOT));
const filesUnder = (dir: string) =>
  (readdirSync(new URL(dir, ROOT), { recursive: true }) as string[]).map((file) => `${dir}/${file.split("\\").join("/")}`).filter((file) => /\.(ts|tsx)$/.test(file));

const DASHBOARD = "src/app/(dashboard)/dashboard/[workspaceId]";
const PAGE = `${DASHBOARD}/contesto/page.tsx`;
const CONFIRM_PAGE = `${DASHBOARD}/contesto/conferma/page.tsx`;
const SETUP_PAGE = `${DASHBOARD}/setup/context/page.tsx`;
const API = "src/app/api/context/[workspaceId]";

/** I file del pacchetto «pagina» (§12.2), senza i test: i componenti (non Granola, non l'avviso dell'ok), le pagine, le rotte, le azioni. */
const PACKAGE_FILES = [
  ...filesUnder("src/components/context").filter((file) => !file.includes("/granola/") && !file.endsWith("/ai-consent-notice.tsx")),
  ...filesUnder(`${DASHBOARD}/contesto`),
  SETUP_PAGE,
  ...filesUnder(`${API}/sources`),
  ...filesUnder(`${API}/facts`),
  ...filesUnder(`${API}/ask`),
  "src/lib/actions/context.ts",
].filter((file) => !/\.test\.tsx?$/.test(file));

/** Il sorgente senza i commenti (blocchi e righe; un `//` dopo i due punti è un indirizzo, non un commento). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

test("i file del pacchetto ci sono", () => {
  for (const file of [PAGE, CONFIRM_PAGE, SETUP_PAGE, `${DASHBOARD}/contesto/loading.tsx`, `${DASHBOARD}/contesto/error.tsx`, "src/components/context/view-model.ts", "src/lib/actions/context.ts"]) {
    assert.ok(exists(file), file);
  }
  assert.ok(PACKAGE_FILES.length >= 25, `${PACKAGE_FILES.length} file`);
});

test("il vecchio indirizzo reindirizza a /contesto, con un 307 vero: nessun loading.tsx sopra di lui", () => {
  const source = withoutComments(read(SETUP_PAGE));
  assert.match(source, /await requireWorkspacePage\(workspaceId\);/);
  assert.match(source, /redirect\(`\/dashboard\/\$\{workspaceId\}\/contesto`\);/);
  // Niente più dati letti qui: la tesi del valore e i dati della Discovery stanno nella Memoria.
  assert.doesNotMatch(source, /companyValueThesis|organizations|getDepartmentsByWorkspace|from "@\/lib\/db"/);
  // `redirect()` sotto un loading.tsx risponde 200 con una meta refresh: la cartella e le sue madri non ne hanno.
  for (const dir of [`${DASHBOARD}/setup/context`, `${DASHBOARD}/setup`, DASHBOARD, "src/app/(dashboard)/dashboard", "src/app/(dashboard)"]) {
    assert.equal(exists(`${dir}/loading.tsx`), false, `${dir}/loading.tsx`);
  }
});

test("«Da confermare»: notFound() per chi non è di Lateral Space, prima di leggere le proposte; e se non ci sono", () => {
  const source = withoutComments(read(CONFIRM_PAGE));
  const gate = source.indexOf("if (!contextAbilities(actor).canConfirm) notFound();");
  assert.ok(gate > 0, "il controllo c'è");
  assert.ok(gate < source.indexOf("listOpenProposals("), "prima di leggere");
  assert.match(source, /if \(!open\) notFound\(\);/);
  assert.match(source, /export const maxDuration = 60;/, "«In breve» si riscrive dopo la conferma, dentro questo tempo");
  assert.match(source, /await requireWorkspacePage\(workspaceId\)/);
});

test("la pagina: chi è nel workspace, la 0038 controllata, le tre viste, Granola montato nei due punti, 60 secondi", () => {
  const source = withoutComments(read(PAGE));
  assert.match(source, /export const metadata = \{ title: CONTEXT_TEXT\.page\.title \};/);
  assert.match(source, /export const maxDuration = 60;/);
  assert.match(source, /await requireWorkspacePage\(workspaceId\)/);
  assert.match(source, /if \(!abilities\.canOpen\) notFound\(\);/);
  assert.ok(source.indexOf("contextStoreReady()") < source.indexOf("loadContextMemory("), "prima l'archivio, poi la memoria");
  // (Rilascio 10, §3.7, §8.2) Le viste da `?vista=`. Il vecchio `?vista=appunti` porta a `?vista=fonti` nel proxy, con un 308
  // vero (src/lib/context/view-alias.test.ts): non qui, sotto `loading.tsx`, dove sarebbe un 200 con una meta refresh.
  assert.match(source, /const view = contextViewOf\(search\.vista\);/);
  assert.doesNotMatch(source, /permanentRedirect|redirect\(/);
  const proxy = withoutComments(read("src/proxy.ts"));
  assert.match(proxy, /const notesAlias = dashWs\?\.\[1\] && hasSession \? notesViewAlias\(pathname, req\.nextUrl\.searchParams\) : null;\s*if \(notesAlias\) return NextResponse\.redirect\(new URL\(notesAlias, req\.url\), 308\);/);
  // Il fatto si apre con `?apri=<fatto>`.
  assert.match(source, /initialFact=\{sheetIdParam\(search\.apri\)\}/);
  assert.match(source, /<GranolaInbox workspaceId=\{workspaceId\} workspaceName=\{workspaceName\} compact \/>/, "una riga nella Memoria");
  assert.match(source, /<GranolaInbox workspaceId=\{workspaceId\} workspaceName=\{workspaceName\} \/>/, "il blocco intero negli Appunti");
  // Il lettore degli appunti in attesa parte solo con l'ok (senza, c'è l'avviso al suo posto).
  assert.match(source, /lateralSpace && consentNotice === null \? memory\.counts\.pendingSourceIds : \[\]/);
  const error = read(`${DASHBOARD}/contesto/error.tsx`);
  assert.match(error, /^"use client";/);
  assert.match(error, /\{ retry \}: \{ retry: \(\) => void \}/, "Next 16: `retry`, non `reset`");
  assert.match(read(`${DASHBOARD}/contesto/loading.tsx`), /Skeleton/);
});

test("nessun testo in italiano scritto a mano fuori da CONTEXT_TEXT (lettere accentate, «», …)", () => {
  const ITALIAN = /[àèéìíòóùÀÈÉÌÒÙ«»…]/;
  const found: string[] = [];
  for (const file of PACKAGE_FILES) {
    withoutComments(read(file))
      .split("\n")
      .forEach((line, index) => {
        if (ITALIAN.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(found, []);
  // Il controllo vede davvero un testo scritto a mano.
  assert.equal(ITALIAN.test(withoutComments('const x = "Già fatto";')), true);
  assert.equal(ITALIAN.test(withoutComments("// già fatto\nconst y = 1;")), false);
  assert.equal(ITALIAN.test(withoutComments('<p>Così</p>')), true);
});

test("i componenti del browser non importano moduli del server: dalle funzioni condivise solo tipi", () => {
  const clientFiles = PACKAGE_FILES.filter((file) => /^\s*"use client";/.test(read(file)) || file.endsWith("/view-model.ts") || file.endsWith("/read-client.ts"));
  assert.ok(clientFiles.length >= 15, `${clientFiles.length} file del browser`);
  const SERVER = /^(@\/lib\/db(\/|$)|@\/lib\/context\/server\/|(\.\.\/)+lib\/db\/|@\/lib\/auth|server-only$)/;
  for (const file of clientFiles) {
    for (const match of read(file).matchAll(/^import\s+(type\s+)?[^"']*from\s+"([^"]+)";/gm)) {
      if (SERVER.test(match[2])) assert.ok(match[1], `${file}: «${match[2]}» si importa solo come tipo`);
    }
    assert.doesNotMatch(read(file), /^import "server-only";/m, file);
  }
  // I moduli del server della pagina lo dicono.
  for (const file of ["src/components/context/page-data.ts", "src/components/context/routes/respond.ts"]) assert.match(read(file), /^import "server-only";/, file);
});

test("«Aggiungi appunti» legge un file di testo trascinato come il caricamento dei documenti: mai solo come UTF-8", () => {
  const source = withoutComments(read("src/components/context/add-notes-dialog.tsx"));
  assert.match(source, /const text = droppedText\(new Uint8Array\(await picked\.arrayBuffer\(\)\)\);/);
  assert.doesNotMatch(source, /\.text\(\)/, "File.text() legge solo UTF-8");
});

test("(rilascio 10) «Altro» di «Aggiungi appunti»: si chiude anche con del testo in «Con chi» o «Link»; si apre da sé solo per un loro errore", () => {
  const source = withoutComments(read("src/components/context/add-notes-dialog.tsx"));
  assert.match(source, /const shown = moreOpen;/);
  assert.doesNotMatch(source, /moreOpen \|\| Boolean\(draft\./, "il testo dentro non la tiene aperta");
  assert.match(source, /setErrors\(\{ \.\.\.local \}\);\s*if \(notesMoreOnError\(local\)\) setMoreOpen\(true\);/);
  assert.match(source, /setErrors\(saved\.fieldErrors\);\s*if \(notesMoreOnError\(saved\.fieldErrors\)\) setMoreOpen\(true\);/);
  // I campi restano nella pagina, nascosti: il loro testo si salva anche con «Altro» chiuso.
  assert.match(source, /<div id="appunti-altro" hidden=\{!shown\}/);
  assert.match(source, /participants: draft\.participants, link: draft\.link/);
});

test("«Aggiungi appunti» chiusa durante la lettura: quando la lettura finisce, la pagina si aggiorna", () => {
  const source = withoutComments(read("src/components/context/add-notes-dialog.tsx"));
  assert.match(source, /if \(running\.current !== controller\) \{\s*router\.refresh\(\);\s*return;\s*\}/);
});

test("le rotte della pagina: funzioni Node, mai in cache, con i tempi del piano; tutte partono da chi chiama", () => {
  const routes: Readonly<Record<string, number>> = {
    [`${API}/sources/route.ts`]: 30,
    [`${API}/sources/[sourceId]/route.ts`]: 30,
    [`${API}/sources/[sourceId]/read/route.ts`]: 120,
    [`${API}/facts/[factId]/route.ts`]: 30,
    [`${API}/ask/route.ts`]: 60,
  };
  for (const [file, seconds] of Object.entries(routes)) {
    const source = read(file);
    assert.match(source, /export const runtime = "nodejs";/, file);
    assert.match(source, /export const dynamic = "force-dynamic";/, file);
    assert.match(source, new RegExp(`export const maxDuration = ${seconds};`), file);
    const body = withoutComments(source);
    assert.ok(body.indexOf("contextActorFromSession(") < body.indexOf("contextStoreReady()"), `${file}: prima chi chiama, poi l'archivio`);
  }
});

test("le azioni rileggono chi chiama e aggiornano la pagina solo se la scrittura è riuscita; «In breve» dopo la conferma", () => {
  const source = withoutComments(read("src/lib/actions/context.ts"));
  assert.match(source, /^"use server";/);
  assert.match(source, /const who = await contextActorFromSession\(workspaceId\);/);
  assert.match(source, /if \(result\.ok\) revalidatePath\(`\/dashboard\/\$\{workspaceId\}\/contesto`, "layout"\);/);
  assert.match(source, /after\(async \(\) => \{\s*await refreshContextBrief\(workspaceId, \{ force: true \}\);\s*\}\);/);
  // Nessuna chiamata al modello nelle azioni: solo scritture brevi.
  assert.doesNotMatch(source, /readContextSource|askContext|generateObject|generateText/);
});

test("«Da confermare» sul telefono: ogni casella si tocca in un'area di almeno 44 px", () => {
  const row = read("src/components/context/proposal-row.tsx");
  assert.match(row, /<label className="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b[^"]*">\s*<Checkbox checked=\{checkable && checked\}/, "la casella di una proposta");
  const view = read("src/components/context/confirm-view.tsx");
  // (Rilascio 10, §3.7) Un solo blocco di riconferme: una casella per fatto, ognuna su tutta la riga.
  assert.match(view, /<label className="flex min-h-11 [^"]*">\s*<span className="[^"]*\bmin-w-11\b[^"]*">\s*<Checkbox/, "una riconferma: tutta la riga");
  assert.doesNotMatch(view, /choices\.reconfirm/, "niente più riga unica delle riconferme");
  // Nessuna casella fuori da un'area così.
  for (const [name, source] of [["proposal-row.tsx", row], ["confirm-view.tsx", view]] as const) {
    assert.equal((source.match(/<Checkbox\b/g) ?? []).length, (source.match(/<label className="[^"]*\bmin-h-11\b[^"]*">\s*(?:<span[^>]*>\s*)?<Checkbox\b/g) ?? []).length, name);
  }
});

// ─── (Rilascio 10, §3.7) I Processi e «Aggiungi un'unità» ────────────

test("(rilascio 10) i Processi: una lettura sola delle unità; «Aggiungi un'unità» a chi modifica i processi; `/mapping` porta qui con un 308", () => {
  const source = withoutComments(read(PAGE));
  assert.match(source, /if \(view === "processi"\) \{\s*const units = await listUnitBoards\(await getAppUcExecutor\(\), workspaceId\);\s*const canAddUnit = boardAbilities\(access\.role\)\.edit;/);
  assert.match(source, /<ContextPage \{\.\.\.shell\} tab="processi" step=\{step\} [^>]*canAddUnit=\{canAddUnit\}>/);
  const mapping = withoutComments(read(`${DASHBOARD}/mapping/page.tsx`));
  assert.match(mapping, /await requireWorkspacePage\(workspaceId\);\s*permanentRedirect\(processesRedirect\(workspaceId, await searchParams\)\);/);
  // Il 308 è vero: né la cartella né le sue madri hanno un loading.tsx (quello della board sta in [deptId]).
  for (const dir of [`${DASHBOARD}/mapping`, DASHBOARD]) assert.equal(exists(`${dir}/loading.tsx`), false, `${dir}/loading.tsx`);
});

test("(rilascio 10) «Aggiungi un'unità»: prima chi chiama (sessione, workspace, la regola della board), poi il nome, poi il database; nessun modello", () => {
  const source = withoutComments(read("src/lib/actions/mappatura-units.ts"));
  assert.match(source, /^"use server";/);
  const gate = source.indexOf("if (!access || !boardAbilities(access.role).edit) return { ok: false, message: UNIT_TEXT.denied };");
  assert.ok(gate > 0 && gate > source.indexOf("await getCollaboratorAccess(session.user.id, workspaceId)"), "la guardia del workspace e la regola della board");
  assert.ok(gate < source.indexOf("addUnit(await getAppUcExecutor(), workspaceId, name)"), "prima di scrivere");
  assert.match(source, /if \(name\.length > UNIT_NAME_MAX\) return/);
  // Un nome uguale e il tetto delle unità li dice la transazione (`addUnit`, provata sul database in units.integration.test.ts).
  assert.match(source, /added\.reason === "duplicate" \? UNIT_TEXT\.duplicate : UNIT_TEXT\.full\(MAPPING_LIMITS\.units\)/);
  assert.doesNotMatch(source, /generateObject|generateText|streamText|anthropic|sendEmail|resend/i);
  // Solo il nome: nessun altro campo dell'unità dal browser.
  const sql = withoutComments(read("src/lib/mappatura/board-sql.ts"));
  assert.match(sql, /INSERT INTO departments \(workspace_id, name\)\s+SELECT \$\{U\(workspaceId\)\}, \$\{cast\(name, "text"\)\} FROM w WHERE NOT w\.same AND w\.units < \$\{cast\(MAPPING_LIMITS\.units, "int"\)\}/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('mappatura-unita:' \|\| \$\{cast\(workspaceId, "text"\)\}\)\)/);
});
