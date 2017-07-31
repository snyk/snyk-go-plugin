var test = require('tap').test;
var path = require('path');

var plugin = require('../lib');
var subProcess = require('../lib/sub-process')

test('inspect', function (t) {
  chdirToPkg(['path', 'to', 'pkg']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.end();
      });

      t.test('root pkg', function (t) {
        t.match(pkg, {
          name: 'path/to/pkg',
        }, 'root pkg')
        t.end();
      });

      t.test('dependencies', function (t) {
        var deps = pkg.dependencies;

        t.match(deps['gitpub.com/food/salad'], {
          name: 'gitpub.com/food/salad',
          version: '1.3.7',
          dependencies: {
            'gitpub.com/nature/vegetables/tomato': {
              version: '#b6ffb7d62206806b573348160795ea16a00940a6',
            },
            'gitpub.com/nature/vegetables/cucamba': {
              version: '#b6ffb7d62206806b573348160795ea16a00940a6',
            },
          },
        });

        t.end();
      });
    });
});

function chdirToPkg(pkgPathArray) {
  process.env['GOPATH'] = path.resolve(__dirname, 'fixtures', 'gopath');
  process.chdir(path.resolve(__dirname, 'fixtures', 'gopath', 'src', ...pkgPathArray));
}