var test = require('tap').test;
var path = require('path');
var fs = require('fs');

var plugin = require('../../lib');

import {
  chdirToPkg,
  getGolangDep,
  getGovendor,
  clonePkg,
  pkgsList,
  cleanup,
  fetchDeps,
} from './util';

test('install dep', { timeout: 120 * 1000 }, function () {
  chdirToPkg([]);
  return getGolangDep();
});

test('install govendor', { timeout: 120 * 1000 }, function () {
  chdirToPkg([]);
  return getGovendor();
});

test('proj imports k8s client', { timeout: 300 * 1000 }, (t) => {
  return testPkg(t, ['with-k8s-client'], 'Gopkg.lock', 'expected-list.json');
});

test('prometheus 1.8', (t) => {
  chdirToPkg(['github.com', 'prometheus']);
  return clonePkg(
    'https://github.com/prometheus/prometheus',
    'v1.8.0',
    'prometheus'
  ).then(function () {
    return testPkg(
      t,
      ['github.com', 'prometheus', 'prometheus', 'cmd', 'prometheus'],
      ['..', '..', 'vendor', 'vendor.json'].join(path.sep),
      ['..', '..', '..', 'prometheus-cmd-prometheus-expected-list.json'].join(
        path.sep
      )
    );
  });
});

function testPkg(t, pkgPathArray, targetFile, expectedPkgsListFile) {
  chdirToPkg(pkgPathArray);

  return cleanup()
    .then(function () {
      return fetchDeps(targetFile);
    })
    .then(function () {
      return plugin.inspect('.', targetFile).then((result) => {
        var pkg = result.package;

        t.ok(JSON.stringify(pkg).length < 2 * 1024 * 1024, 'result below 2MB');
        t.same(
          pkgsList(pkg).sort(),
          JSON.parse(fs.readFileSync(expectedPkgsListFile)).sort(),
          'list of packages is as expected'
        );
      });
    })
    .catch((err) => {
      console.log(err.stack);
      t.bailout(err);
    });
}
