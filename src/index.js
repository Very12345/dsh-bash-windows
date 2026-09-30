/** Profile-wide Git Bash switch; executor helpers remain separately exported. */
export {
  WELL_KNOWN_BASH_PATHS,
  candidateGitBashPaths,
  gitBashArgv,
  resolveGitBashPath,
} from './bash.js';
export {
  GitBashExecutor,
} from './executor.js';
export { assertServiceableBashConfig } from '@deepseek-ai/dsh-bash-local';

export { GitBashSwitcher, GitBashSwitcher as default } from './switcher.js';
