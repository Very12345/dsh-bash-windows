/**
 * Direct-exec "fast path" decision for the Git Bash executor.
 *
 * WHY
 * ---
 * Every dsh bash tool call currently spawns `bash.exe -c "<command>"`, even for
 * a plain `git status`. Measured on this machine (paired, same moment): the
 * bash layer adds ~75-200 ms per call versus spawning the native `.exe`
 * directly with `shell:false`. A representative 8-call agent turn drops from
 * ~1767 ms to ~1204 ms (-32%) when the no-metachar calls skip bash.
 *
 * WHY AN ALLOWLIST AND NOT "no metachar -> exec"
 * ----------------------------------------------
 * Git Bash ships an `ls.exe`/`grep.exe`/`head.exe` in `usr\bin` that are MSYS2
 * programs: they only understand POSIX paths. Handing them a Windows path
 * (`C:\...`) as argv breaks them, whereas real bash translates it. So the fast
 * path must NOT run those. It also must not run a bare `.cmd`/`.bat` name (e.g.
 * `npm`, `pnpm`) — `.cmd` is not reliably launchable with `shell:false` and the
 * MSYS PATH differs from the Windows PATH. Anything not proven safe stays on
 * bash, exactly as before (fail safe = the old behaviour).
 *
 * This module imports only `node:` builtins so it is unit-testable without a
 * composed harness.
 *
 * @module @very12345/dsh-bash-windows/fastpath
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Shell metacharacters. A command containing any of these is left to bash —
 * pipes, redirects, globs, quoting, variable expansion and history all need a
 * shell, and re-implementing them is exactly what the prototype's README lists
 * as its known limitation. Matches the shd (`HasShellMeta`) set.
 */
const SHELL_METACHAR = /[|&;<>()$`\\"'*?[\]#~=%{}!\n\r]/;

/**
 * Command heads allowed on the fast path. Every entry is a real Windows
 * `.exe` on PATH (not an MSYS shim, not a `.cmd`), verified by the resolver at
 * runtime. An unlisted but safe command simply pays the old bash cost — the
 * failure mode of an incomplete list is "no speedup", never "wrong output".
 */
export const FASTPATH_COMMANDS = Object.freeze([
  'git',
  'node',
  'python',
  'python3',
  'py',
  'hostname',
  'where',
  'whoami',
  'tasklist',
  'taskkill',
  'ping',
  'ipconfig',
  'curl',
  'dotnet',
  'java',
  'go',
  'cargo',
  'rustc',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'mocha',
]);

/**
 * Whether a command string contains any shell metacharacter.
 * @param {string} command the raw command text.
 * @returns {boolean} true when bash is required.
 */
export function hasShellMeta(command) {
  return typeof command !== 'string' || SHELL_METACHAR.test(command);
}

/**
 * Tokenise a metachar-free command into argv.
 *
 * Only reached for strings already proven metachar-free, so it only has to
 * handle runs of non-space tokens. Runs of spaces are collapsed (equivalent to
 * shell word splitting for this restricted input).
 * @param {string} command metachar-free command text.
 * @returns {string[]} argv, first element the command head.
 */
export function splitArgv(command) {
  return command.trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Resolve a bare command name to an absolute Windows `.exe` on `PATH`.
 *
 * Only `NAME.exe` is considered: a bare `ls`/`grep` resolves to MSYS `.exe`
 * that cannot take Windows paths, and `npm`/`pnpm` exist only as `.cmd`. Both
 * cases must fall through to bash, so a hit here is a strong "safe" signal.
 *
 * @param {string} name command head, without extension.
 * @param {Record<string, string | undefined>} [env] environment to read PATH from.
 * @param {string} [platform] platform selector.
 * @returns {string | undefined} absolute `.exe` path, or undefined when none.
 */
export function resolveExecutable(name, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return undefined;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (name.includes('/') || name.includes('\\')) return undefined;
  let pathValue = '';
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === 'PATH') { pathValue = value ?? ''; break; }
  }
  if (pathValue.length === 0) return undefined;
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, `${name}.exe`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The command head when it is eligible for the fast path, else undefined.
 *
 * Eligible means: metachar-free, non-empty, and its lowercased head appears on
 * the allowlist. Resolution to an actual `.exe` is a separate step so each
 * rejection reason stays independently testable.
 *
 * @param {string} command raw command text.
 * @param {readonly string[]} allowlist permitted command heads.
 * @returns {string | undefined} lowercased command head, or undefined.
 */
function eligibleHead(command, allowlist) {
  if (hasShellMeta(command)) return undefined;
  const tokens = splitArgv(command);
  if (tokens.length === 0) return undefined;
  const head = tokens[0].toLowerCase();
  return allowlist.includes(head) ? head : undefined;
}

/**
 * Fill in the decision inputs from their defaults.
 *
 * Kept separate from `fastpathArgv` because each `= default` in a parameter
 * list is a branch as far as cyclomatic-complexity tools are concerned:
 * four defaults plus the two guards below put the decision function at CCN 6,
 * over the threshold of 5. Nothing about the defaults is complex, it is just
 * arithmetic on the same counter as real branching.
 *
 * @param {object} [options] caller-supplied inputs.
 * @returns {{command: string, env: Record<string, string|undefined>,
 *   platform: string, allowlist: readonly string[]}} resolved inputs.
 */
function decisionInputs(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const allowlist = options.allowlist ?? FASTPATH_COMMANDS;
  return { command: options.command, env, platform, allowlist };
}

/**
 * Decide whether one command can bypass bash.
 *
 * @param {object} options decision inputs.
 * @param {string} options.command raw command text from the tool spec.
 * @param {Record<string, string | undefined>} [options.env] environment (PATH).
 * @param {string} [options.platform] platform selector.
 * @param {readonly string[]} [options.allowlist] command heads permitted.
 * @returns {{ argv: string[] } | undefined} the argv to spawn directly, or
 *   undefined when bash should be used.
 */
export function fastpathArgv(options) {
  const { command, env, platform, allowlist } = decisionInputs(options);
  const head = eligibleHead(command, allowlist);
  if (head === undefined) return undefined;
  const exe = resolveExecutable(head, env, platform);
  if (exe === undefined) return undefined;
  return { argv: [exe, ...splitArgv(command).slice(1)] };
}
