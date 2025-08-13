import * as fs from 'fs';
import { buildDepGraphFromImportsAndModules } from '../lib';
import { goVersion } from './go-version';
import { test } from 'tap';

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

if (goVersion[0] > 1 || goVersion[1] >= 12) {
  test('go list parsing', (t) => {
    t.test('produces dependency graph', async (t) => {
      // Note that this "graph" has no edges/deps, because all the imported packages are either local or builtin.
      const expectedDepGraph = JSON.parse(
        load('golist/import/expected-depgraph.json'),
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/import`,
      );
      t.deepEquals(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });

    t.test('without .go files produces empty graph', async (t) => {
      const expectedDepGraph = JSON.parse(
        load('golist/empty/expected-depgraph.json'),
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/empty`,
      );
      t.deepEquals(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });

    t.test('additional arguments are passed', async (t) => {
      const depGraph = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/args`,
        'go.mod',
        { args: ['-e'] },
      );
      t.ok('should pass when -e argument is passed', depGraph);
    });

    t.end();
  });

  test('go list parsing with module information', (t) => {
    t.test('produces dependency graph', async (t) => {
      const expectedDepGraph = JSON.parse(
        load('gomod-small/expected-gomodules-depgraph.json'),
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-small`,
      );
      t.deepEquals(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });
    t.end();
  });

  test('go list parsing with replace directive', (t) => {
    t.test('produces dependency graph', async (t) => {
      const expectedDepGraph = JSON.parse(
        load('gomod-replace/expected-depgraph.json'),
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-replace`,
      );
      t.deepEquals(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });
    t.end();
  });
} else {
  test('go list parsing with module information', (t) => {
    t.rejects(
      'throws on older Go versions',
      buildDepGraphFromImportsAndModules(`${__dirname}/fixtures/gomod-small`),
    );
    t.end();
  });
}
