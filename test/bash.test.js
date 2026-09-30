/**
 * Unit tests for the pure Git Bash helpers.
 *
 * These import only `node:` builtins, so they run without the DeepSeek Harness
 * peers present and without a composed host.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import {
  WELL_KNOWN_BASH_PATHS,
  candidateGitBashPaths,
  gitBashArgv,
  resolveGitBashPath,
} from '../src/bash.js';

/**
 * Build a PATH string from directories using the current platform delimiter.
 * @param {...string} directories directory entries.
 * @returns {string} joined PATH value.
 */
function pathOf(...directories) {
  return directories.join(delimiter);
}

test('resolveGitBashPath rejects non-win32 platforms', () => {
  assert.throws(
    () => resolveGitBashPath({ platform: 'linux', env: {} }),
    /only supported on win32/,
  );
});

test('resolveGitBashPath rejects a bashPath that does not exist', () => {
  assert.throws(
    () => resolveGitBashPath({ platform: 'win32', bashPath: 'C:\\nope\\bash.exe' }),
    /bashPath does not exist/,
  );
});

test('resolveGitBashPath rejects a bashPath that is a directory', () => {
  // `C:\Windows` always exists but is not a file.
  assert.throws(
    () => resolveGitBashPath({ platform: 'win32', bashPath: 'C:\\Windows' }),
    /bashPath does not exist/,
  );
});

test('candidateGitBashPaths derives bash from git.exe on PATH', () => {
  // Git for Windows lays out <root>\cmd\git.exe beside <root>\bin\bash.exe.
  const gitCmdDir = 'D:\\Code\\Git\\cmd';
  const candidates = candidateGitBashPaths({
    platform: 'win32',
    env: { Path: pathOf('C:\\Windows', gitCmdDir) },
  });
  assert.equal(candidates[0], join('D:\\Code\\Git', 'bin', 'bash.exe'));
});

test('candidateGitBashPaths reads PATH case-insensitively', () => {
  const candidates = candidateGitBashPaths({
    platform: 'win32',
    env: { pAtH: pathOf('D:\\Code\\Git\\cmd') },
  });
  assert.equal(candidates[0], join('D:\\Code\\Git', 'bin', 'bash.exe'));
});

test('candidateGitBashPaths always appends the well-known locations', () => {
  const candidates = candidateGitBashPaths({ platform: 'win32', env: {} });
  assert.deepEqual(candidates, [...WELL_KNOWN_BASH_PATHS]);
});

test('candidateGitBashPaths ignores git.exe directories that do not exist', () => {
  const candidates = candidateGitBashPaths({
    platform: 'win32',
    env: { Path: 'C:\\definitely\\not\\here' },
  });
  assert.deepEqual(candidates, [...WELL_KNOWN_BASH_PATHS]);
});

test('candidateGitBashPaths yields no PATH candidate on POSIX', () => {
  const candidates = candidateGitBashPaths({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
  });
  assert.deepEqual(candidates, [...WELL_KNOWN_BASH_PATHS]);
});

test('resolveGitBashPath honours an explicit existing bashPath', (t) => {
  const real = WELL_KNOWN_BASH_PATHS.find((candidate) => existsSync(candidate));
  if (real === undefined) {
    t.skip('no Git Bash installed on this machine');
    return;
  }
  assert.equal(resolveGitBashPath({ platform: 'win32', bashPath: real }), real);
});

test('resolveGitBashPath finds the installed Git Bash', (t) => {
  if (process.platform !== 'win32') {
    t.skip('win32-only');
    return;
  }
  let resolved;
  try {
    resolved = resolveGitBashPath();
  } catch (error) {
    t.skip(`no Git Bash on this machine: ${error.message}`);
    return;
  }
  assert.ok(existsSync(resolved), `resolved path should exist: ${resolved}`);
  assert.match(resolved, /bash\.exe$/i);
});

test('resolveGitBashPath enumerates candidates when resolution fails', (t) => {
  // Resolution only fails when nothing on PATH or in the well-known locations
  // matches, so this assertion is meaningful only on a machine without Git
  // Bash there. Both halves of the contract are covered regardless: the
  // candidate list by the tests above, and the success path by the two tests
  // that resolve a real install.
  if (WELL_KNOWN_BASH_PATHS.some((candidate) => existsSync(candidate))) {
    t.skip('Git Bash is installed at a well-known path on this machine');
    return;
  }
  assert.throws(
    () => resolveGitBashPath({ platform: 'win32', env: {} }),
    (error) => {
      return error instanceof Error
        && /could not locate Git Bash/.test(error.message)
        && /Set config\.bashPath/.test(error.message)
        && WELL_KNOWN_BASH_PATHS.every((candidate) => error.message.includes(candidate));
    },
  );
});

test('gitBashArgv builds a non-login argv by default', () => {
  assert.deepEqual(
    gitBashArgv({ bashPath: 'C:\\Git\\bin\\bash.exe', command: 'uname -s' }),
    ['C:\\Git\\bin\\bash.exe', '-c', 'uname -s'],
  );
});

test('gitBashArgv builds a login argv when asked', () => {
  assert.deepEqual(
    gitBashArgv({ bashPath: 'bash.exe', loginShell: true, command: 'echo hi' }),
    ['bash.exe', '-lc', 'echo hi'],
  );
});

test('gitBashArgv preserves the command verbatim', () => {
  // The command is one argv element: no quoting or escaping layer exists, so
  // quotes, newlines, and Windows paths must survive untouched.
  const command = 'echo "a b" && printf \'%s\\n\' "D:\\Code x"';
  const argv = gitBashArgv({ bashPath: 'bash.exe', command });
  assert.equal(argv.length, 3);
  assert.equal(argv[2], command);
});

test('gitBashArgv rejects an empty or non-string command', () => {
  assert.throws(() => gitBashArgv({ bashPath: 'bash.exe', command: '' }), /invalid command/);
  assert.throws(() => gitBashArgv({ bashPath: 'bash.exe', command: undefined }), /invalid command/);
});
