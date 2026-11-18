import * as path from 'path';
import childProcess = require('child_process');
import { test } from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execute, runGo, addPrivateModuleHint } from '../lib/sub-process';

const PRINT_ENV = path.join(__dirname, 'fixtures', 'print-env.js');

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

  t.end();
});

test('addPrivateModuleHint', (t) => {
  const samples: Array<[string, string]> = [
    [
      "go: example.com/internal/lib@v1.2.3: reading https://proxy.golang.org/example.com/internal/lib/@v/v1.2.3.mod: 404 Not Found\n\tserver response: not found: module example.com/internal/lib: git ls-remote -q origin in /go/pkg/mod/cache/vcs/abc: exit status 128:\n\tfatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'could not read Username',
    ],
    [
      'main.go:5:2: no required module provides package example.com/internal/lib; to add it:\n\tgo get example.com/internal/lib',
      'no required module provides package',
    ],
    [
      'go: finding module for package example.com/internal/lib\ngo: example.com/app imports\n\texample.com/internal/lib: cannot find module providing package example.com/internal/lib: module lookup disabled by GOPROXY=off',
      'cannot find module providing package',
    ],
    [
      'go: example.com/internal/lib@v1.0.0: Get "https://proxy.example.com/example.com/internal/lib/@v/v1.0.0.mod": dial tcp: lookup proxy.example.com: no such host',
      'dial tcp',
    ],
    [
      'go: unrecognized import path "example.com/internal/lib": https fetch: Get "https://example.com/internal/lib?go-get=1": dial tcp 10.0.0.1:443: i/o timeout',
      'unrecognized import path',
    ],
    [
      'verifying example.com/internal/lib@v1.0.0: example.com/internal/lib@v1.0.0: reading https://sum.golang.org/lookup/example.com/internal/lib@v1.0.0: 410 Gone',
      '410 Gone',
    ],
  ];

  for (const [stderr, label] of samples) {
    t.test(`appends hint and keeps original text: ${label}`, async (t) => {
      const out = addPrivateModuleHint(stderr);
      t.ok(out.startsWith(stderr), 'original stderr preserved verbatim');
      t.match(out, /GOPROXY/);
      t.match(out, /GOPRIVATE/);
      t.match(out, /GONOSUMDB/);
      t.match(out, /GOFLAGS/);
      t.match(out, /-d/);
    });
  }

  t.test('does not alter unrelated errors', async (t) => {
    const unrelated = [
      'go: cannot find main module, but found .git/config in /src',
      'main.go:3:1: syntax error: unexpected EOF',
      '',
    ];
    for (const e of unrelated) {
      t.equal(addPrivateModuleHint(e), e);
    }
  });

  t.test('is idempotent', async (t) => {
    const once = addPrivateModuleHint('go: dial tcp: i/o timeout');
    t.equal(addPrivateModuleHint(once), once);
  });

  t.end();
});

test('runGo private module failure', (t) => {
  if (process.platform === 'win32') {
    t.skip('uses a POSIX shell stub for the go binary');
    return t.end();
  }

  const stderr =
    "go: example.com/internal/lib@v1.0.0: reading https://proxy.golang.org/x.mod: 410 Gone\nfatal: could not read Username for 'https://github.com': terminal prompts disabled";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-go-'));
  const stub = path.join(dir, 'go');
  fs.writeFileSync(
    stub,
    `#!/bin/sh\ncat >&2 <<'EOF'\n${stderr}\nEOF\nexit 1\n`,
  );
  fs.chmodSync(stub, 0o755);
  const origPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${origPath}`;
  t.teardown(() => {
    process.env.PATH = origPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  t.test(
    'rejects with the same string type, original text first',
    async (t) => {
      try {
        await runGo(['list', './...'], { cwd: dir });
        t.fail('expected rejection');
      } catch (err: any) {
        t.equal(typeof err, 'string');
        t.ok(err.startsWith(stderr));
        t.match(err, /GOPRIVATE/);
      }
    },
  );

  t.end();
});
