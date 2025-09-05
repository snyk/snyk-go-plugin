import * as fs from 'fs';
import * as path from 'path';
import * as subProcess from './sub-process';

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
  // 1) Try to read from go.mod `toolchain goX.Y.Z`
  try {
    const goModPath = path.resolve(root, targetFile);
    const goModContent = fs.readFileSync(goModPath, 'utf8');
    const toolChainMatch = /^\s*toolchain\s+go(\d+\.\d+\.\d+)/m.exec(
      goModContent,
    );
    if (toolChainMatch) {
      return toolChainMatch[1]; // already without the "go" prefix
    }
  } catch {
    // ignore, fall back to 2)
  }

  // 2) Fallback to `go version` if toolchian was not found in the go.mod file
  try {
    const goVerOutput = await subProcess.execute('go', ['version'], {
      cwd: root,
    });
    // accept go1, go1.22, go1.22.2 and prereleases like go1.22rc1
    const match = /(go\d+(?:\.\d+){0,2}[a-z0-9]*)/.exec(goVerOutput);
    if (match) {
      return match[1].replace(/^go/, '');
    }
  } catch {
    // leave as unknown
  }

  return 'unknown';
}
