var test = require('tap').test;
var path = require('path');

var plugin = require('../lib');
var subProcess = require('../lib/sub-process')

test('happy inspect', function (t) {
  chdirToPkg(['path', 'to', 'pkg']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'Gopkg.lock');
        t.end();
      });

      t.test('root pkg', function (t) {
        t.match(pkg, {
          name: 'path/to/pkg',
          version: '0.0.0',
          from: ['path/to/pkg@0.0.0'],
          packageFormatVersion: 'golang:0.0.1',
        }, 'root pkg')
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
          from: ['path/to/pkg@0.0.0', 'gitpub.com/food/salad@v1.3.7'],
        }, 'salad depends on tomato and cucamba');

        t.match(deps['gitpub.com/meal/dinner'], {
          version: 'v0.0.7',
          dependencies: {
            'gitpub.com/food/salad': {
              version: 'v1.3.7',
              dependencies: {
                'gitpub.com/nature/vegetables/tomato': {
                  version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                  from: [
                    'path/to/pkg@0.0.0',
                    'gitpub.com/meal/dinner@v0.0.7',
                    'gitpub.com/food/salad@v1.3.7',
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

test('pkg with local import', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-local-import']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.end();
      });

      t.test('dependencies', function (t) {
        t.match(pkg, {
          version: '0.0.0',
          dependencies: {
            'gitpub.com/meal/dinner': {
              version: 'v0.0.7',
              dependencies: {
                'gitpub.com/food/salad': {
                  version: 'v1.3.7',
                  dependencies: {
                    'gitpub.com/nature/vegetables/tomato': {
                      version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                      from: [
                        'path/to/pkg-with-local-import@0.0.0',
                        'gitpub.com/meal/dinner@v0.0.7',
                        'gitpub.com/food/salad@v1.3.7',
                        'gitpub.com/nature/vegetables/tomato@#b6ffb7d62206806b573348160795ea16a00940a6', // jscs:ignore maximumLineLength
                      ],
                    },
                  },
                },
              },
            },
          },
        }, 'local subpkg merged with root');

        t.end();
      });
    });
});

test('pkg with internal subpkg', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-internal-subpkg']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.end();
      });

      t.test('dependencies', function (t) {
        t.match(pkg, {
          version: '0.0.0',
          dependencies: {
            'gitpub.com/meal/dinner': {
              version: 'v0.0.7',
              dependencies: {
                'gitpub.com/food/salad': {
                  version: 'v1.3.7',
                  dependencies: {
                    'gitpub.com/nature/vegetables/tomato': {
                      version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                      from: [
                        'path/to/pkg-with-internal-subpkg@0.0.0',
                        'gitpub.com/meal/dinner@v0.0.7',
                        'gitpub.com/food/salad@v1.3.7',
                        'gitpub.com/nature/vegetables/tomato@#b6ffb7d62206806b573348160795ea16a00940a6', // jscs:ignore maximumLineLength
                      ],
                    },
                  },
                },
              },
            },
          },
        }, 'internal subpkgps are not in tree, but their children are');

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
      t.equal(
        error.message,
        'Unresolved imports found, please run `dep ensure`');
    });
});

test('missing some packages in vendor/ folder (dep)', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-partial-vendor-folder']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.equal(
        error.message,
        'Unresolved imports found, please run `dep ensure`');
    });
});

test('missing some packages in vendor/ folder (govendor)', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-partial-vendor-folder']);

  return plugin.inspect('.', 'vendor/vendor.json')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.equal(
        error.message,
        'Unresolved imports found, please run `govendor fetch +outside`');
    });
});

test('cyclic import', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-cycle']);

  return plugin.inspect('.', 'vendor/vendor.json')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.match(error.message, 'import cycle');
      t.pass();
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

test('pkg without external deps', function (t) {
  chdirToPkg(['path', 'to', 'pkg-without-deps']);

  return plugin.inspect('.', 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'Gopkg.lock');
        t.end();
      });

      t.test('pkg', function (t) {
        t.same(pkg, {
          name: 'path/to/pkg-without-deps',
          version: '0.0.0',
          from: ['path/to/pkg-without-deps@0.0.0'],
          packageFormatVersion: 'golang:0.0.1',
          dependencies: {},
        });
        t.end();
      });
    })
});

test('happy inspect govendor', function (t) {
  chdirToPkg(['path', 'to', 'pkg']);

  return plugin.inspect('.', 'vendor/vendor.json')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'vendor/vendor.json');
        t.end();
      });

      t.test('root pkg', function (t) {
        t.match(pkg, {
          name: 'path/to/pkg',
          version: '0.0.0',
          from: ['path/to/pkg@0.0.0'],
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
          from: ['path/to/pkg@0.0.0', 'gitpub.com/food/salad@v1.3.7'],
        }, 'salad depends on tomato and cucamba');

        t.match(deps['gitpub.com/meal/dinner'], {
          version: 'v0.0.7',
          dependencies: {
            'gitpub.com/food/salad': {
              version: 'v1.3.7',
              dependencies: {
                'gitpub.com/nature/vegetables/tomato': {
                  version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                  from: [
                    'path/to/pkg@0.0.0',
                    'gitpub.com/meal/dinner@v0.0.7',
                    'gitpub.com/food/salad@v1.3.7',
                    'gitpub.com/nature/vegetables/tomato@#b6ffb7d62206806b573348160795ea16a00940a6', // jscs:ignore maximumLineLength
                  ],
                },
              },
            },
          },
        }, 'salad is also a trasitive dependency');

        t.end();
      });
    });
});

test('inspect govendor with alternate case', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-alternate-govendor']);

  return plugin.inspect('.', 'vendor/vendor.json')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.match(plugin.runtime, /^go\d+/, 'engine');
        t.equal(plugin.targetFile, 'vendor/vendor.json');
        t.end();
      });

      t.test('root pkg', function (t) {
        t.match(pkg, {
          name: 'path/to/pkg-with-alternate-govendor',
          version: '0.0.0',
          from: ['path/to/pkg-with-alternate-govendor@0.0.0'],
          packageFormatVersion: 'golang:0.0.1',
          dependencies: {
            'gitpub.com/drink/juice': {
              version: '#23b2ba882803c3f509a94d5e79f61924126100cf',
            },
          },
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
          from: [
            'path/to/pkg-with-alternate-govendor@0.0.0',
            'gitpub.com/food/salad@v1.3.7',],
        }, 'salad depends on tomato and cucamba');

        t.match(deps['gitpub.com/meal/dinner'], {
          version: 'v0.0.7',
          dependencies: {
            'gitpub.com/food/salad': {
              version: 'v1.3.7',
              dependencies: {
                'gitpub.com/nature/vegetables/tomato': {
                  version: '#b6ffb7d62206806b573348160795ea16a00940a6',
                  from: [
                    'path/to/pkg-with-alternate-govendor@0.0.0',
                    'gitpub.com/meal/dinner@v0.0.7',
                    'gitpub.com/food/salad@v1.3.7',
                    'gitpub.com/nature/vegetables/tomato@#b6ffb7d62206806b573348160795ea16a00940a6', // jscs:ignore maximumLineLength
                  ],
                },
              },
            },
          },
        }, 'salad is also a trasitive dependency');

        t.end();
      });
    });
});

test('corrupt vendor.json', function (t) {
  chdirToPkg(['path', 'to', 'pkg-with-corrupt-govendor-json']);

  return plugin.inspect('.', 'vendor/vendor.json')
    .then(function (result) {
      t.fail('should have failed');
    }).catch(function (error) {
      t.pass();
    });
});

function chdirToPkg(pkgPathArray) {
  process.env['GOPATH'] = path.resolve(__dirname, 'fixtures', 'gopath');
  process.chdir(
    // use apply() instead of the spread `...` operator to support node v4
    path.resolve.apply(
      null,
      [__dirname, 'fixtures', 'gopath', 'src'].concat(pkgPathArray)
    )
  );
}
