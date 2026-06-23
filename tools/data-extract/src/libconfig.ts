// Tolerant parser for the Hercules libconfig-style database files
// (db/re/*.conf). These are NOT JSON. They use:
//   - `//` line comments and `/* ... */` block comments
//   - unquoted keys, `:` or `=` as key/value separators
//   - objects `{ ... }`, arrays `[ ... ]`, tuples `( ... )`
//   - long strings delimited by `<"` ... `">` (used by Script fields)
//   - optional trailing commas
//   - duplicate keys (e.g. mob Drops may repeat an item)
//
// Comment stripping happens inside the tokenizer (not a regex pre-pass) so
// that `//` or `/* */` sequences inside strings are left untouched.

export type ConfValue =
  | string
  | number
  | boolean
  | ConfValue[]
  | { [key: string]: ConfValue };

export interface ParseResult {
  value: ConfValue;
  /** non-fatal issues, e.g. dropped duplicate keys */
  warnings: string[];
}

type TokType =
  | "lbrace" | "rbrace"
  | "lbracket" | "rbracket"
  | "lparen" | "rparen"
  | "colon" | "comma"
  | "string" | "number" | "boolean" | "ident"
  | "eof";

interface Token {
  type: TokType;
  value: string | number | boolean;
  line: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const push = (type: TokType, value: string | number | boolean) =>
    tokens.push({ type, value, line });

  while (i < n) {
    const c = src[i]!;

    // newlines / whitespace
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    // comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "#") { // some Hercules files use shell-style comments
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }

    // long string  <" ... ">
    if (c === "<" && src[i + 1] === '"') {
      i += 2;
      let s = "";
      while (i < n && !(src[i] === '"' && src[i + 1] === ">")) {
        if (src[i] === "\n") line++;
        s += src[i];
        i++;
      }
      i += 2; // skip ">
      push("string", s.trim());
      continue;
    }

    // normal quoted string
    if (c === '"') {
      i++;
      let s = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) { // escape
          s += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === "\n") line++;
        s += src[i];
        i++;
      }
      i++; // closing quote
      push("string", s);
      continue;
    }

    // structural
    if (c === "{") { push("lbrace", c); i++; continue; }
    if (c === "}") { push("rbrace", c); i++; continue; }
    if (c === "[") { push("lbracket", c); i++; continue; }
    if (c === "]") { push("rbracket", c); i++; continue; }
    if (c === "(") { push("lparen", c); i++; continue; }
    if (c === ")") { push("rparen", c); i++; continue; }
    if (c === ":" || c === "=") { push("colon", c); i++; continue; }
    if (c === ",") { push("comma", c); i++; continue; }

    // number, OR a bareword that happens to start with a digit
    // (e.g. mob drop "3rd_Floor_Pass", skill weapon type "1HSwords").
    if (c === "-" || c === "+" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxX.]/.test(src[j]!)) j++;
      // If the numeric run is immediately followed by identifier characters,
      // it's actually a bareword key/value, not a number.
      if (j < n && /[A-Za-z_]/.test(src[j]!)) {
        let k = i;
        while (k < n && /[A-Za-z0-9_]/.test(src[k]!)) k++;
        push("ident", src.slice(i, k));
        i = k;
        continue;
      }
      const raw = src.slice(i, j);
      const num = raw.startsWith("0x") || raw.startsWith("0X")
        ? parseInt(raw, 16)
        : Number(raw);
      if (!Number.isNaN(num)) {
        push("number", num);
        i = j;
        continue;
      }
      // not a clean number and not a bareword: emit single char as ident
    }

    // identifier / bareword (keys, enum constants, true/false)
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      i = j;
      if (word === "true") push("boolean", true);
      else if (word === "false") push("boolean", false);
      else push("ident", word);
      continue;
    }

    // unknown char — skip defensively
    i++;
  }

  push("eof", "");
  return tokens;
}

class Parser {
  private pos = 0;
  lastId = "?";
  readonly warnings: string[] = [];
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.pos]!; }
  private next(): Token { return this.toks[this.pos++]!; }
  private fail(msg: string): never {
    throw new Error(`${msg} (last Id seen: ${this.lastId})`);
  }

  /** Parse a top-level file: a sequence of `key: value` pairs OR a single value. */
  parseTop(): ConfValue {
    // If it looks like a bare container, parse it directly.
    const t = this.peek();
    if (t.type === "lbrace" || t.type === "lbracket" || t.type === "lparen") {
      return this.parseValue();
    }
    // Otherwise treat the whole file as an object body (key: value ...).
    return this.parseObjectBody("eof");
  }

  private parseValue(): ConfValue {
    const t = this.peek();
    switch (t.type) {
      case "lbrace": {
        this.next();
        return this.parseObjectBody("rbrace");
      }
      case "lbracket": {
        this.next();
        return this.parseListBody("rbracket");
      }
      case "lparen": {
        this.next();
        return this.parseListBody("rparen");
      }
      case "string":
      case "number":
      case "boolean":
        this.next();
        return t.value as ConfValue;
      case "ident":
        // bareword used as a value (enum constant) -> keep as string
        this.next();
        return t.value as string;
      default:
        return this.fail(`Parse error at line ${t.line}: unexpected ${t.type}`);
    }
  }

  private parseObjectBody(end: TokType): { [key: string]: ConfValue } {
    const obj: { [key: string]: ConfValue } = {};
    while (this.peek().type !== end && this.peek().type !== "eof") {
      if (this.peek().type === "comma") { this.next(); continue; }

      // key may be ident, string, or number
      const keyTok = this.next();
      let key: string;
      if (keyTok.type === "ident" || keyTok.type === "string") key = String(keyTok.value);
      else if (keyTok.type === "number") key = String(keyTok.value);
      else return this.fail(`Parse error at line ${keyTok.line}: expected key, got ${keyTok.type}`);

      // optional separator
      if (this.peek().type === "colon") this.next();

      const value = this.parseValue();
      if (key === "Id" && (typeof value === "number" || typeof value === "string")) this.lastId = String(value);
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        this.warnings.push(`Duplicate key "${key}" at line ${keyTok.line} (kept first occurrence)`);
      } else {
        obj[key] = value;
      }

      if (this.peek().type === "comma") this.next();
    }
    if (this.peek().type === end) this.next();
    return obj;
  }

  private parseListBody(end: TokType): ConfValue[] {
    const arr: ConfValue[] = [];
    while (this.peek().type !== end && this.peek().type !== "eof") {
      if (this.peek().type === "comma") { this.next(); continue; }
      arr.push(this.parseValue());
      if (this.peek().type === "comma") this.next();
    }
    if (this.peek().type === end) this.next();
    return arr;
  }
}

export function parseConf(src: string): ParseResult {
  const toks = tokenize(src);
  const parser = new Parser(toks);
  const value = parser.parseTop();
  return { value, warnings: parser.warnings };
}

// ----- small helpers for extractors -----

export function asObject(v: ConfValue | undefined): Record<string, ConfValue> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, ConfValue>;
  return {};
}

export function asArray(v: ConfValue | undefined): ConfValue[] {
  if (Array.isArray(v)) return v;
  return [];
}

export function asNumber(v: ConfValue | undefined, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return fallback;
}

export function asString(v: ConfValue | undefined, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

export function asBool(v: ConfValue | undefined, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}
