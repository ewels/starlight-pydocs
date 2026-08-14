import { beforeAll, describe, expect, test } from 'vitest';

import type { AnnotationResolver, AnnotationToken } from '../lib/expr.ts';
import {
  annotationText,
  annotationTokens,
  createAnnotationResolver,
  expressionToPath,
  scopeChain,
  tokensText,
  wrapAnnotationTokens,
} from '../lib/expr.ts';
import { buildAnnotationResolver } from '../lib/model.ts';
import type { PackageModel } from '../lib/model.ts';
import type { Annotation, Expr, GriffeFunction } from '../lib/types.ts';
import { fixtureModel } from './helpers.ts';

const name = (value: string): Expr => ({ cls: 'ExprName', name: value, member: null });
const subscript = (left: Annotation, slice: Annotation): Expr => ({ cls: 'ExprSubscript', left, slice });
const binop = (left: Annotation, operator: string, right: Annotation): Expr => ({
  cls: 'ExprBinOp',
  left,
  operator,
  right,
});
const tuple = (elements: Annotation[], implicit = true): Expr => ({ cls: 'ExprTuple', elements, implicit });

function texts(tokens: AnnotationToken[]): string {
  return tokens.map((token) => token.text).join('');
}

describe('annotationTokens punctuation', () => {
  test('renders a subscripted union the way python writes it', () => {
    const expr = binop(subscript(name('dict'), tuple([name('str'), name('float')])), '|', 'None');
    expect(annotationText(expr)).toBe('dict[str, float] | None');
  });

  test('merges plain text into as few tokens as possible', () => {
    expect(annotationTokens(binop(name('str'), '|', 'None'), '')).toEqual([{ text: 'str | None' }]);
  });

  test('renders a Callable with a parameter list', () => {
    const expr = subscript(
      { cls: 'ExprAttribute', values: [name('collections'), name('abc'), name('Callable')] },
      tuple([{ cls: 'ExprList', elements: [name('int'), name('str')] }, name('bool')]),
    );
    expect(annotationText(expr)).toBe('collections.abc.Callable[[int, str], bool]');
  });

  test('renders Literal constants verbatim, quotes included', () => {
    const expr = subscript(
      name('Literal'),
      tuple([
        { cls: 'ExprConstant', value: "'md'" },
        { cls: 'ExprConstant', value: "'txt'" },
      ]),
    );
    expect(annotationText(expr)).toBe("Literal['md', 'txt']");
  });

  test('renders nested subscripts', () => {
    const expr = subscript(name('dict'), tuple([name('str'), subscript(name('list'), name('int'))]));
    expect(annotationText(expr)).toBe('dict[str, list[int]]');
  });

  test('renders an explicit tuple with brackets and an implicit one without', () => {
    expect(annotationText(tuple([name('int'), name('str')], false))).toBe('(int, str)');
    expect(annotationText(tuple([name('int'), name('str')], true))).toBe('int, str');
  });

  test('renders ellipsis-style tuples', () => {
    expect(annotationText(subscript(name('tuple'), tuple([name('str'), '...'])))).toBe('tuple[str, ...]');
  });

  test('renders calls, keywords and starred arguments', () => {
    const expr: Expr = {
      cls: 'ExprCall',
      function: name('Field'),
      arguments: [
        { cls: 'ExprConstant', value: '0' },
        { cls: 'ExprKeyword', name: 'description', value: { cls: 'ExprConstant', value: "'How many'" } },
        { cls: 'ExprVarPositional', value: name('args') },
        { cls: 'ExprVarKeyword', value: name('kwargs') },
      ],
    };
    expect(annotationText(expr)).toBe("Field(0, description='How many', *args, **kwargs)");
  });

  test('renders lists, sets, dicts and slices', () => {
    expect(annotationText({ cls: 'ExprList', elements: [name('int')] })).toBe('[int]');
    expect(annotationText({ cls: 'ExprSet', elements: [name('int')] })).toBe('{int}');
    expect(
      annotationText({ cls: 'ExprDict', keys: [{ cls: 'ExprConstant', value: "'a'" }], values: [name('int')] }),
    ).toBe("{'a': int}");
    expect(annotationText({ cls: 'ExprSlice', lower: '1', upper: '2' })).toBe('1:2');
    expect(annotationText({ cls: 'ExprSlice', lower: '1', upper: '2', step: '3' })).toBe('1:2:3');
  });

  test('renders boolean and unary operators with sensible spacing', () => {
    expect(annotationText({ cls: 'ExprBoolOp', operator: 'or', values: [name('a'), name('b')] })).toBe('a or b');
    expect(annotationText({ cls: 'ExprUnaryOp', operator: 'not', value: name('a') })).toBe('not a');
    expect(annotationText({ cls: 'ExprUnaryOp', operator: '-', value: '1' })).toBe('-1');
  });

  test('renders comparisons, conditionals and named expressions', () => {
    expect(annotationText({ cls: 'ExprCompare', left: name('a'), operators: ['<'], comparators: [name('b')] })).toBe(
      'a < b',
    );
    expect(annotationText({ cls: 'ExprIfExp', body: name('a'), test: name('c'), orelse: name('b') })).toBe(
      'a if c else b',
    );
    expect(annotationText({ cls: 'ExprNamedExpr', target: name('a'), value: name('b') })).toBe('a := b');
  });

  test('renders comprehensions', () => {
    const generator: Expr = {
      cls: 'ExprComprehension',
      target: name('x'),
      iterable: name('items'),
      conditions: [name('x')],
    };
    expect(annotationText({ cls: 'ExprListComp', element: name('x'), generators: [generator] })).toBe(
      '[x for x in items if x]',
    );
    expect(annotationText({ cls: 'ExprDictComp', key: name('x'), value: name('y'), generators: [generator] })).toBe(
      '{x: y for x in items if x}',
    );
  });

  test('renders f-strings and lambdas', () => {
    expect(
      annotationText({
        cls: 'ExprJoinedStr',
        values: [
          { cls: 'ExprConstant', value: 'a' },
          { cls: 'ExprFormatted', value: name('b') },
        ],
      }),
    ).toBe('a{b}');
    expect(
      annotationText({ cls: 'ExprLambda', parameters: [{ cls: 'ExprParameter', name: 'x' }], body: name('x') }),
    ).toBe('lambda x: x');
  });

  test('plain string annotations pass straight through', () => {
    expect(annotationText('None')).toBe('None');
    expect(annotationText('some | weird ! thing')).toBe('some | weird ! thing');
    expect(annotationText(null)).toBe('');
    expect(annotationText(undefined)).toBe('');
  });

  test('an unknown expression class degrades to its canonical string', () => {
    expect(annotationText({ cls: 'ExprFuture', canonical_path: 'mod.Thing' })).toBe('mod.Thing');
  });

  test('an unknown expression class without a string is concatenated recursively', () => {
    expect(annotationText({ cls: 'ExprFuture', left: name('a'), middle: ' @ ', right: name('b') })).toBe('a @ b');
  });

  test('deep nesting cannot loop forever', () => {
    let expr: Expr = name('int');
    for (let depth = 0; depth < 80; depth += 1) expr = subscript(name('list'), expr);
    expect(annotationText(expr)).toContain('…');
  });
});

describe('expressionToPath', () => {
  test('flattens names and attribute chains only', () => {
    expect(expressionToPath(name('Report'))).toBe('Report');
    expect(expressionToPath({ cls: 'ExprAttribute', values: [name('pathlib'), name('Path')] })).toBe('pathlib.Path');
    expect(expressionToPath('demopkg.report.Report')).toBe('demopkg.report.Report');
    expect(expressionToPath(subscript(name('list'), name('int')))).toBeUndefined();
    expect(expressionToPath('list[int]')).toBeUndefined();
    expect(expressionToPath(null)).toBeUndefined();
  });
});

describe('scopeChain', () => {
  test('walks from the object outwards', () => {
    expect(scopeChain('a.b.C.d')).toEqual(['a.b.C.d', 'a.b.C', 'a.b', 'a']);
    expect(scopeChain('a')).toEqual(['a']);
    expect(scopeChain('')).toEqual([]);
  });
});

describe('name resolution', () => {
  let demopkg: PackageModel;
  let resolver: AnnotationResolver;

  const inventory: Record<string, string> = {
    'pathlib.Path': 'https://docs.python.org/3/library/pathlib.html#pathlib.Path',
    'collections.abc.Iterator': 'https://docs.python.org/3/library/collections.abc.html#collections.abc.Iterator',
    str: 'https://docs.python.org/3/library/stdtypes.html#str',
  };

  beforeAll(async () => {
    demopkg = await fixtureModel('demopkg');
    resolver = buildAnnotationResolver(demopkg, (dottedPath) => inventory[dottedPath]);
  });

  test('resolves a name defined in the same module to an internal target', () => {
    const tokens = annotationTokens(name('Report'), 'demopkg.report.generate_report', resolver);
    expect(tokens).toEqual([{ text: 'Report', target: { kind: 'internal', path: 'demopkg.report.Report' } }]);
  });

  test('resolves a name imported into the module through its alias', () => {
    // utils imports Report from .report.
    const tokens = annotationTokens(name('Report'), 'demopkg.utils.merge_scores', resolver);
    expect(tokens[0]?.target).toEqual({ kind: 'internal', path: 'demopkg.report.Report' });
  });

  test('resolves a fully qualified documented path', () => {
    const tokens = annotationTokens('demopkg.report.Report', 'demopkg.utils', resolver);
    expect(tokens[0]?.target).toEqual({ kind: 'internal', path: 'demopkg.report.Report' });
  });

  test('resolves stdlib names through the inventory', () => {
    const tokens = annotationTokens(
      { cls: 'ExprAttribute', values: [name('pathlib'), name('Path')] },
      'demopkg.report.Report.generate',
      resolver,
    );
    expect(tokens).toEqual([{ text: 'pathlib.Path', target: { kind: 'external', href: inventory['pathlib.Path'] } }]);
  });

  test('resolves an aliased stdlib import to the inventory entry', () => {
    // utils imports Iterator from collections.abc.
    const tokens = annotationTokens(name('Iterator'), 'demopkg.utils.iter_sections', resolver);
    expect(tokens[0]?.target).toEqual({ kind: 'external', href: inventory['collections.abc.Iterator'] });
  });

  test('links builtins when the inventory has them', () => {
    const tokens = annotationTokens(name('str'), 'demopkg.utils.describe', resolver);
    expect(tokens[0]?.target).toEqual({ kind: 'external', href: inventory['str'] });
  });

  test('leaves builtins unlinked without an inventory', async () => {
    const bare = buildAnnotationResolver(demopkg);
    expect(annotationTokens(name('str'), 'demopkg.utils.describe', bare)).toEqual([{ text: 'str' }]);
  });

  test('leaves unknown names unlinked', () => {
    expect(annotationTokens(name('NoSuchType'), 'demopkg.report', resolver)).toEqual([{ text: 'NoSuchType' }]);
  });

  test('a name resolved in scope to an undocumented target stays plain text', () => {
    // `Any` is imported from typing, which is not in the fixture inventory.
    expect(annotationTokens(name('Any'), 'demopkg.report.Report.generate', resolver)).toEqual([{ text: 'Any' }]);
  });

  test('resolves the default value of a keyword argument to the constant it names', () => {
    const generate = demopkg.objectsByPath.get('demopkg.report.Report.generate');
    const timeout = (generate?.object as GriffeFunction).parameters?.find((parameter) => parameter.name === 'timeout');
    expect(annotationTokens(timeout?.default, 'demopkg.report.Report.generate', resolver)).toEqual([
      { text: 'DEFAULT_TIMEOUT', target: { kind: 'internal', path: 'demopkg.DEFAULT_TIMEOUT' } },
    ]);
  });

  test('mixes links and punctuation in one annotation', () => {
    const scores = demopkg.objectsByPath.get('demopkg.report.Report.scores');
    const annotation = scores?.object.kind === 'attribute' ? scores.object.annotation : undefined;
    const tokens = annotationTokens(annotation, 'demopkg.report.Report.scores', resolver);
    expect(texts(tokens)).toBe('dict[str, float]');
    expect(tokens.map((token) => token.target?.kind)).toEqual([undefined, 'external', undefined]);
  });

  test('without a resolver nothing is linked', () => {
    expect(annotationTokens(name('Report'), 'demopkg.report').every((token) => token.target === undefined)).toBe(true);
  });
});

describe('createAnnotationResolver', () => {
  test('prefers the scope chain over the inventory', () => {
    const resolver = createAnnotationResolver({
      isDocumented: (path) => path === 'pkg.mod.Thing',
      lookupScope: (scope, lookupName) => (scope === 'pkg.mod' && lookupName === 'Thing' ? 'pkg.mod.Thing' : undefined),
      lookupExternal: () => 'https://example.dev/Thing',
    });
    expect(resolver.resolve('Thing', 'pkg.mod.func')).toEqual({ kind: 'internal', path: 'pkg.mod.Thing' });
  });

  test('rejects anything that is not an identifier or dotted path', () => {
    const resolver = createAnnotationResolver({ isDocumented: () => true });
    expect(resolver.resolve('list[int]', 'pkg')).toBeUndefined();
    expect(resolver.resolve('', 'pkg')).toBeUndefined();
  });

  test('falls back to builtins.<name> in the inventory', () => {
    const resolver = createAnnotationResolver({
      isDocumented: () => false,
      lookupExternal: (path) => (path === 'builtins.str' ? 'https://docs/str' : undefined),
    });
    expect(resolver.resolve('str', 'pkg')).toEqual({ kind: 'external', href: 'https://docs/str' });
  });
});

describe('wrapAnnotationTokens', () => {
  test('leaves a group that fits on one line', () => {
    const tokens = [{ text: 'x: list = ["cyan", "yellow", "green"]' }];
    expect(tokensText(wrapAnnotationTokens(tokens))).toBe('x: list = ["cyan", "yellow", "green"]');
  });

  test('breaks only the groups that are too wide', () => {
    const item = '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
    const tokens = [{ text: `x = {"a": [1, 2], "b": [${item}, ${item}, ${item}]}` }];
    expect(tokensText(wrapAnnotationTokens(tokens, 40)).split('\n')).toEqual([
      'x = {',
      '  "a": [1, 2],',
      '  "b": [',
      `    ${item},`,
      `    ${item},`,
      `    ${item}`,
      '  ]',
      '}',
    ]);
  });

  test('ignores brackets and commas inside string literals', () => {
    const tokens = [{ text: `x = ("a,{b}c", 'd\\'e')` }];
    expect(tokensText(wrapAnnotationTokens(tokens))).toBe(`x = ("a,{b}c", 'd\\'e')`);
  });

  test('keeps linked tokens intact', () => {
    const target = { kind: 'internal', path: 'pkg.Theme' } as const;
    const tokens: AnnotationToken[] = [{ text: 'x = ' }, { text: 'Theme', target }, { text: '()' }];
    expect(wrapAnnotationTokens(tokens)).toEqual(tokens);
  });
});
