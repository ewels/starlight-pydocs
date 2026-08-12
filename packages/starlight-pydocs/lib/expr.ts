/**
 * Walk griffe's serialised expression trees into linkable tokens.
 *
 * Annotations, defaults and base classes arrive either as a plain string
 * (griffe's own rendering) or as a tree of `Expr*` nodes. `ExprName` carries a
 * bare source name with no canonical path, so resolving `Report` to
 * `demopkg.report.Report` is our job: the scope chain of the owning object
 * first, then builtins, then configured Sphinx inventories.
 *
 * Nothing here can hard-fail on an exotic annotation: unknown node classes fall
 * back to concatenating whatever strings they contain.
 */

import type { Annotation, Expr, ExprOrString } from './types.ts';
import { isExpr } from './types.ts';

export interface InternalAnnotationTarget {
  kind: 'internal';
  /** Dotted path of a documented object; the renderer turns it into a link. */
  path: string;
}

export interface ExternalAnnotationTarget {
  kind: 'external';
  /** Absolute URL, already resolved against the inventory's base. */
  href: string;
}

export type AnnotationTarget = InternalAnnotationTarget | ExternalAnnotationTarget;

/** One piece of a rendered annotation: text, optionally pointing somewhere. */
export interface AnnotationToken {
  text: string;
  target?: AnnotationTarget;
}

export interface AnnotationResolver {
  /**
   * Resolve a name as written in source.
   *
   * @param name - A bare (`Report`) or dotted (`pathlib.Path`) source name.
   * @param scopePath - Dotted path of the object the annotation belongs to.
   */
  resolve(name: string, scopePath: string): AnnotationTarget | undefined;
}

/**
 * Builtin names worth linking. Only types and constants that appear in
 * annotations; the full builtins namespace would add noise without value.
 */
export const BUILTIN_NAMES: readonly string[] = [
  'bool',
  'bytearray',
  'bytes',
  'complex',
  'dict',
  'Ellipsis',
  'enumerate',
  'False',
  'filter',
  'float',
  'frozenset',
  'int',
  'list',
  'map',
  'memoryview',
  'None',
  'NotImplemented',
  'object',
  'range',
  'reversed',
  'set',
  'slice',
  'str',
  'True',
  'tuple',
  'type',
  'zip',
  // Exceptions and warnings, which show up in `Raises:` sections.
  'ArithmeticError',
  'AssertionError',
  'AttributeError',
  'BaseException',
  'DeprecationWarning',
  'EOFError',
  'Exception',
  'FileExistsError',
  'FileNotFoundError',
  'FloatingPointError',
  'GeneratorExit',
  'ImportError',
  'IndentationError',
  'IndexError',
  'InterruptedError',
  'IsADirectoryError',
  'KeyError',
  'KeyboardInterrupt',
  'LookupError',
  'MemoryError',
  'ModuleNotFoundError',
  'NameError',
  'NotADirectoryError',
  'NotImplementedError',
  'OSError',
  'OverflowError',
  'PermissionError',
  'RecursionError',
  'ReferenceError',
  'RuntimeError',
  'RuntimeWarning',
  'StopAsyncIteration',
  'StopIteration',
  'SyntaxError',
  'SystemError',
  'SystemExit',
  'TimeoutError',
  'TypeError',
  'UnicodeDecodeError',
  'UnicodeEncodeError',
  'UserWarning',
  'ValueError',
  'Warning',
  'ZeroDivisionError',
];

const BUILTIN_NAME_SET = new Set(BUILTIN_NAMES);

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export interface AnnotationResolverOptions {
  /** True when a dotted path is documented on this site. */
  isDocumented: (dottedPath: string) => boolean;
  /** Resolve a name in a module or class scope to a dotted path, following aliases. */
  lookupScope?: ((scopePath: string, name: string) => string | undefined) | undefined;
  /** Resolve a dotted path to an external URL, usually through a Sphinx inventory. */
  lookupExternal?: ((dottedPath: string) => string | undefined) | undefined;
}

/**
 * Build a resolver implementing the documented lookup order: enclosing scopes
 * (following aliases), then builtins, then inventories, then nothing.
 */
export function createAnnotationResolver(options: AnnotationResolverOptions): AnnotationResolver {
  const { isDocumented } = options;
  const lookupScope = options.lookupScope;
  const lookupExternal = options.lookupExternal;

  const asTarget = (dottedPath: string): AnnotationTarget | undefined => {
    if (isDocumented(dottedPath)) return { kind: 'internal', path: dottedPath };
    const href = lookupExternal?.(dottedPath);
    return href === undefined ? undefined : { kind: 'external', href };
  };

  return {
    resolve(name, scopePath) {
      if (!NAME_PATTERN.test(name)) return undefined;
      const [first, ...rest] = name.split('.');
      if (first === undefined) return undefined;

      if (lookupScope !== undefined) {
        for (const scope of scopeChain(scopePath)) {
          const resolved = lookupScope(scope, first);
          if (resolved === undefined) continue;
          const candidate = [resolved, ...rest].join('.');
          const target = asTarget(candidate);
          if (target !== undefined) return target;
          // The scope resolved the name but nothing documents the target; do not
          // keep searching with a name that means something else here.
          return undefined;
        }
      }

      // A fully qualified path written out in the annotation.
      const direct = asTarget(name);
      if (direct !== undefined) return direct;

      if (BUILTIN_NAME_SET.has(name)) {
        const href = lookupExternal?.(name) ?? lookupExternal?.(`builtins.${name}`);
        return href === undefined ? undefined : { kind: 'external', href };
      }

      return undefined;
    },
  };
}

/** `a.b.C.d` → `['a.b.C.d', 'a.b.C', 'a.b', 'a']`. */
export function scopeChain(scopePath: string): string[] {
  if (scopePath === '') return [];
  const segments = scopePath.split('.');
  const chain: string[] = [];
  for (let length = segments.length; length > 0; length -= 1) {
    chain.push(segments.slice(0, length).join('.'));
  }
  return chain;
}

/**
 * Render an annotation as tokens.
 *
 * @param expr - The annotation, default value or base class expression.
 * @param scopePath - Dotted path of the owning object, used for name resolution.
 * @param resolver - Optional resolver; without it every token is plain text.
 */
export function annotationTokens(
  expr: Annotation,
  scopePath: string,
  resolver?: AnnotationResolver | undefined,
): AnnotationToken[] {
  const tokens: AnnotationToken[] = [];
  walk(expr, scopePath, resolver, tokens, 0);
  return mergePlainTokens(tokens);
}

/** The annotation as plain text, with no linking. */
export function annotationText(expr: Annotation): string {
  return annotationTokens(expr, '')
    .map((token) => token.text)
    .join('');
}

/**
 * Flatten an expression to a dotted path when it is a name or an attribute
 * chain (`Report`, `pathlib.Path`), else undefined. Used for base classes and
 * for `Raises:` annotations.
 */
export function expressionToPath(expr: Annotation): string | undefined {
  if (expr === null || expr === undefined) return undefined;
  if (typeof expr === 'string') return NAME_PATTERN.test(expr) ? expr : undefined;
  if (expr.cls === 'ExprName') {
    const name = expr['name'];
    return typeof name === 'string' ? name : undefined;
  }
  if (expr.cls === 'ExprAttribute') {
    const values = expr['values'];
    if (!Array.isArray(values)) return undefined;
    const parts: string[] = [];
    for (const value of values as ExprOrString[]) {
      const part = expressionToPath(value);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    return parts.join('.');
  }
  return undefined;
}

const MAX_DEPTH = 32;

function push(tokens: AnnotationToken[], text: string): void {
  if (text !== '') tokens.push({ text });
}

function pushName(
  tokens: AnnotationToken[],
  name: string,
  scopePath: string,
  resolver: AnnotationResolver | undefined,
): void {
  const target = resolver?.resolve(name, scopePath);
  tokens.push(target === undefined ? { text: name } : { text: name, target });
}

function walkList(
  values: unknown,
  scopePath: string,
  resolver: AnnotationResolver | undefined,
  tokens: AnnotationToken[],
  depth: number,
  separator: string,
): void {
  if (!Array.isArray(values)) return;
  (values as ExprOrString[]).forEach((value, index) => {
    if (index > 0) push(tokens, separator);
    walk(value, scopePath, resolver, tokens, depth + 1);
  });
}

function field(expr: Expr, key: string): Annotation {
  const value = expr[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  return isExpr(value) ? value : undefined;
}

function walk(
  expr: Annotation,
  scopePath: string,
  resolver: AnnotationResolver | undefined,
  tokens: AnnotationToken[],
  depth: number,
): void {
  if (expr === null || expr === undefined) return;
  if (depth > MAX_DEPTH) {
    push(tokens, '…');
    return;
  }

  if (typeof expr === 'string') {
    // Griffe falls back to plain strings for simple annotations such as `None`.
    if (NAME_PATTERN.test(expr)) pushName(tokens, expr, scopePath, resolver);
    else push(tokens, expr);
    return;
  }

  switch (expr.cls) {
    case 'ExprName': {
      const name = expr['name'];
      if (typeof name === 'string') pushName(tokens, name, scopePath, resolver);
      return;
    }

    case 'ExprAttribute': {
      // Prefer one link for the whole chain (`pathlib.Path`), and fall back to
      // rendering the segments when nothing resolves it.
      const dotted = expressionToPath(expr);
      if (dotted !== undefined) {
        const target = resolver?.resolve(dotted, scopePath);
        if (target !== undefined) {
          tokens.push({ text: dotted, target });
          return;
        }
        push(tokens, dotted);
        return;
      }
      walkList(expr['values'], scopePath, resolver, tokens, depth, '.');
      return;
    }

    case 'ExprSubscript': {
      walk(field(expr, 'left'), scopePath, resolver, tokens, depth + 1);
      push(tokens, '[');
      walk(field(expr, 'slice'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ']');
      return;
    }

    case 'ExprBinOp': {
      const operator = typeof expr['operator'] === 'string' ? expr['operator'] : '|';
      walk(field(expr, 'left'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ` ${operator} `);
      walk(field(expr, 'right'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprBoolOp': {
      const operator = typeof expr['operator'] === 'string' ? expr['operator'] : 'or';
      walkList(expr['values'], scopePath, resolver, tokens, depth, ` ${operator} `);
      return;
    }

    case 'ExprUnaryOp': {
      const operator = typeof expr['operator'] === 'string' ? expr['operator'] : '-';
      push(tokens, /[A-Za-z]/.test(operator) ? `${operator} ` : operator);
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprTuple': {
      const implicit = expr['implicit'] === true;
      if (!implicit) push(tokens, '(');
      walkList(expr['elements'], scopePath, resolver, tokens, depth, ', ');
      if (!implicit) push(tokens, ')');
      return;
    }

    case 'ExprList': {
      push(tokens, '[');
      walkList(expr['elements'], scopePath, resolver, tokens, depth, ', ');
      push(tokens, ']');
      return;
    }

    case 'ExprSet': {
      push(tokens, '{');
      walkList(expr['elements'], scopePath, resolver, tokens, depth, ', ');
      push(tokens, '}');
      return;
    }

    case 'ExprDict': {
      const keys = Array.isArray(expr['keys']) ? (expr['keys'] as ExprOrString[]) : [];
      const values = Array.isArray(expr['values']) ? (expr['values'] as ExprOrString[]) : [];
      push(tokens, '{');
      keys.forEach((key, index) => {
        if (index > 0) push(tokens, ', ');
        walk(key, scopePath, resolver, tokens, depth + 1);
        push(tokens, ': ');
        walk(values[index], scopePath, resolver, tokens, depth + 1);
      });
      push(tokens, '}');
      return;
    }

    case 'ExprSlice': {
      walk(field(expr, 'lower'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ':');
      walk(field(expr, 'upper'), scopePath, resolver, tokens, depth + 1);
      if (expr['step'] !== undefined && expr['step'] !== null) {
        push(tokens, ':');
        walk(field(expr, 'step'), scopePath, resolver, tokens, depth + 1);
      }
      return;
    }

    case 'ExprExtSlice': {
      walkList(expr['dims'], scopePath, resolver, tokens, depth, ', ');
      return;
    }

    case 'ExprCall': {
      walk(field(expr, 'function'), scopePath, resolver, tokens, depth + 1);
      push(tokens, '(');
      walkList(expr['arguments'], scopePath, resolver, tokens, depth, ', ');
      push(tokens, ')');
      return;
    }

    case 'ExprKeyword': {
      const name = typeof expr['name'] === 'string' ? expr['name'] : '';
      push(tokens, `${name}=`);
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprVarPositional': {
      push(tokens, '*');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprVarKeyword': {
      push(tokens, '**');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprConstant': {
      // Already source-formatted, quotes included: `Literal["a"]`.
      push(tokens, String(expr['value'] ?? ''));
      return;
    }

    case 'ExprLambda': {
      push(tokens, 'lambda ');
      walkList(expr['parameters'], scopePath, resolver, tokens, depth, ', ');
      push(tokens, ': ');
      walk(field(expr, 'body'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprCompare': {
      walk(field(expr, 'left'), scopePath, resolver, tokens, depth + 1);
      const operators = Array.isArray(expr['operators']) ? (expr['operators'] as unknown[]) : [];
      const comparators = Array.isArray(expr['comparators']) ? (expr['comparators'] as ExprOrString[]) : [];
      comparators.forEach((comparator, index) => {
        push(tokens, ` ${String(operators[index] ?? '==')} `);
        walk(comparator, scopePath, resolver, tokens, depth + 1);
      });
      return;
    }

    case 'ExprIfExp': {
      walk(field(expr, 'body'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' if ');
      walk(field(expr, 'test'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' else ');
      walk(field(expr, 'orelse'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprNamedExpr': {
      walk(field(expr, 'target'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' := ');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprComprehension': {
      if (expr['is_async'] === true) push(tokens, 'async ');
      push(tokens, 'for ');
      walk(field(expr, 'target'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' in ');
      walk(field(expr, 'iterable'), scopePath, resolver, tokens, depth + 1);
      const conditions = Array.isArray(expr['conditions']) ? (expr['conditions'] as ExprOrString[]) : [];
      for (const condition of conditions) {
        push(tokens, ' if ');
        walk(condition, scopePath, resolver, tokens, depth + 1);
      }
      return;
    }

    case 'ExprGeneratorExp':
    case 'ExprListComp':
    case 'ExprSetComp': {
      const [open, close] =
        expr.cls === 'ExprListComp' ? ['[', ']'] : expr.cls === 'ExprSetComp' ? ['{', '}'] : ['(', ')'];
      push(tokens, open);
      walk(field(expr, 'element'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' ');
      walkList(expr['generators'], scopePath, resolver, tokens, depth, ' ');
      push(tokens, close);
      return;
    }

    case 'ExprDictComp': {
      push(tokens, '{');
      walk(field(expr, 'key'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ': ');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      push(tokens, ' ');
      walkList(expr['generators'], scopePath, resolver, tokens, depth, ' ');
      push(tokens, '}');
      return;
    }

    case 'ExprJoinedStr':
    case 'ExprTemplateStr': {
      walkList(expr['values'], scopePath, resolver, tokens, depth, '');
      return;
    }

    case 'ExprFormatted':
    case 'ExprInterpolation': {
      push(tokens, '{');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      push(tokens, '}');
      return;
    }

    case 'ExprYield':
    case 'ExprYieldFrom': {
      push(tokens, expr.cls === 'ExprYieldFrom' ? 'yield from ' : 'yield ');
      walk(field(expr, 'value'), scopePath, resolver, tokens, depth + 1);
      return;
    }

    case 'ExprParameter': {
      const name = typeof expr['name'] === 'string' ? expr['name'] : '';
      push(tokens, name);
      if (expr['annotation'] !== undefined && expr['annotation'] !== null) {
        push(tokens, ': ');
        walk(field(expr, 'annotation'), scopePath, resolver, tokens, depth + 1);
      }
      if (expr['default'] !== undefined && expr['default'] !== null) {
        push(tokens, '=');
        walk(field(expr, 'default'), scopePath, resolver, tokens, depth + 1);
      }
      return;
    }

    default:
      walkUnknown(expr, scopePath, resolver, tokens, depth);
  }
}

/**
 * Last resort for expression classes we do not model: use a canonical string if
 * griffe provided one, else concatenate whatever nested strings and expressions
 * the node carries, in insertion order.
 */
function walkUnknown(
  expr: Expr,
  scopePath: string,
  resolver: AnnotationResolver | undefined,
  tokens: AnnotationToken[],
  depth: number,
): void {
  for (const key of ['canonical_path', 'canonical_name', 'string']) {
    const value = expr[key];
    if (typeof value === 'string' && value !== '') {
      pushName(tokens, value, scopePath, resolver);
      return;
    }
  }

  for (const [key, value] of Object.entries(expr)) {
    if (key === 'cls') continue;
    if (typeof value === 'string') {
      push(tokens, value);
      continue;
    }
    if (isExpr(value)) {
      walk(value, scopePath, resolver, tokens, depth + 1);
      continue;
    }
    if (Array.isArray(value)) {
      walkList(value, scopePath, resolver, tokens, depth, ', ');
    }
  }
}

/** Collapse runs of unlinked tokens so renderers emit fewer nodes. */
function mergePlainTokens(tokens: AnnotationToken[]): AnnotationToken[] {
  const merged: AnnotationToken[] = [];
  for (const token of tokens) {
    const previous = merged[merged.length - 1];
    if (token.target === undefined && previous !== undefined && previous.target === undefined) {
      previous.text += token.text;
      continue;
    }
    merged.push({ ...token });
  }
  return merged;
}
