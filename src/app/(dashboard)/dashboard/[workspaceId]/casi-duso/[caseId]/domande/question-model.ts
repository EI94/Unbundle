import "server-only";
import type { QuestionDetailModel } from "@/components/uc/catalog/item-sections";
import { casePath, itemPath } from "@/components/uc/catalog/paths";
import type { ItemDetailData } from "@/lib/db/queries/uc-views";
import { can } from "@/lib/uc/permissions";
import { formatLongDayIt } from "@/lib/uc/views/format";
import {
  activityTimeline,
  askAgainLabel,
  canAskAgain,
  linkedItems,
  pendingSignatureNotice,
  questionActionPlan,
  questionAnswerView,
  statusReasonLine,
} from "@/lib/uc/views/item-detail";
import { PRIVACY_LABEL, blockerLabel } from "@/lib/uc/views/labels";
import { canOpenItem } from "@/lib/uc/views/page-access";
import { clientPlainText, oneQuestionStateLabel } from "@/lib/uc/views/rows";
import { isLsViewer, statusView } from "@/lib/uc/views/status-groups";
import type { Json } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";

/** Al cliente una domanda senza titolo non mostra la chiave (§6.2). */
const UNTITLED = "Domanda senza titolo";

const VISIBILITY_LABEL: Readonly<Record<string, string>> = {
  tutti_i_ruoli_del_caso: "Tutti i ruoli del caso",
  owner_e_ls: "Responsabile del cliente e Lateral Space",
  solo_ls: "Solo Lateral Space",
};

/** Le opzioni di una risposta a scelta, dal template. */
export function choiceOptions(config: Readonly<Record<string, Json>>): { value: string; label: string }[] {
  const raw = config.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    if (typeof o === "string" && o.trim()) return [{ value: o, label: o }];
    if (o && typeof o === "object" && !Array.isArray(o) && typeof o.value === "string") {
      return [{ value: o.value, label: typeof o.label === "string" && o.label ? o.label : o.value }];
    }
    return [];
  });
}

/** La domanda prevede un file: risposta «file» o «dataset», oppure è una fonte o un documento. */
export function expectsFile(data: Pick<ItemDetailData, "loaded">): boolean {
  const s = data.loaded.snapshot;
  return s.responseType === "file" || s.responseType === "dataset" || s.kind === "fonte" || s.kind === "documento";
}

/**
 * Pannello e pagina della domanda per chi guarda (DESIGN §3.6.5, §3.6.8), dal
 * caricatore del dettaglio: azioni dallo stato e dal ruolo, avviso delle
 * firme, risposta, attività in una sola linea del tempo, dettagli tecnici solo
 * per Lateral Space. Al cliente niente codici, nemmeno nell'argomento, nel
 * ruolo di chi risponde e in quelli dei colleghi a cui affidarla; niente
 * autore né data delle risposte, niente scadenza accanto al nome di chi
 * risponde (art. 15.4); una sola azione, «Affida a un altro collega». In
 * pausa, a caso chiuso e in sola lettura le azioni non ci sono.
 */
export function questionDetailModel(
  data: ItemDetailData,
  i: { workspaceId: string; caseId: string; roles: readonly CaseRole[]; readOnly: boolean; now: Date },
): QuestionDetailModel {
  const s = data.loaded.snapshot;
  const x = data.loaded.extra;
  const ls = isLsViewer(i.roles);
  const client = !ls;
  const plain = (t: string | null) => (t && client ? clientPlainText(t) : t);
  const view = statusView(s.status, client ? "cliente" : "ls");
  const writable = !i.readOnly && data.core.status !== "chiuso" && data.core.status !== "sospeso";
  const askAgain = canAskAgain({ status: s.status, hasAssignee: s.assigneeContactId !== null, roles: i.roles, writable });
  const reassign =
    client && writable && can(i.roles, "riassegnare") && s.status !== "validata" && s.status !== "non_applicabile"
      ? { contacts: data.contacts.filter((c) => c.assignable).map((c) => ({ id: c.id, name: c.name, roleLabel: plain(c.roleLabel) || null })), currentId: s.assigneeContactId }
      : null;
  const plan = writable ? questionActionPlan({ status: s.status, actions: data.actions, askAgain, reassign: reassign !== null, client }) : { primary: [], more: [] };
  const current = data.answers.find((a) => a.current) ?? null;
  const activeBlockers = data.blockers.filter((b) => b.active);
  return {
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    itemId: s.id,
    key: s.key,
    title: plain(x.title) || (client ? UNTITLED : ""),
    topic: plain(data.moduleTitle) || null,
    status: { tone: view.tone, label: oneQuestionStateLabel(view, client ? "cliente" : "ls"), sublabel: view.sublabel },
    must: s.priority === "must",
    personal: s.privacyClass === "personale" || s.privacyClass === "personale_equipaggio" || s.privacyClass === "escluso_sanitario",
    outOfContract: s.perimeter === "evoluzione",
    client,
    roles: i.roles,
    blocked: s.status === "bloccata" ? (activeBlockers.length ? [...new Set(activeBlockers.map((b) => blockerLabel(b.key)))].join(", ") : "un blocco ancora attivo") : null,
    reason: statusReasonLine(s.status, plain(x.statusReason), client),
    notice: writable ? pendingSignatureNotice(data.loaded, data.actions, data.core.designated.owner) : null,
    firmeHref: casePath(i.workspaceId, i.caseId, "firme"),
    actions:
      plan.primary.length + plan.more.length > 0
        ? {
            workspaceId: i.workspaceId,
            caseId: i.caseId,
            itemId: s.id,
            plan,
            actions: data.actions,
            askAgainLabel: askAgainLabel(s.status),
            responseType: s.responseType,
            options: choiceOptions(x.responseConfig),
            requiresValidity: s.requiresValidityPeriod,
            reassign,
          }
        : null,
    answer: questionAnswerView(data.answers, data.validations, { client, now: i.now }),
    files: ls && expectsFile(data) ? data.files : null,
    about: { explanation: plain(x.explanation), why: plain(x.why), example: plain(x.example), help: plain(x.help) },
    activity: { entries: activityTimeline(data.comments, data.events, i.now), visibilities: writable ? data.actions.commentVisibilities : [], canResolve: writable && data.actions.resolveClarification },
    tech: ls
      ? {
          spec: data.spec,
          relations: data.links,
          privacy: PRIVACY_LABEL[s.privacyClass],
          visibility: x.valueVisibility ? (VISIBILITY_LABEL[x.valueVisibility] ?? x.valueVisibility) : null,
          sources: data.header.sourceRefs,
          blockers: data.blockers,
          textHash: current?.textHash ?? null,
          validated: data.header.validatedAt ? `${data.header.validatedAt}${data.header.validatedBy ? `, ${data.header.validatedBy}` : ""}` : null,
        }
      : null,
    linked: linkedItems(data.links).map((l) => {
      const v = statusView(l.status, client ? "cliente" : "ls");
      return { id: l.id, title: plain(l.title) || (client ? UNTITLED : l.key), tone: v.tone, label: oneQuestionStateLabel(v, client ? "cliente" : "ls"), href: canOpenItem(i.roles, l.status) ? itemPath(i.workspaceId, i.caseId, l.id) : null };
    }),
    side: {
      assignee: data.assigneeName,
      roleLabel: plain(data.ownerRoleLabel) || null,
      // Accanto al referente, la scadenza sarebbe una data per persona: al cliente no (art. 15.4).
      due: ls && x.dueAt ? `${formatLongDayIt(x.dueAt)}${x.dueIsProposal ? " (proposta)" : ""}` : null,
    },
    fullHref: itemPath(i.workspaceId, i.caseId, s.id),
  };
}
