import { test } from 'tap';
import {
  decodeH1ToSha256Hex,
  buildVcsUrl,
  getComponentMetadataLabels,
  parseGoSum,
} from '../lib/component-metadata';

// h1 value taken from a real go.sum (golang.org/x/text v0.3.2), with its
// base64 payload decoded to hex out of band.
const H1 = 'h1:tW2bmiBqwgJj/UpqtC8EpXEZVYOwU0yG4iWbprSVAcs=';
const H1_HEX =
  'b56d9b9a206ac20263fd4a6ab42f04a571195583b0534c86e2259ba6b49501cb';

test('parseGoSum', async (t) => {
  const hashes = parseGoSum(
    [
      'github.com/davecgh/go-spew v1.1.0 h1:ZDRjVQ15GmhC3fiQ8ni8+OwkZQO4DARzQgrnXU1Liz8=',
      'github.com/davecgh/go-spew v1.1.0/go.mod h1:J7Y8YcW2NihsgmVo/mv3lAwl/skON4iLHjSsI+c5H38=',
      'github.com/stretchr/objx v0.1.0/go.mod h1:HFkY916IF+rwdDfMAkV7OtwuqBVzrE8GR6GFx+wExME=',
      '',
      'garbage line',
      'golang.org/x/text v0.3.2 ' + H1,
    ].join('\n'),
  );

  t.equal(
    hashes['github.com/davecgh/go-spew@v1.1.0'],
    'h1:ZDRjVQ15GmhC3fiQ8ni8+OwkZQO4DARzQgrnXU1Liz8=',
    'keeps the module file-tree hash',
  );
  t.equal(hashes['golang.org/x/text@v0.3.2'], H1);
  t.notOk(
    hashes['github.com/stretchr/objx@v0.1.0'],
    'ignores go.mod-only entries',
  );
});

test('decodeH1ToSha256Hex', async (t) => {
  t.equal(
    decodeH1ToSha256Hex(H1),
    H1_HEX,
    'decodes a valid h1 to lowercase hex',
  );
  t.equal(decodeH1ToSha256Hex(undefined), undefined, 'undefined input');
  t.equal(
    decodeH1ToSha256Hex('tW2bmiBqwgJj/UpqtC8EpXEZVYOwU0yG4iWbprSVAcs='),
    undefined,
    'missing h1: prefix',
  );
  t.equal(
    decodeH1ToSha256Hex('h1:c2hvcnQ='),
    undefined,
    'decodes to fewer than 32 bytes',
  );
  t.equal(
    decodeH1ToSha256Hex('h1:not valid base64!!'),
    undefined,
    'malformed base64',
  );
});

test('buildVcsUrl', async (t) => {
  t.test('prefers go Origin metadata when present', async (t) => {
    t.equal(
      buildVcsUrl('rsc.io/quote', 'https://github.com/rsc/quote'),
      'https://github.com/rsc/quote',
      'origin resolves a vanity path the module path alone cannot',
    );
  });

  t.test('trims a trailing slash from the origin url', async (t) => {
    t.equal(
      buildVcsUrl('example.com/mod', 'https://git.example.com/team/mod/'),
      'https://git.example.com/team/mod',
    );
  });

  t.test('strips basic-auth credentials from the origin url', async (t) => {
    t.equal(
      buildVcsUrl(
        'example.com/mod',
        'https://foo:bar@git.example.com/team/mod',
      ),
      'https://git.example.com/team/mod',
      'credentials must never end up in component metadata',
    );
  });

  t.test('derives a url from the module path for known hosts', async (t) => {
    t.equal(
      buildVcsUrl('github.com/pkg/errors', undefined),
      'https://github.com/pkg/errors',
    );
    t.equal(
      buildVcsUrl('gitlab.com/team/project', undefined),
      'https://gitlab.com/team/project',
    );
    t.equal(
      buildVcsUrl('bitbucket.org/team/repo', undefined),
      'https://bitbucket.org/team/repo',
    );
  });

  t.test('reduces submodule and /vN paths to the repo root', async (t) => {
    t.equal(
      buildVcsUrl('github.com/foo/bar/v2', undefined),
      'https://github.com/foo/bar',
      'the semantic-import-versioning suffix is dropped',
    );
    t.equal(
      buildVcsUrl('github.com/foo/bar/submodule', undefined),
      'https://github.com/foo/bar',
      'a submodule path resolves to its repo root',
    );
  });

  t.test('returns undefined for a vanity path with no origin', async (t) => {
    // The public proxy serves no origin metadata, and rsc.io does not map to a
    // repo root — so rather than guess a wrong URL, emit nothing.
    t.equal(buildVcsUrl('rsc.io/quote', undefined), undefined);
    t.equal(buildVcsUrl('golang.org/x/text', undefined), undefined);
  });

  t.test('ignores a non-http(s) origin url', async (t) => {
    t.equal(
      buildVcsUrl('github.com/foo/bar', 'git@github.com:foo/bar.git'),
      'https://github.com/foo/bar',
      'falls back to the path heuristic for ssh/scp remotes',
    );
    t.equal(
      buildVcsUrl('example.com/mod', 'ssh://git@git.example.com/mod'),
      undefined,
      'no http(s) origin and no known host -> no label',
    );
  });
});

test('getComponentMetadataLabels', async (t) => {
  t.test('emits hash and vcs url when both are known', async (t) => {
    const labels = getComponentMetadataLabels(
      'github.com/pkg/errors',
      H1,
      undefined,
    );
    t.strictSame(labels, {
      'hash:sha-256': H1_HEX,
      'vcs:url': 'https://github.com/pkg/errors',
    });
  });

  t.test('omits the hash when the module has no hash', async (t) => {
    const labels = getComponentMetadataLabels(
      'github.com/pkg/errors',
      undefined,
      undefined,
    );
    t.strictSame(labels, {
      'vcs:url': 'https://github.com/pkg/errors',
    });
  });

  t.test('omits the vcs url when it cannot be resolved', async (t) => {
    const labels = getComponentMetadataLabels(
      'golang.org/x/text',
      H1,
      undefined,
    );
    t.strictSame(labels, { 'hash:sha-256': H1_HEX });
  });
});
