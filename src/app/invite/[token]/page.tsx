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
  keepsCurrentRole,
  maskInviteEmail,
  normalizeInviteEmail,
} from "@/lib/workspace-invite-token";
import { isLearnerOnly } from "@/lib/learning/learner-scope";
import { ROLE_INFO_OUTSIDE, roleLabel } from "@/lib/workspace-roles";
import { INVITE_TEXT, fillInvite, inviteDay } from "@/lib/public/invite";
import { Button } from "@/components/ui/button";
import { Fold } from "@/components/ui-10/fold";
import { PUBLIC_LINK, PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "@/components/public/classes";
import { PublicShell } from "@/components/public/public-shell";
import { PublicStateCard } from "@/components/public/state-card";
import { WorkspaceInviteAcceptForm } from "@/components/workspace/workspace-invite-accept-form";
import { SwitchAccountButton } from "@/components/workspace/switch-account-button";
import { VerifyInviteEmail } from "@/components/workspace/verify-invite-email";

/**
 * L'invito in un workspace (`/invite/<token>`): crea l'account o accedi, poi accetta. Chi ha già accesso entra; un account
 * sbagliato si cambia; un invito riservato a un'email con email e password chiede di confermarla.
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.2) Il guscio unico delle pagine pubbliche,
 * chiaro, il marchio non cliccabile: H1 «{Organizzazione} ti invita in {workspace}», una riga «Ruolo: … · valido fino al
 * 25 novembre», «Cosa potrai fare ▸» chiusa, con i ruoli che dicono «caso d'uso». Un solo pieno per stato; righe di
 * servizio a 14 px; niente colori fissi né «Firebase». Un invito che non si può usare ha la scheda unica, con il motivo in
 * una frase. I testi stanno in `src/lib/public/invite.ts`.
 */
export const metadata: Metadata = {
  title: INVITE_TEXT.metaTitle,
  robots: { index: false, follow: false, nocache: true },
};

const T = INVITE_TEXT;

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
  const ws = { Workspace: workspace.name };

  // Chi ha già accesso entra e basta, qualunque sia lo stato del link. Ma se
  // l'invito è per un'altra email, prima si dice che l'account è sbagliato:
  // su un computer condiviso chi apre il proprio invito non deve leggere
  // «sei già dentro» riferito a un altro.
  // (8.0d) «Già dentro» per elenco, come la decisione dell'accettazione (`keepsCurrentRole`): un collaboratore, o un
  // ruolo che il codice non conosce. Chi segue un corso o è «Solo questo use case» può ancora accettare (e salire).
  const access = session ? await getWorkspaceAccessForUser(session.user.id, workspace.id) : null;
  const alreadyInside = access ? keepsCurrentRole({ orgRole: access.source === "organization" ? access.role : null, workspaceRole: access.source === "workspace" ? access.role : null }) : false;
  if (access && alreadyInside && !wrongAccount) {
    return (
      <PublicShell>
        <div data-testid="invite-already">
          <h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">{fillInvite(T.already.title, ws)}</h1>
          <p className="mt-2 text-muted-foreground">{fillInvite(T.already.body, { Ruolo: roleLabel(access.role) })}</p>
          <Button render={<Link href={`/dashboard/${workspace.id}/portfolio`} />} nativeButton={false} className={`mt-6 ${PUBLIC_PRIMARY}`}>
            {fillInvite(T.already.open, ws)}
          </Button>
          <p className="mt-4 text-sm text-muted-foreground break-words">{fillInvite(T.account, { Email: session?.user.email ?? "" })}</p>
          <SwitchAccountLink loginHref={switchHref} />
        </div>
      </PublicShell>
    );
  }

  const lifecycle = getWorkspaceInvitationLifecycle(invitation);
  if (lifecycle !== "active") return <Unavailable reason={lifecycle} />;

  // (Rilascio 10, §3.11) Fuori dalla dashboard i ruoli dicono «caso d'uso».
  const role = ROLE_INFO_OUTSIDE[invitation.role];
  const needsVerification = Boolean(session && invitedEmail && !wrongAccount && !session.user.emailVerified);

  return (
    <PublicShell>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">{fillInvite(T.title, { Organizzazione: organization.name, Workspace: workspace.name })}</h1>
      <p className="mt-2 text-muted-foreground" data-testid="invite-role">
        {fillInvite(T.roleLine, { Ruolo: role?.label ?? invitation.role, Data: inviteDay(invitation.expiresAt) })}
      </p>

      {role && (
        <Fold id="cosa-potrai-fare" title={T.canDo} className="mt-4">
          <ul className="space-y-1.5" aria-label={T.canDo}>
            {role.can.map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-uc-verde" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
            {role.cannot?.map((item) => (
              <li key={item} className="flex gap-2 text-muted-foreground">
                <MinusCircle className="mt-1 size-4 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{fillInvite(T.onlyThis, ws)}</p>
        </Fold>
      )}

      <div className="mt-6 space-y-3">
        {isLearnerOnly(access?.role) && !wrongAccount && (
          <p className="rounded-xl bg-muted px-4 py-3">{fillInvite(T.learner, { Ruolo: role?.label ?? T.collaborator })}</p>
        )}

        {!session ? (
          <>
            {invitedEmail && <p className="text-muted-foreground break-words">{fillInvite(T.reserved, { Email: maskInviteEmail(invitedEmail) })}</p>}
            <Button render={<Link href={registerHref} />} nativeButton={false} className={PUBLIC_PRIMARY} data-testid="invite-register">
              {T.register}
            </Button>
            <Button render={<Link href={loginHref} />} nativeButton={false} variant="outline" className={PUBLIC_SECONDARY} data-testid="invite-login">
              {T.login}
            </Button>
            <p className="text-center text-sm text-muted-foreground">{T.after}</p>
          </>
        ) : wrongAccount ? (
          <div className="space-y-3" data-testid="invite-wrong-account">
            <p className="rounded-xl bg-uc-giallo-bg px-4 py-3 break-words">
              {fillInvite(T.wrongAccount, { Sessione: session.user.email ?? "", Invito: maskInviteEmail(invitedEmail!) })}
            </p>
            <SwitchAccountButton loginHref={switchHref} className={PUBLIC_PRIMARY} />
            {access && alreadyInside ? (
              <p className="text-center text-sm text-muted-foreground">
                {fillInvite(T.alreadyThere, ws)}{" "}
                <Link className={PUBLIC_LINK} href={`/dashboard/${workspace.id}/portfolio`}>
                  {T.openIt}
                </Link>
                .
              </p>
            ) : (
              <p className="text-center text-sm text-muted-foreground break-words">{fillInvite(T.askLink, { Email: session.user.email ?? "" })}</p>
            )}
          </div>
        ) : needsVerification ? (
          <VerifyInviteEmail email={session.user.email} loginHref={loginHref} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground break-words">{fillInvite(T.account, { Email: session.user.email ?? "" })}</p>
            <WorkspaceInviteAcceptForm token={token} workspaceName={workspace.name} />
            {!invitedEmail && <SwitchAccountLink loginHref={switchHref} />}
          </>
        )}
      </div>
    </PublicShell>
  );
}

/** «Non sei tu?» per gli inviti senza email: la persona sbagliata non entra al posto di quella giusta. */
function SwitchAccountLink({ loginHref }: { loginHref: string }) {
  return (
    <details className="text-center text-sm text-muted-foreground">
      <summary className={`${PUBLIC_LINK} cursor-pointer justify-center`}>{T.notYou}</summary>
      <div className="mt-2">
        <SwitchAccountButton loginHref={loginHref} variant="outline" className={PUBLIC_SECONDARY} />
      </div>
    </details>
  );
}

function Unavailable({ reason }: { reason: keyof typeof INVITE_TEXT.gone }) {
  return (
    <PublicShell>
      <div data-testid={`invite-unavailable-${reason}`}>
        <PublicStateCard kind="link" body={T.gone[reason]}>
          <Button render={<Link href="/dashboard" />} nativeButton={false} variant="outline" className={`mt-5 ${PUBLIC_SECONDARY}`}>
            {T.workspaces}
          </Button>
        </PublicStateCard>
      </div>
    </PublicShell>
  );
}
