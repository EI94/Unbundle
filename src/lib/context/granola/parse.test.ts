import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseAccountInfo, parseFolders, parseGetMeetings, parseParticipants, parseSearchMeetings, parseTranscript } from "./parse.ts";

// Il parser tollerante delle risposte di Granola (RILASCIO-9a-COSTRUZIONE.md §8.5). Le risposte sono finte, nella forma
// che il piano descrive; nomi, aziende e indirizzi sono inventati.

const SEARCH = `<meetings_data>
<upcoming_meetings>
<meeting id="evt_9f2" title="Call futura con Nardi" meeting_at="2026-11-20T09:00:00Z" />
</upcoming_meetings>
<meeting id="m-001" title="Avvio progetto Nardi &amp; soci" meeting_at="2026-11-14T09:30:00Z" updated_at="2026-11-14T11:02:00Z" url="https://note.esempio.test/d/m-001" attachment_count="2">
<known_participants total="3" omitted="0">Paola Verdi (note creator) from Lateral Space (paola@ls.test), Giulia Bianchi from Officina Nardi (giulia@nardi.test), ufficio@nardi.test</known_participants>
<note_headers>Prossimi passi; Decisioni</note_headers>
</meeting>
<meeting updated_at="2026-11-12T08:00:00Z" id="m-002" url="https://note.esempio.test/d/m-002" meeting_at="2026-11-12T07:00:00+01:00" title='Revisione "SAP" > pianificazione'>
<known_participants>Luca Neri &lt;luca@altro.test&gt;</known_participants>
<folders><folder id="f-1" name="Nardi" /></folders>
</meeting>
<meeting title="Senza id" meeting_at="2026-11-10T09:00:00Z"></meeting>
<pagination next_cursor="c-2" has_more="true" />
</meetings_data>
Righe fuori dalle etichette che non contano.`;

test("search_meetings: le call, senza quelle future, con attributi in qualunque ordine ed entità decodificate", () => {
  const page = parseSearchMeetings(SEARCH);
  assert.deepEqual(
    page.meetings.map((m) => m.id),
    ["m-001", "m-002"],
    "la call futura (evt_…) e quella senza id non ci sono",
  );
  const [first, second] = page.meetings;
  assert.equal(first.title, "Avvio progetto Nardi & soci");
  assert.equal(first.meetingAt, "2026-11-14T09:30:00.000Z");
  assert.equal(first.updatedAt, "2026-11-14T11:02:00.000Z");
  assert.equal(first.url, "https://note.esempio.test/d/m-001");
  assert.equal(first.participantsRaw, "Paola Verdi (note creator) from Lateral Space (paola@ls.test), Giulia Bianchi from Officina Nardi (giulia@nardi.test), ufficio@nardi.test");
  assert.deepEqual(first.participants, [
    { name: "Paola Verdi", email: "paola@ls.test", company: "Lateral Space", noteCreator: true },
    { name: "Giulia Bianchi", email: "giulia@nardi.test", company: "Officina Nardi", noteCreator: false },
    { name: null, email: "ufficio@nardi.test", company: null, noteCreator: false },
  ]);
  // Un `>` tra virgolette non chiude l'etichetta; un fuso orario diverso diventa un istante ISO.
  assert.equal(second.title, 'Revisione "SAP" > pianificazione');
  assert.equal(second.meetingAt, "2026-11-12T06:00:00.000Z");
  assert.deepEqual(second.participants, [{ name: "Luca Neri", email: "luca@altro.test", company: null, noteCreator: false }]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "c-2");
});

test("search_meetings: paginazione assente, finita, o con il solo cursore; una risposta incompleta ha altro da leggere", () => {
  assert.deepEqual(parseSearchMeetings("<meetings_data></meetings_data>"), { meetings: [], hasMore: false, nextCursor: null });
  const done = parseSearchMeetings(`<meeting id="a" title="A"></meeting><pagination has_more="false" />`);
  assert.equal(done.hasMore, false);
  assert.equal(done.nextCursor, null);
  const cursorOnly = parseSearchMeetings(`<meeting id="a" title="A"/><pagination next_cursor='xyz'/>`);
  assert.equal(cursorOnly.hasMore, true);
  assert.equal(cursorOnly.nextCursor, "xyz");
  assert.equal(cursorOnly.meetings[0].title, "A", "anche `<meeting … />`");
  const bare = parseSearchMeetings(`<meeting id="a" title="A"/><pagination has_more next_cursor="k" />`);
  assert.equal(bare.hasMore, true, "un attributo senza valore vale «presente»");
  const incomplete = parseSearchMeetings(`<meeting id="a" title="A"/><pagination has_more="false" completion_status="incomplete" />`);
  assert.equal(incomplete.hasMore, true);
  assert.equal(incomplete.nextCursor, null);
});

const GET = `<meetings_data>
<meeting id="m-001" title="Avvio progetto" meeting_at="2026-11-14T09:30:00Z" updated_at="2026-11-14T11:02:00Z" url="https://note.esempio.test/d/m-001">
<known_participants>Giulia Bianchi from Officina Nardi (giulia@nardi.test)</known_participants>
<summary>
## Decisioni
- Il gestionale resta SAP Business One.
- Gli ordini arrivano via e-mail &amp; telefono.
</summary>
<private_notes>Richiamare l'ufficio acquisti giovedì.</private_notes>
<attachments><attachment id="a1" type="photo" /></attachments>
</meeting>
<meeting id="m-002" title="Sola sintesi">
<summary>Breve sintesi della call.</summary>
<private_notes status="empty" />
</meeting>
<meeting id="m-003" title="Note di un altro">
<private_notes status="not_included" />
<etichetta_nuova valore="x">testo che non conta</etichetta_nuova>
</meeting>
<omitted_meetings>
<meeting id="m-004" title="Troppo lunga per questa risposta" />
</omitted_meetings>
</meetings_data>`;

test("get_meetings: riassunto, note private piene e vuote, etichette sconosciute ignorate; le call omesse non ci sono", () => {
  const notes = parseGetMeetings(GET);
  assert.deepEqual(
    notes.map((n) => n.id),
    ["m-001", "m-002", "m-003"],
    "m-004 sta in <omitted_meetings>: si richiede a parte",
  );
  assert.equal(notes[0].summary, "## Decisioni\n- Il gestionale resta SAP Business One.\n- Gli ordini arrivano via e-mail & telefono.");
  assert.equal(notes[0].privateNotes, "Richiamare l'ufficio acquisti giovedì.");
  assert.equal(notes[0].participants[0].email, "giulia@nardi.test");
  assert.equal(notes[1].summary, "Breve sintesi della call.");
  assert.equal(notes[1].privateNotes, null);
  assert.equal(notes[1].meetingAt, null, "una data che manca vale null");
  assert.equal(notes[2].summary, null);
  assert.equal(notes[2].privateNotes, null, "le note di un'altra persona non entrano");
});

test("partecipanti: con e senza nome, azienda, parentesi, a capo e punto e virgola", () => {
  assert.deepEqual(parseParticipants(""), []);
  assert.deepEqual(parseParticipants("Anna Gialli (note creator) (anna@ls.test)"), [{ name: "Anna Gialli", email: "anna@ls.test", company: null, noteCreator: true }]);
  assert.deepEqual(parseParticipants("Ufficio acquisti (acquisti@nardi.test); Marco Blu from Nardi, S.r.l. (marco@nardi.test)"), [
    { name: "Ufficio acquisti", email: "acquisti@nardi.test", company: null, noteCreator: false },
    { name: "Marco Blu", email: null, company: "Nardi", noteCreator: false },
    { name: "S.r.l.", email: "marco@nardi.test", company: null, noteCreator: false },
  ]);
  assert.deepEqual(parseParticipants("- Sara Rosa <SARA@Nardi.Test>\n- Solo Nome"), [
    { name: "Sara Rosa", email: "sara@nardi.test", company: null, noteCreator: false },
    { name: "Solo Nome", email: null, company: null, noteCreator: false },
  ]);
  assert.deepEqual(parseParticipants("Pietro (pietro@a.test, ufficio)"), [{ name: "Pietro", email: "pietro@a.test", company: null, noteCreator: false }], "la virgola tra parentesi non divide");
});

test("testo rotto o inatteso: nessuna eccezione, si legge quello che c'è", () => {
  const broken = [
    "",
    "<meeting",
    `<meeting id="a title="x">`,
    `<meeting id="a" title="Senza chiusura">testo<meeting id="b" title="B">`,
    "<<<>>>",
    "{non è json",
    "<meetings_data><meeting id=\"x\" title=\"T\"><summary>senza fine",
    "\u0000￿<meeting id=x title=nudo/>",
  ];
  for (const text of broken) {
    assert.doesNotThrow(() => parseSearchMeetings(text), text);
    assert.doesNotThrow(() => parseGetMeetings(text), text);
    assert.doesNotThrow(() => parseFolders(text), text);
    assert.doesNotThrow(() => parseAccountInfo(text), text);
    assert.doesNotThrow(() => parseTranscript(text), text);
  }
  assert.deepEqual(
    parseSearchMeetings(`<meeting id="a" title="Senza chiusura">testo<meeting id="b" title="B">`).meetings.map((m) => m.id),
    ["a", "b"],
  );
  assert.deepEqual(parseSearchMeetings("\u0000<meeting id=x title=nudo/>").meetings.map((m) => [m.id, m.title]), [["x", "nudo"]], "attributi senza virgolette");
  assert.equal(parseGetMeetings(`<meeting id="x" title="T"><summary>senza fine`)[0].summary, "senza fine");
  assert.deepEqual(parseSearchMeetings(null as unknown as string), { meetings: [], hasMore: false, nextCursor: null });
});

test("in riserva il JSON: call, note, paginazione", () => {
  const page = parseSearchMeetings(JSON.stringify({ meetings: [{ id: "j1", title: "Da JSON", meeting_at: "2026-11-01T10:00:00Z", known_participants: "Ada (ada@nardi.test)" }], next_cursor: "n2" }));
  assert.deepEqual(page.meetings.map((m) => [m.id, m.title, m.participants[0]?.email]), [["j1", "Da JSON", "ada@nardi.test"]]);
  assert.equal(page.hasMore, true);
  const notes = parseGetMeetings(JSON.stringify([{ id: "j1", title: "Da JSON", summary: "Sintesi &amp; resto", private_notes: { text: "Note" } }]));
  assert.equal(notes[0].summary, "Sintesi &amp; resto", "il JSON non si decodifica come XML");
  assert.equal(notes[0].privateNotes, "Note");
});

test("cartelle: etichette, JSON e righe; id strani scartati", () => {
  assert.deepEqual(parseFolders(`<folders><folder id="f-1" name="Nardi" /><folder title="TopJet" id="f-2"></folder><folder id="f 3" name="Spazi" /></folders>`), [
    { id: "f-1", name: "Nardi" },
    { id: "f-2", name: "TopJet" },
  ]);
  assert.deepEqual(parseFolders(`<folder id="f-9">Clienti &amp; partner\naltro</folder>`), [{ id: "f-9", name: "Clienti & partner" }]);
  assert.deepEqual(parseFolders(JSON.stringify({ folders: [{ id: "a", name: "Uno" }, { folder_id: "b", title: "Due" }, { name: "senza id" }] })), [
    { id: "a", name: "Uno" },
    { id: "b", name: "Due" },
  ]);
  assert.deepEqual(parseFolders("Le tue cartelle:\n- Nardi (id: f-1)\n- TopJet [folder_id = f-2]"), [
    { id: "f-1", name: "Nardi" },
    { id: "f-2", name: "TopJet" },
  ]);
  assert.deepEqual(parseFolders("niente da leggere"), []);
});

test("account: JSON, etichette, righe «chiave: valore»; il piano al massimo 40 caratteri", () => {
  assert.deepEqual(parseAccountInfo(JSON.stringify({ email: "Paola@LS.test", plan: "Free" })), { email: "paola@ls.test", plan: "Free" });
  assert.deepEqual(parseAccountInfo(JSON.stringify({ user: { email: "p@ls.test" }, plan: { name: "Business" } })), { email: "p@ls.test", plan: "Business" });
  assert.deepEqual(parseAccountInfo("<account_info><email>p@ls.test</email><plan>Free</plan></account_info>"), { email: "p@ls.test", plan: "Free" });
  assert.deepEqual(parseAccountInfo(`<account email="p@ls.test" plan="Pro" />`), { email: "p@ls.test", plan: "Pro" });
  assert.deepEqual(parseAccountInfo("Account\nEmail: p@ls.test\nPlan: Business plus"), { email: "p@ls.test", plan: "Business plus" });
  assert.equal(parseAccountInfo(`Plan: ${"x".repeat(80)}`).plan?.length, 40);
  assert.deepEqual(parseAccountInfo("nessun dato"), { email: null, plan: null });
});

test("trascrizione: JSON con il punto da cui riprendere, non disponibile, etichette, testo semplice", () => {
  assert.deepEqual(parseTranscript(JSON.stringify({ transcript: "Prima parte", next_offset: 40000, truncated: true })), { text: "Prima parte", nextOffset: 40000, unavailable: false });
  assert.deepEqual(parseTranscript(JSON.stringify({ transcript: "Ultima", next_offset: 80000, truncated: false })), { text: "Ultima", nextOffset: null, unavailable: false });
  assert.deepEqual(parseTranscript(JSON.stringify({ transcript: null, transcript_unavailable: { reason: "no_transcript" } })), { text: null, nextOffset: null, unavailable: true });
  assert.deepEqual(parseTranscript(`<transcript next_offset="120">Testo &amp; altro</transcript>`), { text: "Testo & altro", nextOffset: 120, unavailable: false });
  assert.deepEqual(parseTranscript("transcript_unavailable: no_transcript"), { text: null, nextOffset: null, unavailable: true });
  assert.deepEqual(parseTranscript("Parla il direttore.\nnext_offset: 300"), { text: "Parla il direttore.", nextOffset: 300, unavailable: false });
  assert.equal(parseTranscript("").unavailable, true);
});

test("entità XML: le note, le numeriche; quelle sconosciute o non valide restano", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#232; &#xE8; &nbsp; &#0; &#xD800;"), `a & b <c> "d" 'e' è è &nbsp; &#0; &#xD800;`);
});
