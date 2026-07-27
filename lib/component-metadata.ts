const H1_PREFIX = 'h1:';
const SHA256_BYTES = 32;
const GO_MOD_SUFFIX = '/go.mod';

// Hosts whose module path prefix maps directly onto a repository root, so a
// VCS URL can be derived from the module path alone (host/owner/repo). Vanity
// import paths (rsc.io, k8s.io, google.golang.org, gopkg.in, ...) do NOT map
// this way and are deliberately excluded — for those we only emit a vcs:url
// when go's own Origin metadata resolves it (see buildVcsUrl).
const KNOWN_VCS_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

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
 *   - `hash:sha-256` the module's file-tree hash, decoded to lowercase hex
 *   - `vcs:url`      the source repository URL for the module
 * `h1` is the module's `h1:` hash as recorded in go.sum. `originUrl` is the
 * repository URL from go's Origin metadata when available (see buildVcsUrl).
 * Either label is omitted when it cannot be produced (missing/invalid hash, or
 * no VCS URL that can be resolved).
 */
export function getComponentMetadataLabels(
  modulePath: string,
  h1: string | undefined,
  originUrl?: string,
): Record<string, string> {
  const labels: Record<string, string> = {};

  const sha256Hex = decodeH1ToSha256Hex(h1);
  if (sha256Hex) {
    labels['hash:sha-256'] = sha256Hex;
  }

  const vcsUrl = buildVcsUrl(modulePath, originUrl);
  if (vcsUrl) {
    labels['vcs:url'] = vcsUrl;
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
 * Resolve the source repository URL for a module version.
 *
 * Go records nothing about which GOPROXY entry served a module, so a proxy
 * download URL cannot be attributed reliably. The VCS location, however, is
 * stable provenance. We resolve it best-effort:
 *   1. `originUrl` — go's own Origin metadata (VCS URL), which is authoritative
 *      and resolves vanity paths (e.g. rsc.io/quote -> github.com/rsc/quote).
 *      Only present when the module was fetched `direct` or from a proxy that
 *      serves origin data; the public proxy.golang.org does not.
 *   2. otherwise derive host/owner/repo from the module path for well-known
 *      VCS hosts (see KNOWN_VCS_HOSTS).
 * Returns undefined when neither yields a URL (e.g. a vanity path fetched via a
 * proxy), rather than guessing a URL that would be misleading.
 */
export function buildVcsUrl(
  modulePath: string,
  originUrl?: string,
): string | undefined {
  return normalizeVcsUrl(originUrl) ?? deriveVcsUrlFromModulePath(modulePath);
}

// Sanitise a repository URL from go's Origin metadata: keep only http(s) URLs,
// strip any embedded basic-auth credentials (they must never reach component
// metadata, which is shipped off-host) and drop trailing slashes. Returns
// undefined for anything that is not a parseable http(s) URL (e.g. ssh/scp
// git remotes), leaving the caller to fall back to the path heuristic.
function normalizeVcsUrl(originUrl?: string): string | undefined {
  if (!originUrl || !/^https?:\/\//.test(originUrl)) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(originUrl);
  } catch {
    return undefined;
  }
  parsed.username = '';
  parsed.password = '';
  return parsed.toString().replace(/\/+$/, '');
}

// Derive a repository URL from a module path for well-known VCS hosts, where
// the repo root is host/owner/repo. This naturally handles submodule paths
// (github.com/o/r/sub) and the semantic-import-versioning suffix
// (github.com/o/r/v2), since both keep the repo root in the first three
// segments. Returns undefined for any other host.
function deriveVcsUrlFromModulePath(modulePath: string): string | undefined {
  const [host, owner, repo] = modulePath.split('/');
  if (!KNOWN_VCS_HOSTS.has(host) || !owner || !repo) {
    return undefined;
  }
  return `https://${host}/${owner}/${repo}`;
}
