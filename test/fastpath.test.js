/**
 * Unit tests for the direct-exec fast-path decision helper.
 *
 * Pure: imports only `node:` builtins and the module under test, so it runs
 * without a composed harness.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delimiter } from 'node:path';
import {
  FASTPATH_COMMANDS,
  fastpathArgv,
  hasShellMeta,
  splitArgv,
  resolveExecutable,
} from '../src/fastpath.js';

// A fake Windows env whose single PATH dir contains the exes we ask for:
// resolveExecutable checks real files, so point at a real one (`node.exe`'s dir).
import { dirname } from 'node:path';
import { execPath } from 'node:process';
const EXE_DIR = dirname(execPath);
const WIN_ENV = { Path: `${EXE_DIR}${delimiter}C:\\definitely\\not\\here` };

test('hasShellMeta flags every metacharacter and plain commands pass', () => {
  for (const cmd of ['a | b', 'a > b', 'echo $HOME', 'ls *.ts', 'a && b', 'a; b', 'a "$(x)"', 'a `x`', 'a\'b', 'a[b]', 'a#b', 'a~b', 'a=b %x%']) {
    assert.equal(hasShellMeta(cmd), true, `expected meta: ${cmd}`);
  }
  for (const cmd of ['git status', 'node -v', 'hostname', 'git rev-parse HEAD']) {
    assert.equal(hasShellMeta(cmd), false, `expected plain: ${cmd}`);
  }
});

test('splitArgv collapses whitespace runs', () => {
  assert.deepEqual(splitArgv('  git   status --porcelain '), ['git', 'status', '--porcelain']);
});

test('resolveExecutable finds an .exe on PATH and rejects MSYS/cmd names', () => {
  // node.exe exists in EXE_DIR (dirname of the running node).
  assert.match(resolveExecutable('node', WIN_ENV, 'win32'), /node\.exe$/i);
  // A name with no matching .exe resolves to undefined -> bash fallback.
  assert.equal(resolveExecutable('definitely-not-a-real-cmd-xyz', WIN_ENV, 'win32'), undefined);
  // Path-like names are never resolved (would escape the allowlist model).
  assert.equal(resolveExecutable('./node', WIN_ENV, 'win32'), undefined);
  // Non-win32: never.
  assert.equal(resolveExecutable('node', WIN_ENV, 'linux'), undefined);
});

test('fastpathArgv accepts a safe native command', () => {
  const out = fastpathArgv({ command: 'node -v', env: WIN_ENV, platform: 'win32' });
  assert.ok(out);
  assert.match(out.argv[0], /node\.exe$/i);
  assert.deepEqual(out.argv.slice(1), ['-v']);
});

test('fastpathArgv rejects metachar commands (bash required)', () => {
  assert.equal(fastpathArgv({ command: 'git status | cat', env: WIN_ENV, platform: 'win32' }), undefined);
  assert.equal(fastpathArgv({ command: 'echo $HOME', env: WIN_ENV, platform: 'win32' }), undefined);
});

test('fastpathArgv rejects a head not on the allowlist even if it is a real exe', () => {
  // `node` is on the list; an unknown head that happens to resolve is refused.
  const out = fastpathArgv({ command: 'node -v', env: WIN_ENV, platform: 'win32', allowlist: ['git'] });
  assert.equal(out, undefined);
});

test('fastpathArgv rejects an allowlisted head that has no native .exe', () => {
  // `npm` is not in the default allowlist; even if it were, no .exe resolves.
  assert.equal(
    fastpathArgv({ command: 'git status', env: { Path: 'C:\\not\\here' }, platform: 'win32' }),
    undefined,
  );
});

test('default allowlist excludes MSYS tools and .cmd shims', () => {
  for (const unsafe of ['ls', 'grep', 'head', 'tail', 'cat', 'sed', 'awk', 'find', 'xargs', 'npm', 'pnpm', 'npx', 'yarn']) {
    assert.equal(FASTPATH_COMMANDS.includes(unsafe), false, `must not fastpath ${unsafe}`);
  }
});
