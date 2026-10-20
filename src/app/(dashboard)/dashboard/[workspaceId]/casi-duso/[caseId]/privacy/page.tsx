import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { PersonalZoneSheet } from "@/components/uc/privacy/personal-zone-panel";
import { PrivacyCard } from "@/components/uc/privacy/privacy-card";
import { DataModeRow, PersonalAccessLog, PersonalFilesList, PrivacyDisclosure, PrivacyQuestionsTable, PrivacyRow } from "@/components/uc/privacy/privacy-summary";
import { canWrite, loadCaseHead, ucEmailConfigured, ucPersonalZoneConfigured } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadPrivacyPage } from "@/lib/db/queries/uc-events";
import { canOpenShellPage } from "@/lib/uc/views/case-shell";
import { formatDayIt } from "@/lib/uc/views/format";
import { seesPersonalZoneMetadata } from "@/lib/uc/views/page-access";
import { groupMembers } from "@/lib/uc/views/people";
import {
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
 * Privacy (DESIGN §3.10): è tutto il prodotto dell'approvatore privacy; gli
 * altri ruoli ci arrivano dal «⋯». In alto la scheda privacy con le due firme,
 * poi modalità dei dati e zona dei dati personali («Gestisci ›» apre il
 * pannello degli accessi), la riga sui dati sanitari e due parti chiuse:
 * «Domande per riservatezza» (solo Lateral Space) e «Registro degli accessi»
 * (Lateral Space e approvatore privacy, solo metadati). Gli altri blocchi
 * stanno in Panoramica › Blocchi. Nessun articolo nei testi.
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

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-8">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Privacy</h2>
          <p className="mt-1 text-sm text-muted-foreground">I dati personali reali entrano solo dopo la scheda privacy firmata.</p>
        </div>

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
          />
        )}

        <div className="space-y-2">
          <dl className="divide-y">
            <DataModeRow mode={dataModeView(data.dataMode)} />
            <PrivacyRow
              label="Zona dei dati personali"
              aside={manageZone ? <PersonalZoneSheet workspaceId={workspaceId} caseId={caseId} zoneText={zone.text} members={zoneRows} viewer={zoneViewer} /> : null}
            >
              {zone.text}
            </PrivacyRow>
          </dl>
          <p className="text-sm text-muted-foreground">I dati sanitari non entrano mai nel caso.</p>
        </div>

        {(questionRows.length > 0 || accessLog.length > 0 || personalFiles.length > 0) && (
          <div className="space-y-1">
            {questionRows.length > 0 && (
              <PrivacyDisclosure title="Domande per riservatezza">
                <PrivacyQuestionsTable rows={questionRows} />
              </PrivacyDisclosure>
            )}
            {(accessLog.length > 0 || personalFiles.length > 0) && (
              <PrivacyDisclosure title="Registro degli accessi">
                {accessLog.length > 0 && <PersonalAccessLog events={accessLog} />}
                {personalFiles.length > 0 && (
                  <div className="space-y-1">
                    <h3 className="text-xs tracking-wide text-muted-foreground">File con dati personali</h3>
                    <PersonalFilesList files={personalFiles} />
                  </div>
                )}
              </PrivacyDisclosure>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
