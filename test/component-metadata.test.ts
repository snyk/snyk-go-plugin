import { test } from 'tap';
import {
  decodeH1ToSha256Hex,
  escapeModulePath,
  buildDistributionUrl,
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

test('escapeModulePath', async (t) => {
  t.equal(
    escapeModulePath('github.com/BurntSushi/toml'),
    'github.com/!burnt!sushi/toml',
    'uppercase letters become !lowercase',
  );
  t.equal(
    escapeModulePath('golang.org/x/text'),
    'golang.org/x/text',
    'all-lowercase path is unchanged',
  );
});

test('buildDistributionUrl', async (t) => {
  t.test('defaults to proxy.golang.org when GOPROXY is empty', async (t) => {
    t.equal(
      buildDistributionUrl('golang.org/x/text', 'v0.3.2', undefined),
      'https://proxy.golang.org/golang.org/x/text/@v/v0.3.2.zip',
    );
  });

  t.test('honours an http(s) GOPROXY, taking the first entry', async (t) => {
    t.equal(
      buildDistributionUrl(
        'golang.org/x/text',
        'v0.3.2',
        'https://corp.example.com/goproxy/,direct',
      ),
      'https://corp.example.com/goproxy/golang.org/x/text/@v/v0.3.2.zip',
      'trailing slash trimmed, first list entry used',
    );
  });

  t.test('returns undefined for off/direct', async (t) => {
    t.equal(
      buildDistributionUrl('golang.org/x/text', 'v0.3.2', 'off'),
      undefined,
    );
    t.equal(
      buildDistributionUrl('golang.org/x/text', 'v0.3.2', 'direct'),
      undefined,
    );
  });

  t.test(
    'strips basic-auth credentials embedded in the GOPROXY url',
    async (t) => {
      t.equal(
        buildDistributionUrl(
          'golang.org/x/text',
          'v0.3.2',
          'https://foo:bar@corp.example.com/goproxy/',
        ),
        'https://corp.example.com/goproxy/golang.org/x/text/@v/v0.3.2.zip',
        'credentials must never end up in component metadata',
      );
    },
  );
});

test('getComponentMetadataLabels', async (t) => {
  t.test(
    'emits hash and distribution url when the module hash is known',
    async (t) => {
      const labels = getComponentMetadataLabels(
        'golang.org/x/text',
        'v0.3.2',
        H1,
        undefined,
      );
      t.strictSame(labels, {
        'hash:sha-256': H1_HEX,
        'distribution:url':
          'https://proxy.golang.org/golang.org/x/text/@v/v0.3.2.zip',
      });
    },
  );

  t.test('omits the hash when the module has no hash', async (t) => {
    const labels = getComponentMetadataLabels(
      'golang.org/x/text',
      'v0.3.2',
      undefined,
      undefined,
    );
    t.strictSame(labels, {
      'distribution:url':
        'https://proxy.golang.org/golang.org/x/text/@v/v0.3.2.zip',
    });
  });

  t.test('omits the url when GOPROXY offers nothing to derive', async (t) => {
    const labels = getComponentMetadataLabels(
      'golang.org/x/text',
      'v0.3.2',
      H1,
      'off',
    );
    t.strictSame(labels, { 'hash:sha-256': H1_HEX });
  });
});
