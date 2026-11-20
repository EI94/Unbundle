import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CliLoginConfirm } from "@/components/cli/cli-login-confirm";
import { PUBLIC_FIELD, PUBLIC_LABEL, PUBLIC_PRIMARY } from "@/components/public/classes";
import { PublicFooterLine, PublicLink, PublicShell } from "@/components/public/public-shell";
import { PublicCard, PublicCardText } from "@/components/public/state-card";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { loginPathForMissingSession, SESSION_COOKIE_NAME } from "@/lib/auth/session-signal";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliCaseWorkspaceIds, cliStoreReady, findCliLogin } from "@/lib/db/queries/use-case-cli-auth";
import { getWorkspaceGroupsForUser } from "@/lib/db/queries/workspaces";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { accountHref } from "@/lib/shell/account";
import { normalizeUserCode } from "@/lib/use-cases/cli/codes";
import { cliWorkspaceChoices, type CliWorkspaceChoice } from "@/lib/use-cases/cli/workspace-choices";
import { CLI_PAGE_TEXT } from "./text";

/**
 * «Collega questa CLI» (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3): la persona, con l'accesso fatto, conferma
 * il codice che vede nel terminale e sceglie il workspace. Il token lo ritira la CLI, mai questa pagina. Il testo
 * dice di confermare solo un codice che si è chiesto: è la difesa contro chi manda un link con un suo codice. I
 * workspace proposti sono solo quelli dove la persona è nel team di un caso (`cliWorkspaceChoices`).
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11) Il guscio unico delle pagine pubbliche, chiaro, il marchio non
 * cliccabile: in fondo un link a «Il tuo account › Claude e terminale» e uno all'Agent Factory, del workspace che la
 * pagina propone per primo (senza, l'elenco dei workspace); con un codice sbagliato, non trovato o scaduto, il campo per
 * riscriverlo. I testi stanno in `./text.ts`.
 */
export const metadata: Metadata = {
  title: CLI_PAGE_TEXT.metaTitle,
  robots: { index: false, follow: false, nocache: true },
};

const T = CLI_PAGE_TEXT;

/** I due link in fondo: il workspace proposto per primo; senza, l'elenco dei workspace e niente Agent Factory. */
function LinksFooter({ workspaceId }: { workspaceId: string | null }) {
  return (
    <PublicFooterLine className="flex flex-wrap gap-x-5">
      <PublicLink href={workspaceId ? accountHref(workspaceId, "claude") : "/dashboard"}>{workspaceId ? T.account : T.workspaces}</PublicLink>
      {workspaceId ? <PublicLink href={`/dashboard/${workspaceId}/agent-factory`}>{T.factory}</PublicLink> : null}
    </PublicFooterLine>
  );
}

/** Il campo del codice: all'inizio, e per riscriverlo dopo un codice sbagliato, non trovato o scaduto. */
function CodeForm({ error, label = T.continue }: { error?: string | null; label?: string }) {
  return (
    <form method="get" className="mt-5 space-y-3" data-testid="cli-code-form">
      <div className="space-y-1.5">
        <label htmlFor="codice" className={PUBLIC_LABEL}>
          {T.codeLabel}
        </label>
        <input
          id="codice"
          name="codice"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={T.codePlaceholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "codice-errore" : undefined}
          className={`${PUBLIC_FIELD} w-full rounded-lg border border-input bg-background px-3 font-mono tracking-widest uppercase`}
        />
      </div>
      {error ? (
        <p id="codice-errore" className="text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className={PUBLIC_PRIMARY}>
        {label}
      </Button>
    </form>
  );
}

/** I workspace della scelta: dove la persona è nel team di un caso. Senza il registro della CLI, nessuno. */
async function workspaceChoices(userId: string): Promise<CliWorkspaceChoice[]> {
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return [];
  const [groups, caseWorkspaces] = await Promise.all([getWorkspaceGroupsForUser(userId), cliCaseWorkspaceIds(executor, userId)]);
  return cliWorkspaceChoices(
    groups.flatMap((g) =>
      g.workspaces.map((w) => ({ id: w.workspace.id, name: w.workspace.name, organization: g.organization.name, createdAt: w.workspace.createdAt, accessRole: w.accessRole })),
    ),
    caseWorkspaces,
  );
}

export default async function CliConnectPage({ searchParams }: { searchParams: Promise<{ codice?: string }> }) {
  const { codice } = await searchParams;
  const userCode = normalizeUserCode(codice);
  const callback = userCode ? `/cli/collega?codice=${encodeURIComponent(userCode)}` : "/cli/collega";
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  if (!session?.user?.id) redirect(loginPathForMissingSession({ hadCookie: cookieStore.has(SESSION_COOKIE_NAME), callbackPath: callback }));

  await ensureDbSchema();
  const workspaces = await workspaceChoices(session.user.id);
  const footer = <LinksFooter workspaceId={workspaces[0]?.id ?? null} />;

  if (!userCode) {
    return (
      <PublicShell footer={footer}>
        <PublicCard title={T.title}>
          <PublicCardText>{T.ask}</PublicCardText>
          <CodeForm error={codice ? T.invalid : null} />
        </PublicCard>
      </PublicShell>
    );
  }

  const executor = await getAppUcExecutor();
  const login = (await cliStoreReady(executor)) ? await findCliLogin(executor, userCode) : null;
  if (!login) {
    return (
      <PublicShell footer={footer}>
        <PublicCard title={T.notFound.title}>
          <PublicCardText>{T.notFound.body}</PublicCardText>
          <CodeForm label={T.retype} />
        </PublicCard>
      </PublicShell>
    );
  }
  if (login.status !== "in_attesa") {
    const done = T.done[login.status];
    return (
      <PublicShell footer={footer}>
        <PublicCard title={done.title}>
          <PublicCardText>{done.body}</PublicCardText>
          {login.status === "scaduto" ? <CodeForm label={T.retype} /> : null}
        </PublicCard>
      </PublicShell>
    );
  }

  return (
    <PublicShell footer={footer}>
      <PublicCard title={T.confirmTitle}>
        <PublicCardText>{T.confirmAsk}</PublicCardText>
        <p className="mt-5 rounded-lg border bg-muted px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]">{login.userCode}</p>
        <PublicCardText>
          <p>
            {T.from} <span className="text-foreground">{login.clientLabel}</span>. {T.scope}
          </p>
        </PublicCardText>
        <div className="mt-5">
          <CliLoginConfirm userCode={login.userCode} workspaces={workspaces} />
        </div>
      </PublicCard>
    </PublicShell>
  );
}
