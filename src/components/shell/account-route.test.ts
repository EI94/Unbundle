import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, PROPOSTA-10 §3.12) `/dashboard/<ws>/account`: l'indirizzo pulito che un'e-mail alla persona («CLI
// collegata») può avere, senza `?` né `#`. Prima l'accesso, come ogni pagina del workspace; poi la Home con il foglio
// «Il tuo account» aperto su «Claude e terminale», lo stesso indirizzo del foglio. La pagina vera con il redirect vero
// di Next, l'accesso finto. Id inventati.

type Prova = { asked: string[]; refuse: Error | null };
const prova: Prova = { asked: [], refuse: null };
(globalThis as { __accountPage?: Prova }).__accountPage = prova;

const WS = "00000000-0000-4000-8000-0000000000f1";

await installAppModules({
  "@/lib/auth/require-workspace": `export async function requireWorkspacePage(workspaceId) {
    const p = globalThis.__accountPage; p.asked.push(workspaceId);
    if (p.refuse) throw p.refuse;
    return { session: { user: { id: "utente-prova" } }, access: { role: "contributor" } };
  }`,
});
await enableTsxImports();

const { default: AccountPage } = (await import("../../app/(dashboard)/dashboard/[workspaceId]/account/page.tsx")) as unknown as {
  default: (props: { params: Promise<{ workspaceId: string }> }) => Promise<unknown>;
};
const { ACCOUNT_PARAM, accountPartOf } = await import("../../lib/shell/account.ts");

const open = () => AccountPage({ params: Promise.resolve({ workspaceId: WS }) });

test("prima l'accesso, poi la Home con il foglio aperto su «Claude e terminale»", async () => {
  Object.assign(prova, { asked: [], refuse: null });
  const thrown = await open().then(
    () => assert.fail("la pagina reindirizza"),
    (error: unknown) => error,
  );
  // Il redirect di Next: «NEXT_REDIRECT;<tipo>;<indirizzo>;<stato>;».
  const [code, , target, status] = String((thrown as { digest?: unknown }).digest).split(";");
  assert.equal(code, "NEXT_REDIRECT");
  assert.equal(status, "307", "temporaneo, come gli altri indirizzi brevi delle e-mail");
  assert.equal(target, `/dashboard/${WS}?account=claude`);
  assert.equal(accountPartOf(new URL(target, "http://unbundle.test").searchParams.get(ACCOUNT_PARAM)), "claude");
  assert.deepEqual(prova.asked, [WS], "l'accesso, una volta");
});

test("chi non può entrare non arriva al foglio: l'accesso decide prima del redirect", async () => {
  const refused = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  Object.assign(prova, { asked: [], refuse: refused });
  await assert.rejects(open(), (error) => error === refused);
  assert.deepEqual(prova.asked, [WS]);
  prova.refuse = null;
});
