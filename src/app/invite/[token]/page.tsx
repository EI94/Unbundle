import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CheckCircle2, MinusCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { loginPathForMissingSession, SESSION_COOKIE_NAME } from "@/lib/auth/session-signal";
import { getWorkspaceInvitationByToken } from "@/lib/db/queries/workspace-collaboration";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import {
  getWorkspaceInvitationLifecycle,
  maskInviteEmail,
  normalizeInviteEmail,
} from "@/lib/workspace-invite-token";
import { ROLE_INFO, roleLabel } from "@/lib/workspace-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceInviteAcceptForm } from "@/components/workspace/workspace-invite-accept-form";
import { SwitchAccountButton } from "@/components/workspace/switch-account-button";
import { VerifyInviteEmail } from "@/components/workspace/verify-invite-email";

export const metadata: Metadata = {
  title: "Invito workspace",
  robots: { index: false, follow: false, nocache: true },
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

const UNAVAILABLE: Record<"invalid" | "expired" | "revoked" | "used", { title: string; body: string }> = {
  invalid: {
    title: "Link di invito non valido",
    body: "Il link non è completo o non esiste. Controlla di averlo copiato per intero, oppure chiedi a chi ti ha invitato di mandartelo di nuovo.",
  },
  expired: {
    title: "Questo invito è scaduto",
    body: "Gli inviti valgono 7 giorni. Chiedi a chi ti ha invitato di crearne uno nuovo.",
  },
  revoked: {
    title: "Questo invito è stato annullato",
    body: "Chi lo ha creato lo ha disattivato. Se ti serve ancora l'accesso, chiedi un link nuovo.",
  },
  used: {
    title: "Questo link è già stato usato",
    body: "Ogni link di invito vale per una sola persona. Se l'hai usato tu, accedi e trovi il workspace tra i tuoi; altrimenti chiedi a chi ti ha invitato di crearne uno per te.",
  },
};

export default async function WorkspaceInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [session, found, cookieStore] = await Promise.all([
    auth(),
    getWorkspaceInvitationByToken(token),
    cookies(),
  ]);

  if (!found) return <Unavailable reason="invalid" />;
  const { invitation, workspace, organization } = found;
  const callbackUrl = `/invite/${encodeURIComponent(token)}`;
  // Un cookie presente ma rifiutato (sessione revocata su un altro dispositivo)
  // va cancellato passando dal login con session=stale: senza, il login
  // rimanderebbe subito qui e il pulsante girerebbe a vuoto.
  const baseLogin = loginPathForMissingSession({
    hadCookie: !session && cookieStore.has(SESSION_COOKIE_NAME),
    callbackPath: callbackUrl,
  });
  const loginHref = baseLogin;
  const registerHref = `${baseLogin}&mode=register`;

  const invitedEmail = normalizeInviteEmail(invitation.email);
  const sessionEmail = normalizeInviteEmail(session?.user.email);
  const wrongAccount = Boolean(session && invitedEmail && sessionEmail !== invitedEmail);
  const switchHref = loginPathForMissingSession({ hadCookie: false, callbackPath: callbackUrl });

  // Chi ha già accesso entra e basta, qualunque sia lo stato del link. Ma se
  // l'invito è per un'altra email, prima si dice che l'account è sbagliato:
  // su un computer condiviso chi apre il proprio invito non deve leggere
  // «sei già dentro» riferito a un altro.
  const access = session ? await getWorkspaceAccessForUser(session.user.id, workspace.id) : null;
  if (access && access.role !== "learner" && !wrongAccount) {
    return (
      <InviteShell>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="space-y-4 p-6">
            <Badge variant="secondary">Hai già accesso</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">Sei già in {workspace.name}</h1>
            <p className="text-sm text-muted-foreground">
              Sei dentro come <span className="font-medium text-foreground">{roleLabel(access.role)}</span>. Questo
              invito non cambia il tuo ruolo: se te ne serve un altro, chiedilo a chi gestisce il workspace.
            </p>
            <Button render={<Link href={`/dashboard/${workspace.id}/portfolio`} />} nativeButton={false} size="lg" className="h-11 w-full">
              Apri {workspace.name}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Connesso come {session?.user.email}.</p>
            <SwitchAccountLink loginHref={switchHref} />
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  const lifecycle = getWorkspaceInvitationLifecycle(invitation);
  if (lifecycle !== "active") return <Unavailable reason={lifecycle} workspaceName={workspace.name} />;

  const role = ROLE_INFO[invitation.role];
  const needsVerification = Boolean(session && invitedEmail && !wrongAccount && !session.user.emailVerified);

  return (
    <InviteShell>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b bg-linear-to-br from-emerald-500/10 via-background to-amber-500/10 p-6">
          <Badge variant="secondary">Invito a collaborare</Badge>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Entra in {workspace.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {organization.name} ti invita a collaborare su «{workspace.name}» in Unbundle. Avrai accesso solo a
            questo workspace, non al resto dell&apos;organizzazione.
          </p>
        </div>
        <CardContent className="space-y-5 p-6">
          <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Il tuo ruolo</div>
                <div className="mt-0.5 font-medium">{role?.label ?? invitation.role}</div>
              </div>
              <div className="text-xs text-muted-foreground">Invito valido fino al {formatDate(invitation.expiresAt)}</div>
            </div>
            {role && (
              <ul className="mt-3 space-y-1.5" aria-label="Cosa potrai fare">
                {role.can.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
                {role.cannot?.map((item) => (
                  <li key={item} className="flex gap-2 text-muted-foreground">
                    <MinusCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {access?.role === "learner" && !wrongAccount && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Ora partecipi a un corso in questo workspace. Accettando diventi {role?.label ?? "collaboratore"} e
              continui a seguire i tuoi corsi.
            </p>
          )}

          {!session ? (
            <div className="space-y-3">
              {invitedEmail && (
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Invito riservato a <span className="font-medium text-foreground">{maskInviteEmail(invitedEmail)}</span>:
                  entra con quella email.
                </p>
              )}
              <Button render={<Link href={registerHref} />} nativeButton={false} size="lg" className="h-11 w-full" data-testid="invite-register">
                Crea il tuo account
              </Button>
              <Button render={<Link href={loginHref} />} nativeButton={false} variant="outline" size="lg" className="h-11 w-full" data-testid="invite-login">
                Ho già un account: accedi
              </Button>
              <p className="text-center text-xs text-muted-foreground">Dopo l&apos;accesso torni qui per entrare.</p>
            </div>
          ) : wrongAccount ? (
            <div className="space-y-3" data-testid="invite-wrong-account">
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Sei connesso come <span className="font-medium">{session.user.email}</span>, ma questo invito è
                riservato a un&apos;altra email ({maskInviteEmail(invitedEmail!)}).
              </p>
              <SwitchAccountButton loginHref={switchHref} />
              {access && access.role !== "learner" ? (
                <p className="text-center text-xs text-muted-foreground">
                  Con questo account sei già in {workspace.name}:{" "}
                  <Link className="underline underline-offset-4" href={`/dashboard/${workspace.id}/portfolio`}>
                    aprilo
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  Oppure chiedi a chi ti ha invitato un link per {session.user.email}.
                </p>
              )}
            </div>
          ) : needsVerification ? (
            <VerifyInviteEmail email={session.user.email} loginHref={loginHref} />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Connesso come <span className="font-medium text-foreground">{session.user.email}</span>.
              </p>
              <WorkspaceInviteAcceptForm token={token} workspaceName={workspace.name} />
              {!invitedEmail && (
                <SwitchAccountLink loginHref={switchHref} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </InviteShell>
  );
}

/** «Non sei tu?» per gli inviti senza email: la persona sbagliata non entra al posto di quella giusta. */
function SwitchAccountLink({ loginHref }: { loginHref: string }) {
  return (
    <details className="text-center text-xs text-muted-foreground">
      <summary className="cursor-pointer underline underline-offset-4">Non sei tu? Usa un altro account</summary>
      <div className="mt-2">
        <SwitchAccountButton loginHref={loginHref} />
      </div>
    </details>
  );
}

function Unavailable({ reason, workspaceName }: { reason: keyof typeof UNAVAILABLE; workspaceName?: string }) {
  const copy = UNAVAILABLE[reason];
  return (
    <InviteShell>
      <Card className="gap-0 py-0">
        <CardContent className="space-y-4 p-6" data-testid={`invite-unavailable-${reason}`}>
          {workspaceName && <Badge variant="outline">{workspaceName}</Badge>}
          <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
          <Button render={<Link href="/dashboard" />} nativeButton={false} variant="outline" className="h-10">
            Hai già un account? Vai ai tuoi workspace
          </Button>
        </CardContent>
      </Card>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-xl flex-col justify-center">
        <Link href="/" className="mb-6 text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        {children}
      </div>
    </main>
  );
}
