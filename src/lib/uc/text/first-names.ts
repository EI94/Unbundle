/**
 * Nomi propri comuni (PIANO §3.10): un elenco **generico** di circa 400 nomi
 * italiani diffusi, per riconoscere i nomi di persona nei testi liberi. Nessun
 * nome del cliente: quelli stanno solo nel file privato di redazione del seed.
 *
 * Sono esclusi i nomi che in un testo di lavoro sono soprattutto parole comuni o
 * luoghi (Rosa, Franco, Bianca, Stella, Viola, Vera, Sole, Fiore, Gemma, Luce,
 * Gioia, Speranza, Felice, Fortunato, Natale, Domenica, Assunta, Immacolata,
 * Alba, Aurora, Asia, Sofia, Ginevra, Emilia, Vittoria, Virginia, Marino,
 * Romano, Santo, Leone, Celeste, Pace, Amato, Benvenuto, Franca).
 *
 * Modulo puro.
 */

const MALE = `
achille adriano agostino alberto albino aldo alessandro alessio alex alfio alfonso alfredo alvaro amedeo ambrogio
andrea angelo anselmo antonino antonio arcangelo armando arnaldo arturo attilio augusto aurelio bartolomeo benedetto
beniamino bernardo biagio bruno calogero camillo carlo carmelo carmine cesare christian ciro claudio corrado cosimo
costantino cristian cristiano damiano daniel daniele dante dario davide diego dino domenico donato edoardo egidio
elia elio emanuele emiliano emilio enrico enzo ercole ermanno ernesto ettore eugenio ezio fabiano fabio fabrizio
fausto federico ferdinando fernando filippo fiorenzo flavio francesco fulvio gabriel gabriele gaetano gennaro gerardo
giacomo giampaolo giampiero giancarlo gianfranco gianluca gianluigi gianmarco gianni gianpaolo gianpiero gino giordano
giorgio giovanni girolamo giulio giuseppe graziano gregorio guglielmo guido ignazio igor ivan ivano jacopo kevin
lamberto lauro leonardo leopoldo lino livio lorenzo loris luca luciano lucio ludovico luigi manfredi manlio manuel
marcello marco mariano mario martino massimiliano massimo matteo mattia maurizio mauro michelangelo michele mirko
nazzareno nicola nicolas nicolo niccolo nino oliviero omar orazio oreste orlando osvaldo ottavio paolo pasquale
patrizio pierfrancesco piergiorgio pierluigi piermario pierpaolo piero pietro raffaele raimondo remo renato renzo
riccardo rinaldo rino roberto rocco rodolfo rolando rosario ruggero sabatino salvatore samuel samuele sandro
saverio sebastiano sergio severino silvano silvestro silvio simone stefano tancredi tarcisio teodoro thomas tiziano
tommaso tullio ugo umberto valentino valerio valter vincenzo vinicio virgilio vito vittorio walter zeno
battista fiorello gianmaria giosue marcantonio nevio pio remigio sauro settimio tiberio tito ubaldo
amerigo cristoforo galileo raffaello
`;

const FEMALE = `
ada adele adriana agata agnese alessandra alessia alice alida amalia angela angelica anna annalisa annamaria
antonella antonietta antonia arianna barbara beatrice benedetta camilla carla carlotta carmela carmen caterina
cecilia chiara cinzia clara claudia clelia concetta cristiana cristina daniela debora denise diana donatella
elena eleonora elisa elisabetta elvira emanuela emma enrica erica erika ester eva fabiola federica filomena fiorella
flavia francesca gabriella gaia giada gianna gina giorgia giovanna giulia giuliana giuseppina grazia graziella greta
ida ilaria ilenia iolanda irene isabella ivana jessica katia lara laura letizia lia lidia liliana lisa lorella
lorena loredana lorenza luana lucia luciana lucilla lucrezia ludovica luisa maddalena manuela mara marcella
margherita maria mariangela marianna mariella marilena marina marisa marta martina matilde melissa michela milena
mirella miriam monica nadia natalia nicoletta noemi nunzia olga ombretta ornella pamela paola patrizia piera pina
raffaella rebecca renata rita roberta romina rosalba rosanna rosaria rossella sabina sabrina samantha sandra sara
selene serena silvana silvia simona sonia stefania susanna tamara teresa tiziana valentina valeria vanessa
veronica viviana wanda ylenia zoe
carolina fernanda giorgina irma mariagrazia mariarosa nella rina rosella sveva tecla vincenza
`;

function words(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

/** Nomi propri, piegati (minuscolo, senza accenti). */
export const FIRST_NAMES: ReadonlySet<string> = new Set([...words(MALE), ...words(FEMALE)]);

/**
 * Parole maiuscole che dopo un nome non sono un cognome: aziende, luoghi,
 * istituzioni («Marina Militare», «Leonardo Helicopters»).
 */
export const NOT_SURNAMES: ReadonlySet<string> = new Set(
  words(`
militare militari spa srl srls snc sas group gruppo holding airport aeroporto airports international airlines airways
aviation air jet jets executive express club center centre centro hotel resort italia italy helicopters aerospace
systems system service services store day days award awards foundation fondazione bank banca hospital ospedale
university universita college school scuola academy accademia museum museo festival cup trophy tour team
`),
);

/**
 * Parole che, subito prima di un nome, ne fanno il nome di un luogo, di una via o
 * di un santo («via Giuseppe Verdi», «aeroporto Marco Polo», «Santa Maria»).
 */
export const PLACE_PREFIXES: ReadonlySet<string> = new Set(
  words(`
via viale corso piazza piazzale largo vicolo strada lungomare aeroporto aeroporti stazione ospedale scuola istituto
liceo teatro fondazione premio san santa sant santo santi beato beata papa re regina principe principessa duca
`),
);

/**
 * Coppie pubbliche che non sono persone da proteggere: nomi di aeroporti e figure
 * storiche ricorrenti nei testi di aviazione. Piegate, separate da uno spazio.
 */
export const PUBLIC_NAME_PAIRS: ReadonlySet<string> = new Set([
  "marco polo",
  "galileo galilei",
  "cristoforo colombo",
  "guglielmo marconi",
  "amerigo vespucci",
  "valerio catullo",
  "federico fellini",
  "sandro pertini",
  "vincenzo bellini",
  "raffaello sanzio",
  "mario mameli",
  "giuseppe verdi",
  "luigi ridolfi",
  "giovanni paolo",
  "vittorio emanuele",
  "giuseppe garibaldi",
  "giuseppe mazzini",
  "camillo benso",
  "leonardo da",
  "gabriele d",
]);

/** Titoli che precedono un cognome («sig. Rossi», «dott.ssa Bianchi», «comandante Verdi»). */
export const HONORIFICS: ReadonlySet<string> = new Set(
  words(`
sig sigg signor signore signora dott dottor dottore dottoressa ing ingegner ingegnere avv avvocato arch architetto
geom rag prof professor professore professoressa comandante cte cpt capitano mr mrs ms
`),
);

/** Il nome (piegato) è nell'elenco generico? */
export function isFirstName(folded: string): boolean {
  return FIRST_NAMES.has(folded);
}
