/**
 * Gli importi massimi dei campi in euro dell'area «Use case» (CHECK della 0020), in un modulo
 * senza dipendenze: li leggono `inputs.ts` e `value-model.ts`, che `inputs.ts` importa a sua
 * volta (così non c'è un giro di import).
 *
 * Modulo puro.
 */

/** `cost_eur_once`: intero da 0 a 100.000.000 (§5.4, CHECK della 0020). */
export const COST_EUR_ONCE_MAX = 100_000_000;
/** `value_eur_year`: intero da 0 a 1.000.000.000 (CHECK della 0020). */
export const VALUE_EUR_YEAR_MAX = 1_000_000_000;
