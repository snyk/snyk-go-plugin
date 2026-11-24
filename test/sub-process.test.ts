import * as path from 'path';
import childProcess = require('child_process');
import { test } from 'tap';
import {
  addPrivateModuleHint,
  execute,
  PRIVATE_MODULE_HINT,
  runGo,
} from '../lib/sub-process';

const PRINT_ENV = path.join(__dirname, 'fixtures', 'print-env.js');
const STUB_GO_DIR = path.join(__dirname, 'fixtures', 'stub-go');

const TEST_ENV: Record<string, string> = {
  SNYK_TOKEN: 'test-token',
  SNYK_OAUTH_TOKEN: 'test-oauth-token',
  snyk_cfg_api: 'test-cfg-api',
  HTTP_PROXY: 'http://internal:1',
  SNYK_SYSTEM_HTTP_PROXY: 'http://corp:3128',
  UNRELATED_VAR: 'keep',
};
const isSnykKey = (key: string) => /^snyk_/i.test(key);
const hasPath = (keys: string[]) =>
  keys.some((key) => key.toUpperCase() === 'PATH');

interface ChildEnv {
  keys: string[];
  HTTP_PROXY?: string;
  http_proxy?: string;
  UNRELATED_VAR?: string;
}

async function runPrintEnv(options?: {
  env?: NodeJS.ProcessEnv;
}): Promise<ChildEnv> {
  return JSON.parse(await execute('node', [PRINT_ENV], options));
}

test('sub-process', (t) => {
  let preTestEnv;
  t.beforeEach(async () => {
    preTestEnv = { ...process.env };
  });

  t.afterEach(async () => {
    process.env = { ...preTestEnv };
  });

  t.test('restore proxy environment', async (t) => {
    process.env.SNYK_SYSTEM_HTTPS_PROXY = 'http://1.1.1.1';
    process.env.SNYK_SYSTEM_HTTP_PROXY = 'http://2.2.2.2';
    process.env.SNYK_SYSTEM_NO_PROXY = 'snyk.com';

    process.env.HTTPS_PROXY = 'http://127.0.0.1';
    process.env.HTTP_PROXY = 'http://127.0.0.1';
    process.env.NO_PROXY = 'example.com';

    const result = await execute('env', []);

    t.ok(result.includes('HTTPS_PROXY=http://1.1.1.1'));
    t.ok(result.includes('HTTP_PROXY=http://2.2.2.2'));
    t.ok(result.includes('NO_PROXY=snyk.com'));

    t.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1');
    t.equal(process.env.HTTP_PROXY, 'http://127.0.0.1');
    t.equal(process.env.NO_PROXY, 'example.com');
  });

  t.test('child process environment', async (t) => {
    let saved: Map<string, string | undefined>;

    t.beforeEach(async () => {
      saved = new Map(
        Object.keys(TEST_ENV).map((key) => [key, process.env[key]]),
      );
      Object.assign(process.env, TEST_ENV);
    });

    t.afterEach(async () => {
      for (const [key, value] of saved) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    t.test(
      'passes spawn an env without SNYK_* variables and with the user proxy',
      async (t) => {
        const realSpawn = childProcess.spawn;
        const calls: any[][] = [];
        (childProcess as any).spawn = (...args: any[]) => {
          calls.push(args);
          return Reflect.apply(realSpawn, childProcess, args);
        };
        try {
          await execute('node', [PRINT_ENV]);
        } finally {
          (childProcess as any).spawn = realSpawn;
        }

        const env: NodeJS.ProcessEnv = calls[0]?.[2]?.env ?? {};
        t.ok(calls[0]?.[2]?.env, 'spawn receives an env option');
        t.same(Object.keys(env).filter(isSnykKey), []);
        t.equal(env.HTTP_PROXY, 'http://corp:3128');
        t.equal(env.http_proxy, 'http://corp:3128');
        t.equal(env.UNRELATED_VAR, 'keep');
        t.ok(hasPath(Object.keys(env)));
      },
    );

    t.test(
      'the child process sees no SNYK_* variables and gets the user proxy',
      async (t) => {
        const child = await runPrintEnv();
        t.same(child.keys.filter(isSnykKey), []);
        t.equal(child.HTTP_PROXY, 'http://corp:3128');
        t.equal(child.http_proxy, 'http://corp:3128');
        t.equal(child.UNRELATED_VAR, 'keep');
        t.ok(hasPath(child.keys));
      },
    );

    t.test('does not modify process.env', async (t) => {
      await execute('node', [PRINT_ENV]);
      t.equal(process.env.SNYK_TOKEN, 'test-token');
      t.equal(process.env.HTTP_PROXY, 'http://internal:1');
    });

    t.test('cleans an env passed by the caller', async (t) => {
      const child = await runPrintEnv({
        env: { ...process.env, SNYK_EXTRA: 'x' },
      });
      t.same(child.keys.filter(isSnykKey), []);
      t.equal(child.http_proxy, 'http://corp:3128');
    });
  });

  t.test('addPrivateModuleHint', async (t) => {
    const matchingSamples: Array<{ name: string; stderr: string }> = [
      {
        name: 'git credential prompt',
        stderr:
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      },
      {
        name: 'no required module',
        stderr:
          'go: example.com/app imports\n\tgithub.com/private/mod: no required module provides package github.com/private/mod',
      },
      {
        name: 'cannot find module',
        stderr:
          'go: cannot find module providing package github.com/acme/private/pkg',
      },
      {
        name: 'unrecognized import path',
        stderr:
          'go get github.com/acme/private: unrecognized import path "github.com/acme/private"',
      },
      {
        name: 'dial tcp',
        stderr:
          'go: github.com/acme/private@v1.2.3: Get "https://proxy.company.internal/...": dial tcp 10.0.0.1:443: i/o timeout',
      },
      {
        name: 'GOPROXY=off',
        stderr: 'go: module lookup disabled by GOPROXY=off',
      },
      {
        name: 'proxy 404',
        stderr:
          'go: github.com/private/mod@v1.0.0: reading https://proxy.golang.org/github.com/private/mod/@v/v1.0.0.info: 404 Not Found',
      },
      {
        name: 'sumdb 410',
        stderr:
          'verifying github.com/private/mod@v1.0.0: github.com/private/mod@v1.0.0: reading https://sum.golang.org/lookup/github.com/private/mod@v1.0.0: 410 Gone',
      },
    ];

    for (const sample of matchingSamples) {
      t.test(`appends hint for ${sample.name}`, async (t) => {
        const result = addPrivateModuleHint(sample.stderr);
        t.equal(typeof result, 'string');
        t.ok(
          (result as string).startsWith(sample.stderr),
          'original stderr is preserved at the start',
        );
        t.ok(
          (result as string).endsWith(PRIVATE_MODULE_HINT),
          'hint is appended',
        );
        t.ok(
          (result as string).includes('GOPROXY') &&
            (result as string).includes('GOPRIVATE') &&
            (result as string).includes('GONOSUMDB') &&
            (result as string).includes('GOFLAGS') &&
            (result as string).includes('-d'),
          'hint mentions env vars and -d',
        );
      });
    }

    t.test('leaves unrelated errors unchanged', async (t) => {
      const stderr = "go: unknown command\nRun 'go help' for usage.";
      t.equal(addPrivateModuleHint(stderr), stderr);
      t.equal(
        addPrivateModuleHint('parser failed at line 404 in go.mod'),
        'parser failed at line 404 in go.mod',
        'bare 404 outside proxy/sumdb status form is ignored',
      );
      t.equal(
        addPrivateModuleHint('package example.com/foo@v1.404.0: invalid'),
        'package example.com/foo@v1.404.0: invalid',
        'version containing 404 is ignored',
      );
    });

    t.test('ignores non-string errors', async (t) => {
      const err = new Error('dial tcp failed');
      t.equal(addPrivateModuleHint(err), err);
      t.equal(addPrivateModuleHint(undefined), undefined);
      t.equal(addPrivateModuleHint(42), 42);
    });

    t.test('is idempotent', async (t) => {
      const stderr =
        'go: github.com/private/mod@v1.0.0: reading https://proxy.golang.org/github.com/private/mod/@v/v1.0.0.info: 404 Not Found';
      const once = addPrivateModuleHint(stderr) as string;
      const twice = addPrivateModuleHint(once) as string;
      t.equal(twice, once);
      t.equal(twice.split(PRIVATE_MODULE_HINT).length - 1, 1);
    });
  });

  t.test(
    'runGo appends the private-module hint via a stub go binary',
    {
      skip:
        process.platform === 'win32'
          ? 'stub go binary fixture is a shell script'
          : false,
    },
    async (t) => {
      const previousPath = process.env.PATH;
      process.env.PATH = `${STUB_GO_DIR}${path.delimiter}${previousPath}`;
      try {
        await runGo(['list', './...'], { cwd: __dirname });
        t.fail('runGo should have rejected');
      } catch (err) {
        t.equal(typeof err, 'string');
        t.ok(
          (err as string).includes('404 Not Found'),
          'original stub stderr is present',
        );
        t.ok(
          (err as string).endsWith(PRIVATE_MODULE_HINT),
          'hint is appended on rejection',
        );
      } finally {
        process.env.PATH = previousPath;
      }
    },
  );

  t.end();
});
