import test from "node:test";
import assert from "node:assert/strict";
import {
  LARGE_TEMPLATE_QUESTIONS,
  START_TEMPLATE_TEXT,
  needsLargeTemplateConfirm,
  significantWords,
  startTemplateOptions,
  templateMatchesUseCase,
  type StartTemplateSource,
} from "./start-templates.ts";

// Solo esempi inventati: nessun cliente, nessun codice o titolo reale.
const FROM_USE_CASE: StartTemplateSource = {
  id: "00000000-0000-4000-8000-000000000001",
  key: "unbundle.dal_caso",
  name: "Dal caso d'uso",
  archetype: "dal_caso",
  industry: null,
  functionArea: null,
  restricted: false,
  questions: 0,
  fromUseCase: true,
};

const RESERVED_SHIFTS: StartTemplateSource = {
  id: "00000000-0000-4000-8000-000000000002",
  key: "settore.turni_reparto",
  name: "Settore · Turni di reparto",
  archetype: "ottimizzazione",
  industry: "logistica",
  functionArea: "turni degli equipaggi",
  restricted: true,
  questions: 1234,
  fromUseCase: false,
};

const PUBLIC_SERVICE: StartTemplateSource = {
  id: "00000000-0000-4000-8000-000000000003",
  key: "esempio.minimo",
  name: "Esempio · Gestione richieste",
  archetype: "decisione_assistita",
  industry: "servizi",
  functionArea: "assistenza clienti",
  restricted: false,
  questions: 12,
  fromUseCase: false,
};

const NO_AREA: StartTemplateSource = {
  id: "00000000-0000-4000-8000-000000000004",
  key: "settore.generico",
  name: "Settore · Generico",
  archetype: "decisione_assistita",
  industry: "servizi",
  functionArea: null,
  restricted: false,
  questions: 30,
  fromUseCase: false,
};

const SALES_CASE = { title: "Elenco mensile di contatti per una fiera inventata", problem: "Oggi l'elenco si compila a mano ogni mese.", flow: null };
const SHIFTS_CASE = { title: "Proposta dei turni per gli equipaggi di reparto", problem: "Il turno si compone a mano.", flow: "Si leggono le disponibilità, si propone il turno." };

test("«Dal caso d'uso» viene per primo ed è scelto all'apertura, anche con uno schema riservato che combacia", () => {
  const choice = startTemplateOptions([RESERVED_SHIFTS, PUBLIC_SERVICE, FROM_USE_CASE], { fromUseCaseQuestions: 6, useCase: SHIFTS_CASE });
  assert.equal(choice.proposed[0]?.id, FROM_USE_CASE.id);
  assert.equal(choice.preselectedId, FROM_USE_CASE.id);
  assert.deepEqual(
    choice.proposed.map((o) => o.id),
    [FROM_USE_CASE.id, RESERVED_SHIFTS.id],
  );
  assert.deepEqual(
    choice.others.map((o) => o.id),
    [PUBLIC_SERVICE.id],
  );
});

test("uno schema riservato non è mai scelto all'apertura, nemmeno senza «Dal caso d'uso»", () => {
  for (const useCase of [SHIFTS_CASE, SALES_CASE]) {
    const choice = startTemplateOptions([RESERVED_SHIFTS, PUBLIC_SERVICE], { fromUseCaseQuestions: 0, useCase });
    assert.equal(choice.preselectedId, null);
    const all = [...choice.proposed, ...choice.others];
    assert.ok(all.some((o) => o.id === RESERVED_SHIFTS.id), "lo schema riservato resta sceglibile");
  }
  const withFromUseCase = startTemplateOptions([RESERVED_SHIFTS, FROM_USE_CASE], { fromUseCaseQuestions: 3, useCase: SALES_CASE });
  assert.notEqual(withFromUseCase.preselectedId, RESERVED_SHIFTS.id);
  // Il caso di vendita non vede lo schema dei turni tra i proposti.
  assert.deepEqual(
    withFromUseCase.proposed.map((o) => o.id),
    [FROM_USE_CASE.id],
  );
  assert.deepEqual(
    withFromUseCase.others.map((o) => o.id),
    [RESERVED_SHIFTS.id],
  );
});

test("la riga di ogni schema dice per che tipo di caso è e quante domande porta", () => {
  const choice = startTemplateOptions([PUBLIC_SERVICE, FROM_USE_CASE, RESERVED_SHIFTS, NO_AREA], { fromUseCaseQuestions: 6, useCase: SALES_CASE });
  const line = (id: string) => [...choice.proposed, ...choice.others].find((o) => o.id === id)?.line;
  assert.equal(line(FROM_USE_CASE.id), "per ogni use case · 6 domande");
  assert.equal(line(RESERVED_SHIFTS.id), "per turni degli equipaggi · 1.234 domande");
  assert.equal(line(PUBLIC_SERVICE.id), "per assistenza clienti · 12 domande");
  // Senza area di funzione, il settore.
  assert.equal(line(NO_AREA.id), "per servizi · 30 domande");
  // Le domande di «Dal caso d'uso» sono le voci di «Cosa serve», non quelle della definizione.
  assert.equal(choice.proposed[0]?.questions, 6);
  assert.equal(START_TEMPLATE_TEXT.line("per ogni use case", 1), "per ogni use case · 1 domanda");
  assert.equal(START_TEMPLATE_TEXT.line("per ogni use case", 0), "per ogni use case · 0 domande");
});

test("oltre 50 domande si chiede conferma, con la domanda esatta", () => {
  assert.equal(LARGE_TEMPLATE_QUESTIONS, 50);
  assert.equal(needsLargeTemplateConfirm(50), false);
  assert.equal(needsLargeTemplateConfirm(51), true);
  assert.equal(needsLargeTemplateConfirm(6), false);
  assert.equal(needsLargeTemplateConfirm(Number.NaN), false);
  assert.equal(START_TEMPLATE_TEXT.largeTitle(245), "Questo schema porta 245 domande: è quello giusto per questo caso?");
  assert.equal(START_TEMPLATE_TEXT.largeTitle(1234), "Questo schema porta 1.234 domande: è quello giusto per questo caso?");
});

test("regola di proposta: combacia quando ogni parola dell'area di funzione è nello use case", () => {
  assert.equal(templateMatchesUseCase(RESERVED_SHIFTS, SHIFTS_CASE), true);
  // Singolare e plurale: «turno»/«turni», «equipaggio»/«equipaggi».
  assert.equal(templateMatchesUseCase(RESERVED_SHIFTS, { title: "Il turno dell'equipaggio di notte" }), true);
  // Accenti e maiuscole non contano.
  assert.equal(templateMatchesUseCase({ ...PUBLIC_SERVICE, functionArea: "Qualità del servizio" }, { title: "Controllo della QUALITA del servizio clienti" }), true);
});

test("regola di proposta: un altro dominio non combacia", () => {
  assert.equal(templateMatchesUseCase(RESERVED_SHIFTS, SALES_CASE), false);
  assert.equal(templateMatchesUseCase(PUBLIC_SERVICE, SHIFTS_CASE), false);
  // Basta che manchi una parola: «equipaggi» c'è, «turni» no.
  assert.equal(templateMatchesUseCase(RESERVED_SHIFTS, { title: "Formazione degli equipaggi" }), false);
  // Stessa radice solo per singolare e plurale, non per parole più lunghe.
  assert.equal(templateMatchesUseCase({ ...PUBLIC_SERVICE, functionArea: "regole" }, { title: "Il regolamento interno" }), false);
});

test("regola di proposta: senza area di funzione non si propone mai", () => {
  assert.equal(templateMatchesUseCase(NO_AREA, { title: "Servizi ai clienti", problem: "servizi" }), false);
  assert.equal(templateMatchesUseCase({ ...NO_AREA, functionArea: "  " }, SHIFTS_CASE), false);
  // Un'area di sole parole vuote o corte non basta.
  assert.equal(significantWords("per la AI").length, 0);
  assert.equal(templateMatchesUseCase({ ...NO_AREA, functionArea: "per la AI" }, { title: "AI per la vendita" }), false);
  const choice = startTemplateOptions([NO_AREA, FROM_USE_CASE], { fromUseCaseQuestions: 2, useCase: { title: "Servizi", problem: "servizi" } });
  assert.deepEqual(
    choice.others.map((o) => o.id),
    [NO_AREA.id],
  );
});
