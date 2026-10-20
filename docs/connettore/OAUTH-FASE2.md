# Fase 2 del connettore: OAuth con login Microsoft

Stato: **progetto**, pacchetto K11 (prompt WP11). In questa fase non si crea nessun endpoint: il documento dice cosa costruire, come e in che ordine, quando Pierpaolo e l'AI Board decideranno di passare all'accesso individuale. Stima: **8-12 giorni** di sviluppo (§15).

Regola di base, come nel `README.md`: qui non ci sono valori del cliente né segreti. Slug, domini e tenant sono segnaposto (`<slug>`, `<tenant>`) o inventati (`alfa-beta`, `example.test`).

Fonti verificate il 19/10/2026:

- specifica MCP 2025-11-25, «Authorization» (modelcontextprotocol.io/specification/2025-11-25/basic/authorization);
- documentazione dei connettori di Claude: «Authentication for connectors» (claude.com/docs/connectors/building/authentication), «Lazy authentication» (…/lazy-authentication), «Enterprise Managed Auth» (…/enterprise-managed-auth);
- documento CIMD di Claude Code, letto all'indirizzo `https://claude.ai/oauth/claude-code-client-metadata`;
- Firebase, «Authenticate Using Microsoft with JavaScript» (firebase.google.com/docs/auth/web/microsoft-oauth);
- SDK MCP 1.29.0 installato (`client/auth.js`, `shared/auth.js`) e Next.js 16.2.3 installato (`node_modules/next/dist/docs/`, `build/route-discovery.js`).

---

## 0. In breve

- **Cosa cambia per le persone.** Oggi tutta l'organizzazione usa un token unico nell'header e chi propone dichiara il nome. In fase 2 ognuno clicca «Connetti» e accede con l'account Microsoft aziendale: Claude riceve un token personale, il connettore sa chi propone (identità «verificata»), il limite degli invii vale per persona e «le mie proposte» funziona senza codice.
- **Chi fa da authorization server.** Unbundle stesso, su `https://www.theunbundle.com` in produzione (in locale e in anteprima sull'origine di quell'ambiente, §8). Microsoft resta il fornitore dell'identità, attraverso Firebase. Usare direttamente Entra ID come authorization server non è praticabile: la documentazione di Claude ricorda che Entra chiede l'URL del server MCP come Application ID URI, accettato solo su un dominio verificato nel tenant (errore `AADSTS9010010`), e il tenant del cliente non può verificare `theunbundle.com`.
- **Cinque endpoint di protocollo** (§3): due documenti `.well-known`, `/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/register`. In più una pagina di accesso e un endpoint che la chiude, che il protocollo non vede.
- **Client**: Claude si presenta con un Client ID Metadata Document (CIMD) se i metadati lo permettono, altrimenti con la registrazione dinamica (DCR). PKCE S256 sempre. Redirect: `https://claude.ai/api/mcp/auth_callback` e il loopback di Claude Code.
- **Token opachi salvati come hash**: accesso di 1 ora con audience uguale all'URL del connettore, refresh di 30 giorni ruotato a ogni uso; un refresh già usato dà `invalid_grant`.
- **Tempi e rete**: risposte entro 10 secondi (30 per il refresh), quindi niente `ensureDbSchema()` sul percorso OAuth; endpoint raggiungibili da `160.79.104.0/21`, nessun filtro sugli IP.
- **Verificato con K11**: `src/proxy.ts` e `next.config.ts` non bloccano i percorsi futuri (§17), con un test che lo tiene fermo.

---

## 1. Cosa c'è già (preparato in fase 1)

| Pezzo | Dove | Cosa fa già |
|---|---|---|
| Principal | `src/lib/connector/auth.ts` (`ConnectorPrincipal`) | ha `identityMode`, `principalKey` (`token:<id>` oggi, `user:<identityId>` in fase 2), `tokenId` e `identityId`. Manca solo il costruttore di fase 2 (oggi c'è `principalFromToken`). |
| Identità | `connector_identities` (0019, vuota) | `workspace_id`, `provider` (`microsoft.com`), `subject` (claim `oid`), `email`, `display_name`, `created_at`, `last_seen_at`, `disabled_at`; unica `(workspace_id, provider, subject)`. Nessun legame con i membri del workspace: un'identità solo MCP, senza accesso alla dashboard. |
| Chi propone | `use_cases.submitted_by_user_id` (0019) | `submit_contribution` la scrive quando il principal ha un'identità (`connectorUseCaseData`). |
| Configurazione | `workspace_connector_configs` | `auth_mode` (`header` o `oauth`), `identity_mode` (`dichiarata` o `verificata`), `allowed_domains` (domini email ammessi al login, separati da `allowed_origins`), `limits.submitsPerHourPerUser` (10). |
| 401 di fase 2 | `connectorUnauthorized`, `gateConnectorRequest` | con `auth_mode = oauth` la rotta risponde 401 con `WWW-Authenticate: Bearer resource_metadata="https://www.theunbundle.com/.well-known/oauth-protected-resource/api/mcp/connettore/<slug>"` (`resourceMetadataUrl`), oggi sempre sull'origine di produzione (§8.1). Nessun token OAuth è accettato: il ramo resta spento. |
| Limiti per persona | `connectorRateLimitRules` | con un'identità i secchi diventano `conn:user:<identityId>:submit` (10 l'ora) e `conn:user:<identityId>:read` (le letture usano `readsPerHour`, 3.000 l'ora, per persona); il secchio del giorno del workspace (`conn:ws:<workspaceId>:submit:day`) resta. |
| Tool | `tools.ts`, `contract.ts` | con identità «verificata» `submittedBy` si ignora; `get_contribution_status` senza codice restituisce le ultime 10 segnalazioni dell'identità (`RECENT_OF_IDENTITY_SQL`); la guida riporta `identityMode` dalla configurazione e la skill chiede il nome solo con «dichiarata». |
| Idempotenza | `external_contribution_submissions.principal_key` | chiave unica `(workspace_id, principal_key, idempotency_key)`, pronta per `user:<id>`. |
| Operatore | `connector-admin config` | oggi **rifiuta** i valori di fase 2 (`oauth`, `verificata`): si apre con la fase 2. |

Non c'è altro: nessuna rotta OAuth, nessuna tabella per client, codici o token, nessuna pagina di accesso.

---

## 2. Il flusso

```
claude.ai, Desktop, mobile, Cowork (dal cloud di Anthropic)   oppure   Claude Code (dal computer della persona)
  │ 1. POST /api/mcp/connettore/<slug>, senza token
  ▼
rotta MCP → 401  WWW-Authenticate: Bearer resource_metadata="https://www.theunbundle.com/.well-known/oauth-protected-resource/api/mcp/connettore/<slug>",
                                          scope="connector:read connector:submit"
  │ 2. GET metadati della risorsa (RFC 9728) → authorization_servers: ["https://www.theunbundle.com"]
  │ 3. GET /.well-known/oauth-authorization-server (RFC 8414)
  │ 4. client: URL del CIMD di Claude come client_id, oppure POST /api/oauth/register (DCR)
  │ 5. browser → GET /api/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…
  │                 &code_challenge_method=S256&state=…&resource=https://www.theunbundle.com/api/mcp/connettore/<slug>
  │              → 303 verso /connettore/accesso, con il cookie __Host-ub_oauth_req (id della richiesta)
  │ 6. pagina di accesso: «Accedi con Microsoft» (Firebase, OAuthProvider('microsoft.com'), tenant del cliente)
  │              → POST /api/oauth/authorize/complete (cookie, token Firebase e token Microsoft)
  │              → controlli: tenant (tid), oid, dominio email → connector_identities → codice monouso
  │              → 303 verso redirect_uri?code=…&state=…
  │ 7. POST /api/oauth/token (form): code, code_verifier, redirect_uri, client_id, resource
  │              → access_token (1 ora) e refresh_token (30 giorni, ruotato)
  │ 8. POST /api/mcp/connettore/<slug> con Authorization: Bearer <access_token>
  ▼
principal { identityMode: "verificata", principalKey: "user:<identityId>", tokenId: null, identityId }
```

Gli indirizzi sono quelli di produzione; in locale e in anteprima cambia solo l'origine (§8.1).

Tutte le chiamate MCP richiedono il token, anche `initialize` e `tools/list`: il connettore non ha tool pubblici, quindi niente «lazy authentication». Claude chiede «Connetti» all'aggiunta del connettore, come prevede il prompt per il passaggio dalla fase 1.

---

## 3. Endpoint

Tutti sull'**origine pubblica** del connettore (§8): in produzione `https://www.theunbundle.com`, sempre con www; in locale e in anteprima l'origine di quell'ambiente. Gli esempi di questo documento usano l'origine di produzione. `runtime = "nodejs"`, intestazioni di igiene come oggi (`Cache-Control: no-store` dove ci sono token, `X-Content-Type-Options: nosniff`), una riga di log per chiamata senza dati (§6.6). Sono spenti, con 404, se `MCP_CONNECTOR_ENABLED` non è `true`.

| Metodo e percorso | Corpo | A cosa serve |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/api/mcp/connettore/<slug>` | | metadati della risorsa protetta (RFC 9728), uno per slug |
| `GET /.well-known/oauth-authorization-server` | | metadati dell'authorization server (RFC 8414) |
| `GET /api/oauth/authorize` | query | inizio dell'accesso, nel browser della persona |
| `POST /api/oauth/token` | `application/x-www-form-urlencoded` | codice → token; refresh |
| `POST /api/oauth/register` | `application/json` | registrazione dinamica (RFC 7591), di riserva |
| `GET /connettore/accesso` (pagina) | | di supporto: login Microsoft e riepilogo di chi chiede l'accesso |
| `POST /api/oauth/authorize/complete` | `application/json` | di supporto: chiude la richiesta e rimanda a Claude con il codice |

File previsti: `src/app/.well-known/oauth-protected-resource/api/mcp/connettore/[slug]/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/api/oauth/{authorize,token,register}/route.ts`, `src/app/api/oauth/authorize/complete/route.ts`, la pagina in `src/app/connettore/accesso/page.tsx` e la logica in `src/lib/connector/oauth/` (moduli puri con dipendenze passate da fuori, come `gate.ts`). Next 16.2.3 scopre anche le cartelle che iniziano con il punto (ignora solo quelle che iniziano con `_`, `build/route-discovery.js`) e la guida «Backend for Frontend» cita `.well-known` tra i percorsi personalizzati di una route handler.

### 3.1 Metadati della risorsa

```json
{
  "resource": "https://www.theunbundle.com/api/mcp/connettore/<slug>",
  "authorization_servers": ["https://www.theunbundle.com"],
  "scopes_supported": ["connector:read", "connector:submit"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Unbundle"
}
```

- `resource` è l'URL del connettore **esattamente** come l'Owner lo inserisce in Claude (con www, senza barra finale). La documentazione di Claude lo richiede e l'SDK MCP lo confronta con l'URL del server prima di usarlo (`selectResourceURL`: con un'origine diversa si ferma con «Protected resource … does not match expected»). Per questo `resource` si costruisce dall'origine pubblica dell'ambiente (§8), mai da una costante: in locale vale `http://127.0.0.1:53130/api/mcp/connettore/<slug>`, in anteprima l'indirizzo dell'anteprima.
- Un solo authorization server: Claude usa solo la prima voce dell'elenco.
- Risponde solo per uno slug con la configurazione in `auth_mode = oauth`; per gli altri 404. Il percorso alla radice (`/.well-known/oauth-protected-resource`, senza slug) non si serve: ogni slug ha la sua risorsa e il 401 della rotta porta sempre il puntatore `resource_metadata`, che Claude usa per primo.
- `Cache-Control: public, max-age=300` e `Access-Control-Allow-Origin: *` (documento pubblico, utile ai client nel browser come MCP Inspector). Claude tiene in cache questi metadati per circa 5 minuti, per URL: un cambio di configurazione arriva a tutti dopo quel tempo.

### 3.2 Metadati dell'authorization server

```json
{
  "issuer": "https://www.theunbundle.com",
  "authorization_endpoint": "https://www.theunbundle.com/api/oauth/authorize",
  "token_endpoint": "https://www.theunbundle.com/api/oauth/token",
  "registration_endpoint": "https://www.theunbundle.com/api/oauth/register",
  "scopes_supported": ["connector:read", "connector:submit"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "client_id_metadata_document_supported": true
}
```

- `issuer` è identico, carattere per carattere, al prefisso da cui il client legge il documento (RFC 8414), quindi con www e senza barra finale. Come `resource`, `issuer` e i tre URL degli endpoint vengono dall'origine pubblica dell'ambiente (§8).
- `client_id_metadata_document_supported: true` **e** `none` in `token_endpoint_auth_methods_supported`: servono entrambi perché Claude usi il CIMD; con uno dei due mancante Claude passa alla DCR.
- `code_challenge_methods_supported` deve esserci: senza, un client MCP conforme si rifiuta di continuare.
- `offline_access` non si elenca: il refresh si emette sempre con il codice. Se un client lo chiede nello `scope`, si accetta e si ignora.
- `/.well-known/openid-configuration` non si serve: Unbundle non è un provider OpenID e, per un issuer senza percorso, i client provano prima `oauth-authorization-server`.
- Documento statico (nessuna lettura del database), con la stessa cache e la stessa intestazione CORS dei metadati della risorsa.

### 3.3 `GET /api/oauth/authorize`

Parametri: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`, `resource`, `scope` (facoltativo).

1. Si riconosce il client (§4): CIMD o client registrato. Si controlla `redirect_uri` (§4.3). **Finché client e redirect non sono validi, nessun redirect**: si mostra una pagina d'errore in italiano (RFC 6749 §4.1.2.1, niente redirect aperti).
2. Poi, con un errore, si torna a `redirect_uri` con `error` e lo `state` ricevuto: `unsupported_response_type`; `invalid_request` (PKCE assente, metodo diverso da S256, challenge fuori forma); `invalid_scope`; `invalid_target` (RFC 8707: `resource` assente o diverso dall'URL di uno slug in `auth_mode = oauth`).
3. Con tutto valido: una **richiesta in sospeso** (id casuale di 32 byte, in tabella solo l'hash, 10 minuti, monouso) con client, redirect, challenge, `state`, risorsa e workspace dello slug. Risposta 303 verso `/connettore/accesso`, **senza query**, con il cookie `__Host-ub_oauth_req=<id>` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=600`).
   - L'id viaggia **solo nel cookie**: mai nell'indirizzo, quindi né nei log della piattaforma Vercel (che registrano percorso e query, README §1) né nella cronologia del browser.
   - Il cookie lega la richiesta al browser che l'ha aperta: la pagina e `complete` senza il cookie non chiudono nulla (§3.4). Chi legge l'indirizzo della pagina non ha niente da usare.
   - `SameSite=Lax`, non `Strict`: con il ripiego su `signInWithRedirect` (§9.1) il browser torna alla pagina da Microsoft con una navigazione da un altro sito, e il cookie deve arrivare. Il prefisso `__Host-` impedisce a un sottodominio di scriverlo.
   - Un browser ha una sola richiesta in sospeso: una nuova sostituisce il cookie. Per questo la pagina manda a `complete` l'impronta della richiesta che mostra (l'hash salvato, che da solo non apre nulla); se il cookie nel frattempo è di un'altra richiesta, nessun codice.

### 3.4 Pagina di accesso e `POST /api/oauth/authorize/complete`

Pagina `/connettore/accesso` (dettagli del login in §9):

- dice chi chiede l'accesso: l'host del `client_id` (per esempio `claude.ai`), mai il `client_name` del documento, che il client scrive da sé; l'host del redirect, come chiede la specifica MCP; con un redirect di loopback un avviso in più («Stai collegando Claude Code su questo computer»);
- dice a quale workspace (nome visualizzato) e cosa riceve Unbundle: nome, email aziendale, identificativo Microsoft; con il link all'informativa;
- senza un cookie valido (assente, scaduto, già usato, di una richiesta sconosciuta) nessun login: solo «Ricomincia da Claude»;
- «Accedi con Microsoft»; poi `POST /api/oauth/authorize/complete` con il token Firebase, il token Microsoft e l'impronta della richiesta mostrata; l'id arriva **solo dal cookie** (stesso controllo d'origine di `/api/auth/session`: solo dal sito). Cookie mancante, scaduto, già usato o con un'impronta diversa: nessun codice, la pagina dice «Ricomincia da Claude»;
- il server controlla (§9), crea o aggiorna l'identità, emette il **codice** e risponde con l'indirizzo `redirect_uri?code=…&state=…`; la pagina ci porta il browser;
- con un accesso negato (tenant o dominio non ammessi, identità disattivata, connettore senza OAuth) la pagina lo spiega in italiano e offre «Torna a Claude», che rimanda con `error=access_denied` e lo `state`;
- chiusa la richiesta (codice o rifiuto), la risposta cancella il cookie (`Max-Age=0`).

Codice: casuale, solo hash in tabella, **5 minuti**, monouso, legato a client, redirect, challenge, risorsa, identità e workspace. Un secondo uso dello stesso codice dà `invalid_grant` e revoca i token già emessi con quel codice (RFC 6749 §4.1.2). Per trovarli il codice porta il `grant_id` della concessione nata dal primo scambio:

- scambio, un solo statement: l'id della concessione si genera prima (`$g`); una CTE segna il codice usato con `grant_id = $g` (`UPDATE connector_oauth_codes SET used_at = now(), grant_id = $g WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING …`) e l'`INSERT` crea la concessione `$g` da quella riga. Se il codice era già usato non torna nessuna riga e non nasce nessuna concessione;
- riuso: `UPDATE connector_oauth_grants SET revoked_at = now(), revoked_reason = 'code_reuse' WHERE id = (SELECT grant_id FROM connector_oauth_codes WHERE code_hash = $1)`; i token della concessione smettono di valere (§6.1).

### 3.5 `POST /api/oauth/token`

Solo `application/x-www-form-urlencoded` (Claude manda così sia lo scambio del codice sia il refresh); un altro tipo dà 400 `invalid_request`. Nessun segreto del client: i client sono pubblici e la prova è il PKCE.

- `grant_type=authorization_code`: `code`, `redirect_uri` (uguale a quello della richiesta), `client_id` (uguale a quello del codice), `code_verifier` (§5), `resource` (uguale a quella del codice).
- `grant_type=refresh_token`: `refresh_token`, `client_id`, `resource` facoltativa (se c'è, uguale a quella del token).
- Risposta 200: `{ "access_token", "token_type": "Bearer", "expires_in": 3600, "refresh_token", "scope": "connector:read connector:submit" }`, con `Cache-Control: no-store` e `Pragma: no-cache`.
- Errori RFC 6749 §5.2, JSON `{ "error", "error_description" }` con descrizioni fisse (mai valori ricevuti): `invalid_request`, `invalid_client` (401), `invalid_grant`, `unauthorized_client`, `unsupported_grant_type`, `invalid_scope`, `invalid_target`. Un refresh non più valido (scaduto, revocato, già usato, sconosciuto) dà sempre `invalid_grant`, mai `invalid_request` né un codice nostro: è l'unico che Claude riconosce per chiedere di riconnettersi.

### 3.6 `POST /api/oauth/register` (DCR, di riserva)

- `application/json` (RFC 7591 §3.1). Solo client pubblici: `token_endpoint_auth_method` assente o `none`; `grant_types` dentro `authorization_code` e `refresh_token`; `response_types` solo `code`.
- `redirect_uris` obbligatori e **tutti** nell'elenco ammesso (§4.3); altrimenti 400 `invalid_redirect_uri`. Altri errori: 400 `invalid_client_metadata`.
- Risposta 201: `client_id` casuale (`ubc_…`), `client_id_issued_at`, i metadati accettati e `token_endpoint_auth_method: "none"`; nessun `client_secret`.
- La documentazione di Claude avverte che con la DCR Claude registra un client nuovo **a ogni collegamento**, e l'endpoint non chiede credenziali: un solo secchio per tutti si esaurirebbe con le richieste di chiunque e bloccherebbe ogni registrazione. Quindi tre secchi in `connector_rate_limits`:
  - **per IP**, `oauth:register:ip:<impronta>`, basso (per esempio 20 l'ora). L'IP viene dall'intestazione che Vercel imposta da sé, mai da una che il client può scrivere (da riverificare nella documentazione di Vercel quando si costruisce); l'impronta è un HMAC-SHA-256 con un segreto del server, perché l'hash semplice di un IPv4 si inverte provando tutti gli indirizzi;
  - **per gli IP di Anthropic** (`160.79.104.0/21`, da cui arrivano le registrazioni di claude.ai, Desktop, mobile e Cowork di tutte le organizzazioni), un secchio loro più alto (per esempio 500 l'ora), invece di quello per IP;
  - **complessivo**, molto più alto (per esempio 5.000 l'ora), solo come freno ai costi.
- Pulizia: un client della DCR che non completa un accesso entro un'ora si cancella; gli altri quando non hanno più concessioni valide. Per questo il CIMD resta la via principale.

---

## 4. Client: CIMD, DCR, client preregistrato

### 4.1 Come sceglie Claude

Specifica MCP e documentazione di Claude, nell'ordine: un client preregistrato, se Claude lo ha (nel dialogo «Add custom connector» l'Owner può inserire un OAuth client ID); il CIMD, se i metadati lo annunciano (§3.2); la DCR, se c'è `registration_endpoint`. Unbundle offre CIMD e DCR e non chiede nulla all'Owner.

### 4.2 Regole per il CIMD

- `client_id` è un URL `https` con un percorso. **Si accettano solo documenti di Claude**: host `claude.ai` o `claude.com` (politica di fiducia ammessa dalla specifica, «allowlists for trusted domains»). Gli altri `client_id` URL danno la pagina d'errore. Il connettore serve solo a Claude; nei test l'elenco degli host si passa come dipendenza.
- Documento di Claude Code, letto il 19/10/2026: `client_id` `https://claude.ai/oauth/claude-code-client-metadata`, `client_name` «Claude Code», `redirect_uris` `http://localhost/callback` e `http://127.0.0.1/callback`, `grant_types` `authorization_code` e `refresh_token`, `token_endpoint_auth_method` `none`.
- L'URL del documento delle app ospitate (claude.ai, Desktop, mobile, Cowork) **non è nella documentazione pubblica**: non si inventa. La regola sugli host lo copre già; il valore vero si legge dalla prima richiesta nell'organizzazione di prova (§14.4) e si annota qui.
- Lettura del documento (difese SSRF della specifica): solo `https` sulla porta 443, nessun redirect seguito, indirizzi risolti mai privati, di loopback o link-local, attesa massima 3 secondi, al massimo 10 KB, JSON valido con `client_id` identico all'URL, `client_name` e `redirect_uris`, e `token_endpoint_auth_method` `none`.
- Cache in tabella (`connector_oauth_clients`, tipo `cimd`), rispettando `Cache-Control` tra 5 minuti e 24 ore: una lettura per client, non una per accesso.
- Al token non si rilegge il documento: basta che `client_id` sia quello legato al codice.

### 4.3 Redirect ammessi

Un redirect vale solo se è nel documento o nella registrazione del client **e** in questo elenco:

| Redirect | Confronto |
|---|---|
| `https://claude.ai/api/mcp/auth_callback` | esatto |
| `https://claude.com/api/mcp/auth_callback` | esatto. Il centro assistenza di Anthropic avverte che il callback potrebbe passare a questo indirizzo e consiglia di ammetterli entrambi |
| `http://localhost/callback`, `http://127.0.0.1/callback` (loopback di Claude Code) | schema, host e percorso esatti, **porta qualsiasi** (RFC 8252 §7.3; per `localhost` lo chiede la documentazione di Claude, perché Claude Code lo dichiara nel suo documento) |

Mai frammenti, credenziali nell'indirizzo, altri host in `http`, o confronti per prefisso.

---

## 5. PKCE, risorsa e scope

- **PKCE S256**, sempre. `plain` si rifiuta. `code_challenge` di 43 caratteri base64url; `code_verifier` da 43 a 128 caratteri `[A-Za-z0-9-._~]`; al token `BASE64URL(SHA256(code_verifier)) = code_challenge`, confrontati in tempo costante. Claude lo manda a ogni richiesta.
- **Risorsa (RFC 8707)**: obbligatoria in `authorize` e `token`, uguale all'URL di uno slug in `auth_mode = oauth` sull'origine pubblica dell'ambiente (§8), mai sull'host della richiesta. Si confronta in forma canonica: schema e host senza distinzione di maiuscole, niente barra finale, niente query né frammento. Diventa l'**audience** del token; la rotta accetta un token solo se l'audience è il suo URL (stesso slug). Un token di un workspace non apre il connettore di un altro.
- **Scope**: `connector:read connector:submit`. Senza `scope` si danno entrambi; uno sconosciuto (tranne `offline_access`, ignorato) dà `invalid_scope`. Il token ha sempre i due scope, come il token di fase 1: dentro i tool non serve un errore di scope e non serve il 403 `insufficient_scope`.
- Il 401 della rotta aggiunge `scope="connector:read connector:submit"` (la specifica MCP lo consiglia; senza, Claude chiede gli `scopes_supported` dei metadati) e, se il token c'era ma non vale, `error="invalid_token"`.

---

## 6. Token

### 6.1 Accesso

- Opaco: 32 byte casuali in base64url con il prefisso `ub_oat_`. Durata **1 ora** (`expires_in: 3600`). In tabella solo l'hash SHA-256 (`hashIntegrationToken`, la stessa funzione di oggi).
- Legato a: audience (URL del connettore), workspace, identità, client, concessione (la famiglia nata da un accesso Microsoft).
- La rotta lo cerca per hash in un solo statement, come il token di fase 1: non revocato, non scaduto, audience uguale al proprio URL, workspace uguale a quello dello slug, configurazione ancora in `auth_mode = oauth`, identità non disattivata, concessione non revocata. Poi `last_seen_at` dell'identità.
- Perché opaco e non JWT: si revoca subito (identità disattivata, accessi revocati), nessuna chiave di firma da custodire e ruotare, stesso modello della fase 1. Il costo è una lettura per richiesta, la stessa di oggi.

### 6.2 Refresh

- Opaco, prefisso `ub_ort_`, solo hash in tabella.
- **Ruotato a ogni uso**, come la specifica MCP chiede per i client pubblici: la risposta porta il refresh nuovo e il vecchio smette di valere nello stesso statement (`UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL … RETURNING`).
- Un refresh **già usato** dà `invalid_grant` e revoca tutta la concessione (furto probabile: il ladro e la persona hanno lo stesso token). Claude può mandare un refresh preventivo (fino a 5 minuti prima della scadenza) e uno dopo un 401 quasi insieme: da provare nell'organizzazione di prova. Se succede, proposta: il riuso del refresh appena ruotato, entro 10 secondi, dà `invalid_grant` **senza** revocare la concessione (il token nuovo del primo resta valido).
- **30 giorni**. Proposta (decisione 3, §16): 30 giorni dall'accesso Microsoft, fissi, che le rotazioni non allungano. Così ogni mese la persona rifà «Connetti» e Microsoft ricontrolla l'account: chi lascia l'azienda e viene disattivato in Entra ID perde l'accesso entro 30 giorni anche senza un intervento di Lateral Space. L'alternativa (30 giorni dall'ultimo uso) è più comoda e meno sicura.

### 6.3 Tutto come hash

Id delle richieste in sospeso, codici, token d'accesso e refresh: in tabella c'è solo l'hash. L'id della richiesta viaggia solo nel cookie `__Host-ub_oauth_req` (§3.3). Nessuno compare in log, URL (tranne il codice nel redirect verso Claude, come vuole il protocollo), messaggi d'errore, test snapshot, commit o chat.

### 6.4 Revoca

- Connettore sospeso: ogni tool risponde `connector_disabled`, come oggi (handshake e `tools/list` funzionano).
- Identità disattivata (`connector_identities.disabled_at`): la rotta risponde 401, il refresh dà `invalid_grant`, il login si rifiuta.
- «Revoca tutti gli accessi» del workspace: revoca tutte le concessioni; ognuno rifà «Connetti».
- Un endpoint di revoca (RFC 7009) non serve a Claude: si rimanda.

### 6.5 Token nell'indirizzo

`DEFAULT_TOKEN_PREFIXES` (`http-hygiene.ts`) aggiunge `ub_oat_` e `ub_ort_`: un token OAuth in una query o in un percorso dà 400 `token_in_url`, come oggi. Proposta (decisione 6): a differenza del token d'organizzazione di fase 1, quello personale si **revoca subito** (tutta la concessione): fermarlo tocca una persona sola, che rifà «Connetti».

### 6.6 Log

Come la fase 1 (`call-log.ts`, `logSafeError`): una riga per chiamata con data e ora, endpoint, slug, esito e durata. Al posto dei primi 8 caratteri dell'id del token, i primi 8 dell'id della **concessione** (cambia a ogni accesso Microsoft), mai l'id dell'identità, `oid`, `tid`, email o nome. Mai codici, verifier, token, `state`, `client_id` completi o query di `authorize`. `src/instrumentation.ts` registra già i percorsi senza query.

---

## 7. Tempi

- Claude aspetta al massimo **10 secondi** i metadati, la registrazione e il token, **30 secondi** il refresh; oltre, l'accesso fallisce anche se il server poi risponde.
- Sul percorso OAuth **niente `ensureDbSchema()`**: oggi la rotta del connettore lo chiama alla prima richiesta di un'istanza fredda (`app-deps.ts`), con un probe e, se serve, il DDL dentro una transazione con un advisory lock. Le tabelle di fase 2 arrivano con la migrazione (§11), applicata prima di accendere l'OAuth; i moduli OAuth usano il client del database senza self-heal. In produzione il piano prevede già `UC_SCHEMA_SELF_HEAL=off` per i Casi d'uso (PIANO-LAVORI §7.1).
- Niente chiamate lente sul percorso: niente Slack, email o modello. Le sole chiamate esterne hanno un'attesa massima e una cache: documento CIMD (3 s, cache in tabella), chiavi pubbliche di Microsoft e di Google per la verifica dei token (3 s, cache in memoria).
- Metadati dell'authorization server senza database. Metadati della risorsa con una lettura per slug (indice unico). La compute di Neon che si risveglia dopo una pausa aggiunge latenza alla prima richiesta: da misurare in anteprima; se serve, i metadati della risorsa rispondono senza database per ogni slug ben formato.
- Obiettivo, misurato nell'anteprima: p95 sotto 1 secondo per metadati e token.

---

## 8. Rete e dominio

- Il traffico di claude.ai, Desktop, mobile e Cowork verso il server MCP **e** verso l'authorization server arriva da Anthropic, `160.79.104.0/21`: metadati, registrazione e token devono essere raggiungibili da lì. Claude Code si collega dal computer della persona, con un IP qualsiasi. Quindi nessun filtro sugli IP, come in fase 1.
- Vercel: la produzione non ha la Deployment Protection. Le regole del Vercel Firewall (Casi d'uso P0-7) e la protezione dai bot (Attack Challenge Mode) non devono sfidare `/.well-known/*`, `/api/oauth/*` e `/api/mcp/connettore/*`: una sfida JavaScript blocca i client che non sono browser. Serve una regola di esclusione per quei percorsi (oppure `160.79.104.0/21` ammesso in modo esplicito, che però non copre Claude Code).
- In produzione sempre `https://www.theunbundle.com`: `issuer`, `resource` e gli URL degli endpoint con www. Il dominio senza www risponde 308 verso www mantenendo percorso e query (verificato, §17); un client non deve mai vederlo, perché `issuer` e `resource` si confrontano esatti.

### 8.1 Origine pubblica per ambiente

L'SDK MCP rifiuta metadati con un'origine diversa da quella del server (§3.1), quindi una costante di produzione renderebbe impossibili lo smoke locale (§14.3), Claude Code in locale e l'anteprima (§14.4), e manderebbe i loro client a leggere i metadati di produzione. Regola:

- Una sola funzione, `connectorPublicOrigin()` in `auth.ts` accanto a `CONNECTOR_PUBLIC_ORIGIN`, dà l'origine. Da lì, e mai dall'header `Host` della richiesta, vengono `issuer`, `resource`, gli URL degli endpoint, l'audience dei token, il puntatore `resource_metadata` del 401 e l'indirizzo della scheda «Connettore Claude». `gate.ts` la passa a `connectorUnauthorized` (oggi la chiama senza origine, e il 401 punterebbe sempre alla produzione).
- **Produzione** (`VERCEL_ENV=production`): solo la costante `https://www.theunbundle.com`. Se `MCP_CONNECTOR_PUBLIC_ORIGIN` c'è con un altro valore, gli endpoint OAuth rispondono 503 e la rotta non accetta token OAuth (fallisce chiusa, come la rotta senza profilo).
- **Fuori produzione**: `MCP_CONNECTOR_PUBLIC_ORIGIN` obbligatoria per l'OAuth, altrimenti 503 come sopra. Valori ammessi: `http://127.0.0.1:<porta>` o `http://localhost:<porta>` in locale, `https://<host>.vercel.app` in anteprima (l'indirizzo stabile del ramo), senza percorso né barra finale. `scripts/connettore-test/start-app.mjs` la imposta a `http://127.0.0.1:53130`; l'anteprima la riceve come variabile del solo ambiente Preview. Nessun metadato fuori produzione nomina l'host di produzione.

---

## 9. Login Microsoft con Firebase

### 9.1 Nella pagina

1. Firebase Web SDK: `const provider = new OAuthProvider("microsoft.com")`, `provider.setCustomParameters({ tenant: "<tenant>", prompt: "select_account" })`. `tenant` è l'id del tenant del cliente (un GUID, oppure il suo dominio `….onmicrosoft.com`), dalla configurazione del workspace (§11): senza, Microsoft accetta account di qualsiasi tenant.
2. `signInWithPopup` (con ripiego su `signInWithRedirect`, come fa già il modulo d'iscrizione ai corsi).
3. Dal risultato: il token Firebase (`user.getIdToken()`) e il token Microsoft (`OAuthProvider.credentialFromResult(result).idToken`). Il token d'accesso Microsoft non serve e non si manda: Unbundle non chiama Microsoft Graph.
4. `POST /api/oauth/authorize/complete`, poi `signOut` di Firebase nella pagina.

### 9.2 Sul server

1. Token Firebase verificato con Firebase Admin (`verifyIdToken`), con `firebase.sign_in_provider = "microsoft.com"`.
2. Token Microsoft verificato con le chiavi pubbliche della piattaforma d'identità Microsoft: firma, `aud` uguale al Client ID dell'app registrata in Azure, `exp`, `iss` della forma `https://login.microsoftonline.com/<tid>/v2.0`.
3. **Tenant**: `tid` dentro i tenant ammessi del workspace. È il controllo principale: il parametro `tenant` della pagina lo può cambiare chiunque nel proprio browser.
4. **Soggetto**: `oid`, uguale all'identificativo federato di Firebase (`firebase.identities["microsoft.com"]`). La documentazione di Firebase lo conferma: con un tenant indicato l'`oid` coincide con l'identificativo che Firebase usa, mentre `sub` è proprio dell'app e non va usato.
5. **Dominio email** (`email`, altrimenti `preferred_username`) dentro `allowed_domains`: un secondo filtro, aggiornabile senza rilascio, se i domini dell'organizzazione cambiano. Microsoft sconsiglia email e UPN come chiave d'autorizzazione: per questo vale prima il tenant e la chiave è `oid`.
6. `connector_identities`: inserimento o aggiornamento su `(workspace_id, "microsoft.com", oid)` con `email`, `display_name` e `last_seen_at`; con `disabled_at` l'accesso si rifiuta.
7. Codice (§3.4).

### 9.3 Chi propone

Con l'identità verificata `submittedBy` del payload si ignora (c'è già). Oggi il servizio di invio riceve allora `{ externalUserId: "user:<id>" }` e `proposed_by` diventerebbe quella stringa: in fase 2 `externalPayloadInput` passa nome ed email dell'identità (`display_name`, `email`), così Lateral Space vede chi propone come oggi, con un dato verificato. Nessun conteggio o classifica per persona in nessuna vista (art. 15.4): `submitted_by_user_id` serve solo a «le mie proposte» e, se Pierpaolo lo sceglie, allo stato per codice (§12).

### 9.4 Un progetto Firebase a parte (decisione 2)

La pagina **non** chiama mai `/api/auth/session`: l'identità è solo MCP. Ma nel progetto Firebase di oggi qualunque utente Firebase può ottenere una sessione della dashboard mandando il suo token a `/api/auth/session` (`createSessionCookie` accetta ogni token valido, poi `auth()` crea la riga in `users`): un'identità Microsoft entrata nello stesso progetto diventerebbe un utente di Unbundle (senza workspace, ma con un account). Due strade:

- **consigliata**: un progetto Firebase (o un tenant di Identity Platform) solo per il connettore, con una seconda app Firebase nel client (`initializeApp(config, "connettore")`). Nessun utente in comune con la dashboard; nessun conflitto con l'impostazione «One account per email address» (Firebase rifiuta con `auth/account-exists-with-different-credential` un accesso Microsoft con l'email di un account Google esistente); configurazione del provider Microsoft indipendente. Gli utenti di quel progetto non servono dopo il login: si possono cancellare con Firebase Admin a fine accesso;
- in alternativa, lo stesso progetto, con `/api/auth/session` che rifiuta i token con `sign_in_provider = "microsoft.com"`: una riga, ma nel cuore dell'accesso alla dashboard, che non è del connettore.

### 9.5 Configurazione di Firebase

- Provider Microsoft attivo con Client ID e segreto dell'app registrata in Azure (§10). Il provider si configura con una sola coppia Client ID e segreto per progetto (da riverificare nella console quando si configura): un motivo in più per il progetto a parte, e per l'app multi-tenant del §10.
- Redirect dell'app in Azure: l'indirizzo di ritorno che Firebase mostra nella configurazione del provider (dominio `*.firebaseapp.com` del progetto, o il dominio di autenticazione personalizzato).
- `www.theunbundle.com` tra gli «Authorized domains».
- I browser che bloccano lo storage di terze parti possono rompere popup e redirect di Firebase quando il dominio di autenticazione è diverso dal sito: da provare in anteprima con Safari e da mobile; il rimedio documentato da Firebase è un dominio di autenticazione sullo stesso sito.

### 9.6 CSP della pagina di accesso

La pagina tratta token Firebase e Microsoft: riceve una CSP sua, in `next.config.ts` come i link personali dei Casi d'uso (`PUBLIC_LINK_CSP`), invece di restare senza:

```
frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self';
connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;
frame-src https://<dominio di autenticazione del progetto Firebase del connettore>
```

- Sono le sorgenti esterne che l'SDK di Firebase Auth installato (`@firebase/auth` 1.13) usa: le API `identitytoolkit` e `securetoken`, l'iframe nascosto `/__/auth/iframe` sul dominio di autenticazione e lo script `https://apis.google.com/js/api.js` (con `script-src` assente non serve elencarlo; se un giorno si aggiunge `script-src`, va ammesso). Da riverificare con la versione dell'SDK quando si costruisce.
- Nessuna `script-src`: senza nonce una `script-src` stretta romperebbe gli script inline di Next (guida `content-security-policy.md`, «Without Nonces»); i nonce richiederebbero il proxy, che è dell'hub e non gira su questo percorso (§17).
- La pagina porta il browser a Claude con una navigazione da script (`location.assign` dell'indirizzo che `complete` restituisce), che la CSP non limita: `form-action 'self'` regge. Se la chiusura diventasse un form con un 303 verso Claude, `form-action` dovrebbe elencare i callback del §4.3, perché i browser la applicano anche ai redirect dopo l'invio.
- Il login Microsoft avviene nel popup (o nel redirect) sul dominio di autenticazione e su `login.microsoftonline.com`, fuori dalla pagina: la sua CSP non lo tocca.
- Con l'emulatore (solo in locale) `connect-src` e `frame-src` aggiungono `http://127.0.0.1:59129`.
- Il test di K11 (§17) controlla che una CSP sulla pagina lasci passare queste sorgenti.

---

## 10. Cosa serve dall'IT del cliente

Una **registrazione in Azure** (Entra ID) e, se il tenant non lascia acconsentire gli utenti da soli, il **consenso di un Global Administrator** (o di un ruolo che può dare il consenso amministrativo). Due modelli (decisione 1):

| | A. App di Lateral Space, multi-tenant (consigliato) | B. App del cliente, single-tenant |
|---|---|---|
| Chi registra | Lateral Space, una volta, nel proprio tenant («Accounts in any organizational directory») | l'IT del cliente, nel suo tenant |
| Cosa fa l'IT | dà il consenso per l'organizzazione; l'app compare tra le «Enterprise applications», dove può limitare l'accesso a un gruppo («Assignment required») | registra l'app con il redirect di Firebase, crea un segreto con scadenza e lo consegna in modo sicuro (mai per email in chiaro) |
| Limite al tenant | parametro `tenant` più controllo di `tid` sul server (§9.2) | lo impone Microsoft; il controllo di `tid` resta |
| Più clienti | la stessa app per tutti | un'app per cliente, ma una sola configurazione Microsoft per progetto Firebase |
| Scadenze | il segreto lo gestisce Lateral Space | il segreto scade: serve un promemoria condiviso |

In tutti e due i casi:

- solo permessi **delegati** per l'accesso (`openid`, `profile`, `email` e, se il login lo chiede, `User.Read`); nessun permesso applicativo, nessun accesso a posta, file o calendari;
- l'IT comunica: id del tenant, domini email ammessi (anche quelli che si aggiungeranno in seguito), eventuale gruppo di persone ammesse;
- le politiche di Conditional Access (MFA, dispositivi gestiti) valgono al login Microsoft: una politica sui dispositivi non gestiti può bloccare l'accesso da telefono. Da provare (§14.4).

---

## 11. Passaggio dalla fase 1

1. **Dati.** Le tabelle nuove (§13) vanno nella **0021**, riservata al connettore se la 0019 è già in produzione (PIANO-LAVORI §2.5); altrimenti in coda alla 0019, con le regole di oggi. Stessi statement nel self-heal, `schema-check.mjs` verde. Nella configurazione: i tenant ammessi (colonna nuova, per esempio `oauth_tenant_ids jsonb`, da riempire con `connector-admin config`).
2. **Codice.** Rilasciato spento: l'OAuth vale solo per i workspace in `auth_mode = oauth`, e nessuno lo è.
3. **Prova** nell'organizzazione di prova (§14.4), con un tenant Microsoft di prova, mai quello del cliente.
4. **Configurazione del workspace** con `connector-admin config` (che oggi rifiuta la fase 2): `authMode: "oauth"`, `identityMode: "verificata"`, `allowedDomains`, tenant. `get_intake_guide` riporta `identityMode: "verificata"` e la skill smette di chiedere il nome (lo fa già).
5. **Il giorno del passaggio.** Lateral Space cambia la configurazione; da quel momento il token nell'header riceve 401 (`auth_mode` diverso da `header`). Subito dopo l'Owner **rimuove** il connettore «Unbundle» e lo **riaggiunge** con lo stesso URL, senza «Request headers»; ognuno clicca «Connetti» e accede con l'account aziendale. Nei minuti in mezzo vale il piano B della skill (riepilogo da mandare per email). Un periodo con i due accessi insieme si potrebbe fare, ma complica l'ingresso per pochi minuti di vantaggio: non lo propongo.
6. **Dopo.** Revocare il token di fase 1 dalla scheda «Connettore Claude» (non serve più e resterebbe una credenziale d'organizzazione attiva). Il plugin con `.mcp.json` può diventare quello normale, se la prova dice che non nasce un secondo «Unbundle» (`VERIFICA.md` §3, voce 10).
7. **Cosa resta della fase 1.**
   - Le segnalazioni di fase 1 non hanno `submitted_by_user_id` (i nomi erano dichiarati, non verificati): non compaiono in «le mie proposte», e non si collegano per nome. Il loro codice funziona come prima (salvo l'opzione del §12).
   - `principal_key` cambia da `token:<id>` a `user:<id>`: un invio ripetuto a cavallo del passaggio non si riconosce come duplicato. Caso trascurabile.
   - Limiti: da quel momento 10 invii l'ora e 3.000 letture l'ora **per persona**; resta il tetto del giorno del workspace (1.000).
8. **Comunicazione** alle persone, una riga: «Da <data> Claude ti chiede di accedere a Unbundle con l'account aziendale, una volta al mese».

---

## 12. Stato per codice limitato a chi ha proposto (opzione da decidere)

Oggi chiunque nell'organizzazione abbia il connettore legge per codice titolo e nota pubblica, e i codici sono in sequenza: rischio accettato in fase 1 (prompt WP6), con le mitigazioni di oggi (limite di letture, forma ridotta per le nascoste, avviso accanto alla nota pubblica). Con l'identità verificata (decisione 4):

| Opzione | Chi ha proposto | Gli altri |
|---|---|---|
| a. come oggi | tutto | tutto |
| **b. consigliata** | tutto | forma ridotta delle nascoste: solo codice, stato e giorno del cambio; `title`, `kind`, `area`, `publicNote`, `linkedCaseCode` e `duplicateOfCode` null (`statusViewOfRow`) |
| c. stretta | tutto | `not_found` |

- «Chi ha proposto» = `submitted_by_user_id` uguale all'identità del token. Le segnalazioni senza identità (fase 1, web, Slack) escono ridotte per tutti con b, non trovate con c.
- `find_similar_contributions` mostra comunque i titoli degli altri (serve a evitare i doppioni): b e c proteggono soprattutto la nota pubblica.
- Nessun cambio di contratto: la forma ridotta esiste già. b è coerente con la regola dell'hub per i contributori (D13: codice e nota pubblica solo delle proprie proposte).

---

## 13. Cambi al codice previsti

- **0021** (o coda della 0019) e self-heal: `connector_oauth_clients` (CIMD in cache e client della DCR: tipo, `client_id` unico, metadati, `redirect_uris`, creato, ultimo uso, letto il), `connector_oauth_requests` (hash dell'id, che sta solo nel cookie; workspace, client, redirect, challenge, `state`, risorsa, scope, scadenza, chiusa il), `connector_oauth_codes` (hash, richiesta, identità, scadenza, usato il, `grant_id uuid REFERENCES connector_oauth_grants(id)`, scritto con `used_at`: §3.4), `connector_oauth_grants` (id, workspace, identità, client, risorsa, creata, scadenza a 30 giorni, revocata il e perché), `connector_oauth_tokens` (hash, concessione, tipo `access` o `refresh`, scadenza, usato il); colonna dei tenant ammessi in `workspace_connector_configs`. Righe scadute cancellate dopo 48 ore, con la stessa pulizia a probabilità bassa di `connector_rate_limits`; i client della DCR mai usati per un accesso dopo un'ora (§3.6).
- `src/lib/connector/oauth/`: metadati, PKCE, confronto dei redirect, risorsa canonica, lettura del CIMD, DCR, codici, token e rotazione, verifica dei token Microsoft e Firebase; tutti moduli con dipendenze passate da fuori, testabili con `node --test`.
- Rotte e pagina del §3; la CSP della pagina in `next.config.ts` (§9.6).
- `auth.ts`: `connectorPublicOrigin()` (§8.1), usata da metadati, endpoint, audience, 401 e scheda; `MCP_CONNECTOR_PUBLIC_ORIGIN` nella tabella delle variabili del README (§3) e in `start-app.mjs`.
- `gate.ts`: ramo `oauth` (token `ub_oat_` per hash, audience, identità) e `principalFromIdentity`; 401 con `scope`, `error="invalid_token"` e il puntatore `resource_metadata` sull'origine dell'ambiente (`connectorUnauthorized(config, connectorPublicOrigin())`).
- `http-hygiene.ts` (prefissi), `call-log.ts` (id della concessione), `tools.ts` (`externalPayloadInput` con l'identità; opzione del §12 in `tool-queries.ts`).
- `connector-admin config`: valori di fase 2 e tenant.
- Scheda «Connettore Claude»: modalità di accesso, «Revoca tutti gli accessi», disattivazione di un'identità cercata per email esatta (nessun elenco o conteggio per persona).
- `VERIFICA.md`: sezione di fase 2; skill e plugin: nessun cambio (la skill segue `identityMode`).

---

## 14. Piano di test

### 14.1 Unità (`npm run test:connector`, già a glob)

- metadati identici a §3.1 e §3.2, validati anche con gli schemi dell'SDK (`OAuthProtectedResourceMetadataSchema`, `OAuthMetadataSchema` di `@modelcontextprotocol/sdk/shared/auth.js`);
- origine pubblica (§8.1), per produzione, locale e anteprima: `resource` uguale all'URL del server di quell'ambiente e accettata da `checkResourceAllowed` dell'SDK; `issuer`, endpoint e puntatore del 401 sulla stessa origine; fuori produzione nessun metadato nomina `www.theunbundle.com`; in produzione un override diverso dalla costante, e fuori produzione una variabile assente o fuori forma, danno 503;
- PKCE con il vettore dell'RFC 7636 (appendice B); `plain` e challenge fuori forma rifiutati;
- redirect: i due callback esatti, loopback con porte diverse per `localhost` e `127.0.0.1`, rifiutati `http` su altri host, frammenti, credenziali, prefissi, maiuscole nel percorso;
- risorsa canonica: maiuscole nell'host, barra finale, query, frammento, slug di un altro workspace o in `header`;
- CIMD: `client_id` diverso dall'URL, `http`, host non ammesso, IP privato, redirect, documento troppo grande, attesa scaduta, JSON non valido, campi mancanti, cache;
- richiesta in sospeso: il 303 senza id nell'indirizzo; gli attributi del cookie (`__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 10 minuti); pagina e `complete` senza cookie, con un cookie scaduto, già usato o con un'impronta diversa → nessun codice; il cookie cancellato alla chiusura;
- codici: scaduto, riusato (la concessione del primo scambio, trovata con `grant_id`, si revoca con i suoi token), legato a un altro client, redirect o risorsa;
- refresh: rotazione, riuso con la revoca della concessione, finestra di 10 secondi (se decisa), scadenza fissa a 30 giorni;
- errori RFC 6749 con descrizioni fisse; `invalid_grant` per ogni refresh non valido;
- 401 con `resource_metadata`, `scope` ed `error="invalid_token"`;
- token `ub_oat_` e `ub_ort_` nell'indirizzo → 400 `token_in_url`;
- log senza codici, verifier, token, `state`, `oid`, `tid`, email o nomi, anche nei percorsi d'errore;
- il test di K11 su proxy e `next.config.ts` (§17) resta, con il dominio di autenticazione vero al posto del segnaposto quando la CSP del §9.6 lo nomina.

### 14.2 Integrazione sul Postgres locale (`npm run test:connector:db`, `--test-concurrency=1`)

- 0021 due volte e parità con il self-heal (`schema-check.mjs`);
- scambio del codice: due scambi in parallelo dello stesso codice danno una sola concessione; il secondo uso revoca la concessione del primo e i suoi token d'accesso e refresh;
- flusso completo con il verificatore Microsoft finto (chiavi locali passate come dipendenza) e l'emulatore di Firebase Auth del connettore (59129); la stessa richiesta chiusa da un altro browser (senza il cookie) non dà codice;
- audience di un altro slug, identità disattivata, tenant o dominio non ammessi, connettore sospeso (`connector_disabled` anche con OAuth), configurazione tornata a `header`;
- 11° invio dell'ora della stessa persona → `rate_limited`; due persone non si consumano il secchio a vicenda; idempotenza per persona;
- DCR: un IP che esaurisce il suo secchio non blocca un altro IP né le registrazioni dagli IP di Anthropic; il tetto complessivo ferma tutti; un client mai usato per un accesso sparisce dopo un'ora;
- `get_contribution_status` senza codice (le proprie) e l'opzione del §12; isolamento fra due workspace.

### 14.3 Smoke con `next start` (53130)

Con `MCP_CONNECTOR_PUBLIC_ORIGIN=http://127.0.0.1:53130` (la imposta `start-app.mjs`, §8.1), il client dell'SDK (`StreamableHTTPClientTransport` con un `OAuthClientProvider`) fa il flusso completo con la DCR; il CIMD richiede un documento `https` e si prova in integrazione con la lettura passata come dipendenza. Tempi: p95 di metadati e token.

### 14.4 Claude Code e organizzazione di prova (le fa Pierpaolo)

- Claude Code (con un login): `claude mcp add --transport http unbundle-test http://127.0.0.1:53130/api/mcp/connettore/<slug>` senza header, poi `/mcp` → accesso nel browser (in locale con l'emulatore) → dialogo; `claude mcp remove unbundle-test`. Nell'app locale servono l'origine pubblica `http://127.0.0.1:53130` (§8.1) e un **verificatore Microsoft solo di prova** dentro l'app in esecuzione (in §14.2 è solo una dipendenza passata ai moduli): con l'emulatore di Firebase Auth non arriva un token firmato da Microsoft, quindi il verificatore di prova prende `tid`, `oid` ed email dall'account dell'emulatore (con un tenant di prova) e applica le stesse regole del §9.2 su tenant e dominio. Si accende solo con `FIREBASE_AUTH_EMULATOR_HOST` impostata e `VERCEL_ENV` diverso da `production` (lo avvia `start-app.mjs`), mai nel build di produzione.
- Anteprima Vercel su un branch Neon di sviluppo, con `MCP_CONNECTOR_PUBLIC_ORIGIN` uguale all'indirizzo dell'anteprima (§8.1), un tenant Microsoft di prova, l'organizzazione Claude di prova: connettore aggiunto senza header; «Connetti» da claude.ai, Desktop, mobile, Cowork e Claude Code; CIMD o DCR (dal log); **URL del CIMD delle app ospitate**, da annotare qui; pagina di accesso e consenso Microsoft; refresh dopo un'ora (o con una durata più breve solo in anteprima) e due refresh quasi insieme; identità disattivata; «Revoca tutti gli accessi»; Safari e telefono; Conditional Access; 5 dialoghi come in `VERIFICA.md` §3.

---

## 15. Stima: 8-12 giorni

| Parte | Giorni |
|---|---|
| 0021, self-heal, `schema-check.mjs`, configurazione e `connector-admin` | 1-1,5 |
| Metadati, `authorize`, richieste in sospeso, pagina di accesso con Firebase e verifica dei token Microsoft | 2-3 |
| Token (codici, PKCE, rotazione e riuso), DCR, lettura del CIMD | 2-2,5 |
| Rotta in modalità `oauth` (principal, audience, log, prefissi), opzione del §12, scheda «Connettore Claude» | 1-1,5 |
| Test di unità, integrazione e smoke | 1,5-2 |
| Organizzazione di prova e correzioni | 0,5-1,5 |
| **Totale** | **8-12** |

Fuori dalla stima: il tempo dell'IT del cliente, la scheda A.8 aggiornata (Firebase tratterà anche le identità delle persone del cliente: nome, email, `oid`), la decisione dell'AI Board.

---

## 16. Decisioni per Pierpaolo, prima di iniziare

1. App in Azure: modello A (di Lateral Space, multi-tenant, consigliato) o B (del cliente) (§10).
2. Progetto Firebase a parte per le identità del connettore (consigliato) oppure lo stesso progetto con `/api/auth/session` che rifiuta gli accessi Microsoft (§9.4).
3. Refresh: 30 giorni fissi dall'accesso (consigliato) o 30 giorni dall'ultimo uso (§6.2).
4. Stato per codice con l'identità verificata: opzione a, b (consigliata) o c (§12).
5. Solo client di Claude (documenti CIMD su `claude.ai` e `claude.com`, DCR con i redirect di Claude): sì (§4).
6. Revoca automatica di un token OAuth arrivato in un indirizzo: sì (§6.5).
7. Decisione dell'AI Board sull'autenticazione (README, «Prima dell'attivazione reale»).

**Fuori dalla fase 2.** La documentazione di Claude descrive anche Enterprise Managed Auth (piani Team ed Enterprise): l'identity provider dell'organizzazione firma un'asserzione e l'authorization server la scambia con un token (grant JWT bearer, RFC 7523), senza «Connetti» né consenso. Non funziona con la DCR e la documentazione la descrive con Okta: si valuta dopo, se il cliente lo chiede.

---

## 17. Verifica di K11: proxy e `next.config.ts` non bloccano i percorsi futuri

**Lettura.**

- `src/proxy.ts`: il matcher è `["/dashboard/:path*", "/login", "/register", "/install/slack"]`. `/.well-known/*`, `/api/oauth/*`, `/api/mcp/connettore/*` e `/connettore/accesso` restano fuori: il proxy non gira su quei percorsi. Il piano assegna `src/proxy.ts` all'hub (H6a, redirect di `/casi-duso/nuovo`): K11 non lo modifica.
- `next.config.ts`: un solo redirect, condizionato all'host `theunbundle.com` (senza www), 308 verso `https://www.theunbundle.com/:path` per ogni percorso tranne `/api/slack/*`. Sull'host con www nessun redirect. Le intestazioni globali (HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, `X-DNS-Prefetch-Control`) non fermano nessuna chiamata; la CSP vale solo per `/r/*` e `/api/r/*`. `X-Frame-Options: DENY` sulla pagina di accesso va bene: si apre in una finestra, mai in un iframe. Nessun `rewrites`, nessun `trailingSlash: true` (e comunque Next esclude `.well-known/` da quella regola). `vercel.json` ha solo i cron.

**Test** (`src/lib/connector/oauth-routes.test.ts`, dentro `npm run test:connector`): compila il matcher di `src/proxy.ts` con la funzione di Next (`getMiddlewareMatchers`) e controlla che nessun percorso futuro corrisponda (e che `/dashboard/…` sì); valuta i redirect di `next.config.ts` con le funzioni di Next (`getPathMatch`, `matchHas`): sull'host con www nessuno, sull'host senza www un solo 308 verso lo stesso percorso su www; controlla che le intestazioni globali arrivino a quei percorsi e che una `Content-Security-Policy`, se arriva alla pagina di accesso, lasci passare le sorgenti di Firebase Auth del §9.6 (direttive di ripiego comprese; sulle risposte JSON una CSP non governa nulla e non si controlla). Il controllo della CSP ha un test suo, con una CSP che blocca e una che lascia passare, perché oggi nessuna CSP arriva a quei percorsi e il controllo sul `next.config.ts` vero non trova niente da verificare. Il percorso dei metadati della risorsa è quello di `resourceMetadataUrl`, la stessa funzione del 401.

**Prova con `next start`** (19/10/2026, build del codice di `a651285`, base di K11, che non cambia file dell'app; `127.0.0.1:53130`, database `conn_k11`), con l'host passato nell'header `Host`:

| Host | `/.well-known/oauth-protected-resource/api/mcp/connettore/alfa-beta`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`, `GET /api/oauth/authorize?…`, `POST /api/oauth/token`, `POST /api/oauth/register`, `/connettore/accesso` | Controllo: `/dashboard` |
|---|---|---|
| `www.theunbundle.com` | 404 di Next (la rotta non c'è ancora), nessun redirect, solo le intestazioni globali, nessuna CSP (quella della pagina arriverà con la fase 2, §9.6) | 307 verso `/login` (il proxy gira) |
| `theunbundle.com` | 308 verso lo stesso percorso su `https://www.theunbundle.com`, query compresa (anche per le POST: il 308 mantiene metodo e corpo) | 308 verso www |
| `127.0.0.1:53130` | come con www | 307 verso `/login` |

Quando le rotte esisteranno, arriveranno a loro senza passare dal proxy e senza redirect sul dominio con www.
