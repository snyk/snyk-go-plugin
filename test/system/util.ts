import * as subProcess from '../../lib/sub-process';
import * as path from 'path';

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

  const pkgPathDirectory = path.resolve(
    __dirname,
    'fixtures',
    'gopath',
    'src',
    ...pkgPathArray
  );

  process.chdir(pkgPathDirectory);
}

export async function cleanup() {
  await subProcess.execute('go', ['clean']);
  await subProcess.execute('rm', ['-rf', './vendor/']);
}

export function getGolangDep() {
  return subProcess.execute('go', [
    'get',
    '-u',
    '-v',
    'github.com/golang/dep/cmd/dep',
  ]);
}

export function getGovendor() {
  return subProcess.execute('go', [
    'get',
    '-u',
    '-v',
    'github.com/kardianos/govendor',
  ]);
}

export async function fetchDeps(targetFile: string) {
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

export function clonePkg(url, tag, destDir) {
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
