/**
 * Types for the subset of `griffe dump -f -d <style>` output that we consume.
 *
 * The dump is a moving target: griffe adds fields between releases (2.1.0 added
 * `git_info` and `source_link`, for example). Every object type therefore
 * carries an index signature so unknown fields survive round-tripping and never
 * break type-checking, and every field we do not strictly need is optional.
 *
 * Field names here were read off real dumps produced by griffe 2.1.0, not from
 * the documentation. Notable surprises are recorded in ARCHITECTURE.md.
 */

/** Object kinds griffe emits in `kind`. `'type alias'` really does contain a space. */
export type GriffeKind = 'module' | 'class' | 'function' | 'attribute' | 'alias' | 'type alias';

/** Parameter kinds griffe emits in `parameters[].kind`, verbatim. */
export type ParameterKind =
  'positional-only' | 'positional or keyword' | 'variadic positional' | 'keyword-only' | 'variadic keyword';

/**
 * Annotations, defaults, base classes and attribute values are either a plain
 * string (griffe's fallback rendering, e.g. `"None"`) or an expression tree.
 */
export type ExprOrString = string | Expr;

/** An annotation slot, which may be absent entirely. */
export type Annotation = ExprOrString | null | undefined;

/** Escape hatch for expression classes we do not model explicitly. */
export interface UnknownExpr {
  cls: string;
  [key: string]: unknown;
}

export interface ExprName {
  cls: 'ExprName';
  /** The bare source name. Griffe does not resolve it to a canonical path. */
  name: string;
  /** Name of the member the expression was written in, or null. */
  member?: string | null;
  [key: string]: unknown;
}

/** Dotted access, e.g. `pathlib.Path`; `values` holds each segment in order. */
export interface ExprAttribute {
  cls: 'ExprAttribute';
  values: ExprOrString[];
  [key: string]: unknown;
}

/** Subscript, e.g. `dict[str, float]`: `left` is the base, `slice` the index. */
export interface ExprSubscript {
  cls: 'ExprSubscript';
  left: ExprOrString;
  slice: ExprOrString;
  [key: string]: unknown;
}

/** Binary operation, e.g. `str | None`. */
export interface ExprBinOp {
  cls: 'ExprBinOp';
  left: ExprOrString;
  operator: string;
  right: ExprOrString;
  [key: string]: unknown;
}

export interface ExprBoolOp {
  cls: 'ExprBoolOp';
  operator: string;
  values: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprUnaryOp {
  cls: 'ExprUnaryOp';
  operator: string;
  value: ExprOrString;
  [key: string]: unknown;
}

/** Tuple; `implicit` is true when the source had no brackets (`dict[str, int]`). */
export interface ExprTuple {
  cls: 'ExprTuple';
  elements: ExprOrString[];
  implicit?: boolean;
  [key: string]: unknown;
}

export interface ExprList {
  cls: 'ExprList';
  elements: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprSet {
  cls: 'ExprSet';
  elements: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprDict {
  cls: 'ExprDict';
  keys: ExprOrString[];
  values: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprSlice {
  cls: 'ExprSlice';
  lower?: Annotation;
  upper?: Annotation;
  step?: Annotation;
  [key: string]: unknown;
}

export interface ExprExtSlice {
  cls: 'ExprExtSlice';
  dims: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprCall {
  cls: 'ExprCall';
  function: ExprOrString;
  arguments: ExprOrString[];
  [key: string]: unknown;
}

/** Keyword argument in a call, e.g. `Field(description="…")`. */
export interface ExprKeyword {
  cls: 'ExprKeyword';
  name: string;
  value?: Annotation;
  [key: string]: unknown;
}

export interface ExprVarPositional {
  cls: 'ExprVarPositional';
  value: ExprOrString;
  [key: string]: unknown;
}

export interface ExprVarKeyword {
  cls: 'ExprVarKeyword';
  value: ExprOrString;
  [key: string]: unknown;
}

export interface ExprConstant {
  cls: 'ExprConstant';
  value: string;
  [key: string]: unknown;
}

export interface ExprLambda {
  cls: 'ExprLambda';
  parameters?: ExprOrString[];
  body?: Annotation;
  [key: string]: unknown;
}

export interface ExprCompare {
  cls: 'ExprCompare';
  left: ExprOrString;
  operators: string[];
  comparators: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprIfExp {
  cls: 'ExprIfExp';
  body: ExprOrString;
  test: ExprOrString;
  orelse: ExprOrString;
  [key: string]: unknown;
}

export interface ExprNamedExpr {
  cls: 'ExprNamedExpr';
  target: ExprOrString;
  value: ExprOrString;
  [key: string]: unknown;
}

export interface ExprComprehension {
  cls: 'ExprComprehension';
  target: ExprOrString;
  iterable: ExprOrString;
  conditions?: ExprOrString[];
  is_async?: boolean;
  [key: string]: unknown;
}

export interface ExprComp {
  cls: 'ExprGeneratorExp' | 'ExprListComp' | 'ExprSetComp';
  element: ExprOrString;
  generators: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprDictComp {
  cls: 'ExprDictComp';
  key: ExprOrString;
  value: ExprOrString;
  generators: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprJoinedStr {
  cls: 'ExprJoinedStr' | 'ExprTemplateStr';
  values: ExprOrString[];
  [key: string]: unknown;
}

export interface ExprFormatted {
  cls: 'ExprFormatted' | 'ExprInterpolation';
  value: ExprOrString;
  [key: string]: unknown;
}

export interface ExprYield {
  cls: 'ExprYield' | 'ExprYieldFrom';
  value?: Annotation;
  [key: string]: unknown;
}

export interface ExprParameter {
  cls: 'ExprParameter';
  name: string;
  annotation?: Annotation;
  default?: Annotation;
  kind?: string;
  [key: string]: unknown;
}

/** Expression classes we walk explicitly. */
export type KnownExpr =
  | ExprName
  | ExprAttribute
  | ExprSubscript
  | ExprBinOp
  | ExprBoolOp
  | ExprUnaryOp
  | ExprTuple
  | ExprList
  | ExprSet
  | ExprDict
  | ExprSlice
  | ExprExtSlice
  | ExprCall
  | ExprKeyword
  | ExprVarPositional
  | ExprVarKeyword
  | ExprConstant
  | ExprLambda
  | ExprCompare
  | ExprIfExp
  | ExprNamedExpr
  | ExprComprehension
  | ExprComp
  | ExprDictComp
  | ExprJoinedStr
  | ExprFormatted
  | ExprYield
  | ExprParameter;

/** Any serialised griffe expression. */
export type Expr = KnownExpr | UnknownExpr;

// -- Docstrings ------------------------------------------------------------

/** A parameter, attribute or return entry inside a parsed docstring section. */
export interface DocstringNamedValue {
  name?: string;
  annotation?: Annotation;
  description?: string;
  /** Default value, as griffe renders it. Only present for parameters. */
  value?: Annotation;
}

/** A `raises`/`warns` entry: an exception type and why it happens. */
export interface DocstringThrown {
  annotation?: Annotation;
  description?: string;
}

/** A `functions`/`classes`/`modules` entry: a cross-reference with a summary. */
export interface DocstringReference {
  name?: string;
  description?: string;
}

/** The payload of a `deprecated` section. */
export interface DocstringDeprecated {
  version?: string;
  description?: string;
}

/**
 * The payload of an `admonition` section. Google-style `Note:`, `Warning:` and
 * (surprisingly) `Deprecated:` blocks all arrive here, with the lowercased
 * block name in `annotation`.
 */
export interface DocstringAdmonition {
  annotation?: Annotation;
  description?: string;
}

export interface DocstringSectionText {
  kind: 'text';
  value: string;
  title?: string | null;
}

export interface DocstringSectionNamedValues {
  kind: 'parameters' | 'other parameters' | 'type parameters' | 'attributes' | 'returns' | 'yields' | 'receives';
  value: DocstringNamedValue[];
  title?: string | null;
}

export interface DocstringSectionThrown {
  kind: 'raises' | 'warns';
  value: DocstringThrown[];
  title?: string | null;
}

export interface DocstringSectionReferences {
  kind: 'functions' | 'classes' | 'modules' | 'type aliases';
  value: DocstringReference[];
  title?: string | null;
}

/** Examples are `[kind, value]` pairs: `'text'` for prose, `'examples'` for code. */
export interface DocstringSectionExamples {
  kind: 'examples';
  value: [string, string][];
  title?: string | null;
}

export interface DocstringSectionDeprecated {
  kind: 'deprecated';
  value: DocstringDeprecated;
  title?: string | null;
}

export interface DocstringSectionAdmonition {
  kind: 'admonition';
  value: DocstringAdmonition;
  title?: string | null;
}

/** Escape hatch for section kinds added by future griffe releases. */
export interface DocstringSectionUnknown {
  kind: string;
  value?: unknown;
  title?: string | null;
}

export type KnownDocstringSection =
  | DocstringSectionText
  | DocstringSectionNamedValues
  | DocstringSectionThrown
  | DocstringSectionReferences
  | DocstringSectionExamples
  | DocstringSectionDeprecated
  | DocstringSectionAdmonition;

export type DocstringSection = KnownDocstringSection | DocstringSectionUnknown;

export interface GriffeDocstring {
  /** The raw docstring text, with indentation stripped. */
  value: string;
  /** Structured sections. Only present when griffe ran with both `-f` and `-d`. */
  parsed?: DocstringSection[] | null;
  lineno?: number | null;
  endlineno?: number | null;
}

// -- Objects ---------------------------------------------------------------

export interface GriffeDecorator {
  value?: ExprOrString;
  lineno?: number | null;
  endlineno?: number | null;
}

export interface GriffeParameter {
  name: string;
  annotation?: Annotation;
  default?: Annotation;
  kind?: ParameterKind | string;
}

/** Fields present on every griffe object. */
interface GriffeObjectCommon {
  name: string;
  /** Canonical dotted path of the object as griffe found it. */
  path: string;
  labels?: string[] | null;
  docstring?: GriffeDocstring | null;
  lineno?: number | null;
  endlineno?: number | null;
  /** Absolute path, or a list for namespace packages. */
  filepath?: string | string[] | null;
  /** Path relative to the griffe process' working directory. */
  relative_filepath?: string;
  /** Path relative to the package's parent directory (`demopkg/report.py`). */
  relative_package_filepath?: string;
  /** Repository URL for the source, derived by griffe from git metadata. */
  source_link?: string | null;
  is_public?: boolean;
  is_private?: boolean;
  is_special?: boolean;
  is_class_private?: boolean;
  is_imported?: boolean;
  is_exported?: boolean;
  is_deprecated?: boolean;
  is_wildcard_exposed?: boolean;
  analysis?: string;
  runtime?: boolean;
  [key: string]: unknown;
}

export interface GriffeModule extends GriffeObjectCommon {
  kind: 'module';
  members?: Record<string, GriffeObject>;
  /** The module's `__all__`, already reduced to a list of names by griffe. */
  exports?: string[] | null;
  /** Imported name to resolved target path. */
  imports?: Record<string, string> | null;
}

export interface GriffeClass extends GriffeObjectCommon {
  kind: 'class';
  members?: Record<string, GriffeObject>;
  bases?: ExprOrString[];
  decorators?: GriffeDecorator[];
}

export interface GriffeFunction extends GriffeObjectCommon {
  kind: 'function';
  parameters?: GriffeParameter[];
  returns?: Annotation;
  decorators?: GriffeDecorator[];
  /**
   * `@typing.overload` variants. Griffe models these internally but does not
   * serialise them as of 2.1.0, so treat the field as optional and be ready for
   * it to appear in later releases.
   */
  overloads?: GriffeFunction[];
}

export interface GriffeAttribute extends GriffeObjectCommon {
  kind: 'attribute';
  annotation?: Annotation;
  value?: Annotation;
}

export interface GriffeTypeAlias extends GriffeObjectCommon {
  kind: 'type alias';
  value?: Annotation;
  type_parameters?: ExprOrString[];
}

export interface GriffeAlias extends GriffeObjectCommon {
  kind: 'alias';
  /** Dotted path of the aliased object, which may live outside the dump. */
  target_path: string;
  /** Inlined target, present only when griffe was asked to expand aliases. */
  target?: GriffeObject;
}

export type GriffeObject =
  GriffeModule | GriffeClass | GriffeFunction | GriffeAttribute | GriffeTypeAlias | GriffeAlias;

/** An object that can hold members. */
export type GriffeParent = GriffeModule | GriffeClass;

/** A dump file: top-level object keyed by package name. */
export type GriffeDump = Record<string, GriffeObject>;

// -- Guards ----------------------------------------------------------------

export function isExpr(value: unknown): value is Expr {
  return typeof value === 'object' && value !== null && typeof (value as { cls?: unknown }).cls === 'string';
}

export function hasMembers(object: GriffeObject): object is GriffeParent {
  return object.kind === 'module' || object.kind === 'class';
}

/** Members as an array; the dump keys them by name, so order is source order. */
export function memberList(object: GriffeObject): GriffeObject[] {
  if (!hasMembers(object)) return [];
  const members = object.members;
  if (!members) return [];
  return Object.values(members);
}
