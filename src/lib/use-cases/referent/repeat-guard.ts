/**
 * Il controllo del doppio clic dei passi (rilascio 4, la finestra «Chiedi al referente»; rilascio 5, la
 * pagina del referente): il pulsante del passo sta nello stesso punto in ogni passo, quindi un doppio
 * clic, o un secondo tocco ravvicinato, premerebbe anche quello del passo dopo. Dopo un cambio di passo
 * il pulsante aspetta `STEP_SETTLE_MS` e non conta il secondo clic di un doppio clic.
 *
 * Modulo puro, piccolo: lo usa anche la pagina pubblica.
 */
export const STEP_SETTLE_MS = 450;

/** Il clic (o l'invio del modulo) arriva troppo presto dopo il cambio di passo, o è il secondo di un doppio clic. */
export function isRepeatActivation(input: { clickCount: number; msSinceStep: number }): boolean {
  return input.clickCount > 1 || input.msSinceStep < STEP_SETTLE_MS;
}
