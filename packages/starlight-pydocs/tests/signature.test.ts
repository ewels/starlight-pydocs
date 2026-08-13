import { beforeAll, describe, expect, test } from 'vitest';

import { buildAnnotationResolver } from '../lib/model.ts';
import type { PackageModel } from '../lib/model.ts';
import { overloadSignatureText, signatureText, signatureTokens } from '../lib/signature.ts';
import { fixtureModel } from './helpers.ts';

let demopkg: PackageModel;

function doc(model: PackageModel, dottedPath: string) {
  const object = model.objectsByPath.get(dottedPath);
  if (object === undefined) throw new Error(`no documented object at ${dottedPath}`);
  return object;
}

beforeAll(async () => {
  demopkg = await fixtureModel('demopkg');
});

describe('signatureText', () => {
  test('hides self and keeps parameter kinds in order', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.Report.generate'))).toBe(
      'def generate(*sections: str, title: str | None = None, timeout: float = DEFAULT_TIMEOUT, **options: Any) -> pathlib.Path',
    );
  });

  test('reinserts the positional-only and keyword-only markers', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.generate_report'))).toBe(
      "def generate_report(source, /, name: str, *, fmt: str = 'md') -> Report",
    );
  });

  test('hides cls on class methods', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.Report.from_mapping'))).toBe(
      "def from_mapping(data: Mapping[str, float], *, name: str = 'report') -> Report",
    );
  });

  test('renders classes with their bases', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.Report'))).toBe('class Report(BaseReport)');
    expect(signatureText(doc(demopkg, 'demopkg.report.BaseReport'))).toBe('class BaseReport');
  });

  test('renders attributes with annotation and value', () => {
    expect(signatureText(doc(demopkg, 'demopkg.DEFAULT_TIMEOUT'))).toBe('DEFAULT_TIMEOUT: float = 30.0');
    expect(signatureText(doc(demopkg, 'demopkg.report.BaseReport.format'))).toBe("format: str = 'txt'");
  });

  test('renders properties as annotated attributes', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.Report.title'))).toBe('title: str');
  });

  test('can use the dotted path and drop the keyword', () => {
    expect(
      signatureText(doc(demopkg, 'demopkg.report.Report.validate'), { qualified: true, includeKeyword: false }),
    ).toBe('demopkg.report.Report.validate() -> bool');
  });

  test('can keep the implicit first parameter', () => {
    expect(signatureText(doc(demopkg, 'demopkg.report.Report.validate'), { hideImplicitFirstParameter: false })).toBe(
      'def validate(self) -> bool',
    );
  });

  test('marks a generator return type as griffe recorded it', () => {
    expect(signatureText(doc(demopkg, 'demopkg.utils.iter_sections'))).toBe(
      'def iter_sections(report: Report) -> Iterator[str]',
    );
  });
});

describe('signatureTokens', () => {
  test('annotations inside signatures resolve to internal targets', () => {
    const resolver = buildAnnotationResolver(demopkg);
    const tokens = signatureTokens(doc(demopkg, 'demopkg.utils.iter_sections'), { resolver });
    const linked = tokens.filter((token) => token.target !== undefined);
    expect(linked).toEqual([{ text: 'Report', target: { kind: 'internal', path: 'demopkg.report.Report' } }]);
    expect(tokens.map((token) => token.text).join('')).toBe(signatureText(doc(demopkg, 'demopkg.utils.iter_sections')));
  });

  test('base classes in a class signature are linkable', () => {
    const resolver = buildAnnotationResolver(demopkg);
    const tokens = signatureTokens(doc(demopkg, 'demopkg.report.Report'), { resolver });
    expect(tokens.find((token) => token.text === 'BaseReport')?.target).toEqual({
      kind: 'internal',
      path: 'demopkg.report.BaseReport',
    });
  });

  test('plain runs are merged into single tokens', () => {
    const tokens = signatureTokens(doc(demopkg, 'demopkg.report.Report.validate'));
    expect(tokens).toEqual([{ text: 'def validate() -> bool' }]);
  });
});

describe('overloadSignatureText', () => {
  test('renders an overload variant on its own', () => {
    const object = doc(demopkg, 'demopkg.report.Report.render');
    expect(
      overloadSignatureText(
        {
          kind: 'function',
          name: 'render',
          path: 'demopkg.report.Report.render',
          parameters: [
            { name: 'self', kind: 'positional or keyword' },
            { name: 'value', annotation: { cls: 'ExprName', name: 'str' }, kind: 'positional or keyword' },
          ],
          returns: { cls: 'ExprName', name: 'str' },
        },
        object,
      ),
      // `self` is hidden here too, so overloads stack under the implementation
      // signature without a jarring difference.
    ).toBe('def render(value: str) -> str');
  });
});
