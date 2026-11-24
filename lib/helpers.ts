import * as fs from 'fs';
import * as path from 'path';
import * as subProcess from './sub-process';
import debugLib = require('debug');
const debug = debugLib('snyk-go-plugin');

export interface ResolveStdlibVersionOptions {
  /**
   * Derive the version from go.mod only (`toolchain`, then `go` directive)
   * and use `go version` as the last resort. When false, only a full
   * `toolchain goX.Y.Z` line is read from go.mod.
   */
  fromGoMod?: boolean;
  /**
   * Latest patch version per minor, keyed by 'X.Y' (e.g. { '1.22': '1.22.12' }).
   * Used with `fromGoMod` when go.mod gives no patch. A minor that is not
   * listed maps to X.Y.0.
   */
  latestPatchVersions?: Record<string, string>;
}

/**
 * Determine the Go tool-chain version (e.g. "1.22.2") to be used
 * as a surrogate version for standard-library packages.
 *
 * 1. Looks for a `toolchain goX.Y.Z` directive in `go.mod`.
 * 2. Falls back to the `go version` output when the directive is absent.
 *
 * With `fromGoMod`, step 1 also accepts `toolchain goX.Y` and the `go`
 * directive. A version without patch maps to `latestPatchVersions[X.Y]`, else X.Y.0.
 *
 * Returns the version **without** the leading `go` prefix or
 * the string `unknown` when the version cannot be resolved.
 */
export async function resolveStdlibVersion(
  root: string,
  targetFile: string,
  options: ResolveStdlibVersionOptions = {},
): Promise<string> {
  if (options.fromGoMod) {
    const fromGoMod = readVersionFromGoMod(
      root,
      targetFile,
      options.latestPatchVersions,
    );
    if (fromGoMod) {
      return fromGoMod;
    }
    return resolveFromGoVersionCommand(root);
  }

  // 1) Try to read from go.mod the toolchian version e.g.`toolchain goX.Y.Z`
  let toolChainMatch: RegExpMatchArray | null = null;

  try {
    const goModPath = path.resolve(root, targetFile);
    const goModContent = fs.readFileSync(goModPath, 'utf8');
    toolChainMatch = /^\s*toolchain\s+go(\d+\.\d+\.\d+)/m.exec(goModContent);
    if (toolChainMatch) {
      debug('Found toolchain in go.mod', { toolChainMatch });
      return toolChainMatch[1]; // already without the "go" prefix
    }
  } catch {
    // ignore, fall back to 2)
    debug('Failed to read toolchain from go.mod', { toolChainMatch });
  }

  // 2) Try to read from the `go version` command output
  return resolveFromGoVersionCommand(root);
}

async function resolveFromGoVersionCommand(root: string): Promise<string> {
  const output = await subProcess.execute('go', ['version'], { cwd: root });
  const versionMatch = /\d+\.\d+(\.\d+)?/.exec(output)![0];
  if (versionMatch) {
    debug('Found go version', { versionMatch });
    return versionMatch; // already without the "go" prefix
  }

  return 'unknown';
}

const GO_VERSION_PATTERN = '(\\d+)\\.(\\d+)(?:\\.(\\d+))?(?:(rc|beta)(\\d+))?';
const TOOLCHAIN_REGEX = new RegExp(
  `^\\s*toolchain\\s+go${GO_VERSION_PATTERN}`,
  'm',
);
const GO_DIRECTIVE_REGEX = new RegExp(`^\\s*go\\s+${GO_VERSION_PATTERN}`, 'm');

function readVersionFromGoMod(
  root: string,
  targetFile: string,
  latestPatchVersions: Record<string, string> = {},
): string | null {
  let content: string;
  try {
    content = fs.readFileSync(path.resolve(root, targetFile), 'utf8');
  } catch {
    debug('Failed to read go.mod', { root, targetFile });
    return null;
  }

  const match =
    TOOLCHAIN_REGEX.exec(content) || GO_DIRECTIVE_REGEX.exec(content);
  if (!match) {
    return null;
  }
  const [, major, minor, patch, preKind, preNumber] = match;
  if (preKind) {
    // Pre-release of the .0 release, e.g. go1.22rc1 -> 1.22.0-rc1
    return `${major}.${minor}.${patch ?? '0'}-${preKind}${preNumber}`;
  }
  if (patch !== undefined) {
    return `${major}.${minor}.${patch}`;
  }
  const minorKey = `${major}.${minor}`;
  return Object.prototype.hasOwnProperty.call(latestPatchVersions, minorKey)
    ? latestPatchVersions[minorKey]
    : `${minorKey}.0`;
}

// Better error message than JSON.parse
export function jsonParse<T = any>(s: string): T {
  try {
    return JSON.parse(s);
  } catch (e: any) {
    e.message = e.message + ', original string: "' + s + '"';
    throw e;
  }
}

export function pathToPosix(fpath: string): string {
  const parts = fpath.split(path.sep);
  return parts.join(path.posix.sep);
}
