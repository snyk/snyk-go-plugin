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
          version: '0.0.0',
          from: ['path/to/pkg@0.0.0'],
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
          from: ['path/to/pkg@0.0.0', 'gitpub.com/food/salad@1.3.7'],
        }, 'salad depends on tomato and cucamba');

        t.match(deps['gitpub.com/meal/dinner'], {
          version: '0.0.7',
          dependencies: {
            'gitpub.com/food/salad': {
              version: '1.3.7',
              dependencies: {
                'gitpub.com/nature/vegetables/tomato': {
                  version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                  from: [
                    'path/to/pkg@0.0.0',
                    'gitpub.com/meal/dinner@0.0.7',
                    'gitpub.com/food/salad@1.3.7',
                    'gitpub.com/nature/vegetables/tomato@#b6ffb7d62206806b573348160795ea16a00940a6', // jscs:ignore maximumLineLength
                    ],
                },
              },
            },
          },
        }, 'salad is also a trasitive dependency')

        t.end();
      });
    });
});

test('missing vendor/ folder', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-missing-vendor-folder']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.equal(error.message, 'Please run `dep ensure`');
    });
});

test('missing some packages in vendor/ folder', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-partial-vendor-folder']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.equal(error.message, 'Please run `dep ensure`');
    });
});

test('corrupt Gopkg.lock', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-corrupt-gopkg-lock']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.pass();
    });
});

function chdirToPkg(pkgPathArray) {
  process.env['GOPATH'] = path.resolve(__dirname, 'fixtures', 'gopath');
  process.chdir(
    path.resolve(__dirname, 'fixtures', 'gopath', 'src', ...pkgPathArray));
}