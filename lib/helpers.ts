import * as fs from 'fs';
import * as path from 'path';
import * as subProcess from './sub-process';
import debugLib = require('debug');
const debug = debugLib('snyk-go-plugin');

/**
 * Determine the Go tool-chain version (e.g. "1.22.2") to be used
 * as a surrogate version for standard-library packages.
 *
 * 1. Looks for a `toolchain goX.Y.Z` directive in `go.mod`.
 * 2. Falls back to the `go version` output when the directive is absent.
 *
 * Returns the version **without** the leading `go` prefix or
 * the string `unknown` when the version cannot be resolved.
 */
export async function resolveStdlibVersion(
  root: string,
  targetFile: string,
): Promise<string> {
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
  const output = await subProcess.execute('go', ['version'], { cwd: root });
  const versionMatch = /\d+\.\d+(\.\d+)?/.exec(output)![0];
  if (versionMatch) {
    debug('Found go version', { versionMatch });
    return versionMatch; // already without the "go" prefix
  }

  return 'unknown';
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
