import test from "node:test";
import assert from "node:assert/strict";
import { isLateralSpaceEmail, userContextFrom } from "../uc/lateral-space.ts";
import { subprocessorDeclarerOf } from "../uc/legal/subprocessors.ts";
import {
  AGENT_VIEWER,
  canRemoveDocument,
  contextAbilities,
  contextActorForCli,
  documentVisibilityFor,
  isClientSource,
  isLearnedSource,
  questionVisibilityFor,
  visibleTo,
  type ContextAbilities,
} from "./visibility.ts";
import { LEARNED_SOURCE_PREFIX } from "./vocab.ts";

// Chi vede e chi fa in «Contesto» (RILASCIO-9a-COSTRUZIONE.md §5.1): la tabella, riga per riga, per i cinque tipi di
// persona. Persone inventate.

const LS = ["ls.test"];
type Kind = "ls" | "ls_contributor" | "reviewer" | "contributor" | "learner" | "nobody";
const PEOPLE: Record<Kind, { email: string; verified: boolean; role: string | null }> = {
  ls: { email: "ada@ls.test", verified: true, role: "transformation_lead" },
  ls_contributor: { email: "bea@ls.test", verified: true, role: "contributor" },
  reviewer: { email: "carla@cliente.test", verified: true, role: "analyst" },
  contributor: { email: "dino@cliente.test", verified: true, role: "contributor" },
  learner: { email: "elio@cliente.test", verified: true, role: "learner" },
  nobody: { email: "fabio@altrove.test", verified: true, role: null },
};
const viewer = (kind: Kind, domains: readonly string[] = LS) => {
  const p = PEOPLE[kind];
  return { userId: `utente-${kind}`, role: p.role, isLateralSpace: isLateralSpaceEmail({ email: p.email, emailVerified: p.verified }, domains) };
};
const abilities = (kind: Kind, domains: readonly string[] = LS) => contextAbilities(viewer(kind, domains));

/** Una riga della tabella: l'azione e chi la può fare. */
const TABLE: Array<[keyof ContextAbilities, Record<Kind, boolean>]> = [
  // Aprire «Contesto»; fatti «Per tutti»; «In breve»; dati della Discovery
  ["canOpen", { ls: true, ls_contributor: true, reviewer: true, contributor: true, learner: false, nobody: false }],
  // Dipendenti e ricavo (dal vivo): i revisori, anche di Lateral Space
  ["canSeeCompanyFigures", { ls: true, ls_contributor: false, reviewer: true, contributor: false, learner: false, nobody: false }],
  // Fatti «Solo Lateral Space»; citazioni; storia; chi ha confermato; appunti
  ["seesLateralSpace", { ls: true, ls_contributor: true, reviewer: false, contributor: false, learner: false, nobody: false }],
  // «Aggiungi appunti», «Leggi», «Rileggi», «Togli» un appunto
  ["canAddNotes", { ls: true, ls_contributor: true, reviewer: false, contributor: false, learner: false, nobody: false }],
  // «Da confermare»: vedere, correggere, confermare, scartare
  ["canConfirm", { ls: true, ls_contributor: true, reviewer: false, contributor: false, learner: false, nobody: false }],
  // «Scrivi un fatto», modificare, «Ancora vero», «Non più vero», visibilità; impegni «Fatto», domande «Chiusa»
  ["canEditMemory", { ls: true, ls_contributor: true, reviewer: false, contributor: false, learner: false, nobody: false }],
  // «Chiedi al contesto»
  ["canAsk", { ls: true, ls_contributor: true, reviewer: true, contributor: true, learner: false, nobody: false }],
  // Aggiungere una domanda aperta (da «Chiedi»)
  ["canAddQuestion", { ls: true, ls_contributor: true, reviewer: true, contributor: true, learner: false, nobody: false }],
  // Documenti: caricare
  ["canUploadDocuments", { ls: true, ls_contributor: true, reviewer: true, contributor: true, learner: false, nobody: false }],
  // Risposte dei referenti e decisioni in «Chiedi»: i revisori
  ["canSeeReviewerSources", { ls: true, ls_contributor: false, reviewer: true, contributor: false, learner: false, nobody: false }],
  // Granola: collegare, regole, «Aggiorna», «Da smistare»
  ["canUseGranola", { ls: true, ls_contributor: true, reviewer: false, contributor: false, learner: false, nobody: false }],
];

test("la tabella del §5.1, riga per riga, per ogni tipo di persona", () => {
  for (const [ability, expected] of TABLE) {
    for (const kind of Object.keys(PEOPLE) as Kind[]) {
      assert.equal(abilities(kind)[ability], expected[kind], `${ability} per ${kind}`);
    }
  }
  // Ogni capacità della funzione ha la sua riga: una capacità nuova senza riga fa fallire il test.
  assert.deepEqual(Object.keys(abilities("ls")).sort(), TABLE.map(([ability]) => ability).sort());
});

test("chi segue solo un corso e chi non ha un ruolo non possono niente, nemmeno con un'e-mail di Lateral Space", () => {
  for (const role of ["learner", null, "", "admin", "owner"]) {
    const none = contextAbilities({ role, isLateralSpace: true });
    assert.equal(Object.values(none).some(Boolean), false, String(role));
  }
});

test("senza domini di Lateral Space nessuno scrive: la pagina si legge e basta", () => {
  for (const kind of Object.keys(PEOPLE) as Kind[]) {
    const a = abilities(kind, []);
    for (const ability of ["seesLateralSpace", "canAddNotes", "canConfirm", "canEditMemory", "canUseGranola"] as const) {
      assert.equal(a[ability], false, `${ability} per ${kind}`);
    }
  }
  assert.equal(abilities("ls", []).canOpen, true, "chi è nel workspace legge ancora");
  // Un'e-mail di Lateral Space non verificata non è Lateral Space.
  assert.equal(contextAbilities({ role: "analyst", isLateralSpace: isLateralSpaceEmail({ email: "ada@ls.test", emailVerified: false }, LS) }).canConfirm, false);
});

test("visibleTo: «Per tutti» a chi apre la pagina, «Solo Lateral Space» solo a Lateral Space", () => {
  assert.equal(visibleTo(viewer("ls"), "ls"), true);
  assert.equal(visibleTo(viewer("ls"), "tutti"), true);
  for (const kind of ["reviewer", "contributor"] as const) {
    assert.equal(visibleTo(viewer(kind), "tutti"), true, kind);
    assert.equal(visibleTo(viewer(kind), "ls"), false, kind);
  }
});

test("documenti: «Togli» a Lateral Space, a chi gestisce il workspace e a chi l'ha caricato", () => {
  const byOther = { uploadedByUserId: "un-altro" };
  assert.equal(canRemoveDocument(viewer("ls"), byOther), true);
  assert.equal(canRemoveDocument(viewer("ls_contributor"), byOther), true);
  // Cliente revisore: chi gestisce il workspace (Sponsor esecutivo, Responsabile della trasformazione), o chi l'ha caricato.
  assert.equal(canRemoveDocument({ userId: "u1", role: "exec_sponsor", isLateralSpace: false }, byOther), true);
  assert.equal(canRemoveDocument({ userId: "u1", role: "transformation_lead", isLateralSpace: false }, byOther), true);
  assert.equal(canRemoveDocument({ userId: "u1", role: "function_lead", isLateralSpace: false }, byOther), false);
  assert.equal(canRemoveDocument({ userId: "u1", role: "analyst", isLateralSpace: false }, byOther), false);
  assert.equal(canRemoveDocument({ userId: "u1", role: "analyst", isLateralSpace: false }, { uploadedByUserId: "u1" }), true);
  // Cliente contributore: solo i suoi.
  assert.equal(canRemoveDocument({ userId: "u2", role: "contributor", isLateralSpace: false }, { uploadedByUserId: "u2" }), true);
  assert.equal(canRemoveDocument({ userId: "u2", role: "contributor", isLateralSpace: false }, byOther), false);
  assert.equal(canRemoveDocument({ userId: "u2", role: "contributor", isLateralSpace: false }, { uploadedByUserId: null }), false);
  // Solo formazione: mai, nemmeno i suoi.
  assert.equal(canRemoveDocument({ userId: "u3", role: "learner", isLateralSpace: false }, { uploadedByUserId: "u3" }), false);
  assert.equal(canRemoveDocument({ userId: "u3", role: "learner", isLateralSpace: true }, { uploadedByUserId: "u3" }), false);
});

test("una domanda da «Chiedi» nasce `ls` se la aggiunge Lateral Space, `tutti` altrimenti; un documento `ls` solo da «Aggiungi appunti» di Lateral Space", () => {
  assert.equal(questionVisibilityFor(viewer("ls")), "ls");
  assert.equal(questionVisibilityFor(viewer("reviewer")), "tutti");
  assert.equal(questionVisibilityFor(viewer("contributor")), "tutti");
  assert.equal(documentVisibilityFor(viewer("ls"), "appunti"), "ls");
  assert.equal(documentVisibilityFor(viewer("ls"), "chat"), "tutti");
  assert.equal(documentVisibilityFor(viewer("reviewer"), "appunti"), "tutti");
  assert.equal(documentVisibilityFor(viewer("contributor"), "chat"), "tutti");
});

test("l'ok ai sub-responsabili: Lateral Space con un clic e il cliente con la casella, solo con i tre ruoli; gli altri no", () => {
  const declarer = (kind: Kind, role: string | null) => {
    const p = PEOPLE[kind];
    return subprocessorDeclarerOf(userContextFrom({ id: "u", email: p.email, emailVerified: p.verified ? new Date() : null }, LS), role, LS);
  };
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead"]) {
    assert.equal(declarer("ls", role), "lateral_space", role);
    assert.equal(declarer("reviewer", role), "cliente", role);
  }
  for (const role of ["analyst", "contributor", "learner", null]) {
    assert.equal(declarer("ls", role), null, String(role));
    assert.equal(declarer("reviewer", role), null, String(role));
  }
});

// ─── (9b) La CLI, gli agenti, le fonti nuove (RILASCIO-9b-COSTRUZIONE.md §4.1) ───

test("(9b) contextActorForCli: la persona della CLI, canale «cli», con il ruolo e Lateral Space riletti dalla rotta", () => {
  const ls = contextActorForCli({ workspaceId: "ws-1", userId: "u-1", role: "transformation_lead", isLateralSpace: true });
  assert.deepEqual(ls, { workspaceId: "ws-1", userId: "u-1", role: "transformation_lead", isLateralSpace: true, channel: "cli" });
  assert.equal(contextAbilities(ls).canAddNotes, true);
  const external = contextActorForCli({ workspaceId: "ws-1", userId: "u-2", role: "analyst", isLateralSpace: false });
  assert.equal(external.channel, "cli");
  assert.equal(contextAbilities(external).seesLateralSpace, false);
  // Un valore che non è vero non fa diventare Lateral Space.
  assert.equal(contextActorForCli({ workspaceId: "ws-1", userId: "u-3", role: "analyst", isLateralSpace: "sì" as unknown as boolean }).isLateralSpace, false);
});

test("(9b, D1) AGENT_VIEWER vede solo «Per tutti»: mai un fatto «Solo Lateral Space», nemmeno per Lateral Space", () => {
  assert.deepEqual({ ...AGENT_VIEWER }, { role: "contributor", isLateralSpace: false });
  assert.ok(Object.isFrozen(AGENT_VIEWER));
  assert.equal(visibleTo(AGENT_VIEWER, "ls"), false);
  assert.equal(visibleTo(AGENT_VIEWER, "tutti"), true);
  const abilities = contextAbilities(AGENT_VIEWER);
  assert.equal(abilities.canOpen, true);
  assert.equal(abilities.seesLateralSpace, false);
  assert.equal(abilities.canSeeCompanyFigures, false, "niente cifre dei revisori");
  assert.equal(abilities.canSeeReviewerSources, false, "niente risposte dei referenti né decisioni");
});

test("(9b) una fonte `risposta` è sempre del cliente; una cosa imparata si riconosce da origine e prefisso", () => {
  for (const visibility of ["ls", "tutti"] as const) {
    for (const addedByLateralSpace of [true, false]) {
      assert.equal(isClientSource({ kind: "risposta", visibility, addedByLateralSpace }), true, `${visibility} ${addedByLateralSpace}`);
    }
  }
  // Le regole di prima non cambiano.
  assert.equal(isClientSource({ kind: "appunti", visibility: "ls", addedByLateralSpace: true }), false);
  assert.equal(isClientSource({ kind: "documento", visibility: "ls", addedByLateralSpace: true }), false);
  assert.equal(isClientSource({ kind: "documento", visibility: "tutti", addedByLateralSpace: true }), true);
  assert.equal(LEARNED_SOURCE_PREFIX, "impara:");
  assert.equal(isLearnedSource({ origin: "cli", externalId: "impara:3f2a9c1e-0000-4000-8000-000000000001" }), true);
  assert.equal(isLearnedSource({ origin: "cli", externalId: null }), false, "un appunto mandato con `unbundle nota`");
  assert.equal(isLearnedSource({ origin: "web", externalId: "impara:3f2a9c1e-0000-4000-8000-000000000001" }), false);
  assert.equal(isLearnedSource({ origin: null, externalId: undefined }), false);
});
