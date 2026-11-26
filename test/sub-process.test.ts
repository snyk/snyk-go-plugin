import * as path from 'path';
import { test } from 'tap';
import {
  addPrivateModuleHint,
  execute,
  PRIVATE_MODULE_HINT,
  runGo,
} from '../lib/sub-process';

const PRINT_ENV = path.join(__dirname, 'fixtures', 'print-env.js');
const STUB_GO_DIR = path.join(__dirname, 'fixtures', 'stub-go');

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

  t.test(
    "the child gets no SNYK_* variables and the user's HTTP_PROXY",
    async (t) => {
      process.env = {
        ...preTestEnv,
        SNYK_TOKEN: 'test-token',
        snyk_cfg_api: 'test-cfg-api',
        HTTP_PROXY: 'http://internal:1',
        SNYK_SYSTEM_HTTP_PROXY: 'http://corp:3128',
      };

      const child = JSON.parse(await execute('node', [PRINT_ENV]));

      t.same(child.snykKeys, []);
      t.equal(child.HTTP_PROXY, 'http://corp:3128');
    },
  );

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
