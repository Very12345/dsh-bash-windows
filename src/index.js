/**
 * Plugin entry for `@very12345/dsh-bash-windows`.
 *
 * Loading this module mounts {@link GitBashExecutor} as `ctx.shell`, exactly
 * the way `@deepseek-ai/dsh-bash-local` mounts its executor: the exported class
 * is the plugin. Because a host provides exactly one `ctx.shell`, this row must
 * sit inside an isolated realm -- the `bash-windows` agent preset supplies one
 * -- when the host composition already mounts a shell executor.
 *
 * The pure helpers are re-exported for tests and for callers that need the
 * path resolution without a composed host. `assertServiceableBashConfig` is
 * re-exported from the parent because this executor inherits its budgets, so
 * the validation that guards them is the parent's, unchanged.
 *
 * @module @very12345/dsh-bash-windows
 */
export {
  WELL_KNOWN_BASH_PATHS,
  candidateGitBashPaths,
  gitBashArgv,
  resolveGitBashPath,
} from './bash.js';
export {
  GitBashExecutor,
  GitBashExecutor as default,
} from './executor.js';
export { assertServiceableBashConfig } from '@deepseek-ai/dsh-bash-local';
