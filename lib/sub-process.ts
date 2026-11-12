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

// Go prints the modules whose go.sum hash is missing on a hint line such as
// "\tgo mod download cloud.google.com/go/compute". Plain `go mod download`
// does not restore that hash (golang/go#45332), so the module has to be named.
const GO_MOD_DOWNLOAD_HINT =
  /^[ \t]*go mod download((?:[ \t]+\S+)+)[ \t]*\r?$/m;

// Matches a Go module path with an optional "@version", using only the
// characters Go allows in module paths and versions.
function isSafeModuleArg(arg: string): boolean {
  const [modulePath, version, ...rest] = arg.split('@');
  if (rest.length > 0 || modulePath.startsWith('-')) {
    return false;
  }
  if (
    version !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._+~-]*$/.test(version)
  ) {
    return false;
  }
  return modulePath
    .split('/')
    .every(
      (element) =>
        /^[A-Za-z0-9._~-]+$/.test(element) &&
        !element.startsWith('.') &&
        !element.endsWith('.'),
    );
}

function getModulesToDownload(err: any): string[] {
  const hint = GO_MOD_DOWNLOAD_HINT.exec(err);
  const modules = hint ? hint[1].trim().split(/\s+/) : [];
  return modules.every(isSafeModuleArg) ? modules : [];
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
    if (command) {
      const newArgs =
        command === 'go mod download'
          ? ['mod', 'download', ...getModulesToDownload(err)]
          : command.split(' ').slice(1);
      const recovery = ['go', ...newArgs].join(' ');
      if (!additionalGoCommands.includes(recovery)) {
        debug('running command:', recovery);
        await execute('go', newArgs, options);
        return runGo(args, options, additionalGoCommands.concat(recovery));
      }
    }
    throw err;
  }
}
