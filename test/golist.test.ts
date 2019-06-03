import * as fs from 'fs';
import { buildDepTreeFromImportsAndModules } from '../lib';
const test = require('tap').test;

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

if (process.env.GO_VERSION) {
  const goVersion = process.env.GO_VERSION.split('.').map(Number);

  if (goVersion[0] > 1 || goVersion[1] >= 12) {

    test('go list parsing', (t) => {
      t.test('produces first level dependencies', async (t) => {
        const expectedDepTree = JSON.parse(load('golist/import/expected-tree.json'));
        const depTree = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/golist/import`);
        t.deepEquals(depTree, expectedDepTree);
      });

      t.test('without .go files produces empty tree', async (t) => {
        const expectedDepTree = JSON.parse(load('golist/empty/expected-tree.json'));
        const depTree = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/golist/empty`);
        t.deepEquals(depTree, expectedDepTree);
      });

      t.end();
    });

    test('go list parsing with module information', (t) => {
      t.test('produces first level dependencies', async (t) => {
        const expectedDepTree = JSON.parse(load('gomod-small/expected-tree.json'));
        const depTree = await buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/gomod-small`);
        t.deepEquals(depTree, expectedDepTree);
      });

      t.end();
    });

  } else {

    test('go list parsing with module information', (t) => {
      t.rejects('throws on older Go versions', buildDepTreeFromImportsAndModules(`${__dirname}/fixtures/gomod-small`));
      t.end();
    });
  }
}