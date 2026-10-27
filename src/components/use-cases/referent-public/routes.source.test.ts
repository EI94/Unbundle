import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Le rotte pubbliche di «Chiedi al referente» sul sorgente (SPEC §4.1, §4.2, §9.2): ogni rotta esporta
// solo il suo metodo, passa da `handleReferentPublic` con il tipo di chiamata giusto (scrittura, limite,
// corpo) e gira su Node; l'handler fa i controlli nell'ordine della SPEC e importa solo i moduli ammessi.

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const API = "src/app/api/rispondi/[token]";

interface RouteSpec {
  method: "GET" | "POST";
  write: boolean;
  rate: string | null;
  body?: "raw";
  maxDuration?: number;
  /** Il comando del modulo pubblico che la rotta chiama. */
  command: string;
}

const ROUTES: Record<string, RouteSpec> = {
  "route.ts": { method: "GET", write: false, rate: null, command: "loadReferentAskView" },
  "privacy/route.ts": { method: "POST", write: true, rate: "apertura", command: "acceptReferentPrivacy" },
  "draft/route.ts": { method: "POST", write: true, rate: "bozza", command: "saveReferentDraft" },
  "submit/route.ts": { method: "POST", write: true, rate: "invio", command: "submitReferentAnswers" },
  "upload/route.ts": { method: "POST", write: true, rate: "upload", body: "raw", maxDuration: 60, command: "uploadReferentFileServer" },
  "upload-token/route.ts": { method: "POST", write: true, rate: "upload", command: "beginReferentClientUpload" },
  "upload-complete/route.ts": { method: "POST", write: true, rate: "invio", maxDuration: 60, command: "completeReferentClientUpload" },
  "file-remove/route.ts": { method: "POST", write: true, rate: "bozza", command: "removeReferentFile" },
  "file-confirm/route.ts": { method: "POST", write: true, rate: "bozza", command: "confirmReferentFile" },
};

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const path = join(abs, name);
    if (statSync(path).isDirectory()) walk(relative(root, path), out);
    else out.push(relative(root, path));
  }
  return out;
}

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function exportsOf(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const stmt of sf.statements) {
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) out.set(stmt.name.text, stmt);
    if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) out.set(d.name.text, d.initializer ?? d);
  }
  return out;
}

/** Il terzo argomento di `handleReferentPublic(request, token, { … }, run)`, come oggetto di valori. */
function specOf(sf: ts.SourceFile): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "handleReferentPublic") {
      const arg = node.arguments[2];
      assert.ok(arg && ts.isObjectLiteralExpression(arg), "la spec è un oggetto letterale");
      const spec: Record<string, unknown> = {};
      for (const p of (arg as ts.ObjectLiteralExpression).properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        const v = p.initializer;
        spec[p.name.text] =
          v.kind === ts.SyntaxKind.TrueKeyword ? true : v.kind === ts.SyntaxKind.FalseKeyword ? false : v.kind === ts.SyntaxKind.NullKeyword ? null : ts.isStringLiteral(v) ? v.text : ts.isNumericLiteral(v) ? Number(v.text) : v.getText(sf);
      }
      found = spec;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("le rotte sono esattamente quelle della SPEC, più l'handler comune", () => {
  const files = walk(API).map((f) => f.slice(API.length + 1)).sort();
  assert.deepEqual(files, [...Object.keys(ROUTES), "handler.ts"].sort());
});

for (const [file, spec] of Object.entries(ROUTES)) {
  test(`${file}: ${spec.method}, nodejs, ${spec.write ? `scrittura «${spec.rate}»` : "solo lettura"}`, () => {
    const sf = source(`${API}/${file}`);
    const exported = exportsOf(sf);
    const methods = [...exported.keys()].filter((k) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k));
    assert.deepEqual(methods, [spec.method], "un solo metodo");
    const literal = (name: string) => {
      const node = exported.get(name);
      return node && (ts.isStringLiteral(node) ? node.text : ts.isNumericLiteral(node) ? Number(node.text) : undefined);
    };
    assert.equal(literal("runtime"), "nodejs");
    assert.equal(literal("dynamic"), "force-dynamic");
    assert.equal(literal("maxDuration"), spec.maxDuration);
    const allowed = new Set([spec.method, "runtime", "dynamic", ...(spec.maxDuration ? ["maxDuration"] : [])]);
    assert.deepEqual([...exported.keys()].filter((k) => !allowed.has(k)), [], "nessun altro export");
    const found = specOf(sf);
    assert.ok(found, "chiama handleReferentPublic");
    assert.equal(found.write, spec.write);
    assert.equal(found.rate, spec.rate);
    assert.equal(found.body, spec.body);
    assert.ok(sf.text.includes(`${spec.command}(`), `chiama ${spec.command}`);
  });
}

test("submit: dopo un invio riuscito le email partono dopo la risposta, mai dentro la chiamata", () => {
  const text = readFileSync(join(root, API, "submit/route.ts"), "utf8");
  assert.match(text, /if \(outcome\.ok\) scheduleReferentDispatch\(link\.requestId\)/);
  assert.doesNotMatch(text, /dispatchReferentEmails|await scheduleReferentDispatch/);
});

const HANDLER = `${API}/handler.ts`;

test("handler: i controlli nell'ordine della SPEC §4.2", () => {
  const text = source(HANDLER).getFullText();
  const body = text.slice(text.indexOf("export async function handleReferentPublic"));
  const steps = [
    'process.env.USE_CASE_REFERENTS?.trim() === "off"',
    "looksLikeReferentToken(token)",
    "referentPublicWritesAvailable(process.env)",
    "publicOriginAllowed(request.headers",
    "readPublicJson(request",
    "referentStoreReady()",
    "ipRateLimitRule(requestIpHash(request.headers, process.env.UC_SECRET))",
    "resolveReferentToken(token",
    "referentAskEnabled(resolved.link.workspaceId",
    "referentRateRule(resolved.link.tokenId",
    "run({",
  ];
  let at = -1;
  for (const step of steps) {
    const next = body.indexOf(step, at + 1);
    assert.ok(next > at, `«${step}» dopo il passo precedente`);
    at = next;
  }
  // Le scritture sono le sole a controllare segreto, origine, corpo e limiti.
  assert.match(body, /if \(spec\.write\) \{\s*if \(!referentPublicWritesAvailable/);
  assert.match(body, /if \(spec\.write && spec\.rate\)/);
  // Ogni errore imprevisto: «errore», e nel log solo il tipo di chiamata.
  assert.match(body, /catch \(error\) \{\s*logReferentPublicError\(opOf\(request\), error\);\s*return publicError\("errore"\);/);
});

test("handler: il log non riceve mai un pezzo dell'indirizzo che non sia un tipo di chiamata noto", () => {
  const text = readFileSync(join(root, HANDLER), "utf8");
  assert.match(text, /OPS\.has\(last\) \? last : "vista"/);
});

const ALLOWED = new Set([
  "@/lib/use-cases/referent/contract",
  "@/lib/use-cases/referent/tokens",
  "@/lib/db/queries/use-case-referent-public",
  "@/lib/uc/http",
  "@/lib/uc/files/multipart",
  "@/lib/db/queries/uc-public",
  "@/lib/db/uc-executor",
]);

test("le rotte e l'handler importano solo i moduli ammessi (§4.2), niente sessione", () => {
  const bad: string[] = [];
  for (const file of walk(API)) {
    const sf = source(file);
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const spec = stmt.moduleSpecifier.text;
      if (spec.startsWith(".") || spec === "server-only") continue;
      if (!ALLOWED.has(spec)) bad.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
