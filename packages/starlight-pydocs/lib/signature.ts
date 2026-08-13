/**
 * Signature formatting, shared by the Markdown renderer and the components.
 *
 * Signatures are built from the griffe parameter list rather than from source
 * text, so positional-only (`/`) and keyword-only (`*`) markers are reinserted
 * in the right places and every annotation stays a linkable token.
 */

import type { AnnotationResolver, AnnotationToken } from './expr.ts';
import { annotationTokens, mergeAnnotationTokens } from './expr.ts';
import type { DocObject } from './model.ts';
import type { GriffeFunction } from './types.ts';

/** Parameter names Python hides from signatures when rendering methods. */
const IMPLICIT_FIRST_PARAMETERS = new Set(['self', 'cls']);

export interface SignatureOptions {
  /** Drop the leading `self`/`cls` parameter. Default: true for class members. */
  hideImplicitFirstParameter?: boolean | undefined;
  /** Prefix the signature with `class`, `def`, `async def`, … Default: true. */
  includeKeyword?: boolean | undefined;
  /** Use the dotted path instead of the short name. Default: false. */
  qualified?: boolean | undefined;
  resolver?: AnnotationResolver | undefined;
}

/** Tokens for a signature, ready to render with links. */
export function signatureTokens(doc: DocObject, options: SignatureOptions = {}): AnnotationToken[] {
  const tokens: AnnotationToken[] = [];
  const name = options.qualified === true ? doc.path : doc.name;
  const scope = doc.path;
  const resolver = options.resolver;
  const includeKeyword = options.includeKeyword !== false;

  if (doc.kind === 'class') {
    if (includeKeyword) tokens.push({ text: 'class ' });
    tokens.push({ text: name });
    const bases = doc.bases ?? [];
    if (bases.length > 0) {
      tokens.push({ text: '(' });
      bases.forEach((base, index) => {
        if (index > 0) tokens.push({ text: ', ' });
        tokens.push(...annotationTokens(base.expression, scope, resolver));
      });
      tokens.push({ text: ')' });
    }
    return mergeAnnotationTokens(tokens);
  }

  if (doc.kind === 'attribute') {
    tokens.push({ text: name });
    const annotation = doc.object.kind === 'attribute' ? doc.object.annotation : undefined;
    if (annotation !== undefined && annotation !== null) {
      tokens.push({ text: ': ' });
      tokens.push(...annotationTokens(annotation, scope, resolver));
    }
    const value = doc.object.kind === 'attribute' ? doc.object.value : undefined;
    if (value !== undefined && value !== null) {
      tokens.push({ text: ' = ' });
      tokens.push(...annotationTokens(value, scope, resolver));
    }
    return mergeAnnotationTokens(tokens);
  }

  if (doc.kind !== 'function') {
    tokens.push({ text: name });
    return mergeAnnotationTokens(tokens);
  }

  const fn = doc.object as GriffeFunction;
  if (includeKeyword) tokens.push({ text: doc.labels.includes('async') ? 'async def ' : 'def ' });
  tokens.push({ text: name });
  tokens.push(...parameterTokens(fn, scope, options));

  if (fn.returns !== undefined && fn.returns !== null) {
    tokens.push({ text: ' -> ' });
    tokens.push(...annotationTokens(fn.returns, scope, resolver));
  }

  return mergeAnnotationTokens(tokens);
}

/** The `(…)` part of a function signature. */
function parameterTokens(fn: GriffeFunction, scope: string, options: SignatureOptions = {}): AnnotationToken[] {
  const resolver = options.resolver;
  const parameters = [...(fn.parameters ?? [])];
  const hideFirst = options.hideImplicitFirstParameter !== false;
  if (hideFirst && parameters.length > 0) {
    const first = parameters[0];
    if (first !== undefined && IMPLICIT_FIRST_PARAMETERS.has(first.name)) parameters.shift();
  }

  const tokens: AnnotationToken[] = [{ text: '(' }];
  let emitted = 0;
  let positionalOnlySeen = false;
  let keywordMarkerNeeded = false;

  const separator = (): void => {
    if (emitted > 0) tokens.push({ text: ', ' });
    emitted += 1;
  };

  for (const parameter of parameters) {
    const kind = parameter.kind ?? 'positional or keyword';

    if (positionalOnlySeen && kind !== 'positional-only') {
      separator();
      tokens.push({ text: '/' });
      positionalOnlySeen = false;
    }
    if (kind === 'positional-only') positionalOnlySeen = true;

    if (kind === 'keyword-only' && keywordMarkerNeeded) {
      separator();
      tokens.push({ text: '*' });
      keywordMarkerNeeded = false;
    }
    if (kind === 'variadic positional') keywordMarkerNeeded = false;
    if (kind === 'positional or keyword' || kind === 'positional-only') keywordMarkerNeeded = true;

    separator();
    tokens.push({ text: parameterPrefix(kind) + parameter.name });

    if (parameter.annotation !== undefined && parameter.annotation !== null) {
      tokens.push({ text: ': ' });
      tokens.push(...annotationTokens(parameter.annotation, scope, resolver));
    }
    if (parameter.default !== undefined && parameter.default !== null && !isVariadic(kind)) {
      tokens.push({ text: parameter.annotation === undefined || parameter.annotation === null ? '=' : ' = ' });
      tokens.push(...annotationTokens(parameter.default, scope, resolver));
    }
  }

  if (positionalOnlySeen) {
    separator();
    tokens.push({ text: '/' });
  }

  tokens.push({ text: ')' });
  return tokens;
}

function parameterPrefix(kind: string): string {
  if (kind === 'variadic positional') return '*';
  if (kind === 'variadic keyword') return '**';
  return '';
}

function isVariadic(kind: string): boolean {
  return kind === 'variadic positional' || kind === 'variadic keyword';
}

/**
 * The `__init__` of a class, straight from the griffe object.
 *
 * Read off `object.members` rather than the model's members because `__init__`
 * is a special member and the default filters hide it.
 */
export function constructorOf(doc: DocObject): GriffeFunction | undefined {
  if (doc.kind !== 'class') return undefined;
  const members = doc.object.kind === 'class' ? doc.object.members : undefined;
  const init = members?.['__init__'];
  return init?.kind === 'function' ? init : undefined;
}

/**
 * Signature tokens as the HTML renderer shows them.
 *
 * The one difference from {@link signatureTokens} is the mkdocstrings
 * convention of merging a class' `__init__` into the class signature, so
 * `class Report(name: str, scores: dict[str, float] | None = None)` documents
 * how the class is actually called. Base classes are listed separately by the
 * class renderer, which is why they are not repeated here.
 */
export function renderedSignatureTokens(doc: DocObject, options: SignatureOptions = {}): AnnotationToken[] {
  const constructor = constructorOf(doc);
  if (constructor === undefined) return signatureTokens(doc, options);

  const tokens: AnnotationToken[] = [];
  if (options.includeKeyword !== false) tokens.push({ text: 'class ' });
  tokens.push({ text: options.qualified === true ? doc.path : doc.name });
  tokens.push(...parameterTokens(constructor, doc.path, options));
  return mergeAnnotationTokens(tokens);
}

/**
 * Number of parameters a rendered signature shows, so the renderer can decide
 * between a one-line and a one-per-line layout.
 */
export function renderedParameterCount(doc: DocObject): number {
  const fn = constructorOf(doc) ?? (doc.object.kind === 'function' ? doc.object : undefined);
  if (fn === undefined) return 0;
  const parameters = fn.parameters ?? [];
  const first = parameters[0];
  return first !== undefined && IMPLICIT_FIRST_PARAMETERS.has(first.name) ? parameters.length - 1 : parameters.length;
}

/** Plain-text signature, used in code fences and in the Markdown renderer. */
export function signatureText(doc: DocObject, options: SignatureOptions = {}): string {
  return signatureTokens(doc, options)
    .map((token) => token.text)
    .join('');
}

/** Signature of one `@overload` variant, which has no model object of its own. */
export function overloadSignatureTokens(
  overload: GriffeFunction,
  doc: DocObject,
  options: SignatureOptions = {},
): AnnotationToken[] {
  const tokens: AnnotationToken[] = [{ text: `def ${overload.name}` }, ...parameterTokens(overload, doc.path, options)];
  if (overload.returns !== undefined && overload.returns !== null) {
    tokens.push({ text: ' -> ' }, ...annotationTokens(overload.returns, doc.path, options.resolver));
  }
  return mergeAnnotationTokens(tokens);
}

/** Plain-text signature of one `@overload` variant. */
export function overloadSignatureText(overload: GriffeFunction, doc: DocObject): string {
  return overloadSignatureTokens(overload, doc)
    .map((token) => token.text)
    .join('');
}
