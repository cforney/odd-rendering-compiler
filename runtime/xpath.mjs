/**
 * The XPath of Processing-Model predicates and params: a subset, compiled once
 * to closures over xast. Anything outside it throws when the expression is
 * compiled, so a generator can fail on it and name the model.
 *
 * Paths: `.`, `..`, `@name`, `name`, `*`, `node()`, `text()`, the axes in AXES,
 * `/`, `//`, absolute paths and `[predicate]`. Operators: or, and, the general
 * (= != < <= > >=) and value (eq ne lt le gt ge) comparisons, + -, mod,
 * `if (…) then … else …`. Sequences `(a, b)`, string and number literals, and
 * the functions in FUNCTIONS.
 *
 * A position is `{ node, up }`: the node and its ancestor elements, outermost
 * first. Attributes evaluate to their string values.
 */

const isElement = (n) => n?.type === "element";
const isText = (n) => n?.type === "text";
const localName = (qname = "") => qname.slice(qname.indexOf(":") + 1);
const textOf = (n) => (isText(n) ? n.value : (n?.children ?? []).map(textOf).join(""));

export const isPos = (item) => typeof item === "object" && item !== null && "node" in item;
const atom = (item) => (isPos(item) ? textOf(item.node) : item);
export const seq = (v) => (Array.isArray(v) ? v : [v]);
const normalizeSpace = (s) => s.replace(/[ \t\n\r]+/g, " ").replace(/^ | $/g, "");
const num = (v) => (typeof v === "number" ? v : Number(str(v)));

export const bool = (v) =>
  Array.isArray(v) ? v.length > 0 : typeof v === "number" ? v !== 0 && !Number.isNaN(v) : Boolean(v);
/** The string value of the first item. */
export const str = (v) => (Array.isArray(v) ? (v.length ? String(atom(v[0])) : "") : String(v));

const COMPARE = {
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};
const VALUE_COMPARE = { eq: "=", ne: "!=", lt: "<", le: "<=", gt: ">", ge: ">=" };

/** General comparison: true if any pair of items compares. */
function compare(op, a, b) {
  if (typeof a === "boolean" || typeof b === "boolean") return COMPARE[op](bool(a), bool(b));
  return seq(a).some((x) =>
    seq(b).some((y) => {
      const [p, q] = [atom(x), atom(y)];
      const numeric = typeof p === "number" || typeof q === "number" || (op !== "=" && op !== "!=");
      return numeric ? COMPARE[op](Number(p), Number(q)) : COMPARE[op](p, q);
    }),
  );
}

// Each parent's element and text children, and where each child stands among them.
const lists = new WeakMap();
const index = new WeakMap();
function nodesOf(parent) {
  let list = lists.get(parent);
  if (!list) {
    list = (parent.children ?? []).filter((n) => isElement(n) || isText(n));
    list.forEach((n, i) => index.set(n, i));
    lists.set(parent, list);
  }
  return list;
}
const kids = (p) => {
  const up = [...p.up, p.node];
  return nodesOf(p.node).map((node) => ({ node, up }));
};
const parent = (p) => (p.up.length ? [{ node: p.up.at(-1), up: p.up.slice(0, -1) }] : []);
const siblings = (p, after) => {
  if (!p.up.length) return [];
  const list = nodesOf(p.up.at(-1));
  const i = index.get(p.node);
  return (after ? list.slice(i + 1) : list.slice(0, i).reverse()).map((node) => ({ node, up: p.up }));
};
const descendants = (p) => kids(p).flatMap((k) => [k, ...descendants(k)]);
const ancestors = (p) => p.up.map((node, i) => ({ node, up: p.up.slice(0, i) })).reverse();
/** The document node above the outermost element, where an absolute path starts. */
const documentOf = (p) => ({ node: { type: "root", children: [p.up[0] ?? p.node] }, up: [] });

/** The axes, each in proximity order. */
const AXES = {
  self: (p) => [p],
  child: kids,
  parent,
  ancestor: ancestors,
  "ancestor-or-self": (p) => [p, ...ancestors(p)],
  descendant: descendants,
  "descendant-or-self": (p) => [p, ...descendants(p)],
  "preceding-sibling": (p) => siblings(p, false),
  "following-sibling": (p) => siblings(p, true),
  preceding: (p) => [p, ...ancestors(p)].flatMap((a) => siblings(a, false).flatMap((s) => [...descendants(s).reverse(), s])),
  following: (p) => [p, ...ancestors(p)].flatMap((a) => siblings(a, true).flatMap((s) => [s, ...descendants(s)])),
};

/** Position and size of the context in the predicate being evaluated. */
let focus = { position: 1, size: 1 };

/** Called without arguments, a function gets the context item. */
const FUNCTIONS = {
  position: () => focus.position,
  last: () => focus.size,
  exists: (v) => seq(v).length > 0,
  empty: (v) => seq(v).length === 0,
  "local-name": (v) => {
    const [item] = seq(v);
    return isPos(item) && isElement(item.node) ? localName(item.node.name) : "";
  },
  "string-length": (a) => [...str(a)].length,
  "ends-with": (a, b) => str(a).endsWith(str(b)),
  matches: (a, re, flags) => new RegExp(str(re), flags === undefined ? "" : str(flags)).test(str(a)),
  replace: (a, re, to) => str(a).replace(new RegExp(str(re), "g"), str(to)),
  not: (v) => !bool(v),
  count: (v) => seq(v).length,
  concat: (...vs) => vs.map(str).join(""),
  contains: (a, b) => str(a).includes(str(b)),
  "contains-token": (a, t) => seq(a).some((i) => String(atom(i)).split(/[ \t\n\r]+/).includes(normalizeSpace(str(t)))),
  "starts-with": (a, b) => str(a).startsWith(str(b)),
  "normalize-space": (a) => normalizeSpace(str(a)),
  translate: (a, from, to) =>
    [...str(a)].map((c) => { const i = [...str(from)].indexOf(c); return i < 0 ? c : [...str(to)][i] ?? ""; }).join(""),
  string: (a) => str(a),
  true: () => true,
  false: () => false,
};

const TOKEN = /\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|(::|\.\.|!=|<=|>=|[=<>()[\],@/.*+|-])|([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?))/y;

/** Compile an expression to a function of a position; throws on anything outside the subset. */
export function xpath(expr) {
  const fail = (why) => {
    throw new Error(`XPath "${expr}": ${why}`);
  };

  const toks = [];
  for (let at = 0; at < expr.length; ) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(expr);
    if (!m) {
      if (expr.slice(at).trim()) fail(`cannot read "${expr.slice(at).trim()}"`);
      break;
    }
    at = TOKEN.lastIndex;
    if (m[1] !== undefined || m[2] !== undefined) toks.push({ t: "str", v: m[1] ?? m[2] });
    else if (m[3]) toks.push({ t: "num", v: m[3] });
    else if (m[4]) toks.push({ t: "op", v: m[4] });
    else toks.push({ t: "name", v: m[5] });
  }

  let i = 0;
  const is = (v, t = "op") => toks[i]?.t === t && toks[i].v === v;
  const eat = (v, t = "op") => (is(v, t) ? (i++, true) : false);
  const expect = (v) => eat(v) || fail(`expected "${v}"`);
  const name = () => (toks[i]?.t === "name" ? toks[i++].v : fail("expected a name"));

  /** Keep the items a predicate admits: a number is a position, anything else a test. */
  const filter = (items, preds, outer) =>
    preds.reduce((list, pred) => {
      const saved = focus;
      const kept = list.filter((item, k) => {
        focus = { position: k + 1, size: list.length };
        const v = pred(isPos(item) ? item : outer);
        return typeof v === "number" ? v === k + 1 : bool(v);
      });
      focus = saved;
      return kept;
    }, items);
  const predicates = () => {
    const preds = [];
    while (eat("[")) {
      preds.push(or());
      expect("]");
    }
    return preds;
  };

  function or() {
    let left = and();
    while (eat("or", "name")) {
      const [a, b] = [left, and()];
      left = (p) => bool(a(p)) || bool(b(p));
    }
    return left;
  }
  function and() {
    let left = comparison();
    while (eat("and", "name")) {
      const [a, b] = [left, comparison()];
      left = (p) => bool(a(p)) && bool(b(p));
    }
    return left;
  }
  function comparison() {
    const left = additive();
    const op = Object.keys(COMPARE).find((o) => is(o)) ?? VALUE_COMPARE[Object.keys(VALUE_COMPARE).find((o) => is(o, "name"))];
    if (!op) return left;
    i++;
    const right = additive();
    return (p) => compare(op, left(p), right(p));
  }
  function additive() {
    let left = multiplicative();
    for (let op; (op = ["+", "-"].find((o) => is(o))); ) {
      i++;
      const [a, b] = [left, multiplicative()];
      left = op === "+" ? (p) => num(a(p)) + num(b(p)) : (p) => num(a(p)) - num(b(p));
    }
    return left;
  }
  function multiplicative() {
    let left = primary();
    while (eat("mod", "name")) {
      const [a, b] = [left, primary()];
      left = (p) => num(a(p)) % num(b(p));
    }
    return left;
  }

  /** A literal, a parenthesised sequence, a conditional, a function call — or a location path. */
  function primary() {
    const tok = toks[i] ?? fail("unexpected end");
    const call = tok.t === "name" && toks[i + 1]?.v === "(" && tok.v !== "node" && tok.v !== "text";
    let base;
    if (tok.t === "str" || tok.t === "num") {
      i++;
      const v = tok.t === "num" ? Number(tok.v) : tok.v;
      base = () => v;
    } else if (eat("(")) {
      const items = [];
      if (!is(")")) do items.push(or()); while (eat(","));
      expect(")");
      base = items.length === 1 ? items[0] : (p) => items.flatMap((f) => seq(f(p)));
    } else if (call && tok.v === "if") {
      i += 2;
      const test = or();
      expect(")");
      if (!eat("then", "name")) fail('expected "then"');
      const yes = or();
      if (!eat("else", "name")) fail('expected "else"');
      const no = or();
      base = (p) => (bool(test(p)) ? yes(p) : no(p));
    } else if (call) {
      const f = FUNCTIONS[tok.v] ?? fail(`unknown function ${tok.v}()`);
      i += 2;
      const args = [];
      if (!is(")")) do args.push(or()); while (eat(","));
      expect(")");
      base = (p) => f(...(args.length ? args.map((a) => a(p)) : [[p]]));
    }
    if (!base) return path();
    const [inner, preds] = [base, predicates()];
    return preds.length ? (p) => filter(seq(inner(p)), preds, p) : inner;
  }

  /** Steps joined by `/`; `//` is `/descendant-or-self::node()/`, a leading `/` the document. */
  function path() {
    const absolute = is("/");
    const steps = absolute ? [] : [step()];
    while (eat("/")) {
      if (eat("/")) steps.push(AXES["descendant-or-self"]);
      steps.push(step());
    }
    return (p) => steps.reduce((ctx, s) => ctx.flatMap((c) => (isPos(c) ? s(c) : [])), [absolute ? documentOf(p) : p]);
  }

  function step() {
    if (eat(".")) return (p) => [p];
    if (eat("..")) return parent;
    if (eat("@")) {
      const attr = name();
      return (p) => {
        const v = isElement(p.node) ? p.node.attributes?.[attr] : undefined;
        return v == null ? [] : [v];
      };
    }
    let axis = "child";
    if (toks[i]?.t === "name" && toks[i + 1]?.v === "::") {
      axis = name();
      i++;
    }
    const move = AXES[axis] ?? fail(`unsupported axis ${axis}`);
    let test = (q) => isElement(q);
    if (!eat("*")) {
      const n = name();
      if ((n === "node" || n === "text") && eat("(")) {
        expect(")");
        test = n === "node" ? () => true : (q) => isText(q);
      } else test = (q) => isElement(q) && localName(q.name) === localName(n);
    }
    const preds = predicates();
    return (p) => filter(move(p).filter((q) => test(q.node)), preds, p);
  }

  const root = or();
  if (i < toks.length) fail(`unexpected "${toks[i].v}"`);
  return root;
}
