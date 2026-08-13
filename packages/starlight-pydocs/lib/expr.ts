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
const BUILTIN_NAMES = new Set([
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
]);

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

      if (BUILTIN_NAMES.has(name)) {
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
  const context: WalkContext = { scopePath, resolver, tokens: [] };
  walk(context, expr, 0);
  return mergeAnnotationTokens(context.tokens);
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

/** What every step of the walk needs: where to resolve names, where to write. */
interface WalkContext {
  /** Dotted path of the object the expression belongs to. */
  scopePath: string;
  resolver: AnnotationResolver | undefined;
  tokens: AnnotationToken[];
}

function push(context: WalkContext, text: string): void {
  if (text !== '') context.tokens.push({ text });
}

function pushName(context: WalkContext, name: string): void {
  const target = context.resolver?.resolve(name, context.scopePath);
  context.tokens.push(target === undefined ? { text: name } : { text: name, target });
}

function walkList(context: WalkContext, values: unknown, depth: number, separator: string): void {
  if (!Array.isArray(values)) return;
  (values as ExprOrString[]).forEach((value, index) => {
    if (index > 0) push(context, separator);
    walk(context, value, depth + 1);
  });
}

function field(expr: Expr, key: string): Annotation {
  const value = expr[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  return isExpr(value) ? value : undefined;
}

/** A string field of a node, or the fallback when the dump omits it. */
function stringField(expr: Expr, key: string, fallback: string): string {
  const value = expr[key];
  return typeof value === 'string' ? value : fallback;
}

/** True when a node carries a field at all, whatever its type. */
function hasField(expr: Expr, key: string): boolean {
  const value = expr[key];
  return value !== undefined && value !== null;
}

/** Brackets a comprehension is written in, by node class. */
const COMPREHENSION_BRACKETS: Record<string, [string, string]> = {
  ExprListComp: ['[', ']'],
  ExprSetComp: ['{', '}'],
  ExprGeneratorExp: ['(', ')'],
};

function walk(context: WalkContext, expr: Annotation, depth: number): void {
  if (expr === null || expr === undefined) return;
  if (depth > MAX_DEPTH) {
    push(context, '…');
    return;
  }

  if (typeof expr === 'string') {
    // Griffe falls back to plain strings for simple annotations such as `None`.
    if (NAME_PATTERN.test(expr)) pushName(context, expr);
    else push(context, expr);
    return;
  }

  switch (expr.cls) {
    case 'ExprName': {
      const name = expr['name'];
      if (typeof name === 'string') pushName(context, name);
      return;
    }

    case 'ExprAttribute': {
      // Prefer one link for the whole chain (`pathlib.Path`), and fall back to
      // rendering the segments when nothing resolves it.
      const dotted = expressionToPath(expr);
      if (dotted !== undefined) {
        if (dotted !== '') pushName(context, dotted);
        return;
      }
      walkList(context, expr['values'], depth, '.');
      return;
    }

    case 'ExprSubscript': {
      walk(context, field(expr, 'left'), depth + 1);
      push(context, '[');
      walk(context, field(expr, 'slice'), depth + 1);
      push(context, ']');
      return;
    }

    case 'ExprBinOp': {
      walk(context, field(expr, 'left'), depth + 1);
      push(context, ` ${stringField(expr, 'operator', '|')} `);
      walk(context, field(expr, 'right'), depth + 1);
      return;
    }

    case 'ExprBoolOp': {
      walkList(context, expr['values'], depth, ` ${stringField(expr, 'operator', 'or')} `);
      return;
    }

    case 'ExprUnaryOp': {
      const operator = stringField(expr, 'operator', '-');
      push(context, /[A-Za-z]/.test(operator) ? `${operator} ` : operator);
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprTuple': {
      // An implicit tuple is the bare `int, str` inside a subscript.
      const implicit = expr['implicit'] === true;
      if (!implicit) push(context, '(');
      walkList(context, expr['elements'], depth, ', ');
      if (!implicit) push(context, ')');
      return;
    }

    case 'ExprList': {
      push(context, '[');
      walkList(context, expr['elements'], depth, ', ');
      push(context, ']');
      return;
    }

    case 'ExprSet': {
      push(context, '{');
      walkList(context, expr['elements'], depth, ', ');
      push(context, '}');
      return;
    }

    case 'ExprDict': {
      const keys = Array.isArray(expr['keys']) ? (expr['keys'] as ExprOrString[]) : [];
      const values = Array.isArray(expr['values']) ? (expr['values'] as ExprOrString[]) : [];
      push(context, '{');
      keys.forEach((key, index) => {
        if (index > 0) push(context, ', ');
        walk(context, key, depth + 1);
        push(context, ': ');
        walk(context, values[index], depth + 1);
      });
      push(context, '}');
      return;
    }

    case 'ExprSlice': {
      walk(context, field(expr, 'lower'), depth + 1);
      push(context, ':');
      walk(context, field(expr, 'upper'), depth + 1);
      if (hasField(expr, 'step')) {
        push(context, ':');
        walk(context, field(expr, 'step'), depth + 1);
      }
      return;
    }

    case 'ExprExtSlice': {
      walkList(context, expr['dims'], depth, ', ');
      return;
    }

    case 'ExprCall': {
      walk(context, field(expr, 'function'), depth + 1);
      push(context, '(');
      walkList(context, expr['arguments'], depth, ', ');
      push(context, ')');
      return;
    }

    case 'ExprKeyword': {
      push(context, `${stringField(expr, 'name', '')}=`);
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprVarPositional': {
      push(context, '*');
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprVarKeyword': {
      push(context, '**');
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprConstant': {
      // Already source-formatted, quotes included: `Literal["a"]`.
      push(context, String(expr['value'] ?? ''));
      return;
    }

    case 'ExprLambda': {
      push(context, 'lambda ');
      walkList(context, expr['parameters'], depth, ', ');
      push(context, ': ');
      walk(context, field(expr, 'body'), depth + 1);
      return;
    }

    case 'ExprCompare': {
      walk(context, field(expr, 'left'), depth + 1);
      const operators = Array.isArray(expr['operators']) ? (expr['operators'] as unknown[]) : [];
      const comparators = Array.isArray(expr['comparators']) ? (expr['comparators'] as ExprOrString[]) : [];
      comparators.forEach((comparator, index) => {
        push(context, ` ${String(operators[index] ?? '==')} `);
        walk(context, comparator, depth + 1);
      });
      return;
    }

    case 'ExprIfExp': {
      walk(context, field(expr, 'body'), depth + 1);
      push(context, ' if ');
      walk(context, field(expr, 'test'), depth + 1);
      push(context, ' else ');
      walk(context, field(expr, 'orelse'), depth + 1);
      return;
    }

    case 'ExprNamedExpr': {
      walk(context, field(expr, 'target'), depth + 1);
      push(context, ' := ');
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprComprehension': {
      if (expr['is_async'] === true) push(context, 'async ');
      push(context, 'for ');
      walk(context, field(expr, 'target'), depth + 1);
      push(context, ' in ');
      walk(context, field(expr, 'iterable'), depth + 1);
      const conditions = Array.isArray(expr['conditions']) ? (expr['conditions'] as ExprOrString[]) : [];
      for (const condition of conditions) {
        push(context, ' if ');
        walk(context, condition, depth + 1);
      }
      return;
    }

    case 'ExprGeneratorExp':
    case 'ExprListComp':
    case 'ExprSetComp': {
      const [open, close] = COMPREHENSION_BRACKETS[expr.cls] ?? ['(', ')'];
      push(context, open);
      walk(context, field(expr, 'element'), depth + 1);
      push(context, ' ');
      walkList(context, expr['generators'], depth, ' ');
      push(context, close);
      return;
    }

    case 'ExprDictComp': {
      push(context, '{');
      walk(context, field(expr, 'key'), depth + 1);
      push(context, ': ');
      walk(context, field(expr, 'value'), depth + 1);
      push(context, ' ');
      walkList(context, expr['generators'], depth, ' ');
      push(context, '}');
      return;
    }

    case 'ExprJoinedStr':
    case 'ExprTemplateStr': {
      walkList(context, expr['values'], depth, '');
      return;
    }

    case 'ExprFormatted':
    case 'ExprInterpolation': {
      push(context, '{');
      walk(context, field(expr, 'value'), depth + 1);
      push(context, '}');
      return;
    }

    case 'ExprYield':
    case 'ExprYieldFrom': {
      push(context, expr.cls === 'ExprYieldFrom' ? 'yield from ' : 'yield ');
      walk(context, field(expr, 'value'), depth + 1);
      return;
    }

    case 'ExprParameter': {
      push(context, stringField(expr, 'name', ''));
      if (hasField(expr, 'annotation')) {
        push(context, ': ');
        walk(context, field(expr, 'annotation'), depth + 1);
      }
      if (hasField(expr, 'default')) {
        push(context, '=');
        walk(context, field(expr, 'default'), depth + 1);
      }
      return;
    }

    default:
      walkUnknown(context, expr, depth);
  }
}

/**
 * Last resort for expression classes we do not model: use a canonical string if
 * griffe provided one, else concatenate whatever nested strings and expressions
 * the node carries, in insertion order.
 */
function walkUnknown(context: WalkContext, expr: Expr, depth: number): void {
  for (const key of ['canonical_path', 'canonical_name', 'string']) {
    const value = expr[key];
    if (typeof value === 'string' && value !== '') {
      pushName(context, value);
      return;
    }
  }

  for (const [key, value] of Object.entries(expr)) {
    if (key === 'cls') continue;
    if (typeof value === 'string') {
      push(context, value);
      continue;
    }
    if (isExpr(value)) {
      walk(context, value, depth + 1);
      continue;
    }
    if (Array.isArray(value)) {
      walkList(context, value, depth, ', ');
    }
  }
}

/** Collapse runs of unlinked tokens so renderers emit fewer nodes. */
export function mergeAnnotationTokens(tokens: AnnotationToken[]): AnnotationToken[] {
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
