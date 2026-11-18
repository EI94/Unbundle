/**
 * Lo schema d'uscita della lettura di un appunto (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.2): piatto,
 * con campi nulli al posto delle unioni. I limiti di lunghezza stanno nelle descrizioni e si applicano nel codice
 * (`reconcile.ts`): uno schema con minimi e massimi non passa da `output_config.format`.
 * Nessun campo chiede al modello il suo ragionamento (src/lib/ai/models.ts, MOTIVAZIONE_DESCRIPTION).
 * (9b) `esigenzaRif`: la richiesta di «Cosa serve» a cui un fatto nuovo risponde (RILASCIO-9b-COSTRUZIONE.md §2.2).
 * Modulo puro (solo zod).
 */
import { z } from "zod";

export const contextReadSchema = z.object({
  proposte: z.array(
    z.object({
      tipo: z.enum(["nuovo", "conferma", "cambia", "conflitto", "decisione", "impegno", "domanda"]),
      testo: z.string().describe("Una frase sola, neutra, al massimo 200 caratteri."),
      citazione: z.string().describe("Il passaggio degli appunti da cui viene, copiato parola per parola, al massimo 300 caratteri."),
      base: z.enum(["detto", "dedotto"]),
      sezione: z.enum(["azienda", "persone", "lavoro", "sistemi", "obiettivi", "regole", "parole"]).nullable().describe("Nulla per impegni e domande."),
      visibilita: z.enum(["tutti", "ls"]),
      fattoRif: z.string().nullable().describe("Il riferimento del fatto in memoria (per esempio F12) per conferma, cambia e conflitto."),
      domandaRif: z.string().nullable().describe("Il riferimento della domanda aperta (per esempio D3) a cui il fatto risponde."),
      esigenzaRif: z.string().nullable().describe("Il riferimento della richiesta aperta di «Cosa serve» (per esempio R2) a cui il fatto nuovo risponde."),
      useCase: z.array(z.string()).describe("I codici degli use case dell'elenco che la proposta tocca."),
      parte: z.enum(["nostra", "cliente"]).nullable().describe("Solo per gli impegni."),
      ruolo: z.string().nullable().describe("Per un impegno chi lo fa, per una domanda a chi chiederla: un ruolo, mai un nome."),
      entro: z.string().nullable().describe("Solo per gli impegni: la data AAAA-MM-GG, se gli appunti la dicono."),
      entita: z.array(z.object({ nome: z.string(), tipo: z.enum(["ruolo", "unita", "processo", "sistema", "dato", "fornitore", "obiettivo", "use_case"]) })),
      collegamenti: z.array(z.object({ da: z.string(), verbo: z.enum(["usa", "gestisce", "decide", "dipende_da", "alimenta", "fornisce", "riguarda"]), a: z.string() })),
    }),
  ),
  nonRiportati: z.object({ persone: z.number(), sanitari: z.number(), altriClienti: z.number(), clientiDelCliente: z.number() }),
});
export type ContextReadOutput = z.infer<typeof contextReadSchema>;
export type ContextReadProposal = ContextReadOutput["proposte"][number];
