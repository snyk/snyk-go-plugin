import * as childProcess from 'child_process';
import { cleanSnykEnv } from '@snyk/cli-interface';

import { debug } from './debug';

interface ExecOptions {
  cwd?: string;
  env?: any;
}

/**
 * Appended when a `go` failure looks like a private-module / proxy / sumdb
 * access problem. Kept as a string so callers that regex-match the rejection
 * (dep-graph, dep-tree) still see the original stderr at the start.
 */
export const PRIVATE_MODULE_HINT =
  '\n\nHint: This may be caused by a private Go module, module proxy, or ' +
  'checksum database that the Snyk process cannot reach. Check that ' +
  'GOPROXY, GOPRIVATE, GONOSUMDB, GOFLAGS and credentials match what ' +
  '`go build` uses in CI and are visible to the Snyk process, then re-run ' +
  'with `-d`.';

const PRIVATE_MODULE_ERROR_PATTERNS: RegExp[] = [
  /could not read Username/,
  /no required module provides package/,
  /cannot find module providing package/,
  /unrecognized import path/,
  /dial tcp/,
  /module lookup disabled by GOPROXY=off/,
  // Go proxy/sumdb errors look like ": 404 Not Found" / ": 410 Gone"
  /: 404\b/,
  /: 410\b/,
];

/**
 * If `err` is a string whose contents look like a private-module / proxy /
 * sumdb failure, append {@link PRIVATE_MODULE_HINT}. Idempotent and a no-op
 * for non-string errors so rejection stays a string for downstream regexes.
 */
export function addPrivateModuleHint(err: unknown): unknown {
  if (typeof err !== 'string') {
    return err;
  }
  if (err.includes(PRIVATE_MODULE_HINT)) {
    return err;
  }
  if (!PRIVATE_MODULE_ERROR_PATTERNS.some((pattern) => pattern.test(err))) {
    return err;
  }
  return err + PRIVATE_MODULE_HINT;
}

export async function execute(
  command: string,
  args: string[],
  options?: ExecOptions,
  shell: boolean = false,
): Promise<string> {
  const spawnOptions: childProcess.SpawnOptions = {
    shell,
    env: { ...process.env },
  };
  if (options?.cwd) {
    spawnOptions.cwd = options.cwd;
  }
  if (options?.env) {
    spawnOptions.env = { ...process.env, ...options.env };
  }

  spawnOptions.env = cleanSnykEnv(
    spawnOptions.env as NodeJS.ProcessEnv,
    process.env,
  );

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = childProcess.spawn(command, args, spawnOptions);

    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        stdout = stdout + data;
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        stderr = stderr + data;
      });
    }

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(stdout || stderr);
      }
      resolve(stdout || stderr);
    });
  });
}

export async function runGo(
  args: string[],
  options: ExecOptions,
  additionalGoCommands: string[] = [],
): Promise<string> {
  try {
    return await execute('go', args, options);
  } catch (err: any) {
    const [command] = /(go mod download)|(go get [^"]*)/.exec(err) || [];
    if (command && !additionalGoCommands.includes(command)) {
      debug('running command:', command);
      const newArgs = command.split(' ').slice(1);
      try {
        await execute('go', newArgs, options);
      } catch (downloadErr: unknown) {
        throw addPrivateModuleHint(downloadErr);
      }
      return runGo(args, options, additionalGoCommands.concat(command));
    }
    throw addPrivateModuleHint(err);
  }
}
