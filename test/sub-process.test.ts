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

    t.contains(result, 'HTTPS_PROXY=http://1.1.1.1');
    t.contains(result, 'HTTP_PROXY=http://2.2.2.2');
    t.contains(result, 'NO_PROXY=snyk.com');

    t.equals(process.env.HTTPS_PROXY, 'http://127.0.0.1');
    t.equals(process.env.HTTP_PROXY, 'http://127.0.0.1');
    t.equals(process.env.NO_PROXY, 'example.com');
  });

  t.end();
});
