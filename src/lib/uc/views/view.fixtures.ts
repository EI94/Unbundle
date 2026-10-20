/**
 * Dati sintetici per i test delle viste (WP9): righe come le restituisce il
 * database, nessun valore di un cliente reale. Non è un file di test.
 */
import type { Row } from "../sql/readiness.ts";
import type { UserContext } from "../types.ts";

export const CASE_ID = "22222222-2222-4222-8222-222222222222";
export const WS_ID = "11111111-1111-4111-8111-111111111111";
export const LS_USER = "33333333-3333-4333-8333-333333333333";
export const OTHER_LS = "44444444-4444-4444-8444-444444444444";
export const OWNER_USER = "55555555-5555-4555-8555-555555555555";
export const CONTACT = "77777777-7777-4777-8777-777777777777";
export const ITEM = "66666666-6666-4666-8666-666666666666";
export const ANSWER = "88888888-8888-4888-8888-888888888888";
export const REQUEST = "99999999-9999-4999-8999-999999999999";

export const lsUser: UserContext = { userId: LS_USER, emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
export const otherLsUser: UserContext = { userId: OTHER_LS, emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
export const ownerUser: UserContext = { userId: OWNER_USER, emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false };

/** Riga di `itemSnapshotsSql`: una domanda in verifica con la risposta di un referente. */
export function snapshotRow(over: Row = {}): Row {
  return {
    id: ITEM,
    key: "q.servizio.01",
    kind: "domanda",
    section: "documenti_dataset",
    status: "in_verifica",
    status_reason: null,
    priority: "must",
    perimeter: "in_contratto",
    serves_for: ["modello"],
    in_gate_scope: true,
    privacy_class: "nessuna",
    value_visibility: "owner_e_ls",
    response_type: "numero",
    response_config: {},
    owner_role_key: "resp_servizio",
    assignee_contact_id: CONTACT,
    requires_validity_period: false,
    freshness_days: null,
    stale_at: null,
    current_answer_id: ANSWER,
    validated_answer_id: null,
    confirmed_by_contact_id: null,
    na_reason: null,
    na_proposed_at: null,
    na_approved_by_user_id: null,
    na_client_approved_by_user_id: null,
    na_approved_by_contact_id: null,
    na_approved_at: null,
    waiver: null,
    waiver_approved_at: null,
    fallback: null,
    fallback_approved_at: null,
    partial_na: null,
    availability: [],
    levers: [],
    request_module_key: "m.servizio.base",
    spec: {},
    title: "Quante richieste arrivano ogni settimana?",
    explanation: null,
    why: "Serve un valore di partenza.",
    example: "120 (esempio inventato).",
    help: null,
    parent_item_id: null,
    due_at: null,
    due_is_proposal: false,
    updated_at: "2026-10-01T10:00:00Z",
    a_id: ANSWER,
    a_version: 1,
    a_kind: "valore",
    a_source_kind: "referente",
    a_responder_contact_id: CONTACT,
    a_responder_user_id: null,
    a_request_id: REQUEST,
    a_valid_from: null,
    a_created_at: "2026-10-02T09:00:00Z",
    a_text_hash: null,
    a_typed: true,
    responder_role_key: "resp_servizio",
    va_valid_from: null,
    va_created_at: null,
    confirmed_by_role_key: null,
    responder_user_ids: [],
    token_issuer_user_ids: [],
    blocker_links: [],
    open_clarification: false,
    active_request_id: null,
    last_auto_check_error: false,
    ...over,
  };
}

/** Riga di `linksTouchingKindsSql`. */
export function linkRow(over: Row): Row {
  return {
    from_item_id: "f",
    to_item_id: "t",
    relation: "usa",
    cardinality: null,
    note: null,
    f_key: "kpi.servizio.tempo",
    f_title: "Tempo",
    f_kind: "kpi",
    f_status: "da_chiedere",
    f_availability: [],
    f_response_type: null,
    t_key: "richiesta.canale",
    t_title: "Canale",
    t_kind: "campo",
    t_status: "da_chiedere",
    t_availability: [],
    t_response_type: null,
    f_confirmed_hash: null,
    ...over,
  };
}

/** Riga di `itemsOfKindsSql`. */
export function modelRow(over: Row): Row {
  return {
    id: "i1",
    key: "kpi.servizio.tempo",
    kind: "kpi",
    title: "Tempo medio alla prima risposta",
    explanation: "Minuti tra apertura e prima risposta.",
    why: null,
    example: null,
    help: null,
    spec: {},
    status: "da_chiedere",
    status_reason: null,
    priority: "must",
    perimeter: "in_contratto",
    serves_for: ["modello"],
    levers: ["tempo"],
    privacy_class: "riservato_azienda",
    availability: [],
    owner_role_key: "resp_servizio",
    response_type: null,
    source_refs: [],
    parent_item_id: null,
    assignee_contact_id: null,
    confirmed_text_hash: null,
    active_blockers: [],
    ...over,
  };
}
