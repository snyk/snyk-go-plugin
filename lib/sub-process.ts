import * as childProcess from 'child_process';
import { cleanSnykEnv } from '@snyk/cli-interface';

import { debug } from './debug';

interface ExecOptions {
  cwd?: string;
  env?: any;
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

  // Ensure env is defined (it always is due to initialization above)
  const env = spawnOptions.env as NodeJS.ProcessEnv;

  // Before spawning an external process, we look if we need to restore the system proxy configuration,
  // which overides the cli internal proxy configuration.
  if (process.env.SNYK_SYSTEM_HTTP_PROXY !== undefined) {
    env.HTTP_PROXY = process.env.SNYK_SYSTEM_HTTP_PROXY;
  }
  if (process.env.SNYK_SYSTEM_HTTPS_PROXY !== undefined) {
    env.HTTPS_PROXY = process.env.SNYK_SYSTEM_HTTPS_PROXY;
  }
  if (process.env.SNYK_SYSTEM_NO_PROXY !== undefined) {
    env.NO_PROXY = process.env.SNYK_SYSTEM_NO_PROXY;
  }

  spawnOptions.env = cleanSnykEnv(env, process.env);

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

// Well-known `go` toolchain failures seen when a (private) module or the
// module proxy / checksum database cannot be reached from the current
// environment.
const PRIVATE_MODULE_FAILURE_PATTERNS: RegExp[] = [
  /could not read Username/i,
  /no required module provides package/i,
  /cannot find module providing package/i,
  /unrecognized import path/i,
  /dial tcp/i,
  /module lookup disabled by GOPROXY=off/i,
  /terminal prompts disabled/i,
  /(?:reading|fetching) https?:\/\/\S+: (?:40[134]|410) /i,
];

const PRIVATE_MODULE_HINT_MARKER = 'Snyk hint:';

/**
 * Appends an actionable hint to go toolchain stderr that looks like a
 * network / private module failure. The original text is preserved verbatim at
 * the start of the returned string so callers matching on it keep working.
 */
export function addPrivateModuleHint(output: string): string {
  if (
    !output ||
    output.includes(PRIVATE_MODULE_HINT_MARKER) ||
    !PRIVATE_MODULE_FAILURE_PATTERNS.some((re) => re.test(output))
  ) {
    return output;
  }
  const sep = output.endsWith('\n') ? '' : '\n';
  return (
    `${output}${sep}${PRIVATE_MODULE_HINT_MARKER} the go command could not fetch one or more modules. ` +
    'If these are private modules, check that GOPROXY, GOPRIVATE, GONOSUMDB and GOFLAGS ' +
    '(and any credentials such as .netrc or git configuration) are set the same way as for `go build` in your CI, ' +
    'and that those environment variables are available to the Snyk process. ' +
    'Re-run with -d for debug output.'
  );
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
      await execute('go', newArgs, options);
      return runGo(args, options, additionalGoCommands.concat(command));
    }
    throw typeof err === 'string' ? addPrivateModuleHint(err) : err;
  }
}
