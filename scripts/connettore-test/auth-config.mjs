// Local Firebase Auth emulator of the connector harness (docs/connettore/README.md §4):
// only for the screenshots of the «Connettore Claude» settings card on the connector app
// (127.0.0.1:53130). Its own port, next to the other harnesses (Formazione 59099, Casi
// d'uso 59109, hub 59119), and the demo project that start-app.mjs already passes to Next.
export const CONNECTOR_AUTH_HOST = "127.0.0.1";
export const CONNECTOR_AUTH_PORT = 59129;
export const CONNECTOR_AUTH_PROJECT = "demo-unbundle-connector";
export const CONNECTOR_APP_HOST = "127.0.0.1";
export const CONNECTOR_APP_PORT = 53130;
