import * as path from 'path';
import * as subProcess from '../../lib/sub-process';

export function pkgsList(pkgTree) {
  var pkgsMap = {};

  var fullName = pkgTree.name + '@' + pkgTree.version;
  pkgsMap[fullName] = true;

  var deps = pkgTree.dependencies;

  deps &&
    Object.keys(deps).forEach((k) => {
      var childList = pkgsList(deps[k]);

      childList.forEach((d) => {
        pkgsMap[d] = true;
      });
    });

  return Object.keys(pkgsMap);
}

export function chdirToPkg(pkgPathArray) {
  process.env['GOPATH'] = path.resolve(__dirname, 'fixtures', 'gopath');
  process.chdir(
    // use apply() instead of the spread `...` operator to support node v4
    path.resolve.apply(
      null,
      [__dirname, 'fixtures', 'gopath', 'src'].concat(pkgPathArray)
    )
  );
}

export async function cleanup() {
  return subProcess.execute('go', ['clean']).then(function () {
    return subProcess.execute('rm', ['-rf', './vendor/']);
  });
}

export async function getGolangDep() {
  return subProcess.execute('go', [
    'get',
    '-u',
    '-v',
    'github.com/golang/dep/cmd/dep',
  ]);
}

export async function getGovendor() {
  return subProcess.execute('go', [
    'get',
    '-u',
    '-v',
    'github.com/kardianos/govendor',
  ]);
}

export async function fetchDeps(targetFile) {
  if (targetFile.indexOf('Gopkg.lock') >= 0) {
    return subProcess.execute(process.env['GOPATH'] + '/bin/dep', [
      'ensure',
      '-v',
    ]);
  }

  if (targetFile.indexOf('vendor.json') >= 0) {
    return subProcess.execute(process.env['GOPATH'] + '/bin/govendor', [
      'sync',
    ]);
  }

  throw new Error('unrecognized targetFile: ' + targetFile);
}

export async function clonePkg(url, tag, destDir) {
  return subProcess.execute('rm', ['-rvf', './' + destDir]).then(function () {
    return subProcess.execute('git', [
      'clone',
      '-b',
      tag,
      '--single-branch',
      '--depth',
      '1',
      url,
      destDir,
    ]);
  });
}
