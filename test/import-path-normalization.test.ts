import { test } from 'tap';
import { DepGraphBuilder } from '@snyk/dep-graph';
import { buildGraph } from '../lib';
import { GoPackage } from '../lib/types';

function makePkg(
  importPath: string,
  modulePath: string,
  version: string,
  imports: string[] = [],
): GoPackage {
  return {
    ImportPath: importPath,
    Name: importPath.split('/').pop()?.split(' ')[0] || 'pkg', // Extract the package name: take the last path segment, then strip any variant annotation
    Dir: '',
    DepOnly: true,
    Standard: false,
    Module: {
      Path: modulePath,
      Version: version,
      Versions: [],
      Replace: null as any,
      Time: '',
      Update: null as any,
      Main: false,
      Indirect: false,
      Dir: '',
      GoMod: '',
      Error: '',
    },
    Imports: imports,
    ImportMap: {} as any,
    Deps: [],
    TestImports: [],
    XTestImports: [],
    Incomplete: false,
    Error: null as any,
    DepsErrors: [],
  };
}

const GRAPH_OPTIONS = {
  stdlibVersion: 'unknown',
  additionalArgs: [],
  includeGoStandardLibraryDeps: false,
  includePackageUrls: false,
  useReplaceName: false,
};

function makeBuilder() {
  return new DepGraphBuilder(
    { name: 'gomodules' },
    { name: 'root', version: '0.0.0' },
  );
}

// Baseline: a package with a clean ImportPath produces the correct node in the graph.
test('clean ImportPath produces the correct package ID in the graph', (t) => {
  const pkg = makePkg(
    'cloud.google.com/go/pubsub/v2',
    'cloud.google.com/go/pubsub',
    'v1.30.0',
  );

  const builder = makeBuilder();
  const packagesByName = { 'cloud.google.com/go/pubsub/v2': pkg };

  buildGraph(
    builder,
    ['cloud.google.com/go/pubsub/v2'],
    packagesByName,
    'root-node',
    new Map(),
    new Map(),
    GRAPH_OPTIONS,
  );

  const pkgIds = builder
    .build()
    .toJSON()
    .pkgs.map((p) => p.id);
  t.ok(
    pkgIds.includes('cloud.google.com/go/pubsub/v2@1.30.0'),
    'package ID matches the clean import path and version',
  );
  t.end();
});

// When a package's Imports array contains a PGO variant annotation
// (e.g., "pkg/path [owner/cmd]"), the bracketed suffix must be stripped before
// looking the package up in packagesByName (which is keyed by clean paths).
// Without normalisation at this point the transitive dependency would be silently
// dropped from the graph.
test('PGO variant annotation in Imports array is normalised when resolving transitive deps', (t) => {
  const middleman = makePkg(
    'acme.io/middleman',
    'acme.io/middleman',
    'v1.0.0',
    // Raw go list output: pubsub was recompiled as a PGO variant for this owner
    ['cloud.google.com/go/pubsub/v2 [acme.io/app/cmd/pubsub]'],
  );
  const pubsub = makePkg(
    'cloud.google.com/go/pubsub/v2',
    'cloud.google.com/go/pubsub',
    'v1.30.0',
  );

  const builder = makeBuilder();
  const packagesByName = {
    'acme.io/middleman': middleman,
    'cloud.google.com/go/pubsub/v2': pubsub, // keyed by CLEAN path
  };

  buildGraph(
    builder,
    ['acme.io/middleman'],
    packagesByName,
    'root-node',
    new Map(),
    new Map(),
    GRAPH_OPTIONS,
  );

  const pkgIds = builder
    .build()
    .toJSON()
    .pkgs.map((p) => p.id);
  t.ok(
    pkgIds.includes('cloud.google.com/go/pubsub/v2@1.30.0'),
    'transitive dep referenced via a PGO variant is resolved and appears in the graph',
  );
  t.notOk(
    pkgIds.some((id) => id.includes(' [')),
    'no bracketed variant annotation appears in any graph package ID',
  );
  t.end();
});

// Go also appends a test-variant annotation when dependencies are recompiled for
// a test binary (e.g., "pkg/path [pkg/path.test]"). The same stripping logic must
// handle this format.
test('test variant annotation [pkg.test] in Imports array is normalised', (t) => {
  const parent = makePkg(
    'acme.io/some-pkg',
    'acme.io/some-pkg',
    'v1.0.0',
    // Dep recompiled for the test binary of its owner
    ['github.com/some/dep [github.com/some/dep.test]'],
  );
  const dep = makePkg('github.com/some/dep', 'github.com/some/dep', 'v2.0.0');

  const builder = makeBuilder();
  const packagesByName = {
    'acme.io/some-pkg': parent,
    'github.com/some/dep': dep,
  };

  buildGraph(
    builder,
    ['acme.io/some-pkg'],
    packagesByName,
    'root-node',
    new Map(),
    new Map(),
    GRAPH_OPTIONS,
  );

  const pkgIds = builder
    .build()
    .toJSON()
    .pkgs.map((p) => p.id);
  t.ok(
    pkgIds.includes('github.com/some/dep@2.0.0'),
    'dep referenced via a test variant annotation is resolved to its clean path',
  );
  t.notOk(
    pkgIds.some((id) => id.includes(' [')),
    'no test variant annotation appears in any graph package ID',
  );
  t.end();
});

// When PGO is active, go list may output the same underlying package as multiple
// differently-owned variants (e.g., compiled once per main package that imports it).
// After stripping annotations these all collapse to the same clean path. The Set
// deduplication in buildGraph must ensure only a single graph node is created.
test('multiple PGO variants of the same package are deduplicated into a single graph node', (t) => {
  const parent = makePkg('acme.io/some-pkg', 'acme.io/some-pkg', 'v1.0.0', [
    'cloud.google.com/go/pubsub/v2 [acme.io/app/cmd/pubsub]',
    'cloud.google.com/go/pubsub/v2 [acme.io/app/cmd/worker]', // same package, different owner
  ]);
  const pubsub = makePkg(
    'cloud.google.com/go/pubsub/v2',
    'cloud.google.com/go/pubsub',
    'v1.30.0',
  );

  const builder = makeBuilder();
  const packagesByName = {
    'acme.io/some-pkg': parent,
    'cloud.google.com/go/pubsub/v2': pubsub,
  };

  buildGraph(
    builder,
    ['acme.io/some-pkg'],
    packagesByName,
    'root-node',
    new Map(),
    new Map(),
    GRAPH_OPTIONS,
  );

  const pkgIds = builder
    .build()
    .toJSON()
    .pkgs.map((p) => p.id);
  const pubsubEntries = pkgIds.filter((id) =>
    id.startsWith('cloud.google.com/go/pubsub/v2'),
  );
  t.equal(
    pubsubEntries.length,
    1,
    'two differently-owned variants of the same package produce exactly one graph node',
  );
  t.end();
});

// A package may appear in Imports both as a clean path and as a bracketed variant
// (e.g., if it is imported both directly and transitively through a PGO-compiled path).
// After normalisation the Set deduplication must collapse these to one entry.
test('a clean and a bracketed reference to the same package are treated as one dep', (t) => {
  const parent = makePkg('acme.io/some-pkg', 'acme.io/some-pkg', 'v1.0.0', [
    'cloud.google.com/go/pubsub/v2', // clean reference
    'cloud.google.com/go/pubsub/v2 [acme.io/app/cmd/pubsub]', // bracketed reference
  ]);
  const pubsub = makePkg(
    'cloud.google.com/go/pubsub/v2',
    'cloud.google.com/go/pubsub',
    'v1.30.0',
  );

  const builder = makeBuilder();
  const packagesByName = {
    'acme.io/some-pkg': parent,
    'cloud.google.com/go/pubsub/v2': pubsub,
  };

  buildGraph(
    builder,
    ['acme.io/some-pkg'],
    packagesByName,
    'root-node',
    new Map(),
    new Map(),
    GRAPH_OPTIONS,
  );

  const pkgIds = builder
    .build()
    .toJSON()
    .pkgs.map((p) => p.id);
  const pubsubEntries = pkgIds.filter((id) =>
    id.startsWith('cloud.google.com/go/pubsub/v2'),
  );
  t.equal(
    pubsubEntries.length,
    1,
    'a clean and a bracketed reference to the same package produce exactly one graph node',
  );
  t.end();
});
