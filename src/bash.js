/**
 * Pure Git-for-Windows bash helpers: executable discovery and argv shape.
 *
 * This module deliberately imports nothing from the DeepSeek Harness peer
 * packages, so it can be unit-tested and reasoned about without a composed
 * host. `executor.js` is the only consumer that needs the cordis peers.
 *
 * @module @very12345/dsh-bash-windows/bash
 */
import { statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/**
 * Last-resort install locations probed when `git.exe` is not on PATH.
 * `D:\\Code\\Git` is a common out-of-tree developer location; the Program
 * Files entries cover the standard Git for Windows installers.
 */
export const WELL_KNOWN_BASH_PATHS = Object.freeze([
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'D:\\Code\\Git\\bin\\bash.exe',
]);

/**
 * Whether a path exists and is a regular file.
 * @param {string} path candidate path.
 * @returns {boolean} true when the path is an existing file.
 */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Read `PATH` from an environment object using the target platform's key
 * semantics. Windows environment names are case-insensitive, and the common
 * spellings differ between tools (`Path`, `PATH`).
 * @param {Record<string, string | undefined>} env environment entries.
 * @param {string} platform `process.platform` value.
 * @returns {string} the raw PATH value, or an empty string.
 */
function environmentPath(env, platform) {
  if (platform !== 'win32') return env.PATH ?? '';
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === 'PATH') return value ?? '';
  }
  return '';
}

/**
 * Candidate `bash.exe` paths, most trustworthy first.
 *
 * The first strategy derives the Git install root from `git.exe` on PATH:
 * Git for Windows lays out `<root>\\cmd\\git.exe` beside `<root>\\bin\\bash.exe`,
 * so the sibling `bin` directory follows from the found `cmd` directory. This
 * keeps the resolver correct on machines that install Git anywhere, rather
 * than relying on a hardcoded location.
 *
 * @param {object} [options] resolution inputs.
 * @param {Record<string, string | undefined>} [options.env] environment to read PATH from.
 * @param {string} [options.platform] platform selector; non-win32 yields no candidates.
 * @returns {string[]} candidate paths in probe order.
 */
export function candidateGitBashPaths({ env = process.env, platform = process.platform } = {}) {
  const candidates = [];
  if (platform === 'win32') {
    for (const directory of environmentPath(env, platform).split(delimiter)) {
      if (directory.length === 0) continue;
      if (!isFile(join(directory, 'git.exe'))) continue;
      candidates.push(join(dirname(directory), 'bin', 'bash.exe'));
      break;
    }
  }
  candidates.push(...WELL_KNOWN_BASH_PATHS);
  return candidates;
}

/**
 * Resolve the absolute path of the Git for Windows `bash.exe`.
 *
 * An explicit `bashPath` wins and must exist. Otherwise the candidates from
 * {@link candidateGitBashPaths} are probed in order. Failing to find one is a
 * hard error listing every attempted path, because a silent fallback would
 * surface much later as an unexplained command failure.
 *
 * @param {object} [options] resolution inputs.
 * @param {string} [options.bashPath] explicit override; must be an existing file.
 * @param {Record<string, string | undefined>} [options.env] environment to read PATH from.
 * @param {string} [options.platform] platform selector.
 * @returns {string} absolute path to `bash.exe`.
 * @throws {Error} on a non-Windows platform, a missing explicit path, or no match.
 */
export function resolveGitBashPath({ bashPath, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') {
    throw new Error(
      `dsh-bash-windows: only supported on win32 (current platform: ${platform})`,
    );
  }
  if (typeof bashPath === 'string' && bashPath.length > 0) {
    if (!isFile(bashPath)) {
      throw new Error(`dsh-bash-windows: bashPath does not exist: ${bashPath}`);
    }
    return bashPath;
  }
  const candidates = candidateGitBashPaths({ env, platform });
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  throw new Error(
    'dsh-bash-windows: could not locate Git Bash (bash.exe). Tried:\n'
    + candidates.map((candidate) => `  - ${candidate}`).join('\n')
    + '\nSet config.bashPath to the absolute path of bash.exe.',
  );
}

/**
 * Build the argv for one bash command.
 *
 * A non-login shell is the default: Git Bash inherits the Windows `PATH` and
 * converts it to `/c/...` form on its own, so `python`, `node`, `pip`, and
 * `git` are reachable without sourcing any profile. `loginShell` is offered
 * because `-l` is the escape hatch when a user needs their own `~/.bash_profile`.
 *
 * @param {object} options argv inputs.
 * @param {string} options.bashPath absolute path to `bash.exe`.
 * @param {boolean} [options.loginShell] use `-lc` instead of `-c`.
 * @param {string} options.command shell source to run.
 * @returns {string[]} the exact argv handed to the subprocess seam.
 * @throws {Error} when `command` is not a non-empty string.
 */
export function gitBashArgv({ bashPath, loginShell = false, command }) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('dsh-bash-windows: invalid command: expected a non-empty string');
  }
  return [bashPath, loginShell ? '-lc' : '-c', command];
}
