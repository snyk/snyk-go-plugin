import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'tap';
import { buildDepGraphFromImportsAndModules } from '../lib';
import { execute, runGo } from '../lib/sub-process';
import { goVersion } from './go-version';

interface FakeGoResult {
  code: number;
  output: string;
}

// Replaces child_process.spawn so runGo() can be driven with canned go output.
function loadRunGoWithFakeGo(t: Tap.Test, results: FakeGoResult[]) {
  const calls: { command: string; args: string[]; options: any }[] = [];
  const spawn = (command: string, args: string[], options: any) => {
    calls.push({ command, args, options });
    const result = results[calls.length - 1];
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from(result.output));
      proc.emit('close', result.code);
    });
    return proc;
  };
  const mocked = t.mockRequire('../lib/sub-process', {
    child_process: { spawn },
  });
  return { runGo: mocked.runGo as typeof runGo, calls };
}

const missingSumPackageErrorWithGoGet = `main.go:6:2: missing go.sum entry needed to verify package cloud.google.com/go/compute/metadata (imported by example.com/app) is provided by exactly one module; to add:
\tgo get example.com/app
`;

const missingSumPackageErrorWithModDownload = `missing go.sum entry needed to verify package cloud.google.com/go/compute/metadata is provided by exactly one module; to add:
\tgo mod download cloud.google.com/go/compute
`;

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

  t.test('runGo recovery from a missing go.sum entry', (t) => {
    const listArgs = ['list', '-json', '-deps', './...'];
    const options = { cwd: '/some/project' };

    t.test('runs `go get <pkg>` as hinted by go and retries', async (t) => {
      const fake = loadRunGoWithFakeGo(t, [
        { code: 1, output: missingSumPackageErrorWithGoGet },
        { code: 0, output: '' },
        { code: 0, output: '{"ImportPath":"example.com/app"}' },
      ]);

      const out = await fake.runGo(listArgs, options);

      t.equal(out, '{"ImportPath":"example.com/app"}');
      t.equal(fake.calls.length, 3);
      t.same(fake.calls[0].args, listArgs);
      t.equal(fake.calls[1].args[0], 'get');
      t.equal(fake.calls[1].args[1].trim(), 'example.com/app');
      t.same(fake.calls[2].args, listArgs);
      t.equal(fake.calls[1].options.shell, false);
    });

    t.test(
      'runs `go mod download <module>` with the module go names, as separate argv',
      async (t) => {
        const fake = loadRunGoWithFakeGo(t, [
          { code: 1, output: missingSumPackageErrorWithModDownload },
          { code: 0, output: '' },
          { code: 0, output: 'listed' },
        ]);

        const out = await fake.runGo(listArgs, options);

        t.equal(out, 'listed');
        t.same(
          fake.calls.map((c) => [c.command, c.args]),
          [
            ['go', listArgs],
            ['go', ['mod', 'download', 'cloud.google.com/go/compute']],
            ['go', listArgs],
          ],
        );
        t.equal(fake.calls[1].options.shell, false);
        t.equal(fake.calls[1].options.cwd, options.cwd);
      },
    );

    t.test('passes every module go names, each as its own arg', async (t) => {
      const fake = loadRunGoWithFakeGo(t, [
        {
          code: 1,
          output:
            'missing go.sum entry needed to verify package a.example/x/y is provided by exactly one module; to add:\n\tgo mod download a.example/x a.example/x/y@v1.2.3+incompatible\n',
        },
        { code: 0, output: '' },
        { code: 0, output: 'listed' },
      ]);

      await fake.runGo(listArgs, options);

      t.same(fake.calls[1].args, [
        'mod',
        'download',
        'a.example/x',
        'a.example/x/y@v1.2.3+incompatible',
      ]);
    });

    t.test('does not retry the same recovery command twice', async (t) => {
      const fake = loadRunGoWithFakeGo(t, [
        { code: 1, output: missingSumPackageErrorWithModDownload },
        { code: 0, output: '' },
        { code: 1, output: missingSumPackageErrorWithModDownload },
      ]);

      await t.rejects(
        fake.runGo(listArgs, options),
        missingSumPackageErrorWithModDownload,
      );
      t.equal(fake.calls.length, 3);
    });

    t.test(
      'keeps running bare `go mod download` when no module is named',
      async (t) => {
        const fake = loadRunGoWithFakeGo(t, [
          { code: 1, output: "some failure, try 'go mod download'" },
          { code: 0, output: '' },
          { code: 0, output: 'listed' },
        ]);

        await fake.runGo(listArgs, options);

        t.same(fake.calls[1].args, ['mod', 'download']);
      },
    );

    const unsafeHints = [
      'go mod download example.com/m;touch pwned',
      'go mod download example.com/m && touch pwned',
      'go mod download $(touch pwned)',
      'go mod download `touch pwned`',
      'go mod download -modfile=evil.mod',
      'go mod download -x',
      'go mod download ../outside',
      'go mod download /absolute/path',
      'go mod download example.com/m@v1;touch',
      'go mod download example.com//m',
      'go mod download example.com/m|cat',
    ];
    for (const hint of unsafeHints) {
      t.test(`never passes untrusted text on: ${hint}`, async (t) => {
        const fake = loadRunGoWithFakeGo(t, [
          { code: 1, output: `failure; to add:\n\t${hint}\n` },
          { code: 0, output: '' },
          { code: 0, output: 'listed' },
        ]);

        await fake.runGo(listArgs, options);

        t.same(
          fake.calls[1].args,
          ['mod', 'download'],
          'falls back to the argument-less command',
        );
        t.ok(
          fake.calls.every((c) => c.options.shell === false),
          'never uses a shell',
        );
      });
    }

    t.test('rethrows errors that are not a go.sum hint', async (t) => {
      const fake = loadRunGoWithFakeGo(t, [{ code: 1, output: 'boom' }]);

      await t.rejects(fake.runGo(listArgs, options), 'boom');
      t.equal(fake.calls.length, 1);
    });

    t.end();
  });

  t.end();
});

// Real `go` runs against a module that imports a package from a module whose
// path is a prefix of another required module's path, with the h1: hash of the
// parent module missing from go.sum.
const supportsMissingParentSumFixture = goVersion[0] > 1 || goVersion[1] >= 17;
if (supportsMissingParentSumFixture) {
  test('missing go.sum hash of a parent module', { timeout: 300000 }, (t) => {
    const fixture = path.resolve(
      __dirname,
      'fixtures',
      'gomod-missing-parent-sum',
    );
    const parentHash = /^cloud\.google\.com\/go\/compute v[^\s/]+ h1:/m;

    const copyFixture = (t: Tap.Test): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-missing-sum-'));
      t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.cpSync(fixture, dir, { recursive: true });
      return dir;
    };

    t.test('fixture really lacks the parent hash', async (t) => {
      const goSum = fs.readFileSync(path.join(fixture, 'go.sum'), 'utf8');
      t.notOk(parentHash.test(goSum));
    });

    t.test(
      'runGo restores it when go hints `go mod download <module>`',
      async (t) => {
        const dir = copyFixture(t);

        const out = await runGo(
          ['list', '-json', 'cloud.google.com/go/compute/metadata'],
          { cwd: dir },
        );

        t.equal(
          JSON.parse(out).ImportPath,
          'cloud.google.com/go/compute/metadata',
        );
        t.ok(
          parentHash.test(fs.readFileSync(path.join(dir, 'go.sum'), 'utf8')),
        );
      },
    );

    t.test('dep-graph is built when go hints `go get <pkg>`', async (t) => {
      const dir = copyFixture(t);

      const depGraph = await buildDepGraphFromImportsAndModules(dir);

      t.ok(
        depGraph
          .getPkgs()
          .some((pkg) => pkg.name === 'cloud.google.com/go/compute/metadata'),
      );
    });

    t.end();
  });
}
