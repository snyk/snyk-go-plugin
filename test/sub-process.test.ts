import { test } from 'tap';
import { execute } from '../lib/sub-process';

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
