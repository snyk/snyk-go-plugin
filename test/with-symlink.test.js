var tap = require('tap');
var test = tap.test;
var path = require('path');

var subProcess = require('../lib/sub-process');

test('with nested GOPATH/src/proj symlink-ing to ../..', function (t) {
  var rootFolder = path.resolve(
    __dirname, 'fixtures', 'proj-with-nested-gopath-and-symlink');
  var gopath = path.resolve(rootFolder, 'gopath');
  var cwd = path.join(gopath, 'src', 'proj');

  var manualScriptPath = path.resolve(__dirname, 'manual.js');

  // NOTE: use spawn(shell=true) for this test,
  //  because node's process.chdir() resolved symlinks,
  //  such that process.cwd() no-longer contains the /gopath/ part
  return subProcess.execute(
    `cd ${cwd} ; export GOPATH=${gopath} ; node ${manualScriptPath} Gopkg.lock`,
    [],
    {
      shell: true,
    })
    .then(function (result) {
      var resultJson = JSON.parse(result);

      var plugin = resultJson.plugin;
      var pkg = resultJson.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'Gopkg.lock');
        t.end();
      });

      t.test('root pkg', function (t) {
        t.match(pkg, {
          name: 'proj',
          version: '',
          packageFormatVersion: 'golang:0.0.1',
        }, 'root pkg');
        t.end();
      });

      t.test('dependencies', function (t) {
        var deps = pkg.dependencies;

        t.match(deps['gitpub.com/food/salad'], {
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

        t.match(deps['gitpub.com/meal/dinner'], {
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
        }, 'salad is also a trasitive dependency');

        t.end();
      });
    });
});
