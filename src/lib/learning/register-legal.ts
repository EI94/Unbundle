/**
 * Testi normativi del registro. Stanno in un posto solo perché sono verificati
 * su fonti primarie a una data precisa: quando la norma cambia si aggiorna
 * questo file, e pagina, PDF ed Excel cambiano insieme.
 *
 * Verificati il 4 ottobre 2026 su: Reg. (UE) 2026/1744, testo italiano
 * (Cellar, CELEX 32026R1744) e inglese (EUR-Lex); testo consolidato dell'art. 4
 * sull'AI Act Service Desk della Commissione; «AI literacy – Questions &
 * Answers» della Commissione, aggiornata al 27 luglio 2026; L. 132/2025,
 * art. 20 (Normattiva). Qui si sintetizza, non si cita.
 */

export const REGISTER_LEGAL_VERIFIED_ON = "2026-10-04";

export const registerTitle = "Registro della formazione in materia di intelligenza artificiale";
export const registerSubtitle = "Misure di alfabetizzazione in materia di IA · art. 4 del Regolamento (UE) 2024/1689";

/** Cosa chiede la norma, in sintesi non ufficiale. */
export const legalFramework = [
  "Sintesi aggiornata al 4 ottobre 2026. L'art. 4 del Regolamento (UE) 2024/1689 sull'intelligenza artificiale, nel testo modificato dal Regolamento (UE) 2026/1744 in vigore dal 27 luglio 2026, chiede a fornitori e deployer di sistemi di IA di adottare misure volte a sostenere lo sviluppo dell'alfabetizzazione in materia di IA del proprio personale e delle altre persone che si occupano del funzionamento e dell'uso dei sistemi per loro conto.",
  "Le misure devono tenere conto delle conoscenze tecniche, dell'esperienza, dell'istruzione e della formazione delle persone, del contesto in cui i sistemi sono utilizzati e delle persone su cui sono utilizzati. La norma precisa che l'obbligo non impone di garantire un livello specifico di alfabetizzazione per alcuna persona. Fino al 26 luglio 2026 il testo chiedeva invece di garantire, nella misura del possibile, un livello sufficiente: per questo ogni sessione riporta la versione dell'art. 4 in vigore quel giorno.",
  "Non è previsto un certificato e la norma non prescrive un formato di documentazione. Secondo le domande e risposte della Commissione europea sull'alfabetizzazione in materia di IA, le organizzazioni possono tenere un registro interno delle formazioni e delle altre iniziative, e non c'è obbligo di misurare le conoscenze delle persone. Questo documento è quel registro.",
  "La vigilanza sull'art. 4 spetta alle autorità nazionali dal 2 agosto 2026. In Italia l'autorità di vigilanza del mercato è l'Agenzia per la Cybersicurezza Nazionale (L. 132/2025, art. 20); restano ferme le competenze di Banca d'Italia, CONSOB e IVASS e, per i dati personali, del Garante.",
];

/** Come il registro risponde ai criteri dell'art. 4. */
export const criteriaMap: [string, string][] = [
  ["Ruolo dell'organizzazione", "Ruolo ai sensi dell'AI Act e sistemi di IA in uso, dichiarati dall'azienda (sezione 1)."],
  ["Misure adottate", "Percorsi, moduli, obiettivi, durata, contenuti e sessioni svolte (sezioni 3 e 4)."],
  ["Persone coinvolte", "Partecipanti di ogni sessione, con il modo in cui la partecipazione è documentata (sezione 5)."],
  ["Conoscenze ed esperienza di partenza", "Rilevazione dei bisogni svolta prima della formazione, riportata solo in forma aggregata (sezione 2)."],
  ["Contesto d'uso e persone interessate", "Sistemi di IA in uso e contesto, indicati dall'azienda (sezione 1)."],
];

export const notIncluded = [
  "Il registro non riporta risposte né punteggi individuali. La norma non chiede di garantire un livello di competenza di ciascuno e, secondo le domande e risposte della Commissione, non comporta l'obbligo di misurare le conoscenze delle persone; ai partecipanti è stato garantito che la direzione vede solo dati aggregati delle loro risposte.",
  "«Esercitazioni consegnate» indica che un'esercitazione è stata svolta e consegnata, non che sia stata superata.",
  "Il registro non contiene dati di navigazione, tempi di permanenza, indirizzi IP o dispositivi: non servono a documentare la formazione.",
];

export const limits = [
  "Questo registro documenta le misure di alfabetizzazione in materia di IA adottate dall'azienda. Non è un certificato e non attesta la conformità al Regolamento (UE) 2024/1689: secondo la Commissione europea per l'art. 4 non serve alcun certificato.",
  "L'obbligo dell'art. 4 resta in capo all'azienda come fornitore o deployer di sistemi di IA. Lateral Space eroga e documenta la formazione, ma non ne trasferisce né garantisce l'adempimento, né l'esito di un controllo.",
  "Il registro documenta la formazione erogata tramite la piattaforma e le presenze registrate dal formatore. Non attesta il livello di competenza delle singole persone e non va usato per valutarle.",
  "Le voci della sezione 1 sono dichiarate dall'azienda e non sono verificate da Lateral Space. Nei corsi che riuniscono più società, l'appartenenza di una persona a una società si ricava dal dominio della sua email.",
  "Riporta solo fatti registrati: un dato che manca resta «Non indicato» e non viene stimato.",
  "Per i sistemi di IA ad alto rischio resta l'obbligo, per chi li utilizza, di affidare la sorveglianza umana a persone con competenza, formazione e autorità adeguate (art. 26, par. 2), applicabile dal 2 dicembre 2027 per i sistemi dell'Allegato III e dal 2 agosto 2028 per quelli dell'Allegato I. Se l'azienda utilizza questi sistemi, la formazione specifica va documentata a parte o aggiunta fra le altre iniziative.",
  "Questo documento non costituisce parere legale. La sintesi della norma non è una citazione: fa fede il testo pubblicato nella Gazzetta ufficiale dell'Unione europea.",
];

export const integrity = [
  "Ogni esportazione riceve un codice e la sua impronta SHA-256 viene registrata sulla piattaforma nel momento in cui il file è generato. Per verificare che una copia sia integra, calcolane l'impronta (macOS e Linux: shasum -a 256 nome-file; Windows: certutil -hashfile nome-file SHA256) e confrontala con lo storico delle esportazioni nella pagina del registro, oppure caricala nella funzione «Verifica un file».",
  "Il contenuto di ogni percorso è identificato da versione e impronta: una volta pubblicato non si modifica. Anche i materiali consegnati sono identificati dalla loro impronta SHA-256.",
  "Le presenze registrate dal formatore non si modificano: si possono solo annullare, una volta, indicando il motivo. Gli annullamenti restano visibili nella sezione 6.",
];

/** In Italia, chi vigila e cosa manca ancora. Da rileggere alla pubblicazione del decreto. */
export const italianAuthority =
  "In Italia l'autorità di vigilanza del mercato per l'AI Act, con poteri ispettivi e sanzionatori, è l'Agenzia per la Cybersicurezza Nazionale (L. 132/2025, art. 20). Il decreto legislativo su poteri delle autorità e sanzioni, approvato dal Consiglio dei ministri il 4 agosto 2026, al 3 ottobre 2026 non risultava ancora pubblicato in Gazzetta Ufficiale.";

/** Come si legge la colonna «Stato». */
export const presenceDefinition =
  "La partecipazione è documentata quando la persona è entrata dal link del proprio turno durante la lezione, ha consegnato almeno un'esercitazione, oppure è stata registrata dal formatore. Chi si è solo iscritto compare come «partecipazione non documentata» e non è contato fra le persone che hanno partecipato.";

/**
 * Privacy del registro: indicazioni per l'azienda, che ne è titolare. Sono
 * buona pratica ricavata da GDPR, Codice privacy e Statuto dei lavoratori,
 * non adempimenti prescritti dall'art. 4: compaiono nella pagina, non nel PDF.
 */
export const privacyGuidance: [string, string][] = [
  ["Base giuridica", "Legittimo interesse dell'azienda a documentare le misure adottate (art. 6, par. 1, lett. f GDPR), con una valutazione scritta fatta prima di iniziare."],
  ["Informativa", "I partecipanti vanno informati (art. 13 GDPR), indicando l'interesse perseguito e il diritto di opporsi. La pagina d'ingresso e la pagina del corso ne mostrano già un riassunto."],
  ["Uso consentito", "Solo documentare la formazione. Usarlo per valutare o controllare le persone può ricadere nell'art. 4 dello Statuto dei lavoratori, che richiede accordo sindacale o autorizzazione dell'Ispettorato."],
  ["Conservazione", "Nessun termine di legge specifico. Un criterio prudente: durata del rapporto di lavoro più cinque anni, il termine di prescrizione delle sanzioni amministrative (art. 28 L. 689/1981)."],
  ["Fornitore", "Lateral Space tratta questi dati per conto dell'azienda: serve un accordo sul trattamento dei dati (art. 28 GDPR), se il contratto non lo comprende già."],
];

/**
 * Informativa breve per i partecipanti, sulla pagina d'ingresso e sul corso.
 * Senza nome dell'azienda: lo stesso corso può riunire persone di più società.
 */
export const participantNotice =
  "Per documentare la formazione sull'IA, la tua azienda tiene un registro con nome, email, data e ora del tuo accesso e quante esercitazioni hai consegnato, ma non cosa hai risposto: le tue risposte le vede solo il formatore. Niente voti né classifiche, e il registro non serve a valutarti. Titolare dei dati è la tua azienda: puoi chiederle l'informativa completa e opporti al trattamento.";
