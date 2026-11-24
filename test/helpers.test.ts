import { test } from 'tap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveStdlibVersion } from '../lib/helpers';
import { goVersion, fullGoVersion } from './go-version';

const targetFile = 'go.mod';

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
  t.ok(version.startsWith('1.'), 'extracts version from go directive');
});

function resolveWithGoMod(content: string | null, fromGoMod = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdlib-version-'));
  if (content !== null) {
    fs.writeFileSync(path.join(dir, 'go.mod'), content);
  }
  return resolveStdlibVersion(dir, targetFile, { fromGoMod }).finally(() =>
    fs.rmSync(dir, { recursive: true, force: true }),
  );
}

test('fromGoMod: toolchain with patch is used as is', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ngo 1.21\n\ntoolchain go1.22.3\n'),
    '1.22.3',
  );
});

test('fromGoMod: toolchain without patch maps to latest patch', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ngo 1.21\n\ntoolchain go1.24\n'),
    '1.24.13',
  );
});

test('fromGoMod: toolchain wins over a different go directive', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ngo 1.25.0\n\ntoolchain go1.21.13\n'),
    '1.21.13',
  );
});

test('fromGoMod: rc and beta toolchains become pre-releases of .0', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ntoolchain go1.22rc1\n'),
    '1.22.0-rc1',
  );
  t.equal(
    await resolveWithGoMod('module m\n\ntoolchain go1.21beta2\n'),
    '1.21.0-beta2',
  );
});

test('fromGoMod: go directive with patch is used as is', async (t) => {
  t.equal(await resolveWithGoMod('module m\n\ngo 1.23.4\n'), '1.23.4');
});

test('fromGoMod: go directive without patch maps to latest patch', async (t) => {
  t.equal(await resolveWithGoMod('module m\n\ngo 1.21\n'), '1.21.13');
  t.equal(await resolveWithGoMod('module m\n\ngo 1.27\n'), '1.27.4');
  t.equal(await resolveWithGoMod('module m\n\ngo 1.16\n'), '1.16.15');
});

test('fromGoMod: go directive for a minor not in the table uses .0', async (t) => {
  t.equal(await resolveWithGoMod('module m\n\ngo 1.99\n'), '1.99.0');
  t.equal(await resolveWithGoMod('module m\n\ngo 1.8\n'), '1.8.0');
});

test('fromGoMod: commented directives and trailing comments are handled', async (t) => {
  t.equal(
    await resolveWithGoMod(
      'module m\n\n// go 1.19\n// toolchain go1.20.1\ngo 1.22 // minimum\n',
    ),
    '1.22.12',
  );
});

test('fromGoMod: toolchain default falls through to go directive', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ngo 1.23\n\ntoolchain default\n'),
    '1.23.12',
  );
});

test('fromGoMod: no directives falls back to go version', async (t) => {
  t.equal(await resolveWithGoMod('module m\n'), fullGoVersion);
});

test('fromGoMod: missing go.mod falls back to go version', async (t) => {
  t.equal(await resolveWithGoMod(null), fullGoVersion);
});

test('without fromGoMod: go directive and short toolchain are ignored', async (t) => {
  t.equal(
    await resolveWithGoMod('module m\n\ngo 1.21\n', false),
    fullGoVersion,
  );
  t.equal(
    await resolveWithGoMod('module m\n\ntoolchain go1.21\n', false),
    fullGoVersion,
  );
  t.equal(
    await resolveWithGoMod('module m\n\ntoolchain go1.24.2\n', false),
    '1.24.2',
  );
});
