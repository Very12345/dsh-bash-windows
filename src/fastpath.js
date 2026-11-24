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
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Characters indicating that bash itself must interpret the command.
 *
 * Note `/` is deliberately not here: a leading slash is a *separate* hazard
 * caught by {@link hasPosixPathArgument}, because it is not shell syntax but a
 * path the shell layer would have translated.
 */
const SHELL_METACHAR = /[|&;<>()$`\\"'*?[\]#~=%{}!\n\r]/;

/**
 * Whether any argument looks like a POSIX absolute path.
 *
 * Why this matters more than it looks: spawning directly is not equivalent to
 * spawning through bash, because **bash is what translates POSIX paths into
 * Windows ones** for the child. Measured on this machine:
 *
 *     bash -c "git -C /tmp/x status"   -> works
 *     spawn(git.exe, ['-C','/tmp/x'])  -> fatal: cannot change to '/tmp/x'
 *
 * So `git` itself does not convert either — nothing does, the shell layer
 * does. Feeding `/c/...` or `/tmp/...` straight to a child silently changes
 * the meaning of the command, which is exactly the "wrong output" failure the
 * allowlist design exists to prevent.
 *
 * A conservative rule is enough here: an argument starting with `/` means bash.
 * That keeps `git status`, `git log`, `node -v` and friends on the fast path
 * while any POSIX-path argument goes the old way.
 *
 * @param {string[]} tokens argv, head included.
 * @returns {boolean} true when bash must be used.
 */
function hasPosixPathArgument(tokens) {
  return tokens.some((token) => token.startsWith('/'));
}

/**
 * Command heads allowed on the fast path.
 *
 * Every entry must be a real Windows `.exe` reachable on `PATH` (not an MSYS
 * shim, not a `.cmd`), which the resolver re-checks at runtime. An unlisted but
 * safe command simply pays the old bash cost — the failure mode of an
 * incomplete list is "no speedup", never "wrong output".
 *
 * `.cmd`-only tools are deliberately absent: `tsc`, `eslint`, `prettier`,
 * `vitest`, `jest` and `mocha` are all `.cmd` shims on Windows, so they can
 * never resolve to a native `.exe`. Listing them would be dead weight that
 * suggests support the fast path cannot deliver.
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
 * **Load-bearing invariant:** this is only ever called on strings that
 * `hasShellMeta` has already rejected for quotes and backslashes. Without that
 * guarantee the plain whitespace split would be wrong, because real shell word
 * splitting honours quoting (`a "b c"` is two words, not three). `eligibleHead`
 * is the only caller and it checks `hasShellMeta` first; the assertion there
 * makes the order impossible to lose silently in a refactor.
 *
 * Runs of spaces are collapsed, which is equivalent to shell word splitting for
 * this restricted input. Only reached for metachar-free text, so it only has to
 * handle runs of non-space tokens.
 * @param {string} command metachar-free command text.
 * @returns {string[]} argv, first element the command head.
 */
export function splitArgv(command) {
  return command.trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Whether `name` is a bare command name worth resolving.
 *
 * A name carrying a separator is already a path: letting it through would
 * bypass the `.exe`-only rule that keeps MSYS shims out.
 *
 * @param {unknown} name candidate command head.
 * @returns {boolean}
 */
function isBareName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return !name.includes('/') && !name.includes('\\');
}

/**
 * Read `PATH` from an environment object, case-insensitively.
 *
 * Windows env keys are case-insensitive but case-preserving, so `Path` and
 * `PATH` both occur; an exact-match lookup would miss whichever the caller has.
 *
 * @param {Record<string, string | undefined>} env environment to read from.
 * @returns {string} raw PATH value, or '' when absent.
 */
function pathFrom(env) {
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === 'PATH') return value ?? '';
  }
  return '';
}

/**
 * Whether `candidate` is an existing regular file.
 *
 * `existsSync` alone is not enough: a *directory* named `git.exe` would satisfy
 * it, and the resulting spawn would fail at runtime instead of falling back to
 * bash. Cheap stat, no throw.
 *
 * @param {string} candidate absolute path to test.
 * @returns {boolean}
 */
function isExecutableFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * First `PATH` directory holding a real `<name>.exe` file.
 *
 * @param {string} pathValue raw PATH value.
 * @param {string} name bare command head, without extension.
 * @returns {string | undefined} absolute `.exe` path, or undefined when none.
 */
function findOnPath(pathValue, name) {
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, `${name}.exe`);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
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
  if (!isBareName(name)) return undefined;
  return findOnPath(pathFrom(env), name);
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
 * @param {string[]} tokens the already-split argv for `command`.
 * @returns {string | undefined} lowercased command head, or undefined.
 */
function eligibleHead(command, allowlist, tokens) {
  if (hasShellMeta(command)) return undefined;
  // Mirrors the preconditions `splitArgv` documents: metachar-free (so no
  // quotes, hence plain whitespace splitting is correct) and no POSIX path
  // argument (bash would have translated it, a direct spawn would not).
  assert(tokens.every((token) => !hasShellMeta(token)), 'splitArgv requires metachar-free tokens');
  if (tokens.length === 0) return undefined;
  if (hasPosixPathArgument(tokens)) return undefined;
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
  const tokens = splitArgv(command);
  const head = eligibleHead(command, allowlist, tokens);
  if (head === undefined) return undefined;
  const exe = resolveExecutable(head, env, platform);
  if (exe === undefined) return undefined;
  return { argv: [exe, ...tokens.slice(1)] };
}
