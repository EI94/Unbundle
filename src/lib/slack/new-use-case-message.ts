/**
 * Testi di Slack per un nuovo contributo del portafoglio: il messaggio al canale admin
 * (notifyNewUseCase) e la risposta a chi l'ha proposto dopo l'invio riuscito
 * (use-case-agent). Tutti i testi scritti dagli utenti, nome del team compreso, passano
 * da escapeSlackText. Il nome del team va da solo, senza articolo né «team» davanti
 * (docs/use-case/DESIGN.md §14.2). Modulo puro: lo provano i test con Node.
 */
import type { UseCase } from "@/lib/db/schema";
import { connectorStatus, type UseCaseStatusInput } from "../connector/status.ts";
import { escapeSlackText } from "../notifications/sanitize.ts";
import { CONNECTOR_CODE_PHASE, PHASE_LABEL } from "../use-cases/phase.ts";
import { SLACK_INTAKE_SOURCE } from "./use-case-payload.ts";

/** ID utente Slack (U… o W…). */
const SLACK_USER_ID = /^[UW][A-Z0-9]{6,}$/;

/** Le colonne che decidono la fase (`connectorStatus`, DESIGN §3.5). */
type PhaseColumns = "status" | "portfolioReviewStatus" | "reviewedBy" | "publicNote" | "intake" | "reviewBy";

/**
 * La fase della scheda con la parola che vedono i revisori («Da valutare» per una proposta
 * nuova, DESIGN §14.1), mai la chiave dello stato nel database. Solo la fase: il sotto-stato
 * chiede la data di oggi e lo stato del dossier, che il messaggio non ha.
 */
function phaseName(useCase: Pick<UseCase, PhaseColumns>): string {
  const { statusCode } = connectorStatus({
    status: useCase.status,
    portfolioReviewStatus: useCase.portfolioReviewStatus,
    reviewedBy: useCase.reviewedBy ?? null,
    publicNote: useCase.publicNote ?? null,
    intake: (useCase.intake ?? null) as UseCaseStatusInput["intake"],
    reviewBy: useCase.reviewBy ?? null,
  });
  return PHASE_LABEL[CONNECTOR_CODE_PHASE[statusCode]];
}

function portfolioHeadline(useCase: Pick<UseCase, "portfolioKind">): string {
  if (useCase.portfolioKind === "best_practice") {
    return "Nuova best practice proposta :white_check_mark:";
  }
  if (useCase.portfolioKind === "use_case_ai") {
    return "Nuovo use case AI proposto :sparkles:";
  }
  return "Nuovo contributo portfolio proposto :sparkles:";
}

export function buildNewUseCaseSlackText(params: {
  useCase: Pick<
    UseCase,
    | "portfolioKind"
    | "title"
    | "description"
    | "proposedBy"
    | "source"
    | PhaseColumns
    | "overallScore"
    | "overallImpactScore"
    | "overallFeasibilityScore"
    | "overallEsgScore"
  >;
  teamName: string;
  detailUrl: string | null;
}) {
  const { useCase, teamName, detailUrl } = params;

  // Menzione `<@…>` solo per lo Slack intake, dove proposedBy è l'ID Slack di chi ha
  // compilato. Da ogni altra fonte (REST, connettore, web) proposedBy è dichiarato
  // da chi invia: si mostra come testo, anche se somiglia a un ID Slack.
  const proposer =
    useCase.source === SLACK_INTAKE_SOURCE && useCase.proposedBy && SLACK_USER_ID.test(useCase.proposedBy)
      ? `<@${useCase.proposedBy}>`
      : escapeSlackText(useCase.proposedBy ?? "Contributore");

  const excerpt = useCase.description
    ? useCase.description.slice(0, 200) + (useCase.description.length > 200 ? "…" : "")
    : "Nessuna descrizione";

  const lines = [
    portfolioHeadline(useCase),
    "",
    escapeSlackText(useCase.title),
    excerpt ? `Anteprima: ${escapeSlackText(excerpt)}` : "Anteprima: —",
    "",
    `Compilato da: ${proposer}`,
    `Fase in Unbundle: ${phaseName(useCase)} (in coda a ${escapeSlackText(teamName)}).`,
  ];

  if (typeof useCase.overallScore === "number" && useCase.overallScore > 0) {
    lines.push(
      `Ranking AI iniziale: score ${useCase.overallScore.toFixed(2)} · impact ${useCase.overallImpactScore?.toFixed(1) ?? "-"} · feasibility ${useCase.overallFeasibilityScore?.toFixed(1) ?? "-"}${typeof useCase.overallEsgScore === "number" ? ` · esg ${useCase.overallEsgScore.toFixed(1)}` : ""}`
    );
  }

  if (detailUrl) {
    lines.push("", `Apri in Unbundle: ${detailUrl}`);
  } else {
    lines.push(
      "",
      "Per il link diretto alla scheda, configura NEXT_PUBLIC_APP_URL sul server."
    );
  }

  return lines.join("\n");
}

/**
 * Risposta a chi ha proposto su Slack, dopo l'invio riuscito (DESIGN §14.5, D14): il codice
 * della sua proposta, chi la valuta e il link di condivisione. La pagina del link non mostra
 * il codice a chi non è membro: glielo dà questo messaggio. Senza codice (workspace senza
 * configurazione dei codici, o assegnazione non riuscita) la frase resta senza.
 */
export function buildSlackSubmittedReply(params: {
  code: string | null;
  teamName: string;
  link: string | null;
}): string {
  const team = escapeSlackText(params.teamName);
  const code = params.code?.trim();
  const thanks = code
    ? `Grazie, l'ho registrato. Il codice è ${escapeSlackText(code)}: ${team} lo valuta.`
    : `Grazie, l'ho registrato: ${team} lo valuta.`;
  return params.link ? `${thanks}\nScheda Unbundle: ${params.link}` : thanks;
}
