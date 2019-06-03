import * as child_process from 'child_process';

export const goVersion = (() => {
  try {
    const versionString = process.env.GO_VERSION || child_process.execSync('go version', { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)![0];
    return versionString.split('.').map(Number);
  } catch (e) {
    throw new Error("go appears to be not installed: " + e);
  }
})();

