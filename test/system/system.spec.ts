import {
  chdirToPkg,
  getGolangDep,
  getGovendor,
  cleanup,
  fetchDeps,
  pkgsList,
} from './util';

import * as fs from 'fs';
import * as plugin from '../../lib';

describe('go dependencies', () => {
  it('should successful load golang package', async () => {
    chdirToPkg([]);
    const actual = await getGolangDep();
    const expected = 'github.com/golang/dep (download)';
    expect(actual).toMatch(expected);
  }, 120000);

  it('should successful load govendor package', async () => {
    chdirToPkg([]);
    const actual = await getGovendor();
    const expected = 'github.com/kardianos/govendor (download)';
    expect(actual).toMatch(expected);
  }, 120000);

  it('should successful load <proj imports k8s client>', async () => {
    const pkgPathArray = ['with-k8s-client'];
    const targetFile = 'Gopkg.lock';
    const expectedPkgsListFile = 'expected-list.json';

    chdirToPkg(pkgPathArray);
    await cleanup();
    await fetchDeps(targetFile);

    const pluginResult = await plugin.inspect('.', targetFile);

    const pkg = pluginResult.package;
    // verify `result is below 2MB`
    expect(JSON.stringify(pkg).length < 2 * 1024 * 1024).toBeTruthy();
    // verify 'list of packages is as expected'
    expect(pkgsList(pkg).sort()).toEqual(
      JSON.parse(fs.readFileSync(expectedPkgsListFile, 'utf-8')).sort()
    );
  }, 300000);
});
