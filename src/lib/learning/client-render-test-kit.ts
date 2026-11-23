/**
 * Solo per i test resi nel browser (rilascio 10, ondata 7b): un DOM minimo in Node, quanto basta a `react-dom/client`
 * per montare una pagina, ridisegnarla con un albero nuovo come fa il router dopo `router.replace` o `router.refresh`, e
 * leggerla in HTML con gli aiuti di `render-test-kit.ts`. Serve per gli errori che il server non mostra, perché
 * nascono solo quando React riconcilia l'albero di prima con quello nuovo (due fratelli con la stessa chiave lasciano
 * in pagina il vecchio). Non lo importa nessun file dell'applicazione.
 */

const XHTML = "http://www.w3.org/1999/xhtml";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const noop = () => {};

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

class FakeNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly ownerDocument: FakeDocument | null;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  nodeValue: string | null = null;
  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) - 1] ?? null) : null;
  }
  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }
  get isConnected() {
    return true;
  }
  appendChild<N extends FakeNode>(child: N): N {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore<N extends FakeNode>(child: N, before: FakeNode | null): N {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<N extends FakeNode>(child: N): N {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  getRootNode(): FakeNode {
    return this.ownerDocument ?? this;
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  get textContent(): string {
    return this.nodeValue ?? this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    if (this.nodeType !== 1) {
      this.nodeValue = value;
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  get data() {
    return this.nodeValue ?? "";
  }
  set data(value: string) {
    this.nodeValue = value;
  }
}

class FakeStyle {
  [property: string]: unknown;
  setProperty(name: string, value: string) {
    this[name] = value;
  }
  removeProperty(name: string) {
    delete this[name];
  }
  getPropertyValue(name: string) {
    return typeof this[name] === "string" ? (this[name] as string) : "";
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly localName: string;
  readonly namespaceURI: string;
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  constructor(tag: string, doc: FakeDocument, namespaceURI: string = XHTML) {
    super(1, namespaceURI === XHTML ? tag.toUpperCase() : tag, doc);
    this.tagName = this.nodeName;
    this.localName = tag;
    this.namespaceURI = namespaceURI;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  setAttributeNS(_namespace: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  removeAttributeNS(_namespace: string | null, name: string) {
    this.removeAttribute(name);
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  get children() {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }
  focus() {}
  blur() {}
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  get outerHTML(): string {
    const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
    if (VOID.has(this.localName)) return `<${this.localName}${attributes}>`;
    return `<${this.localName}${attributes}>${this.innerHTML}</${this.localName}>`;
  }
  get innerHTML(): string {
    return this.childNodes.map((child) => (child instanceof FakeElement ? child.outerHTML : child.nodeType === 3 ? escapeText(child.nodeValue ?? "") : "")).join("");
  }
}

class FakeDocument extends FakeNode {
  activeElement: FakeElement | null = null;
  body: FakeElement | null = null;
  readonly documentElement: FakeElement;
  readonly visibilityState = "visible";
  readonly hidden = false;
  readonly readyState = "complete";
  cookie = "";
  defaultView: unknown = null;
  constructor() {
    super(9, "#document", null);
    this.documentElement = new FakeElement("html", this);
  }
  createElement(tag: string) {
    return new FakeElement(tag, this);
  }
  createElementNS(namespace: string, tag: string) {
    return new FakeElement(tag, this, namespace);
  }
  createTextNode(text: string) {
    const node = new FakeNode(3, "#text", this);
    node.nodeValue = text;
    return node;
  }
  createComment(text: string) {
    const node = new FakeNode(8, "#comment", this);
    node.nodeValue = text;
    return node;
  }
  getElementById(id: string): FakeElement | null {
    const visit = (node: FakeNode): FakeElement | null => {
      if (node instanceof FakeElement && node.getAttribute("id") === id) return node;
      for (const child of node.childNodes) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return this.body ? visit(this.body) : null;
  }
  getElementsByName() {
    return [];
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

type Act = (callback: () => void) => void;
type Root = { render(element: unknown): void; unmount(): void };

export interface ClientPage {
  /** Disegna (la prima volta) o ridisegna l'albero nella stessa radice, come il router dopo `replace` o `refresh`. */
  render(element: unknown): void;
  /** Cambia l'indirizzo che la pagina legge (`window.location`), come un `router.replace`. */
  navigate(href: string): void;
  /** L'HTML della pagina, da leggere con `visibleText`, `filledButtons`, `folds`. */
  html(): string;
  /** Gli errori che React scrive in console mentre disegna (per esempio due fratelli con la stessa chiave). */
  readonly errors: string[];
  unmount(): void;
}

/**
 * Una radice di `react-dom/client` su un DOM finto, con la finestra all'indirizzo `href` (assoluto, con l'ancora). Le
 * variabili globali (`window`, `document`, …) restano solo finché la pagina è montata: `unmount` le toglie.
 */
export async function mountClient(href: string): Promise<ClientPage> {
  const document = new FakeDocument();
  const body = document.createElement("body");
  document.documentElement.appendChild(body);
  document.body = body;
  const container = document.createElement("div");
  body.appendChild(container);
  let url = new URL(href);
  const location = {
    get href() {
      return url.href;
    },
    get origin() {
      return url.origin;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
    assign: noop,
    replace: noop,
    reload: noop,
  };
  const history = {
    state: null as unknown,
    pushState(state: unknown, _title: string, next: string) {
      history.state = state;
      url = new URL(next, url);
    },
    replaceState(state: unknown, _title: string, next: string) {
      history.state = state;
      url = new URL(next, url);
    },
    back: noop,
  };
  /** I `requestAnimationFrame` ancora in attesa: `unmount` li cancella, così niente parte a pagina smontata. */
  const frames = new Set<ReturnType<typeof setTimeout>>();
  const requestAnimationFrame = (callback: (time: number) => void) => {
    const id = setTimeout(() => {
      frames.delete(id);
      callback(Date.now());
    }, 0);
    frames.add(id);
    return id;
  };
  const cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => {
    frames.delete(id);
    clearTimeout(id);
  };
  const window = {
    document,
    location,
    history,
    event: undefined,
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    scrollTo: noop,
    getComputedStyle: () => new FakeStyle(),
    matchMedia: () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    HTMLIFrameElement: class {},
    HTMLInputElement: class {},
    HTMLButtonElement: class {},
    ShadowRoot: class {},
    ResizeObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    MutationObserver: FakeObserver,
  };
  document.defaultView = window;
  const globals: Record<string, unknown> = {
    window,
    self: window,
    document,
    location,
    history,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLButtonElement: window.HTMLButtonElement,
    ShadowRoot: window.ShadowRoot,
    ResizeObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    MutationObserver: FakeObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: window.getComputedStyle,
    matchMedia: window.matchMedia,
  };
  const scope = globalThis as Record<string, unknown>;
  const before = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(scope, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(scope, key, { value, configurable: true, writable: true });

  const errors: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  const restore = () => {
    for (const id of frames) clearTimeout(id);
    frames.clear();
    console.error = consoleError;
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(scope, key, descriptor);
      else delete scope[key];
    }
  };

  try {
    const react = (await import("react")) as unknown as { act: Act };
    const { createRoot } = (await import("react-dom/client")) as unknown as { createRoot(container: unknown): Root };
    const root = createRoot(container);
    return {
      errors,
      render: (element) => react.act(() => root.render(element)),
      navigate: (next) => {
        url = new URL(next, url);
      },
      html: () => container.innerHTML,
      unmount: () => {
        try {
          react.act(() => root.unmount());
        } finally {
          restore();
        }
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}
