import * as fs from 'fs';
import * as path from 'path';
import { buildDepGraphFromImportsAndModules } from '../lib';
import { goVersion } from './go-version';
import { createFromJSON } from '@snyk/dep-graph';

const load = (filename: string) =>
  fs.readFileSync(path.resolve(__dirname, 'fixtures', filename), 'utf8');

if (goVersion[0] > 1 || goVersion[1] >= 12) {
  describe('go list parsing', () => {
    it('should produces dependency graph', async () => {
      // Note that this "graph" has no edges/deps, because all the imported packages are either local or builtin.
      const expectedDepGraph = createFromJSON(
        JSON.parse(load('golist/import/expected-depgraph.json'))
      );

      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/import`
      );

      expect(depGraphAndNotice.equals(expectedDepGraph)).toBeTruthy();
    });

    it('should produces an empty dependency graph when there are no .go files', async () => {
      const expectedDepGraph = createFromJSON(
        JSON.parse(load('golist/empty/expected-depgraph.json'))
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/golist/empty`
      );
      expect(depGraphAndNotice.equals(expectedDepGraph)).toBeTruthy();
    });
  });

  describe('go list parsing with module information', () => {
    it('should produces a dependency graph', async () => {
      const expectedDepGraph = createFromJSON(
        JSON.parse(load('gomod-small/expected-gomodules-depgraph.json'))
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-small`
      );
      expect(depGraphAndNotice.equals(expectedDepGraph)).toBeTruthy();
    });
  });
} else {
  it('should throw an exception on old versions when parsing with module information', async () => {
    const actual = await buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`
    );
    expect(actual).toThrow();
  });
}
