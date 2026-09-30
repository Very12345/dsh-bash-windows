/**
 * A `ctx.shell` executor that runs commands through Git for Windows bash.
 *
 * HOW IT RELATES TO `@deepseek-ai/dsh-bash-local`
 * ----------------------------------------------
 * It is a thin subclass. `LocalBashExecutor` hardcodes `['bash', '-c', command]`
 * and exposes `executeArgv(spec, argv)` precisely so a subclass can substitute
 * the shell argv "at an execution boundary". On Windows `bash.exe` is not on
 * `PATH`, so the absolute path has to be injected somewhere -- that substitution
 * is the whole of this class.
 *
 * Everything else is inherited deliberately, so this executor is not a lookalike:
 *   - `resolve()` fills and caps `workdir`, `timeoutMs`, `onExpiry`, `stdoutMaxBytes`
 *     from the same schema fields;
 *   - `executeArgv()` owns deadline fusion, first-cause `timedOut`/`aborted`
 *     classification, the synchronous-spawn-failure path, the provider-failure
 *     note, and the background read merge;
 *   - `spawnSpec()` applies `maxSpillBytes`, the model-friendly `ENV_OVERRIDES`,
 *     and the caller `env`/`dshEnv` layering.
 *
 * `dsh-tool-bash` therefore renders exactly as it does on POSIX --
 * `(no output)`, `[output truncated; full output: <path>]`,
 * `[timed out after <ms>ms]`, `[exit code: N]` -- without a line of duplicated
 * rendering logic here.
 *
 * WHAT THIS EXECUTOR DOES NOT DO
 * ------------------------------
 * It does not confine. `sandboxMode` stays `undefined` (inherited), so
 * `dsh-tool-bash` advertises no `sandbox_permissions` and offers no escalation
 * path that does not exist; commands run with the harness process's own
 * authority. This is a platform constraint rather than a choice: MSYS2 cannot
 * start under the Windows ACL sandbox, because its runtime needs to create a
 * named signal pipe and the write-restricted token denies that. See README.md
 * for the measured evidence, including the control experiment showing native
 * Win32 binaries run fine under the same sandbox.
 *
 * @module @very12345/dsh-bash-windows/executor
 */
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import z from '@deepseek-ai/schemastery';
import { gitBashArgv, resolveGitBashPath } from './bash.js';

/** Default SIGTERM-to-SIGKILL grace period, matching the POSIX executor. */
const DEFAULT_GRACE_MS = 3000;

/** Default per-stream spill cap (64 MiB), matching the POSIX executor. */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;

/**
 * Git-for-Windows bash executor.
 *
 * Registers as `ctx.shell` (the `ShellExecutor` base calls `super(ctx, 'shell')`),
 * so it must be mounted inside an isolated realm when the host composition
 * already provides a shell -- which is what the `bash-windows` agent preset
 * does.
 */
export class GitBashExecutor extends LocalBashExecutor {
  static inject = ['subprocess'];

  /**
   * The parent's fields are restated because a plugin Config replaces the
   * inherited schema rather than merging into it. Every numeric budget stays
   * `volatile()` so the parent's `resolve()` can sample it through `.get()`
   * exactly as it does for its own config.
   */
  static Config = z.object({
    /** Default working directory; falls back to `process.cwd()`. */
    cwd: z.string().volatile(),
    /**
     * Absolute path to `bash.exe`. Omit to auto-resolve from `git.exe` on
     * `PATH`, then the well-known install locations.
     */
    bashPath: z.string().volatile(),
    /**
     * Run as a login shell (`-lc`) so `~/.bash_profile` is sourced. The
     * default `false` is what makes the installed Python/Node toolchain
     * reachable without any profile setup.
     */
    loginShell: z.boolean().default(false).volatile(),
    /** Default foreground timeout in milliseconds. */
    timeoutMs: z.number().default(120000).volatile(),
    /** Upper bound for per-call timeout overrides. */
    maxTimeoutMs: z.number().default(600000).volatile(),
    /** Per-stream in-memory output cap; overflow spills to a temp file. */
    maxOutputBytes: z.number().default(64000).volatile(),
    /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
    maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES).volatile(),
    /** Grace period for kill escalation and inherited pipes. */
    graceMs: z.number().default(DEFAULT_GRACE_MS).volatile(),
  });

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx owning context.
   * @param {object} config validated plugin config.
   * @throws {Error} when no Git Bash can be located.
   */
  constructor(ctx, config) {
    super(ctx, config);
    // Resolve once at construction. A missing Git Bash fails the plugin load,
    // so the preset reports a broken row naming the cause instead of failing
    // later on the first command.
    this.bashPath = resolveGitBashPath({ bashPath: config.bashPath?.get?.() ?? config.bashPath });
  }

  /**
   * Run one command through Git Bash.
   *
   * This is the single override. Delegating to `executeArgv` keeps every
   * inherited guarantee -- deadline fusion before preparation, first-cause
   * classification, `onExpiry: 'none'` background mode, spill-backed output,
   * and provider-failure reporting.
   *
   * @param {import('@deepseek-ai/dsh-shell').ShellExecSpec} spec resolved spec.
   * @returns {Promise<import('@deepseek-ai/dsh-shell').ShellProcess>} the live execution handle.
   */
  async execute(spec) {
    const loginShell = this.config.loginShell?.get?.() ?? this.config.loginShell;
    return this.executeArgv(spec, gitBashArgv({
      bashPath: this.bashPath,
      loginShell: loginShell === true,
      command: spec.command,
    }));
  }
}

export default GitBashExecutor;
