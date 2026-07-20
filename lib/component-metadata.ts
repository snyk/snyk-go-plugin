const H1_PREFIX = 'h1:';
const SHA256_BYTES = 32;
const DEFAULT_GOPROXY = 'https://proxy.golang.org';
const GO_MOD_SUFFIX = '/go.mod';

export type GoSumHashes = Record<string, string>;

/**
 * Parse a go.sum file into a map of `<module>@<version>` -> its file-tree
 * (`h1:`) hash. go.sum records two lines per module version:
 *   <module> <version> h1:<base64>=          -> the module .zip hash (kept here)
 *   <module> <version>/go.mod h1:<base64>=   -> the go.mod hash (ignored)
 * We read the hash from go.sum rather than `go list` because `Module.Sum` is
 * only emitted by go >= 1.23, whereas the go.sum format is stable across all
 * supported go versions. See https://go.dev/ref/mod#go-sum-files
 */
export function parseGoSum(goSumContents: string): GoSumHashes {
  const hashes: GoSumHashes = {};
  for (const rawLine of goSumContents.split('\n')) {
    const [modulePath, versionField, hash] = rawLine.trim().split(/\s+/);
    if (!modulePath || !versionField || !hash) {
      continue; // blank or malformed line
    }
    if (versionField.endsWith(GO_MOD_SUFFIX)) {
      continue; // go.mod hash, not the module file-tree hash
    }
    hashes[`${modulePath}@${versionField}`] = hash;
  }
  return hashes;
}

/**
 * Build the component-metadata labels for a single Go module version. Produces:
 *   - `hash:sha-256`     the module's file-tree hash, decoded to lowercase hex
 *   - `distribution:url` the module proxy download URL for the .zip
 * `h1` is the module's `h1:` hash as recorded in go.sum. `goproxy` is the
 * effective GOPROXY value as reported by `go env GOPROXY` (see
 * buildDistributionUrl). Either label is omitted when it cannot be produced
 * (missing/invalid hash, or no proxy to derive a URL from).
 */
export function getComponentMetadataLabels(
  modulePath: string,
  version: string,
  h1: string | undefined,
  goproxy?: string,
): Record<string, string> {
  const labels: Record<string, string> = {};

  const sha256Hex = decodeH1ToSha256Hex(h1);
  if (sha256Hex) {
    labels['hash:sha-256'] = sha256Hex;
  }

  const distributionUrl = buildDistributionUrl(modulePath, version, goproxy);
  if (distributionUrl) {
    labels['distribution:url'] = distributionUrl;
  }

  return labels;
}

/**
 * A go module `h1:` hash is the base64-encoded SHA-256 of the module's dirhash
 * manifest (see https://go.dev/ref/mod#go-sum-files). SBOM consumers expect a
 * lowercase hex digest, so decode base64 -> hex. Returns undefined when the
 * value is missing or not a well-formed 32-byte digest.
 */
export function decodeH1ToSha256Hex(h1?: string): string | undefined {
  if (!h1 || !h1.startsWith(H1_PREFIX)) {
    return undefined;
  }
  const base64 = h1.slice(H1_PREFIX.length);
  const buf = Buffer.from(base64, 'base64');
  // Guard against short/garbage input: require an exact SHA-256 digest and a
  // clean base64 round-trip (Buffer.from is otherwise lenient).
  if (buf.length !== SHA256_BYTES || buf.toString('base64') !== base64) {
    return undefined;
  }
  return buf.toString('hex');
}

/**
 * Derive the module proxy download URL for a module version, e.g.
 * https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.2.3.zip
 * `goproxy` is the effective GOPROXY value as reported by `go env GOPROXY`
 * (which already applies env-var > go-env-file > built-in-default precedence).
 * Honours it when it points at an http(s) proxy; returns undefined for
 * `off`/`direct`/private setups where a public URL would be misleading.
 */
export function buildDistributionUrl(
  modulePath: string,
  version: string,
  goproxy?: string,
): string | undefined {
  const proxy = resolveGoProxyBase(goproxy);
  if (!proxy) {
    return undefined;
  }
  return `${proxy}/${escapeModulePath(modulePath)}/@v/${escapeModulePath(
    version,
  )}.zip`;
}

function resolveGoProxyBase(goproxy: string | undefined): string | undefined {
  if (!goproxy) {
    // `go env GOPROXY` returned nothing (or the lookup failed): fall back to
    // the public proxy, which is also go's built-in default.
    return DEFAULT_GOPROXY;
  }
  // GOPROXY is a list separated by commas or pipes; the first entry wins.
  const first = goproxy.split(/[,|]/)[0].trim();
  if (!/^https?:\/\//.test(first)) {
    // "off", "direct", "none" or empty: no proxy URL we can safely derive.
    return undefined;
  }
  return first.replace(/\/+$/, '');
}

/**
 * Go escapes module paths and versions for case-insensitive filesystems by
 * replacing each uppercase letter with `!` followed by its lowercase form.
 * See https://go.dev/ref/mod#goproxy-protocol
 */
export function escapeModulePath(value: string): string {
  return value.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase());
}
