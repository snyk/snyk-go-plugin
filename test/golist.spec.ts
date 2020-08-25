import * as fs from 'fs';
import * as path from 'path';
import { buildDepGraphFromImportsAndModules } from '../lib';
import { goVersion } from './go-version';

const latestGoVersions = goVersion[0] > 1 || goVersion[1] >= 12;
const load = (filename: string) =>
  fs.readFileSync(path.resolve(__dirname, 'fixtures', filename), 'utf8');

const TIMEOUT = 10000;

if (latestGoVersions) {
  describe('parsing different go versions', () => {
    it(
      'should produces dependency graph',
      async () => {
        // Note that this "graph" has no edges/deps, because all the imported packages are either local or builtin.
        const expectedDepGraph = JSON.parse(
          load('golist/import/expected-depgraph.json')
        );
        const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
          `${__dirname}/fixtures/golist/import`
        );
        expect(JSON.stringify(depGraphAndNotice)).toBe(
          JSON.stringify(expectedDepGraph)
        );
      },
      TIMEOUT
    );

    it(
      'should produces an empty dependency graph when there are no .go files',
      async () => {
        const expectedDepGraph = JSON.parse(
          load('golist/empty/expected-depgraph.json')
        );
        const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
          `${__dirname}/fixtures/golist/empty`
        );
        expect(JSON.stringify(depGraphAndNotice)).toBe(
          JSON.stringify(expectedDepGraph)
        );
      },
      TIMEOUT
    );

    it('should produces a dependency graph when using module information', async () => {
      const expectedDepGraph = JSON.parse(
        load('gomod-small/expected-gomodules-depgraph.json')
      );
      const depGraphAndNotice = await buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-small`
      );
      expect(JSON.stringify(depGraphAndNotice)).toBe(
        JSON.stringify(expectedDepGraph)
      );
    }, 120000);
  });
} else {
  it(
    'should throw an exception on old versions when parsing with module information',
    async () => {
      const actual = buildDepGraphFromImportsAndModules(
        `${__dirname}/fixtures/gomod-small`
      );
      expect(actual).rejects.toThrow();
    },
    TIMEOUT
  );
}
