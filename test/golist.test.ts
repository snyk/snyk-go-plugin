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
      t.equal(
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
      t.equal(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });

    t.test('additional arguments are passed', async (t) => {
      const depGraph = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/args`,
        'go.mod',
        {
          additionalArgs: ['-e'],
        },
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
      t.equal(
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
      t.equal(
        JSON.stringify(depGraphAndNotice),
        JSON.stringify(expectedDepGraph),
      );
    });
    t.end();
  });
} else {
  test('go list parsing with module information', (t) => {
    t.rejects(
      buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-small`,
        undefined,
        {
          stdlibVersion: '1.10',
        },
      ),
      'throws on older Go versions',
    );
    t.end();
  });
}
