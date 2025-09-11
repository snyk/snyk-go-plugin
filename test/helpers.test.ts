import { test } from 'tap';
import * as path from 'path';
import { resolveStdlibVersion } from '../lib/helpers';
import { goVersion } from './go-version';

const targetFile = 'go.mod';

const localGoVersion = `${goVersion[0]}.${goVersion[1]}.${goVersion[2]}`;

// When we find the toolchain version in the go.mod file
test('resolveStdlibVersion picks toolchain from go.mod', async (t) => {
  const projectDir = path.join(__dirname, 'fixtures', 'gomod-simple-toolchain');
  const version = await resolveStdlibVersion(projectDir, targetFile);
  t.equal(version, '1.24.2', 'extracts version from toolchain line');
});

// When we don't find the toolchain in the go.mod file, we fall back to the installed go version
test('resolveStdlibVersion picks go directive from go.mod', async (t) => {
  const projectDir = path.join(__dirname, 'fixtures', 'gomod-simple');
  const version = await resolveStdlibVersion(projectDir, targetFile);
  t.equal(version, localGoVersion, 'extracts version from go directive');
});
