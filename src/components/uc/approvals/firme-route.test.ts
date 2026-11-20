import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import type { CaseRole } from "../../../lib/uc/vocab.ts";

// Rilascio 10, §3.5: il comportamento di `/firme` per ruolo. Chi firma riceve un 308 verso la sua pagina d'arrivo con il
// pannello delle firme aperto e la query di prima, senza cache (dipende da chi guarda); chi non firma, o non vede la
// realizzazione, riceve 404 come prima. L'accesso al workspace e al caso arrivano da moduli finti: si prova la route.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

interface Fake {
  access: { roles: CaseRole[] } | null | "non_disponibile";
}
const state = globalThis as unknown as { __firme: Fake };
const mod = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const BASE = `/dashboard/${WS}/casi-duso/${CASE}`;

let GET: (request: { nextUrl: URL }, ctx: { params: Promise<{ workspaceId: string; caseId: string }> }) => Promise<Response>;

before(async () => {
  await enableTsxImports();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/auth/require-workspace") {
        return { url: mod("export async function requireWorkspacePage() { return { session: { user: { id: 'u' } }, access: { role: 'transformation_lead' } }; }"), shortCircuit: true };
      }
      if (specifier === "@/lib/db/queries/uc-access") return { url: mod("export class UcAccessError extends Error {}"), shortCircuit: true };
      if (specifier === "@/components/uc/shell/case-data") {
        return {
          url: mod(
            "import { UcAccessError } from '@/lib/db/queries/uc-access';\n" +
              "export async function findDossierAccess() { const a = globalThis.__firme.access; if (a === 'non_disponibile') throw new UcAccessError('Sezione non disponibile'); return a; }",
          ),
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });
  const route = await import(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/firme/route.ts", import.meta.url).href);
  GET = route.GET;
});

beforeEach(() => {
  state.__firme = { access: null };
});

const call = (query = "") => GET({ nextUrl: new URL(`http://app.test${BASE}/firme${query}`) }, { params: Promise.resolve({ workspaceId: WS, caseId: CASE }) });

/** `notFound()` di Next: un errore con il digest del 404. */
async function notFoundOf(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (error) {
    return String((error as { digest?: string }).digest ?? "").includes("404");
  }
}

test("chi firma riceve un 308 verso la sua pagina d'arrivo, con il pannello aperto, la query di prima e senza cache", async () => {
  for (const [roles, landing] of [
    [["ls_lead"], ""],
    [["owner_cliente"], ""],
    [["approvatore_privacy"], "/privacy"],
  ] as const) {
    state.__firme = { access: { roles: [...roles] } };
    const res = await call("?da=email");
    assert.equal(res.status, 308, roles.join());
    assert.equal(res.headers.get("location"), `${BASE}${landing}?da=email&firma=1`, roles.join());
    assert.equal(res.headers.get("cache-control"), "private, no-store", roles.join());
  }
});

test("chi non firma, o non vede la realizzazione, riceve 404 come prima", async () => {
  for (const roles of [["ls_analista"], ["ls_sviluppatore"], ["osservatore"], ["ai_board"]] as CaseRole[][]) {
    state.__firme = { access: { roles } };
    assert.equal(await notFoundOf(call()), true, roles.join());
  }
  state.__firme = { access: null };
  assert.equal(await notFoundOf(call()), true, "nessun ruolo nel caso");
});

test("con la sezione non disponibile porta alla radice, dove il guscio lo dice", async () => {
  state.__firme = { access: "non_disponibile" };
  const res = await call();
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), `${BASE}?firma=1`);
});
