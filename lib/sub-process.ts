import * as childProcess from 'child_process';

export function execute(command: string,
                        args: string[],
                        options?: { cwd?: string, env?: any },
                        shell: boolean = false): Promise<string> {
  const spawnOptions: childProcess.SpawnOptions = { shell };
  if (options?.cwd) {
    spawnOptions.cwd = options.cwd;
  }
  if (options?.env) {
    spawnOptions.env = { ...process.env, ...options.env };
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = childProcess.spawn(command, args, spawnOptions);
    proc.stdout.on('data', (data: Buffer) => {
      stdout = stdout + data;
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr = stderr + data;
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(stdout || stderr);
      }
      resolve(stdout || stderr);
    });
  });
}
