import * as fs from 'fs';
import { buildDepTreeFromImports } from '../lib';
const test = require('tap').test;

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

test('go list parsing', (t) => {
  t.test('produces first level dependencies', async (t) => {
    const expectedDepTree = JSON.parse(load('golist/import/expected-tree.json'));
    const depTree = await buildDepTreeFromImports(`${__dirname}/fixtures/golist/import`);
    t.deepEquals(depTree, expectedDepTree);
  });

  t.test('without .go files produces empty tree', async (t) => {
    const expectedDepTree = JSON.parse(load('golist/empty/expected-tree.json'));
    const depTree = await buildDepTreeFromImports(`${__dirname}/fixtures/golist/empty`);
    t.deepEquals(depTree, expectedDepTree);
  });

  t.end();
});
