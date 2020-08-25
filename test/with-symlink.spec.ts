import * as path from 'path';
import * as subProcess from '../lib/sub-process';

import { jsonParse } from '../lib';

const rootFolder = path.resolve(
  __dirname,
  'fixtures',
  'proj-with-nested-gopath-and-symlink'
);

const gopath = path.resolve(rootFolder, 'gopath');
const cwd = path.join(gopath, 'src', 'proj');
const manualScriptPath = path.resolve(__dirname, 'manual.ts');

describe('with nested GOPATH/src/proj symlink-ing to ../..', () => {
  // NOTE: use spawn(shell=true) for this test,
  //  because node's process.chdir() resolved symlinks,
  //  such that process.cwd() no-longer contains the /gopath/ part

  it('should use snyk-go-plugin when scanning Gopkg.lock', async () => {
    try {
      const result = await subProcess.execute(
        `cd '${cwd}' ; export GOPATH=${gopath} ; ${__dirname}/../node_modules/.bin/ts-node ${manualScriptPath} Gopkg.lock`,
        []
      );

      const { plugin, pkg } = await jsonParse(result);

      expect(plugin).toBeTruthy();
      expect(pkg).toBeTruthy();

      expect(plugin.name).toBe('snyk-go-plugin');
      expect(plugin.runtime).toMatch(/^go\d+/); // engine
      expect(plugin.targetFile).toBe('Gopkg.lock');

      // root pkg
      expect(pkg).toEqual({
        name: 'proj',
        version: '',
        packageFormatVersion: '',
      });

      const deps = pkg.dependencies;

      // salad depends on tomato and cucamba
      expect(deps['gitpub.com/food/salad']).toEqual({
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
      });

      // salad is also a trasitive dependency
      expect(deps['gitpub.com/meal/dinner']).toEqual({
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
      });
    } catch (error) {
      throw new Error(error);
    }
  });
});
