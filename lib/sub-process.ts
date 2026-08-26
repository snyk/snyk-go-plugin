import * as childProcess from 'child_process';

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
      await execute('go', newArgs, options);
      return runGo(args, options, additionalGoCommands.concat(command));
    }
    throw err;
  }
}
