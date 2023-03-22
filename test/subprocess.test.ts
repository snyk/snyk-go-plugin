import { test } from 'tap';
import { execute } from '../lib/sub-process';

test('sub-process', (t) => {
  t.test('restore proxy environment', async (t) => {
    let preTestEnv = { ...process.env };
    
    process.env.SNYK_SYSTEM_HTTPS_PROXY = "http://127.0.0.1";
    process.env.SNYK_SYSTEM_HTTP_PROXY = "http://127.0.0.1";
    process.env.SNYK_SYSTEM_NO_PROXY = "example.com";
    
    // process.env.SNYK_SYSTEM_HTTPS_PROXY = "http://127.0.0.1";
    // process.env.SNYK_SYSTEM_HTTP_PROXY = "http://127.0.0.1";
    // process.env.SNYK_SYSTEM_NO_PROXY = "example.com";
    
    // restore env before test
    process.env = { ...preTestEnv };
    
    await execute('test', ['-d']);
    t.deepEquals(process.env, preTestEnv);
  });

  t.end();
});
