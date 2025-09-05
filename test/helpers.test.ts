import { test } from 'tap';
import * as fs from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';

// Helper to create a temporary project with the given go.mod contents
function withTempProject(
  goModContent: string,
  testFn: (projectDir: string) => Promise<void>,
) {
  const dirObj = tmp.dirSync({ unsafeCleanup: true });
  const goModPath = path.join(dirObj.name, 'go.mod');
  fs.writeFileSync(goModPath, goModContent);
  return testFn(dirObj.name).finally(() => dirObj.removeCallback());
}

// When we find the toolchain version in the go.mod file
test('resolveStdlibVersion picks toolchain from go.mod', async (t) => {
  await withTempProject(
    'module example.com\n\ntoolchain go1.22.2',
    async (projectDir) => {
      // Mock sub-process to ensure fallback is not used
      const { resolveStdlibVersion } = (t as any).mock('../lib/helpers', {
        '../lib/sub-process': {
          async execute() {
            t.fail(
              'subProcess.execute should not be called when toolchain exists',
            );
            return '';
          },
        },
      });

      const version = await resolveStdlibVersion(projectDir, 'go.mod');
      t.equal(version, '1.22.2', 'extracts version from toolchain line');
    },
  );
});

// When we find the go directive in the go.mod file
test('resolveStdlibVersion picks go directive from go.mod', async (t) => {
  await withTempProject(
    'module example.com\n\ngo 1.21.7',
    async (projectDir) => {
      const { resolveStdlibVersion } = (t as any).mock('../lib/helpers', {
        '../lib/sub-process': {
          async execute() {
            t.fail(
              'subProcess.execute should not be called when go directive exists',
            );
            return '';
          },
        },
      });

      const version = await resolveStdlibVersion(projectDir, 'go.mod');
      t.equal(version, '1.21.7', 'extracts version from go directive');
    },
  );
});

// When we don't find the toolchain or go directive in the go.mod file, we fall back to `go version`
test('resolveStdlibVersion falls back to `go version`', async (t) => {
  await withTempProject('module example.com', async (projectDir) => {
    const fakeGoVersion = 'go version go1.19.7 linux/amd64';
    const { resolveStdlibVersion } = (t as any).mock('../lib/helpers', {
      '../lib/sub-process': {
        async execute() {
          return fakeGoVersion;
        },
      },
    });

    const version = await resolveStdlibVersion(projectDir, 'go.mod');
    t.equal(version, '1.19.7', 'extracts version from `go version` output');
  });
});
