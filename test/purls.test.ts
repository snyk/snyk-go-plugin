import * as fs from 'fs';
import { test } from 'tap';
import { createFromJSON } from '@snyk/dep-graph';

import { buildDepGraphFromImportsAndModules } from '../lib';

const load = (filename: string) =>
  fs.readFileSync(`${__dirname}/fixtures/${filename}`, 'utf8');

test('dependency graph with package urls', (t) => {
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

  t.test('produces a dependency graph with package urls', async (t) => {
    const expectedDepGraph = JSON.parse(
      load('gomod-small/expected-gomodules-depgraph-with-purls.json'),
    );
    const depGraph = await buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`,
      undefined,
      { includePackageUrls: true },
    );
    t.equal(JSON.stringify(depGraph), JSON.stringify(expectedDepGraph));
  });

  t.end();
});
