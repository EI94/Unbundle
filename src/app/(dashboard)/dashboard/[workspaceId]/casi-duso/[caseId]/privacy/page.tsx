import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { TextAction } from "@/components/ui-10/row";
import { casePath } from "@/components/uc/catalog/paths";
import { PersonalZoneSheet } from "@/components/uc/privacy/personal-zone-panel";
import { PrivacyCard } from "@/components/uc/privacy/privacy-card";
import { DataModeRow, PersonalAccessLog, PersonalFilesList, PrivacyDisclosure, PrivacyQuestionsTable, PrivacyRow } from "@/components/uc/privacy/privacy-summary";
import { canWrite, loadCaseHead, ucEmailConfigured, ucPersonalZoneConfigured } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadPrivacyPage } from "@/lib/db/queries/uc-events";
import { PERSONAL_DATA_FAMILY } from "@/lib/uc/views/audit";
import { canOpenShellPage } from "@/lib/uc/views/case-shell";
import { formatDayIt } from "@/lib/uc/views/format";
import { seesPersonalZoneMetadata } from "@/lib/uc/views/page-access";
import { groupMembers } from "@/lib/uc/views/people";
import {
  PRIVACY_TEXT,
  a8FormFromEvidence,
  a8SignatureLines,
  blockerView,
  canManagePersonalZone,
  dataModeView,
  personalZoneState,
  privacyCardStatus,
  privacyQuestionRows,
  type ZoneMemberRow,
  type ZoneViewer,
} from "@/lib/uc/views/privacy";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import { LS_CASE_ROLES, type CaseRole } from "@/lib/uc/vocab";
import { clientPlainText } from "@/lib/uc/views/rows";

const isLsRole = (r: CaseRole) => (LS_CASE_ROLES as readonly string[]).includes(r);

/**
 * Privacy (rilascio 10, §3.5; DESIGN §3.10): è tutto il prodotto dell'approvatore privacy; gli altri ruoli ci arrivano
 * dal «⋯». In alto la scheda privacy con le due firme in una riga (le due regole fisse dentro «Cosa approvi», «A.8» in
 * «Dettagli tecnici»), poi modalità dei dati e zona dei dati personali («Gestisci ›» apre il pannello degli accessi).
 * Gli accessi ai dati personali, il vecchio «Registro degli accessi», stanno in Attività › «Dati personali», con un
 * link; chi Attività non la apre (l'analista) li legge qui, in una piega. Poi, chiuse, «File con dati personali»
 * (solo metadati, il tipo in parole) e «Domande per riservatezza» (solo Lateral Space). Al massimo 70 parole in vista.
 * Gli altri blocchi stanno in Panoramica › Blocchi. Nessun articolo nei testi.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  const roles = caseAccess.roles;
  if (!canOpenShellPage("privacy", roles)) notFound();
  const write = canWrite(caseAccess);
  // In pausa i controlli di scrittura non ci sono; togliere un accesso ai dati personali resta possibile.
  const paused = caseAccess.status === "sospeso";
  const lead = write && !paused && roles.includes("ls_lead");

  // Un solo giro dopo la testata: scheda, membri, file indicabili e contesto del caso.
  const data = await loadPrivacyPage(executor, { workspaceId, caseId: caseAccess.caseId, lsDomains: ucLsDomains() });
  if (!data) notFound();
  const ctx = data.context;
  const files = data.usableFiles;
  const memberRows = data.members;

  const now = new Date();
  const members = groupMembers(memberRows, { withEmail: false });
  const lsMembers = members.filter((m) => m.isLateralSpace && m.roles.some(isLsRole));
  // I ruoli che hanno approvato la scheda, come li legge il cliente: senza articoli né sigle (DESIGN §6.2).
  const roleLabels = isLsViewer(roles) ? ctx.roleLabels : Object.fromEntries(Object.entries(ctx.roleLabels).map(([k, v]) => [k, clientPlainText(v) || v]));
  const view = data.a8 ? blockerView(data.a8, { files: new Map(files.map((f) => [f.id, f.name])), people: new Map(lsMembers.map((m) => [m.userId, m.name])), roles: roleLabels }) : null;

  const accessList = data.a8?.evidence?.accesso_zona_personale;
  const a8List = new Set(Array.isArray(accessList) ? accessList.filter((u): u is string => typeof u === "string") : []);
  const zoneRows: ZoneMemberRow[] = lsMembers.map((m) => ({ userId: m.userId, name: m.name, state: m.personalZone, inA8List: a8List.has(m.userId), proposedBy: m.grantProposedBy }));
  const zone = personalZoneState({ a8Status: data.a8?.status ?? null, keyConfigured: ucPersonalZoneConfigured(), activeMembers: zoneRows.filter((m) => m.state === "attiva").length, lsViewer: isLsViewer(roles) });
  const zoneViewer: ZoneViewer = { userId: caseAccess.user.userId, lead: roles.includes("ls_lead"), privacyApprover: roles.includes("approvatore_privacy"), write, paused };
  const manageZone = data.a8?.status === "sciolto" && canManagePersonalZone(zoneRows, zoneViewer);

  const questionRows = isLsViewer(roles) ? privacyQuestionRows(data.classCounts) : [];
  // L'approvatore privacy legge i titoli delle domande come il resto del cliente.
  const plainTitle = <T extends { itemTitle: string | null }>(r: T): T => (isLsViewer(roles) || !r.itemTitle ? r : { ...r, itemTitle: clientPlainText(r.itemTitle) || null });
  const accessLog = seesPersonalZoneMetadata(roles) ? data.accessLog.map(plainTitle) : [];
  const personalFiles = seesPersonalZoneMetadata(roles) ? data.personalFiles.map(plainTitle) : [];

  // Gli accessi ai dati personali: in Attività › «Dati personali» per chi la apre, altrimenti qui (solo metadati).
  const accessHref = accessLog.length > 0 && canOpenShellPage("registro", roles) ? `${casePath(workspaceId, caseId, "attivita")}?tipo=${PERSONAL_DATA_FAMILY}` : null;
  const T = PRIVACY_TEXT;

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <h2 className="text-base font-semibold">{T.title}</h2>

        {/* Senza la scheda privacy (uno schema senza quel blocco) le due regole fisse restano in pagina. */}
        {!view && (
          <ul data-slot="privacy-rules" className="space-y-1 text-sm">
            <li>{T.realDataRule}</li>
            <li>{T.healthRule}</li>
          </ul>
        )}
        {view && (
          <PrivacyCard
            workspaceId={workspaceId}
            caseId={caseId}
            view={view}
            status={privacyCardStatus(view)}
            signatures={a8SignatureLines(view, (iso) => formatDayIt(iso, { now }))}
            prefill={a8FormFromEvidence(data.a8?.evidence ?? null)}
            viewer={{ lead, privacyDesignated: data.privacyDesignated, emailConfigured: ucEmailConfigured() }}
            roles={lead ? Object.entries(ctx.roleLabels).map(([key, label]) => ({ key, label })) : []}
            files={lead ? files : []}
            lsMembers={lead ? lsMembers.map((m) => ({ userId: m.userId, name: m.name })) : []}
            viewerRoles={roles}
          />
        )}

        <dl className="divide-y">
          <DataModeRow mode={dataModeView(data.dataMode)} />
          <PrivacyRow label={T.zone} aside={manageZone ? <PersonalZoneSheet workspaceId={workspaceId} caseId={caseId} zoneText={zone.text} members={zoneRows} viewer={zoneViewer} /> : null}>
            {zone.text}
          </PrivacyRow>
        </dl>

        {accessHref && <TextAction href={accessHref}>{T.accesses}</TextAction>}

        {((!accessHref && accessLog.length > 0) || personalFiles.length > 0 || questionRows.length > 0) && (
          <div className="space-y-1">
            {!accessHref && accessLog.length > 0 && (
              <PrivacyDisclosure title={T.accesses}>
                <PersonalAccessLog events={accessLog} />
              </PrivacyDisclosure>
            )}
            {personalFiles.length > 0 && (
              <PrivacyDisclosure title={T.personalFiles}>
                <PersonalFilesList files={personalFiles} />
              </PrivacyDisclosure>
            )}
            {questionRows.length > 0 && (
              <PrivacyDisclosure title={T.questions}>
                <PrivacyQuestionsTable rows={questionRows} />
              </PrivacyDisclosure>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
