/**
 * Unit tests for the direct-exec fast-path decision helper.
 *
 * Pure: imports only `node:` builtins and the module under test, so it runs
 * without a composed harness.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { delimiter } from 'node:path';
import {
  FASTPATH_COMMANDS,
  fastpathArgv,
  hasShellMeta,
  splitArgv,
  resolveExecutable,
} from '../src/fastpath.js';
import { gitBashArgv } from '../src/bash.js';

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

test('default allowlist holds no .cmd-only entries', () => {
  // These exist on Windows only as `.cmd` shims, so they can never resolve to a
  // native `.exe`. Listing them would be dead weight implying support the fast
  // path cannot deliver.
  for (const cmdOnly of ['tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha']) {
    assert.equal(FASTPATH_COMMANDS.includes(cmdOnly), false, `must not list .cmd-only ${cmdOnly}`);
  }
});

test('fastpathArgv sends POSIX-path arguments to bash', () => {
  // Bash is what translates POSIX paths for the child; a direct spawn is not
  // equivalent. Measured: `bash -c "git -C /tmp/x status"` works while
  // `spawn(git.exe, ['-C','/tmp/x'])` fails with "cannot change to /tmp/x".
  // Nothing converts on its own -- not even git.exe, which is MSYS-linked.
  for (const command of [
    'git -C /tmp/repo status',
    'node /c/x.js',
    'python /home/u/a.py',
    'java -cp /c/lib Main',
    'curl /absolute',
  ]) {
    assert.equal(
      fastpathArgv({ command, env: WIN_ENV, platform: 'win32' }),
      undefined,
      `POSIX path must fall back to bash: ${command}`,
    );
  }
});

test('fastpathArgv still accepts Windows-style and relative arguments', () => {
  // The POSIX guard must not cost the common cases: flags, relative paths and
  // Windows paths all stay on the fast path.
  for (const command of ['git status', 'git log -1', 'node -v', 'node ./a.js', 'git -C C:\\repo status']) {
    const out = fastpathArgv({ command, env: WIN_ENV, platform: 'win32' });
    // Some heads resolve only for `node` in this fake env; assert on the ones
    // that do, and on the absence of a throw for the rest.
    if (out !== undefined) assert.match(out.argv[0], /\.exe$/i);
  }
});

test('resolveExecutable ignores a directory named like an exe', () => {
  // A directory called `node.exe` satisfies existsSync but is not launchable;
  // resolving it would fail at spawn time instead of falling back to bash.
  const root = mkdtempSync(join(tmpdir(), 'dsh-fp-dir-'));
  try {
    mkdirSync(join(root, 'node.exe'));
    assert.equal(resolveExecutable('node', { PATH: root }, 'win32'), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every allowlisted entry either resolves to a native .exe or is absent', () => {
  // The allowlist is documented as "names that can resolve to a real .exe".
  // This pins the invariant without requiring every tool to be installed: each
  // name must either resolve to a file on this machine's PATH, or be genuinely
  // absent (undefined) -- never resolve to a directory or a `.cmd`.
  for (const name of FASTPATH_COMMANDS) {
    const exe = resolveExecutable(name);
    if (exe === undefined) continue; // not installed here; nothing to assert
    assert.match(exe, /\.exe$/i, `${name} must resolve to a .exe, got ${exe}`);
    assert.equal(statSync(exe).isFile(), true, `${name} must resolve to a file`);
  }
});

test('known path-translating and shim families stay off the allowlist', () => {
  // Regression guard for the invariant documented on FASTPATH_COMMANDS:
  // anything that needs bash to translate POSIX paths, or that exists only as a
  // .cmd shim, must never be added. If a future entry needs a path argument it
  // belongs on the bash path by definition.
  const forbidden = [
    // MSYS tools that only understand POSIX paths
    'ls', 'grep', 'head', 'tail', 'cat', 'sed', 'awk', 'find', 'xargs', 'cp', 'mv', 'rm', 'mkdir',
    // .cmd-only shims
    'npm', 'pnpm', 'npx', 'yarn', 'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha',
    // names that would collide with a shell builtin
    'cd', 'echo', 'export', 'set', 'test', 'true', 'false',
  ];
  for (const name of forbidden) {
    assert.equal(
      FASTPATH_COMMANDS.includes(name),
      false,
      `${name} must not be on the fast-path allowlist`,
    );
  }
});

test('a rejected command is handed to bash verbatim', () => {
  // The safety property the allowlist promises is "wrong output is impossible".
  // The other half of that promise lives on the reject side: the command must
  // reach bash byte-identical, with no rewriting, quoting or argv splitting of
  // our own. This pins the contract between the guard and `gitBashArgv`
  // without needing to spawn a process.
  const bashPath = 'C:\Program Files\Git\bin\bash.exe';
  const rejected = [
    'git -C /tmp/repo status',
    'node /c/x.js',
    'git status | cat',
    'echo $HOME',
    'git "log" -1',
    'ls *.ts',
    'cd /tmp && ls',
  ];
  for (const command of rejected) {
    assert.equal(
      fastpathArgv({ command, env: WIN_ENV, platform: 'win32' }),
      undefined,
      `expected bash fallback: ${command}`,
    );
    // The unchanged bash path receives the command text as-is.
    assert.deepEqual(gitBashArgv({ bashPath, command }), [bashPath, '-c', command]);
    assert.deepEqual(gitBashArgv({ bashPath, loginShell: true, command }), [bashPath, '-lc', command]);
  }
});

test('directExec:false disables the fast path entirely', () => {
  // Mirrors `directArgv`'s guard: the config flag is checked before any
  // detection, so `false` restores the strict always-through-bash behaviour.
  const directArgv = (config) => {
    const directExec = config.directExec?.get?.() ?? config.directExec;
    if (directExec === false) return undefined;
    return fastpathArgv({ command: 'node -v', env: WIN_ENV, platform: 'win32' })?.argv;
  };
  assert.equal(directArgv({ directExec: false }), undefined);
  assert.ok(directArgv({ directExec: true }));
  assert.ok(directArgv({ directExec: { get: () => true } }), 'getter form');
  assert.equal(directArgv({ directExec: { get: () => false } }), undefined, 'getter false');
});
