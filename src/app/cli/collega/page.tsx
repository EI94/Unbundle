import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CliLoginConfirm } from "@/components/cli/cli-login-confirm";
import { auth } from "@/lib/auth";
import { loginPathForMissingSession, SESSION_COOKIE_NAME } from "@/lib/auth/session-signal";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady, findCliLogin } from "@/lib/db/queries/use-case-cli-auth";
import { getWorkspaceGroupsForUser } from "@/lib/db/queries/workspaces";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { normalizeUserCode } from "@/lib/use-cases/cli/codes";

/**
 * «Collega questa CLI» (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3): la persona, con l'accesso fatto, conferma
 * il codice che vede nel terminale e sceglie il workspace. Il token lo ritira la CLI, mai questa pagina. Il testo
 * dice di confermare solo un codice che si è chiesto: è la difesa contro chi manda un link con un suo codice.
 */
export const metadata: Metadata = {
  title: "Collega la CLI",
  robots: { index: false, follow: false, nocache: true },
};

const DONE: Record<string, { title: string; body: string }> = {
  scaduto: { title: "Il codice è scaduto", body: "I codici valgono 10 minuti. Nel terminale rifai «unbundle login»." },
  confermato: { title: "Già confermato", body: "Questo codice è già stato confermato: torna al terminale." },
  consegnato: { title: "Già usato", body: "Questo codice è già stato usato. Se non sei stato tu, revoca il collegamento da Impostazioni › CLI di Unbundle." },
  negato: { title: "Codice annullato", body: "Hai detto «Non l'ho chiesto io»: nessuna CLI è stata collegata." },
};

export default async function CliConnectPage({ searchParams }: { searchParams: Promise<{ codice?: string }> }) {
  const { codice } = await searchParams;
  const userCode = normalizeUserCode(codice);
  const callback = userCode ? `/cli/collega?codice=${encodeURIComponent(userCode)}` : "/cli/collega";
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  if (!session?.user?.id) redirect(loginPathForMissingSession({ hadCookie: cookieStore.has(SESSION_COOKIE_NAME), callbackPath: callback }));

  if (!userCode) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Collega la CLI</h1>
        <p className="text-sm text-muted-foreground">Scrivi il codice che vedi nel terminale dopo «unbundle login».</p>
        <form method="get" className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="codice" className="sr-only">
            Codice
          </label>
          <input
            id="codice"
            name="codice"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="BCDF-GHJK"
            className="h-11 flex-1 rounded-md border border-input bg-background px-3 font-mono text-base tracking-widest uppercase sm:h-9 sm:text-sm"
          />
          <Button type="submit" className="h-11 sm:h-9">
            Continua
          </Button>
        </form>
        {codice ? <p className="text-sm text-destructive">Il codice non è valido: sono otto lettere, come BCDF-GHJK.</p> : null}
      </Shell>
    );
  }

  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  const login = (await cliStoreReady(executor)) ? await findCliLogin(executor, userCode) : null;
  if (!login) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Codice non trovato</h1>
        <p className="text-sm text-muted-foreground">Controlla il codice nel terminale, oppure rifai «unbundle login».</p>
      </Shell>
    );
  }
  if (login.status !== "in_attesa") {
    const done = DONE[login.status];
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">{done.title}</h1>
        <p className="text-sm text-muted-foreground">{done.body}</p>
      </Shell>
    );
  }

  const groups = await getWorkspaceGroupsForUser(session.user.id);
  const workspaces = groups.flatMap((g) =>
    g.workspaces.filter((w) => w.accessRole !== "learner").map((w) => ({ id: w.workspace.id, name: w.workspace.name, organization: g.organization.name })),
  );
  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">Collega questa CLI?</h1>
      <p className="text-sm text-muted-foreground">Conferma solo se questo è il codice che vedi adesso nel tuo terminale. Se non hai chiesto tu un collegamento, scegli {"«Non l'ho chiesto io»."}</p>
      <p className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]">{login.userCode}</p>
      <p className="text-sm text-muted-foreground">
        Da: <span className="text-foreground">{login.clientLabel}</span>. La CLI potrà fare per 90 giorni quello che puoi fare tu nei casi dove sei nel team; si revoca da Impostazioni › CLI di Unbundle o con «unbundle logout».
      </p>
      {workspaces.length ? (
        <CliLoginConfirm userCode={login.userCode} workspaces={workspaces} />
      ) : (
        <p className="text-sm text-muted-foreground">Non hai un workspace dove collegarla.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-xl flex-col justify-center">
        <Link href="/" className="mb-6 text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="space-y-4 p-6">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
