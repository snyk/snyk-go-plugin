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

  // 2) Try to read from go.mod the go version e.g. `go X.Y.Z`
  let goDirectiveMatch: RegExpMatchArray | null = null;

  try {
    const goModPath = path.resolve(root, targetFile);
    const goModContent = fs.readFileSync(goModPath, 'utf8');
    goDirectiveMatch = /^\s*go\s+(\d+(?:\.\d+){0,2})/m.exec(goModContent);
    if (goDirectiveMatch) {
      debug('Found go directive in go.mod', { goDirectiveMatch });
      return goDirectiveMatch[1];
    }
  } catch {
    // ignore, fall back to 3)
    debug('Failed to read go directive from go.mod', { goDirectiveMatch });
  }

  // 3) Fallback to `go version` command (legacy behaviour)
  let goVerOutput = '';

  try {
    goVerOutput = await subProcess.execute('go', ['version'], {
      cwd: root,
    });
    // accept go1, go1.22, go1.22.2 and prereleases like go1.22rc1
    const match = /(go\d+(?:\.\d+){0,2}[a-z0-9]*)/.exec(goVerOutput);
    if (match) {
      debug('Found go version', { goVerOutput });
      return match[1].replace(/^go/, '');
    }
  } catch {
    // leave as unknown
    debug('failed to read go version', { goVerOutput });
  }

  return 'unknown';
}
