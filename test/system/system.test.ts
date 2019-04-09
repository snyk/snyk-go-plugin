var test = require('tap').test;
var path = require('path');
var fs = require('fs');

var plugin = require('../../lib');
var subProcess = require('../../lib/sub-process');

test('install dep', {timeout: 120 * 1000}, function () {
  chdirToPkg([]);
  return getGolangDep();
});

test('install govendor', {timeout: 120 * 1000}, function () {
  chdirToPkg([]);
  return getGovendor();
});

test('proj imports k8s client', {timeout: 300 * 1000}, (t) => {
  return testPkg(t,
    ['with-k8s-client'],
    'Gopkg.lock',
    'expected-list.json'
  );
});

test('prometheus 1.8', (t) => {
  chdirToPkg(['github.com', 'prometheus']);
  return clonePkg(
    'https://github.com/prometheus/prometheus',
    'v1.8.0',
    'prometheus'
  ).then(function () {
    return testPkg(t,
      ['github.com', 'prometheus', 'prometheus', 'cmd', 'prometheus'],
      ['..', '..', 'vendor', 'vendor.json'].join(path.sep),
      ['..', '..', '..',
        'prometheus-cmd-prometheus-expected-list.json'].join(path.sep)
    );
  });
});

function testPkg(t, pkgPathArray, targetFile, expectedPkgsListFile) {
  chdirToPkg(pkgPathArray);

  return cleanup().then(function () {
    return fetchDeps(targetFile);
  }).then(function () {

    return plugin.inspect('.', targetFile)
      .then((result) => {
        var pkg = result.package;

        t.ok(JSON.stringify(pkg).length < 2 * 1024 * 1024, 'result below 2MB');
        t.same(
          pkgsList(pkg).sort(),
          JSON.parse(fs.readFileSync(expectedPkgsListFile)).sort(),
          'list of packages is as expected'
        );
      });
  }).catch((err) => {
    console.log(err.stack);
    t.bailout(err);
  });
}

// utils:

function pkgsList(pkgTree) {
  var pkgsMap = {};

  var fullName = pkgTree.name + '@' + pkgTree.version;
  pkgsMap[fullName] = true;

  var deps = pkgTree.dependencies;

  deps && Object.keys(deps).forEach((k) => {
    var childList = pkgsList(deps[k]);

    childList.forEach((d) => {
      pkgsMap[d] = true;
    });
  });

  return Object.keys(pkgsMap);
}

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

function cleanup() {
  return subProcess.execute('go', ['clean']).then(function () {
    return subProcess.execute('rm', ['-rf', './vendor/']);
  });
}

function getGolangDep() {
  return subProcess.execute(
    'go',
    ['get', '-u', '-v', 'github.com/golang/dep/cmd/dep']);
}

function getGovendor() {
  return subProcess.execute(
    'go',
    ['get', '-u', '-v', 'github.com/kardianos/govendor']);
}

function fetchDeps(targetFile) {
  if (targetFile.indexOf('Gopkg.lock') >= 0) {
    return subProcess.execute(
      process.env['GOPATH'] + '/bin/dep',
      ['ensure', '-v']);
  }

  if (targetFile.indexOf('vendor.json') >= 0) {
    return subProcess.execute(
      process.env['GOPATH'] + '/bin/govendor',
      ['sync']);
  }

  throw new Error('unrecognized targetFile: ' + targetFile);
}

function clonePkg(url, tag, destDir) {
  return subProcess.execute('rm', ['-rvf', './' + destDir]).then(function () {
    return subProcess.execute('git',
      ['clone', '-b', tag, '--single-branch', '--depth', '1', url, destDir]
    );
  });
}

