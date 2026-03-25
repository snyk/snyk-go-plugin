import * as fs from 'fs';
import { buildDepGraphFromImportsAndModules } from '../lib';
import { resolveStdlibVersion } from '../lib/helpers';
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
        load('gomod-small/expected-gomodules-depgraph-no-purls.json'),
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

  test('go list parsing with edge cases', (t) => {
    t.test(
      'produces dependency graph',
      {
        skip: goVersion[0] <= 1 && goVersion[1] < 21,
      },
      async (t) => {
        const expectedDepGraph = JSON.parse(
          load('gomod-kitchen-sink/expected-depgraph.json'),
        );
        const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
          `${__dirname}/fixtures/gomod-kitchen-sink`,
        );
        t.equal(
          JSON.stringify(depGraphAndNotice),
          JSON.stringify(expectedDepGraph),
        );
      },
    );
    t.end();
  });

  // Two cmd mains, each with default.pgo: go list emits PGO ImportPath variants
  // (e.g. github.com/google/uuid [github.com/snyk-test/pgo-test/cmd/svc-a]).
  test('go list parsing with PGO fixture', (t) => {
    t.test(
      'produces dependency graph with normalised package IDs',
      {
        skip: goVersion[0] <= 1 && goVersion[1] < 21,
      },
      async (t) => {
        const expectedDepGraph = JSON.parse(
          load('gomod-pgo/expected-depgraph.json'),
        );
        const depGraph = await buildDepGraphFromImportsAndModules(
          `${__dirname}/fixtures/gomod-pgo`,
        );
        t.equal(JSON.stringify(depGraph), JSON.stringify(expectedDepGraph));
      },
    );

    t.test(
      'with includeGoStandardLibraryDeps: std packages (e.g. fmt) use clean names',
      {
        skip: goVersion[0] <= 1 && goVersion[1] < 21,
      },
      async (t) => {
        const root = `${__dirname}/fixtures/gomod-pgo`;
        const stdlibVersion = await resolveStdlibVersion(root, 'go.mod');
        const depGraph = await buildDepGraphFromImportsAndModules(
          root,
          'go.mod',
          {
            includeGoStandardLibraryDeps: true,
            stdlibVersion,
          },
        );
        const names = depGraph.getPkgs().map((p) => p.name);
        t.ok(
          names.every((n) => !n.includes(' [')),
          'no package name contains a PGO/test variant suffix',
        );
        t.ok(
          names.includes('std/fmt'),
          'stdlib fmt is present when flag is on',
        );
        t.ok(
          names.includes('github.com/google/uuid'),
          'module dependency uuid is still present',
        );
        t.end();
      },
    );
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
