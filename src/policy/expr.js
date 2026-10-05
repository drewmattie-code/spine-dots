// Safe policy expression evaluator (fixes C9 — policy is declarative data, not code).
// A small, side-effect-free boolean grammar over a flat typed context. NO eval / Function / member
// access / calls: identifiers resolve only to OWN fields of the context object (so `constructor`,
// `__proto__`, etc. are undefined, not JS), and anything else is a parse error. Malformed input
// throws so the caller can fail closed.
//
// Grammar (low -> high precedence):
//   or   := and ('||' and)*
//   and  := not ('&&' not)*
//   not  := '!' not | cmp
//   cmp  := primary (('=='|'!='|'<'|'<='|'>'|'>='|'in') primary)?
//   primary := '(' or ')' | string | number | true | false | identifier

const TWO = new Set(['==', '!=', '<=', '>=', '&&', '||']);

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, s = '';
      while (j < src.length && src[j] !== q) { s += src[j]; j++; }
      if (src[j] !== q) throw new Error('unterminated string literal');
      toks.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i, s = '';
      while (j < src.length && /[0-9.]/.test(src[j])) { s += src[j]; j++; }
      toks.push({ t: 'num', v: Number(s) }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i, s = '';
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) { s += src[j]; j++; }
      if (s === 'true') toks.push({ t: 'bool', v: true });
      else if (s === 'false') toks.push({ t: 'bool', v: false });
      else if (s === 'in') toks.push({ t: 'op', v: 'in' });
      else toks.push({ t: 'id', v: s });
      i = j; continue;
    }
    const pair = src.slice(i, i + 2);
    if (TWO.has(pair)) { toks.push({ t: 'op', v: pair }); i += 2; continue; }
    if (c === '!' || c === '<' || c === '>') { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { toks.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp' }); i++; continue; }
    throw new Error(`unexpected character '${c}' in policy expression`);
  }
  return toks;
}

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => { const tk = peek(); return tk && tk.t === 'op' && tk.v === v; };

  function parseOr() { let l = parseAnd(); while (isOp('||')) { next(); l = { k: 'or', l, r: parseAnd() }; } return l; }
  function parseAnd() { let l = parseNot(); while (isOp('&&')) { next(); l = { k: 'and', l, r: parseNot() }; } return l; }
  function parseNot() { if (isOp('!')) { next(); return { k: 'not', e: parseNot() }; } return parseCmp(); }
  function parseCmp() {
    const l = parsePrimary();
    const tk = peek();
    const cmps = ['==', '!=', '<', '<=', '>', '>=', 'in'];
    if (tk && tk.t === 'op' && cmps.includes(tk.v)) { const op = next().v; return { k: 'cmp', op, l, r: parsePrimary() }; }
    return l;
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end of policy expression');
    if (tk.t === 'lp') { next(); const e = parseOr(); if (!peek() || peek().t !== 'rp') throw new Error('missing )'); next(); return e; }
    if (tk.t === 'str' || tk.t === 'num' || tk.t === 'bool') { next(); return { k: 'lit', v: tk.v }; }
    if (tk.t === 'id') { next(); return { k: 'id', name: tk.v }; }
    throw new Error('unexpected token in policy expression');
  }

  const ast = parseOr();
  if (p !== toks.length) throw new Error('trailing tokens in policy expression');
  return ast;
}

function evalNode(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'id':  return Object.prototype.hasOwnProperty.call(ctx, n.name) ? ctx[n.name] : undefined;
    case 'not': return !evalNode(n.e, ctx);
    case 'and': return Boolean(evalNode(n.l, ctx)) && Boolean(evalNode(n.r, ctx));
    case 'or':  return Boolean(evalNode(n.l, ctx)) || Boolean(evalNode(n.r, ctx));
    case 'cmp': {
      const a = evalNode(n.l, ctx), b = evalNode(n.r, ctx);
      switch (n.op) {
        case '==': return a === b;
        case '!=': return a !== b;
        case '<':  return a < b;
        case '<=': return a <= b;
        case '>':  return a > b;
        case '>=': return a >= b;
        case 'in': return Array.isArray(b) && b.includes(a);
      }
    }
  }
  throw new Error('bad policy expression node');
}

/** Evaluate a policy expression string against a flat context. Throws on malformed input. */
export function evalExpr(src, ctx = {}) {
  if (typeof src !== 'string') throw new Error('policy expression must be a string');
  return evalNode(parse(tokenize(src)), ctx);
}

/** Parse-check an expression at policy-load time (throws if invalid). */
export function compile(src) { parse(tokenize(src)); return src; }
