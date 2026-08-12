import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { PydocsConfig, PydocsPackageConfig } from '../lib/config.ts';
import { normalizeConfig } from '../lib/config.ts';
import { createMemoryLogger } from '../lib/logger.ts';
import type { ExecFileImpl } from '../lib/runner.ts';
import { buildGriffeArgs, resolveExtraction, watchPaths } from '../lib/runner.ts';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pydocs-runner-'));
  await fs.mkdir(path.join(workspace, 'src', 'demopkg'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'demopkg', '__init__.py'), '"""Doc."""\n');
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function configure(overrides: Record<string, unknown> = {}, top: Record<string, unknown> = {}): PydocsConfig {
  return normalizeConfig(
    {
      packages: [{ name: 'demopkg', search: ['src'], ...overrides }],
      cacheDir: 'cache',
      ...top,
    },
    workspace,
  );
}

function onlyPackage(config: PydocsConfig): PydocsPackageConfig {
  const pkg = config.packages[0];
  if (pkg === undefined) throw new Error('no package');
  return pkg;
}

describe('buildGriffeArgs', () => {
  test('always passes -f and the docstring style, with the package last', () => {
    const args = buildGriffeArgs(onlyPackage(configure()));
    expect(args).toEqual(['dump', '-f', '-d', 'google', '-s', path.join(workspace, 'src'), 'demopkg']);
  });

  test('adds the output path just before the package', () => {
    const args = buildGriffeArgs(onlyPackage(configure()), '/tmp/out.json');
    expect(args.slice(-3)).toEqual(['-o', '/tmp/out.json', 'demopkg']);
  });

  test('serialises docstring options as JSON behind -D', () => {
    const args = buildGriffeArgs(onlyPackage(configure({ docstringOptions: { returns_multiple_items: false } })));
    expect(args).toContain('-D');
    expect(args[args.indexOf('-D') + 1]).toBe('{"returns_multiple_items":false}');
  });

  test('passes plain extensions by name and configured ones as JSON', () => {
    const args = buildGriffeArgs(
      onlyPackage(configure({ extensions: ['griffe_pydantic', { name: 'my_ext', options: { schema: true } }] })),
    );
    expect(args.filter((arg, index) => args[index - 1] === '-e')).toEqual([
      'griffe_pydantic',
      '{"my_ext":{"schema":true}}',
    ]);
  });

  test('adds one -s per search path and -x for forced inspection', () => {
    const args = buildGriffeArgs(onlyPackage(configure({ search: ['src', 'other'], forceInspection: true })));
    expect(args.filter((arg, index) => args[index - 1] === '-s')).toEqual([
      path.join(workspace, 'src'),
      path.join(workspace, 'other'),
    ]);
    expect(args).toContain('-x');
    expect(args.indexOf('-x')).toBeLessThan(args.length - 1);
  });

  test('every numpy/sphinx/auto style reaches -d', () => {
    for (const style of ['numpy', 'sphinx', 'auto'] as const) {
      const args = buildGriffeArgs(onlyPackage(configure({ docstringStyle: style })));
      expect(args[args.indexOf('-d') + 1]).toBe(style);
    }
  });
});

/** Record calls and write a dump when griffe is asked to. */
function recordingExec(recorded: { file: string; args: string[] }[], options: { fail?: string[] } = {}): ExecFileImpl {
  return async (file, args) => {
    recorded.push({ file, args });
    if (options.fail?.includes(file) === true) {
      const error = new Error(`${file}: not found`) as Error & { code: string };
      error.code = 'ENOENT';
      throw error;
    }
    const outIndex = args.indexOf('-o');
    if (outIndex !== -1) {
      const target = args[outIndex + 1];
      if (target !== undefined)
        await fs.writeFile(target, '{"demopkg":{"kind":"module","name":"demopkg","path":"demopkg"}}');
    }
    return { stdout: '', stderr: '' };
  };
}

describe('resolveExtraction', () => {
  test('prefers an explicit runner command', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure({}, { runner: { command: ['micromamba', 'run', '-n', 'docs', 'griffe'] } });
    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded),
    });

    expect(result.strategy).toBe('command');
    expect(result.fromCache).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.file).toBe('micromamba');
    expect(recorded[0]?.args.slice(0, 5)).toEqual(['run', '-n', 'docs', 'griffe', 'dump']);
    await expect(fs.readFile(result.dumpPath, 'utf8')).resolves.toContain('demopkg');
  });

  test('uses uvx when uv is on PATH, with --with for extra requirements', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure({ extensions: ['griffe_pydantic'], extraRequirements: ['griffe-pydantic'] });
    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded),
    });

    expect(result.strategy).toBe('uvx');
    expect(recorded[0]).toEqual({ file: 'uv', args: ['--version'] });
    expect(recorded[1]?.file).toBe('uvx');
    expect(recorded[1]?.args.slice(0, 6)).toEqual(['--from', 'griffe', '--with', 'griffe-pydantic', 'griffe', 'dump']);
  });

  test('falls back to python -m griffe when uv is missing', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure();
    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded, { fail: ['uv'] }),
    });

    expect(result.strategy).toBe('python');
    expect(recorded[1]).toEqual({ file: 'python3', args: ['-c', 'import griffe'] });
    expect(recorded[2]?.args.slice(0, 3)).toEqual(['-m', 'griffe', 'dump']);
  });

  test('probes a configured interpreter only', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure({}, { runner: { python: '/opt/py/bin/python' } });
    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded, { fail: ['uv'] }),
    });

    expect(result.strategy).toBe('python');
    expect(recorded.map((entry) => entry.file)).toEqual(['uv', '/opt/py/bin/python', '/opt/py/bin/python']);
  });

  test('reuses the cached dump on a second call', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure();
    const context = {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded),
    };

    const first = await resolveExtraction(onlyPackage(config), config, context);
    const second = await resolveExtraction(onlyPackage(config), config, context);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.dumpPath).toBe(first.dumpPath);
    // One probe plus one extraction, then only the probe.
    expect(recorded.filter((entry) => entry.file === 'uvx')).toHaveLength(1);
  });

  test('re-extracts when a source file changes', async () => {
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure();
    const context = {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded),
    };

    const first = await resolveExtraction(onlyPackage(config), config, context);
    await fs.writeFile(path.join(workspace, 'src', 'demopkg', 'extra.py'), 'x = 1\n');
    const second = await resolveExtraction(onlyPackage(config), config, context);

    expect(second.dumpPath).not.toBe(first.dumpPath);
    expect(second.fromCache).toBe(false);
  });

  test('uses a pre-generated dump file without running anything', async () => {
    const dump = path.join(workspace, 'api.json');
    await fs.writeFile(dump, '{}');
    const recorded: { file: string; args: string[] }[] = [];
    const config = configure({ source: { file: 'api.json' } });

    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec(recorded),
    });

    expect(result).toEqual({ dumpPath: dump, strategy: 'file', fromCache: true });
    expect(recorded).toHaveLength(0);
  });

  test('reports a missing pre-generated dump', async () => {
    const config = configure({ source: { file: 'missing.json' } });
    await expect(
      resolveExtraction(onlyPackage(config), config, {
        cacheDir: config.cacheDir,
        cwd: workspace,
        execFileImpl: recordingExec([]),
      }),
    ).rejects.toThrow(/the dump configured for 'demopkg' does not exist/);
  });

  test('downloads a pre-generated dump from a URL', async () => {
    const config = configure({ source: { url: 'https://example.dev/api.json' } });
    const result = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: recordingExec([]),
      fetchImpl: async () =>
        new Response('{"demopkg":{"kind":"module","name":"demopkg","path":"demopkg"}}', {
          headers: { etag: '"1"' },
        }),
    });

    expect(result.strategy).toBe('url');
    expect(result.fromCache).toBe(false);
    await expect(fs.readFile(result.dumpPath, 'utf8')).resolves.toContain('demopkg');
  });

  test('explains every probe when nothing can extract', async () => {
    const config = configure({ extraRequirements: ['griffe-pydantic'] });
    const failing: ExecFileImpl = async (file) => {
      const error = new Error(`${file} missing`) as Error & { code: string };
      error.code = 'ENOENT';
      throw error;
    };

    const error = await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: failing,
    }).catch((cause: unknown) => cause as Error);

    expect(error.message).toContain("could not extract the API of 'demopkg'");
    expect(error.message).toContain('uv --version (not found on PATH)');
    expect(error.message).toContain('python3 -c "import griffe"');
    expect(error.message).toContain('python -c "import griffe"');
    expect(error.message).toContain('install uv');
    expect(error.message).toContain('pip install griffe');
    expect(error.message).toContain('source.file or .url');
    expect(error.message).toContain('griffe-pydantic');
  });

  test('surfaces griffe failures with the command that ran', async () => {
    const config = configure();
    const failing: ExecFileImpl = async (file, args) => {
      if (args[0] === '--version') return { stdout: 'uv 1.0', stderr: '' };
      const error = new Error('boom') as Error & { stderr: string };
      error.stderr = 'ERROR griffe exploded';
      throw error;
    };

    await expect(
      resolveExtraction(onlyPackage(config), config, {
        cacheDir: config.cacheDir,
        cwd: workspace,
        execFileImpl: failing,
      }),
    ).rejects.toThrow(/griffe failed while extracting 'demopkg'[\s\S]*ERROR griffe exploded/);
  });

  test('forwards griffe warnings to the logger', async () => {
    const logger = createMemoryLogger();
    const config = configure();
    const noisy: ExecFileImpl = async (_file, args) => {
      const outIndex = args.indexOf('-o');
      const target = outIndex === -1 ? undefined : args[outIndex + 1];
      if (target !== undefined) await fs.writeFile(target, '{}');
      return { stdout: '', stderr: 'INFO loading\nWARNING report.py:1: no annotation\n' };
    };

    await resolveExtraction(onlyPackage(config), config, {
      cacheDir: config.cacheDir,
      cwd: workspace,
      execFileImpl: noisy,
      logger,
    });

    expect(logger.messages.some((message) => message.includes('WARNING report.py:1'))).toBe(true);
    expect(logger.messages.some((message) => message.includes('INFO loading'))).toBe(false);
  });
});

describe('watchPaths', () => {
  test('lists the search roots of extracted packages only', () => {
    const config = normalizeConfig(
      {
        packages: [
          { name: 'a', search: ['pya'] },
          { name: 'b', base: 'api/b', source: { file: 'b.json' } },
        ],
      },
      workspace,
    );
    expect(watchPaths(config)).toEqual([path.join(workspace, 'pya')]);
  });
});
