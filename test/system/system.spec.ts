import * as fs from 'fs';
import * as plugin from '../../lib';
import {
  chdirToPkg,
  getGolangDep,
  getGovendor,
  cleanup,
  fetchDeps,
  pkgsList,
} from './utils';

it('should install GolangDep', async () => {
  chdirToPkg([]);
  expect(await getGolangDep()).toBeTruthy();
});

it('should install GoVendor', async () => {
  chdirToPkg([]);
  expect(await getGovendor()).toBeTruthy();
});

// it('should work proj that imports k8s client', async (t) => {
//   const pkgPathArray = ['with-k8s-client'];
//   const targetFile = 'Gopkg.lock';
//   const expectedPkgsListFile = 'expected-list.json';

//   await cleanup();
//   await fetchDeps(targetFile);
//   await plugin.inspect('.', targetFile);
// });

// test('proj imports k8s client', { timeout: 300 * 1000 }, (t) => {
//   return;
// });

// test('prometheus 1.8', (t) => {
//   chdirToPkg(['github.com', 'prometheus']);
//   return clonePkg(
//     'https://github.com/prometheus/prometheus',
//     'v1.8.0',
//     'prometheus'
//   ).then(function () {
//     return testPkg(
//       t,
//       ['github.com', 'prometheus', 'prometheus', 'cmd', 'prometheus'],
//       ['..', '..', 'vendor', 'vendor.json'].join(path.sep),
//       ['..', '..', '..', 'prometheus-cmd-prometheus-expected-list.json'].join(
//         path.sep
//       )
//     );
//   });
// });

// function testPkg(t, pkgPathArray, targetFile, expectedPkgsListFile) {
//   chdirToPkg(pkgPathArray);

//   return cleanup()
//     .then(function () {
//       return fetchDeps(targetFile);
//     })
//     .then(function () {
//       return plugin.inspect('.', targetFile).then((result) => {
//         var pkg = result.package;

//         t.ok(JSON.stringify(pkg).length < 2 * 1024 * 1024, 'result below 2MB');
//         t.same(
//           pkgsList(pkg).sort(),
//           JSON.parse(fs.readFileSync(expectedPkgsListFile, 'utf-8')).sort(),
//           'list of packages is as expected'
//         );
//       });
//     })
//     .catch((err) => {
//       console.log(err.stack);
//       t.bailout(err);
//     });
// }
