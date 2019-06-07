import * as fs from 'fs';
import { buildDepTreeFromImportsAndModules } from '../lib';
import { goVersion } from './go-version';
import { test } from 'tap';

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

if (goVersion[0] > 1 || goVersion[1] >= 12) {

  test('go list parsing', (t) => {
    t.test('produces dependency tree', async (t) => {
      // Note that this "tree" has no dependencies, because all the imported packages are either local or builtin.
      const expectedDepTree = JSON.parse(load('golist/import/expected-tree.json'));
      const depTreeAndNotice = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/golist/import`);
      t.deepEquals(depTreeAndNotice, expectedDepTree);
    });

    t.test('without .go files produces empty tree', async (t) => {
      const expectedDepTree = JSON.parse(load('golist/empty/expected-tree.json'));
      const depTreeAndNotice = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/golist/empty`);
      t.deepEquals(depTreeAndNotice, expectedDepTree);
    });

    t.end();
  });

  test('go list parsing with module information', (t) => {
    t.test('produces dependency tree', async (t) => {
      const expectedDepTree = JSON.parse(load('gomod-small/expected-tree.json'));
      const depTreeAndNotice = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/gomod-small`);
      t.deepEquals(depTreeAndNotice, expectedDepTree);
    });

    t.end();
  });

} else {

  test('go list parsing with module information', (t) => {
    t.rejects('throws on older Go versions', buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/gomod-small`));
    t.end();
  });
}
