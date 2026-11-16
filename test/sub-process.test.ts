import { test } from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execute, runGo, addPrivateModuleHint } from '../lib/sub-process';

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
