import * as fs from 'fs';
import { skip, test } from 'tap';
import { createFromJSON } from '@snyk/dep-graph';

import { buildDepGraphFromImportsAndModules } from '../lib';
import { createGoPurl } from '../lib/package-url';
import { goVersion } from './go-version';

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

test('purls for go modules', async (t) => {
  t.test('simple module', async (t) => {
    const expected = 'pkg:golang/foo@v0.0.0';
    const actual = createGoPurl({ Path: 'foo', Version: 'v0.0.0' });
    t.equal(actual, expected);
  });

  t.test('module with namespace', async (t) => {
    const expected = 'pkg:golang/github.com/foo/bar@v0.0.0';
    const actual = createGoPurl({
      Path: 'github.com/foo/bar',
      Version: 'v0.0.0',
    });
    t.equal(actual, expected);
  });

  t.test('module with alternative import path', async (t) => {
    const expected = 'pkg:golang/github.com/foo/bar@v0.0.0#pkg/baz/quux';
    const actual = createGoPurl(
      { Path: 'github.com/foo/bar', Version: 'v0.0.0' },
      { name: 'github.com/foo/bar/pkg/baz/quux' },
    );
    t.equal(actual, expected);
  });

  t.test('module with problematic name', async (t) => {
    const expected = 'pkg:golang/foo@v0.0.0';
    const actual = createGoPurl({ Path: '/foo', Version: 'v0.0.0' });
    t.equal(actual, expected);
  });
});

test('dependency graph with package urls', async (t) => {
  t.test('produces a valid dependency graph', async (t) => {
    const depGraph = await buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`,
      undefined,
      { includePackageUrls: true },
    );
    try {
      createFromJSON(depGraph.toJSON());
      t.pass('produces valid dep-graph data');
    } catch (e) {
      t.fail('does not produce a valid dep-graph', (e as any).message);
    }
  });

  t.test(
    'produces a valid dependency graph with edge cases',
    {
      skip: goVersion[0] <= 1 && goVersion[1] < 21,
    },
    async (t) => {
      const expectedDepGraph = JSON.parse(
        load('gomod-kitchen-sink/expected-depgraph-with-purls.json'),
      );
      const depGraph = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-kitchen-sink`,
        undefined,
        {
          includePackageUrls: true,
          // Temporary: this is required for purl generation.
          useReplaceName: true,
        },
      );
      try {
        const actualDepGraph = createFromJSON(depGraph.toJSON());
        t.equal(
          JSON.stringify(actualDepGraph),
          JSON.stringify(expectedDepGraph),
        );
        t.pass('produces valid dep-graph data');
      } catch (e) {
        t.fail('does not produce a valid dep-graph', (e as any).message);
      }
    },
  );

  t.test('produces a dependency graph with package urls', async (t) => {
    const expectedDepGraph = JSON.parse(
      load('gomod-small/expected-gomodules-depgraph.json'),
    );
    const depGraph = await buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`,
      undefined,
      { includePackageUrls: true },
    );
    t.equal(JSON.stringify(depGraph), JSON.stringify(expectedDepGraph));
  });

  t.test('produces a dependency graph without package urls', async (t) => {
    const expectedDepGraph = JSON.parse(
      load('gomod-small/expected-gomodules-depgraph-no-purls.json'),
    );
    const depGraph = await buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`,
      undefined,
      { includePackageUrls: false },
    );
    t.equal(JSON.stringify(depGraph), JSON.stringify(expectedDepGraph));
  });
});
