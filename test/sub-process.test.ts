import * as path from 'path';
import childProcess = require('child_process');
import { test } from 'tap';
import { execute } from '../lib/sub-process';

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
  return JSON.parse(await execute(process.execPath, [PRINT_ENV], options));
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
          await execute(process.execPath, [PRINT_ENV]);
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
      await execute(process.execPath, [PRINT_ENV]);
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
