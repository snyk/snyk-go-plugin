import * as tap from 'tap';
import * as path from 'path';
import * as os from 'os';
import {exec} from 'child_process'
import * as subProcess from '../lib/sub-process';
import {jsonParse} from '../lib';
const test = tap.test;

interface ExecPromiseResponse{
    stdout: string;
    stderr: string;
}

// Since we support Node 8+, we can't use util.promisify(Node 10+). Let's implement promisified exec:
function execPromise(command:string):Promise<ExecPromiseResponse> {
  return new Promise(function(resolve, reject) {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({stdout, stderr});
    });
  });
}

const isRunningOnWindows = os.platform() === 'win32';


test('with nested GOPATH/src/proj symlink-ing to ../..', async(t) => {
  const rootFolder = path.resolve(
    __dirname, 'fixtures', 'proj-with-nested-gopath-and-symlink');
  const gopath = path.resolve(rootFolder, 'gopath');
  const cwd = path.join(gopath, 'src', 'proj');

  const manualScriptPath = path.resolve(__dirname, 'manual.ts');

  const nativeExport = isRunningOnWindows ? 'SET' : 'export';
  if (isRunningOnWindows) {
      // If we run on windows we have to manually create the symlink every time.
      // Note that windows symlink generates a file, so we have to delete the current `proj` unix symlink
    const windowsScriptFile = path.resolve(rootFolder, 'windows-script', 'mklink.cmd');
    try{
        // We pass two args: [symlink target location, symlink target location]
        const msCmd = `${windowsScriptFile} ${cwd} ${rootFolder}`;
        const {stdout, stderr} = await execPromise(msCmd);
        if (stderr.length) {
            throw new Error(stderr);
        }
    }catch(e){
        t.fail(e.message)
    }
  }

  // NOTE: use spawn(shell=true) for this test,
  //  because node's process.chdir() resolved symlinks,
  //  such that process.cwd() no-longer contains the /gopath/ part
  const tsNodePath = path.resolve(__dirname, '..', 'node_modules','.bin','ts-node');
  const execPluginCmd = `${tsNodePath} ${manualScriptPath} Gopkg.lock`;

  // If we run on windows, we'd like to "lazy-eval" the env variable, so we wrap w/ quotes. This took a long while to find.
  const exportEnvVarCmd = `${nativeExport} ${isRunningOnWindows ? '"':''}GOPATH=${gopath}${isRunningOnWindows ? '"':''}`
  const cmd = `cd ${cwd} && ${exportEnvVarCmd} && ${execPluginCmd}`;
  return subProcess.execute(
    cmd,
    [], {}, true)
    .then((result) => {
      const resultJson = jsonParse(result);

      const plugin = resultJson.plugin;
      const pkg = resultJson.package;

      t.test('plugin', (t1) => {
        t1.ok(plugin, 'plugin');
        t1.equal(plugin.name, 'snyk-go-plugin', 'name');
        t1.match(plugin.runtime, /^go\d+/, 'engine');
        t1.equal(plugin.targetFile, 'Gopkg.lock');
        t1.end();
      });

      t.test('root pkg', (t1) => {
        t1.match(pkg, {
          name: 'proj',
          version: '',
          packageFormatVersion: 'golang:0.0.1',
        }, 'root pkg');
        t1.end();
      });

      t.test('dependencies', (t1) => {
        const deps = pkg.dependencies;

        t1.match(deps['gitpub.com/food/salad'], {
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
        }, 'salad depends on tomato and cucamba');

        t1.match(deps['gitpub.com/meal/dinner'], {
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
        }, 'salad is also a transitive dependency');

        t1.end();
      });
    })
    .catch(t.threw);
});

test('package with broken symlink', async (t) => {
  const fixtures = path.resolve(__dirname, 'fixtures');
  const gopath = path.resolve(fixtures, 'gopath');
  const cwd = path.join(gopath, 'src', 'path', 'to', 'pkg-with-broken-symlink');

  const manualScriptPath = path.resolve(__dirname, 'manual.ts');

  const nativeExport = isRunningOnWindows ? 'SET' : 'export';
  // NOTE: use spawn(shell=true) for this test,
  //  because node's process.chdir() resolved symlinks,
  //  such that process.cwd() no-longer contains the /gopath/ part
  const tsNodePath = path.resolve(__dirname, '..', 'node_modules','.bin','ts-node');
  const execPluginCmd = `${tsNodePath} ${manualScriptPath} Gopkg.lock`;

  // If we run on windows, we'd like to "lazy-eval" the env variable, so we wrap w/ quotes. This took a long while to find.
  const exportEnvVarCmd = `${nativeExport} ${isRunningOnWindows ? '"':''}GOPATH=${gopath}${isRunningOnWindows ? '"':''}`
  const cmd = `cd ${cwd} && ${exportEnvVarCmd} && ${execPluginCmd}`;
  return subProcess.execute(
    cmd,
    [], {}, true)
    .then((result) => {
      const resultJson = jsonParse(result);

      const plugin = resultJson.plugin;
      const pkg = resultJson.package;

      t.test('plugin', (t1) => {
        t1.ok(plugin, 'plugin');
        t1.equal(plugin.name, 'snyk-go-plugin', 'name');
        t1.match(plugin.runtime, /^go\d+/, 'engine');
        t1.equal(plugin.targetFile, 'Gopkg.lock');
        t1.end();
      });

      t.test('dependencies', (t1) => {
        const deps = pkg.dependencies;

        t1.match(deps['gitpub.com/food/salad'], {
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
        }, 'salad depends on tomato and cucamba');

        t1.match(deps['gitpub.com/meal/dinner'], {
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
        }, 'salad is also a transitive dependency');

        t1.end();
      });
    })
    .catch(t.threw);
});
