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

  
// const { spawn } = require('node:child_process');
// const child = childProcess.spawn(command, args, spawnOptions);

// child.stdout.on('data', (data) => {
//   console.log(`stdout: ${data}`);
// });

// child.stderr.on('data', (data) => {
//   console.error(`stderr: ${data}`);
// });

// child.on('close', (code) => {
//   console.log(`child process exited with code ${code}`);
// });

//  const exitCode = await new Promise((resolve, reject) => {
//     child.on('close', resolve);
//   });



  //DAMI 
  const child = childProcess.spawn(command, args, spawnOptions);
  let data = '';
  for await (const chunk of child.stdout) {
    console.log('stdout chunk: ' + chunk);
    data += chunk;
  }
  let error = '';
  for await (const chunk of child.stderr) {
    console.error('stderr chunk: ' + chunk);
    error += chunk;
  }
  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
  });

  if (exitCode) {
    throw new Error(`subprocess error exit ${exitCode}, ${error}`);
  }
  return data;


  //ORIGINAL 
  // return new Promise((resolve, reject) => {
  //   let stdout = '';
  //   let stderr = '';

  //   const proc = childProcess.spawn(command, args, spawnOptions);
  //   proc.stdout.on('data', (data: Buffer) => {
  //     stdout = stdout + data;
  //   });
  //   proc.stderr.on('data', (data: Buffer) => {
  //     console.log('err');
  //     stderr = stderr + data;
  //     reject('something went boom');
  //   });

  //   proc.on('close', (code) => {
  //     console.log('close');
  //     console.log({ code });
  //     if (code !== 0) {
  //       return reject(stdout || stderr);
  //     }
  //     resolve(stdout || stderr);
  //   });
  // });
}
