import * as tap from 'tap';
const test = tap.test;
import * as path from 'path';

import * as subProcess from '../lib/sub-process';

import { jsonParse } from '../lib';

test('with nested GOPATH/src/proj symlink-ing to ../..', (t) => {
  const rootFolder = path.resolve(
    __dirname,
    'fixtures',
    'proj-with-nested-gopath-and-symlink'
  );
  const gopath = path.resolve(rootFolder, 'gopath');
  const cwd = path.join(gopath, 'src', 'proj');

  const manualScriptPath = path.resolve(__dirname, 'manual.ts');

  // NOTE: use spawn(shell=true) for this test,
  //  because node's process.chdir() resolved symlinks,
  //  such that process.cwd() no-longer contains the /gopath/ part
  return subProcess
    .execute(
      `cd '${cwd}' ; export GOPATH=${gopath} ; ${__dirname}/../node_modules/.bin/ts-node ${manualScriptPath} Gopkg.lock`,
      []
    )
    .then((result) => {
      const resultJson = jsonParse(result);

      const plugin = resultJson.plugin;
      const pkg = resultJson.package;

      t.test('plugin', (t) => {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'Gopkg.lock');
        t.end();
      });

      t.test('root pkg', (t) => {
        t.match(
          pkg,
          {
            name: 'proj',
            version: '',
            packageFormatVersion: 'golang:0.0.1',
          },
          'root pkg'
        );
        t.end();
      });

      t.test('dependencies', (t) => {
        const deps = pkg.dependencies;

        t.match(
          deps['gitpub.com/food/salad'],
          {
            name: 'gitpub.com/food/salad',
            version: 'v1.3.7',
            dependencies: {
              'gitpub.com/nature/vegetables/tomato': {
                version: '#b6ffb7d62206806b573348160795ea16a00940a6',
              },
              'gitpub.com/nature/vegetables/cucamba': {
                version: '#b6ffb7d62206806b573348160795ea16a00940a6',
              },
            },
          },
          'salad depends on tomato and cucamba'
        );

        t.match(
          deps['gitpub.com/meal/dinner'],
          {
            version: 'v0.0.7',
            dependencies: {
              'gitpub.com/food/salad': {
                version: 'v1.3.7',
                dependencies: {
                  'gitpub.com/nature/vegetables/tomato': {
                    version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                  },
                },
              },
            },
          },
          'salad is also a trasitive dependency'
        );

        t.end();
      });
    })
    .catch(t.threw);
});
