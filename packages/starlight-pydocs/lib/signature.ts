/**
 * Signature formatting, shared by the Markdown renderer and the components.
 *
 * Signatures are built from the griffe parameter list rather than from source
 * text, so positional-only (`/`) and keyword-only (`*`) markers are reinserted
 * in the right places and every annotation stays a linkable token.
 */

import type { AnnotationResolver, AnnotationToken } from './expr.ts';
import { annotationTokens } from './expr.ts';
import type { DocObject } from './model.ts';
import type { GriffeFunction, GriffeParameter } from './types.ts';

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
    return merge(tokens);
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
    return merge(tokens);
  }

  if (doc.kind !== 'function') {
    tokens.push({ text: name });
    return merge(tokens);
  }

  const fn = doc.object as GriffeFunction;
  if (includeKeyword) tokens.push({ text: doc.labels.includes('async') ? 'async def ' : 'def ' });
  tokens.push({ text: name });
  tokens.push(...parameterTokens(fn, scope, options));

  if (fn.returns !== undefined && fn.returns !== null) {
    tokens.push({ text: ' -> ' });
    tokens.push(...annotationTokens(fn.returns, scope, resolver));
  }

  return merge(tokens);
}

/** The `(…)` part of a function signature. */
export function parameterTokens(fn: GriffeFunction, scope: string, options: SignatureOptions = {}): AnnotationToken[] {
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

/** Plain-text signature, used in code fences and in the Markdown renderer. */
export function signatureText(doc: DocObject, options: SignatureOptions = {}): string {
  return signatureTokens(doc, options)
    .map((token) => token.text)
    .join('');
}

/** Signature of one `@overload` variant, which has no model object of its own. */
export function overloadSignatureText(overload: GriffeFunction, doc: DocObject): string {
  const tokens: AnnotationToken[] = [{ text: `def ${overload.name}` }, ...parameterTokens(overload, doc.path)];
  if (overload.returns !== undefined && overload.returns !== null) {
    tokens.push({ text: ' -> ' }, ...annotationTokens(overload.returns, doc.path));
  }
  return merge(tokens)
    .map((token) => token.text)
    .join('');
}

/** Describe a parameter's kind for the parameter table. */
export function parameterKindLabel(parameter: GriffeParameter): string | undefined {
  switch (parameter.kind) {
    case 'positional-only':
      return 'parameterPositionalOnly';
    case 'keyword-only':
      return 'parameterKeywordOnly';
    case 'variadic positional':
      return 'parameterVariadicPositional';
    case 'variadic keyword':
      return 'parameterVariadicKeyword';
    default:
      return undefined;
  }
}

function merge(tokens: AnnotationToken[]): AnnotationToken[] {
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
