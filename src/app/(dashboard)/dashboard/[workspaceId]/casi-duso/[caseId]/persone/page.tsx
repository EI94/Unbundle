import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";
import { casePath } from "@/components/uc/catalog/paths";
import { AddContactSheet } from "@/components/uc/people/contact-sheet";
import { MembersPanel } from "@/components/uc/people/members-panel";
import { PeopleList, type PeopleCan, type PersonRequestView } from "@/components/uc/people/people-list";
import { SendSheet } from "@/components/uc/people/send-sheet";
import type { SignerSlot } from "@/components/uc/people/signers-panel";
import { WidgetBoundary } from "@/components/uc/people/widget-boundary";
import { audienceOf, canWrite, loadCaseHead, openShellPage, ucEmailConfigured } from "@/components/uc/shell/case-data";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { SectionHeading } from "@/components/uc/ui/section-heading";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadPeopleView } from "@/lib/db/queries/uc-people-view";
import { loadCaseMembers, loadMemberCandidates, loadSignerDesignations, loadUsableCaseFiles } from "@/lib/db/queries/uc-shell";
import { caseGrantUserIds } from "@/lib/db/queries/use-case-builders";
import { exportChoices } from "@/lib/uc/export/request";
import { addDays, romeDate } from "@/lib/uc/notify/schedule";
import { stepHiddenOn } from "@/lib/uc/views/case-shell";
import { formatDayIt } from "@/lib/uc/views/format";
import { dayWithArticle } from "@/lib/uc/views/labels";
import { clientPlainText } from "@/lib/uc/views/rows";
import { caseNextSteps, nextStepFor, resolveStepHref } from "@/lib/uc/views/next-step";
import { canOpenPage, seesValidatedOnly } from "@/lib/uc/views/page-access";
import { EMAIL_OFF_TEXT, PEOPLE_TEXT, clientPeopleRows, groupMembers, lsPeopleRows, peopleHaveSendWork, personRoleText, signerCandidates, unassignedRoleRows } from "@/lib/uc/views/people";

function first(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s : null;
}

/**
 * La testata mostra il suo pulsante pieno anche su Persone? Lo stesso passo del
 * guscio (`nextStepFor`, dati della testata in un giro, una volta per
 * richiesta), che si nasconde sulla pagina in cui porta (`stepHiddenOn`): così
 * «Invia le domande», «Aggiungi i referenti» e «Indica chi firma la privacy»
 * lasciano il pieno alla pagina, «Verifica 3 risposte» no.
 */
async function headerPrimaryOn(workspaceId: string, caseId: string, userId: string, workspaceRole: string, pagePath: string): Promise<boolean> {
  const { caseAccess, header } = await loadCaseHead(workspaceId, caseId, userId, workspaceRole);
  const next = nextStepFor(caseNextSteps(header.nextStep, { roles: caseAccess.roles }));
  if (!next) return false;
  // Come il guscio: «Scarica il catalogo validato» c'è solo con un export possibile.
  const exportable = exportChoices(caseAccess.roles, header.case.catalogVersion);
  if (next.id === "scarica_catalogo" && !exportable.validated && !exportable.draft) return false;
  const caseBase = casePath(workspaceId, caseId);
  return !stepHiddenOn({ href: resolveStepHref(caseBase, next.href), caseBase, panel: Boolean(next.transition) || next.id === "scarica_catalogo" }, pagePath);
}

/**
 * Persone (rilascio 10, §3.5; DESIGN §3.9): due gruppi.
 *
 * - «Rispondono per il cliente»: chi risponde, in una lista sola e in ordine alfabetico, con chi firma per il cliente
 *   come chip («firma il via», «firma la privacy») e una riga sola se manca qualcuno. Un solo «Invia le domande»
 *   (`?invia=1`, i passi e l'email vera come «Chiedi al referente») e «Aggiungi» (`?nuovo=1`, tre campi più «Altro»).
 * - «Nella realizzazione», solo per il responsabile Lateral Space (che li vedeva in Impostazioni del caso): gli account
 *   con i loro ruoli e chi costruisce la realizzazione.
 *
 * Chi vede che cosa resta com'era: il responsabile Lateral Space modifica; l'analista legge la stessa lista; il
 * responsabile del cliente (art. 15.4) legge nome, ruolo, firma e stato, senza conteggi né date, aggiunge altre persone,
 * assegna le domande senza referente, affida quelle di una persona a un'altra e indica chi firma.
 *
 * In pausa, a realizzazione chiusa e in sola lettura i controlli di scrittura non ci sono.
 */
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await openShellPage({ workspaceId, caseId, session, access, page: "persone" });
  const roles = caseAccess.roles;
  const audience = audienceOf(caseAccess);
  const ls = audience === "lateral_space";
  const write = canWrite(caseAccess);
  const isLead = roles.includes("ls_lead");
  const isOwner = roles.includes("owner_cliente");

  const lsDomains = ucLsDomains();
  // «Nella realizzazione»: gli account e chi costruisce, per il solo responsabile Lateral Space (prima in Impostazioni del caso).
  const [view, files, designations, memberRows, candidates, builderIds] = await Promise.all([
    loadPeopleView(executor, { workspaceId, caseId, audience }),
    write && (isLead || isOwner) ? loadUsableCaseFiles(executor, { workspaceId, caseId }) : Promise.resolve([]),
    loadSignerDesignations(executor, { workspaceId, caseId }),
    isLead ? loadCaseMembers(executor, { workspaceId, caseId, lsDomains }) : Promise.resolve([]),
    isLead && write ? loadMemberCandidates(executor, { workspaceId, lsDomains }) : Promise.resolve([]),
    // (8.0c) Chi costruisce il caso da fuori: la sua riga «Osservatore» dice «costruisce».
    isLead ? caseGrantUserIds(executor, caseId) : Promise.resolve([]),
  ]);
  if (!view) notFound();
  // Al cliente i ruoli senza articoli, sigle o chiavi del template (DESIGN §6.2): «… (A.8)» → «…».
  const plain = (t: string) => (ls ? t : clientPlainText(t) || t);
  const roleLabels = ls ? view.roleLabels : Object.fromEntries(Object.entries(view.roleLabels).map(([k, v]) => [k, plain(v)]));
  const templateRoles = ls ? view.templateRoles : view.templateRoles.map((r) => ({ ...r, label: plain(r.label) }));
  const contacts = ls ? view.contacts : view.contacts.map((c) => ({ ...c, roleLabel: c.roleLabel ? plain(c.roleLabel) : c.roleLabel }));

  const active = write && view.caseStatus !== "sospeso" && view.caseStatus !== "chiuso";
  const can: PeopleCan = {
    manage: active && isLead,
    send: active && isLead,
    clientAssign: active && isOwner && !isLead,
    designate: active && (isLead || isOwner),
    clearSigner: active && isLead,
  };
  const canAdd = active && (isLead || isOwner);
  const emailConfigured = ucEmailConfigured();
  const sp = await searchParams;
  const base = casePath(workspaceId, caseId, "persone");
  const sendHref = `${base}?invia=1`;
  const addHref = `${base}?nuovo=1`;

  const input = { contacts: contacts, requests: view.requests as PersonRequestView[], roleLabels: roleLabels, designated: view.designated };
  const lsRows = ls ? lsPeopleRows(input) : [];
  const clientRows = ls ? [] : clientPeopleRows(input);
  const unassigned = unassignedRoleRows(view.roleGroups, roleLabels, contacts);
  const assignable = contacts.filter((c) => c.isActive && !c.anonymized);
  const contactOptions = assignable.map((c) => ({ id: c.id, name: c.displayName, roleLabel: personRoleText(c, roleLabels) })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  const signerOptions = signerCandidates(contacts).map((c) => ({ id: c.id, name: c.displayName, roleLabel: personRoleText(c, roleLabels) }));
  // Anche le domande assegnate dopo un link ancora aperto: quel link non le contiene.
  const hasWork = peopleHaveSendWork(unassigned, lsRows);
  // Nessun referente: lo stato vuoto con «Aggiungi un referente» come unico primario, lo stesso
  // passo che indica la testata («Aggiungi i referenti»). Le righe «Senza referente» tornano col primo.
  const empty = lsRows.length === 0 && clientRows.length === 0;
  const showSend = !empty && can.send && hasWork;
  // Un solo pulsante pieno (DESIGN §1.2): «Invia le domande» è pieno solo se la testata non mostra qui il suo primario.
  const sendFilled = showSend && !(await headerPrimaryOn(workspaceId, caseId, session.user.id, access.role, base));

  const nameOf = (id: string | null) => {
    const c = id ? contacts.find((x) => x.id === id) : null;
    return c ? { id: c.id, name: c.displayName, roleLabel: personRoleText(c, roleLabels) } : null;
  };
  const evidenceText = (d: "owner" | "privacy") => {
    const x = designations[d];
    if (!x) return null;
    const when = formatDayIt(x.at);
    return [x.evidenceFileName ? `Prova: ${x.evidenceFileName}` : "Prova scritta registrata", when ? `indicato ${dayWithArticle("il", when)}` : null].filter(Boolean).join(" · ");
  };
  const slots: SignerSlot[] = (["owner", "privacy"] as const).map((d) => ({ designation: d, current: nameOf(view.designated[d]), evidenceText: evidenceText(d) }));
  const catalogBase = ls && canOpenPage("voci", roles) && !seesValidatedOnly(roles) ? casePath(workspaceId, caseId, "domande") : null;
  // (Rilascio 10, §3.5) I file stanno nel pannello «File» di Domande (`?apri=file`, l'indirizzo concordato).
  const documentsHref = canOpenPage("documenti", roles) ? `${casePath(workspaceId, caseId, "domande")}?apri=file` : null;
  const today = romeDate(new Date());
  // La riga «A» dell'anteprima dell'email: solo per chi apre il pannello (il responsabile Lateral Space).
  const emails = can.send ? Object.fromEntries(contacts.map((c) => [c.id, c.email])) : {};
  const editableMembers = write && isLead && view.caseStatus !== "sospeso";

  return (
    <PageContainer>
      <div className="space-y-8">
        <section className="space-y-3" aria-labelledby="uc-people-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeading id="uc-people-title" title={PEOPLE_TEXT.clientGroup} />
            {!empty && (showSend || canAdd) ? (
              <div className="flex flex-wrap gap-2">
                {showSend && (
                  <Button variant={sendFilled ? "default" : "outline"} className="min-h-11 sm:min-h-8" render={<Link href={sendHref} scroll={false} />} nativeButton={false}>
                    {PEOPLE_TEXT.send}
                  </Button>
                )}
                {canAdd && (
                  <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={addHref} scroll={false} />} nativeButton={false}>
                    <Plus aria-hidden />
                    {PEOPLE_TEXT.add}
                  </Button>
                )}
              </div>
            ) : null}
          </div>

          {empty ? (
            <EmptyState
              icon={Users}
              title={PEOPLE_TEXT.emptyTitle}
              action={
                canAdd ? (
                  <Button className="min-h-11 sm:min-h-8" render={<Link href={addHref} scroll={false} />} nativeButton={false}>
                    {PEOPLE_TEXT.emptyAction}
                  </Button>
                ) : undefined
              }
            >
              {PEOPLE_TEXT.emptyBody}
            </EmptyState>
          ) : (
            <PeopleList
              workspaceId={workspaceId}
              caseId={caseId}
              view={ls ? { audience: "lateral_space", rows: lsRows } : { audience: "cliente", rows: clientRows }}
              unassigned={unassigned}
              contactOptions={contactOptions}
              signerOptions={signerOptions}
              signers={slots}
              files={files}
              templateRoles={templateRoles}
              can={can}
              emailConfigured={emailConfigured}
              today={today}
              maxExpiry={addDays(today, 30)}
              catalogBase={catalogBase}
              documentsHref={documentsHref}
              sendHref={sendHref}
            />
          )}
          {ls && !emailConfigured && !empty && <p className="text-xs text-muted-foreground">{EMAIL_OFF_TEXT}</p>}
        </section>

        {isLead && (
          <section className="space-y-3" aria-labelledby="uc-people-case">
            <SectionHeading id="uc-people-case" title={PEOPLE_TEXT.caseGroup} />
            <MembersPanel
              workspaceId={workspaceId}
              caseId={caseId}
              members={groupMembers(memberRows, { withEmail: true })}
              candidates={candidates.map((m) => ({ userId: m.userId, name: m.name, isLateralSpace: m.isLateralSpace }))}
              canManage={editableMembers}
              builderIds={builderIds}
            />
          </section>
        )}
      </div>

      {first(sp.invia) === "1" && can.send && (
        <WidgetBoundary title="Il pannello «Invia le domande»" showCode={ls}>
          <SendSheet
            workspaceId={workspaceId}
            caseId={caseId}
            roles={unassigned}
            contacts={contactOptions}
            emails={emails}
            emailConfigured={emailConfigured}
            clientName={view.clientName}
            caseTitle={view.caseTitle}
            canReassign={isLead}
            addHref={`${base}?nuovo=1&poi=invia`}
          />
        </WidgetBoundary>
      )}
      {first(sp.nuovo) === "1" && canAdd && <AddContactSheet workspaceId={workspaceId} caseId={caseId} roles={templateRoles} />}
    </PageContainer>
  );
}
