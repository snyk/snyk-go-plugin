var test = require('tap').test;
var path = require('path');

var plugin = require('../lib');

test('inspect', function (t) {
  return plugin.inspect(path.join(__dirname, 'fixtures'), 'Gopkg.lock')
    .then(function (result) {
      var plugin = result.plugin;
      var pkg = result.package;

      t.test('plugin', function (t) {
        t.ok(plugin, 'plugin');
        t.equal(plugin.name, 'snyk-go-plugin', 'name');
        t.end();
      });

      t.test('dependencies', function (t) {
        var deps = pkg.dependencies;

        t.same(deps['github.com/dgrijalva/jwt-go'], {
          name: 'github.com/dgrijalva/jwt-go',
          version: '3.0.0',
        }, 'simple pkg');

        t.same(deps['github.com/davecgh/go-spew/spew'], {
          name: 'github.com/davecgh/go-spew/spew',
          version: '1.1.0' ,
        }, 'subpackage')

        t.same(deps['github.com/valyala/bytebufferpool'], {
          name: 'github.com/valyala/bytebufferpool',
          version: '#e746df99fe4a3986f4d4f79e13c1e0117ce9c2f7',
        }, 'no version')

        t.same(deps['golang.org/x/crypto/acme'], {
          name: 'golang.org/x/crypto/acme',
          version: '#e1a4589e7d3ea14a3352255d04b6f1a418845e5e',
        }, 'golang.org multiple subpaackages 1')

        t.same(deps['golang.org/x/crypto/acme/autocert'], {
          name: 'golang.org/x/crypto/acme/autocert',
          version: '#e1a4589e7d3ea14a3352255d04b6f1a418845e5e',
        }, 'golang.org multiple subpaackages 2')

        t.end();
      });
    });
});