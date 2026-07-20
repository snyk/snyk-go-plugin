// test/debug.test.ts
import { test } from 'tap';
import * as path from 'path';
import { inspect } from '../lib';
import { goVersion, fullGoVersion } from './go-version';

const targetFile = 'go.mod';

async function fetchGraph(fixture: string, includeStd: boolean) {
  const { dependencyGraph } = await inspect(
    path.join(__dirname, 'fixtures', fixture),
    targetFile,
    {
      configuration: { includeGoStandardLibraryDeps: includeStd },
    } as any,
  );

  return dependencyGraph!;
}

const [major, minor] = goVersion;
const skipTest = major < 1 || (major === 1 && minor < 21);

// Test gomodules with the toolchain specified in go.mod
test(
  'std-lib inclusion flag works for fixture: gomod-simple-toolchain',
  {
    skip: skipTest
      ? 'Go version < 1.21 does not support toolchain directive'
      : false,
  },
  async (t) => {
    const graphWith = await fetchGraph('gomod-simple-toolchain', true);
    const verTool = graphWith
      .getPkgs()
      .find((p) => p.name === 'std/fmt')?.version;
    t.equal(verTool, '1.24.2', 'fmt present with correct version when flag on');

    const graphWithout = await fetchGraph('gomod-simple-toolchain', false);
    t.notOk(
      graphWithout.getPkgs().some((p) => p.name === 'std/fmt'),
      'fmt not present when flag off',
    );
  },
);

// Test gomodules without the toolchain specified in go.mod
test('std-lib inclusion flag works for fixture: gomod-simple', async (t) => {
  const graphWith = await fetchGraph('gomod-simple', true);
  const verDir = graphWith.getPkgs().find((p) => p.name === 'std/fmt')?.version;
  t.ok(
    verDir?.startsWith('1.'),
    'fmt present with correct version when flag on',
  );

  const graphWithout = await fetchGraph('gomod-simple', false);
  t.notOk(
    graphWithout.getPkgs().some((p) => p.name === 'std/fmt'),
    'fmt not present when flag off',
  );
});

// Standard library packages are toolchain-provided, not proxy-distributed and
// with no go.sum/Module.Sum hash, so they must never carry component-metadata
// labels — even with includeComponentMetadata enabled. Guards against a future
// change accidentally attaching a bogus proxy URL / hash to std nodes.
test('std-lib packages carry no component-metadata labels', async (t) => {
  const { dependencyGraph } = await inspect(
    path.join(__dirname, 'fixtures', 'gomod-simple'),
    targetFile,
    {
      configuration: { includeGoStandardLibraryDeps: true },
      includeComponentMetadata: true,
    } as any,
  );

  const stdNodes = dependencyGraph!
    .toJSON()
    .graph.nodes.filter((n) => n.pkgId.startsWith('std/'));

  t.ok(stdNodes.length > 0, 'graph contains standard library nodes to check');
  for (const node of stdNodes) {
    const labels = node.info?.labels || {};
    t.notOk(labels['hash:sha-256'], `${node.pkgId} has no hash:sha-256 label`);
    t.notOk(
      labels['distribution:url'],
      `${node.pkgId} has no distribution:url label`,
    );
  }
});
