/**
 * Syntax check for CEL expressions (https://cel.dev). It parses the grammar and
 * reports the first error. It does not check names or types; that comes later.
 */

type Tok = { kind: "num" | "str" | "id" | "op"; text: string; pos: number };

const OPS3 = ["&&", "||", "==", "!=", "<=", ">="];
const SINGLE = "+-*/%!?:.,()[]{}<>";

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(0[xX][0-9a-fA-F]+[uU]?|[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?[uU]?|[0-9]+\.)/.exec(src.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      i += m[0].length;
      toks.push({ kind: "num", text: m[0], pos: start });
      continue;
    }
    const prefix = /^[rRbB]{1,2}(?=['"])/.exec(src.slice(i));
    if (c === "'" || c === '"' || prefix) {
      const raw = prefix ? /r/i.test(prefix[0]) : false;
      if (prefix) i += prefix[0].length;
      const q = src[i]!;
      const triple = src.startsWith(q.repeat(3), i);
      const end = triple ? q.repeat(3) : q;
      i += end.length;
      let closed = false;
      while (i < src.length) {
        if (!raw && src[i] === "\\") { i += 2; continue; }
        if (src.startsWith(end, i)) { i += end.length; closed = true; break; }
        if (!triple && src[i] === "\n") break;
        i++;
      }
      if (!closed) throw new Error(`unterminated string starting at ${start}`);
      toks.push({ kind: "str", text: src.slice(start, i), pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      toks.push({ kind: "id", text: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS3.includes(two)) { i += 2; toks.push({ kind: "op", text: two, pos: start }); continue; }
    if (SINGLE.includes(c)) { i++; toks.push({ kind: "op", text: c, pos: start }); continue; }
    throw new Error(`unexpected character "${c}" at ${i}`);
  }
  return toks;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private is(text: string): boolean { const t = this.peek(); return !!t && t.kind === "op" && t.text === text; }
  private eat(text: string): boolean { if (this.is(text)) { this.i++; return true; } return false; }
  private expect(text: string): void {
    if (!this.eat(text)) throw new Error(`expected "${text}" ${this.where()}`);
  }
  private where(): string {
    const t = this.peek();
    return t ? `at ${t.pos}, found "${t.text}"` : "at the end of the expression";
  }

  parse(): void {
    if (this.toks.length === 0) throw new Error("the expression is empty");
    this.expr();
    if (this.peek()) throw new Error(`unexpected "${this.peek()!.text}" at ${this.peek()!.pos}`);
  }

  private expr(): void {
    if (++this.depth > 100) throw new Error("expression is nested too deeply");
    this.or();
    if (this.eat("?")) {
      this.or();
      this.expect(":");
      this.expr();
    }
    this.depth--;
  }
  private or(): void { this.and(); while (this.eat("||")) this.and(); }
  private and(): void { this.rel(); while (this.eat("&&")) this.rel(); }
  private rel(): void {
    this.add();
    for (;;) {
      const t = this.peek();
      if (t && ((t.kind === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.text)) || (t.kind === "id" && t.text === "in"))) {
        this.i++;
        this.add();
      } else break;
    }
  }
  private add(): void { this.mul(); while (this.is("+") || this.is("-")) { this.i++; this.mul(); } }
  private mul(): void { this.unary(); while (this.is("*") || this.is("/") || this.is("%")) { this.i++; this.unary(); } }
  private unary(): void {
    if (this.depth++ > 100) throw new Error("expression is nested too deeply");
    if (this.is("!") || this.is("-")) { this.i++; this.unary(); } else this.postfix();
    this.depth--;
  }
  private postfix(): void {
    this.primary();
    for (;;) {
      if (this.eat(".")) {
        const t = this.peek();
        if (!t || t.kind !== "id") throw new Error(`expected a name after "." ${this.where()}`);
        this.i++;
        if (this.is("(")) this.args(")");
      } else if (this.eat("[")) {
        this.expr();
        this.expect("]");
      } else break;
    }
  }
  private args(close: string): void {
    this.expect(close === ")" ? "(" : "[");
    if (this.eat(close)) return;
    do {
      if (this.is(close)) break; // trailing comma
      this.expr();
    } while (this.eat(","));
    this.expect(close);
  }
  private primary(): void {
    const t = this.peek();
    if (!t) throw new Error("the expression ends too early");
    if (t.kind === "num" || t.kind === "str") { this.i++; return; }
    if (t.kind === "id") {
      this.i++;
      if (this.is("(")) this.args(")");
      return;
    }
    if (this.eat("(")) { this.expr(); this.expect(")"); return; }
    if (this.is("[")) { this.args("]"); return; }
    if (this.eat("{")) {
      if (this.eat("}")) return;
      do {
        if (this.is("}")) break;
        this.expr();
        this.expect(":");
        this.expr();
      } while (this.eat(","));
      this.expect("}");
      return;
    }
    throw new Error(`unexpected "${t.text}" at ${t.pos}`);
  }
}

/** Returns an error message, or undefined when the expression parses. */
/** Most tokens one expression may have. A static stand-in for the CEL cost limit. */
export const MAX_EXPRESSION_STEPS = 400;

/** Number of tokens in an expression, or undefined if it cannot be read. */
export function expressionSteps(src: string): number | undefined {
  try {
    return tokenize(src).length;
  } catch {
    return undefined;
  }
}

export function celSyntaxError(src: string): string | undefined {
  try {
    new Parser(tokenize(src)).parse();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : "invalid expression";
  }
}

export interface Template {
  /** Expression sources found between `{{` and `}}`. */
  expressions: string[];
  /** Set when a `{{` has no closing `}}`. */
  unterminated: boolean;
}

/** Finds the `{{ ... }}` parts of a string. */
export function extractExpressions(s: string): Template {
  const expressions: string[] = [];
  let i = s.indexOf("{{");
  while (i !== -1) {
    let j = i + 2;
    let depth = 0;
    let quote = "";
    let end = -1;
    while (j < s.length) {
      const c = s[j]!;
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = "";
      } else if (c === "'" || c === '"') quote = c;
      else if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0 && s[j + 1] === "}") { end = j; break; }
        if (depth > 0) depth--;
      }
      j++;
    }
    if (end === -1) return { expressions, unterminated: true };
    expressions.push(s.slice(i + 2, end));
    i = s.indexOf("{{", end + 2);
  }
  return { expressions, unterminated: false };
}
