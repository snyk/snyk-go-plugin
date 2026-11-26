import { test } from 'tap';

import { buildDepGraphFromImportsAndModules, inspect } from '../lib';

const SHA256_HEX = /^[0-9a-f]{64}$/;

// Ensure the module proxy URL is deterministic regardless of the host's GOPROXY.
test('component metadata labels on the go modules graph', async (t) => {
  const originalGoProxy = process.env.GOPROXY;
  process.env.GOPROXY = 'https://proxy.golang.org';
  t.teardown(() => {
    if (originalGoProxy === undefined) {
      delete process.env.GOPROXY;
    } else {
      process.env.GOPROXY = originalGoProxy;
    }
  });

  const build = (includeComponentMetadata: boolean) =>
    buildDepGraphFromImportsAndModules(
      `${__dirname}/fixtures/gomod-small`,
      undefined,
      { includePackageUrls: true, includeComponentMetadata },
    );

  const withMetadata = (await build(true)).toJSON();
  const withoutMetadata = (await build(false)).toJSON();

  const labelsOf = (json: any) =>
    json.graph.nodes.map((n: any) => n.info?.labels || {});

  // The flag only adds labels; the graph shape is unchanged.
  t.equal(
    withMetadata.graph.nodes.length,
    withoutMetadata.graph.nodes.length,
    'node count is unchanged',
  );

  const hashed = labelsOf(withMetadata).filter((l: any) => l['hash:sha-256']);
  t.ok(hashed.length > 0, 'at least one node carries a hash:sha-256 label');
  for (const l of hashed) {
    t.match(l['hash:sha-256'], SHA256_HEX, 'hash is a lowercase sha-256 hex');
  }

  // The fixture depends on github.com modules, whose vcs:url is derived from
  // the module path (the public proxy serves no origin metadata). Assert at
  // least one such repo URL is present and well formed.
  const vcsUrls = labelsOf(withMetadata)
    .map((l: any) => l['vcs:url'])
    .filter(Boolean);
  t.ok(vcsUrls.length > 0, 'at least one node carries a vcs:url label');
  for (const url of vcsUrls) {
    t.match(
      url,
      /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+$/,
      'vcs url is a repo root on a known host',
    );
  }

  // Disabled: no component metadata labels at all (pruned labels may remain).
  for (const l of labelsOf(withoutMetadata)) {
    t.notOk(l['hash:sha-256'], 'no hash label when disabled');
    t.notOk(l['vcs:url'], 'no vcs url when disabled');
  }
});

// Exercises the full plugin (`inspect`) with the CLI-facing option shape:
// `includeComponentMetadata` at the top level, matching how the CLI forwards
// it (get-single-plugin-result.ts) and how the other plugins read it
// (snyk-mvn-plugin, snyk-nodejs-plugin). This is the path the unit test above
// does not cover, since it calls the internal builder with a flat shape.
test('inspect() reads includeComponentMetadata from the top level', async (t) => {
  const originalGoProxy = process.env.GOPROXY;
  process.env.GOPROXY = 'https://proxy.golang.org';
  t.teardown(() => {
    if (originalGoProxy === undefined) {
      delete process.env.GOPROXY;
    } else {
      process.env.GOPROXY = originalGoProxy;
    }
  });

  const root = `${__dirname}/fixtures/gomod-small`;
  const hashCount = async (options: any) => {
    const { dependencyGraph } = await inspect(root, 'go.mod', options);
    return dependencyGraph!
      .toJSON()
      .graph.nodes.filter((n: any) => n.info?.labels?.['hash:sha-256']).length;
  };

  t.ok(
    (await hashCount({ includeComponentMetadata: true })) > 0,
    'top-level includeComponentMetadata attaches hash:sha-256 labels',
  );

  // Regression guard: the flag no longer lives under `configuration`, so a
  // nested value must be ignored — keeps the plugin aligned with the shared
  // top-level convention used by the other plugins.
  t.equal(
    await hashCount({ configuration: { includeComponentMetadata: true } }),
    0,
    'nested configuration.includeComponentMetadata is ignored',
  );
});
