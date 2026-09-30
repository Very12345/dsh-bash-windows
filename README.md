# @very12345/dsh-bash-windows

A **Git for Windows bash executor** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It adds a selectable session mode — **「Bash 模式（Git Bash）」** — whose tool catalog is identical to the shipped **「标准模式」**, except that the shell tool is `bash` (through the Git Bash you already have) instead of `pwsh`. **No WSL involved.**

## Why this exists

On Windows, DSH deliberately gates the POSIX shell stack off:

| File | Row | Gate |
|---|---|---|
| `dsh-base/cordis.patch.yml` | `tool-bash`, `bash-sandbox` | `disabled: process.platform === 'win32'` |
| `dsh-base/cordis.patch.yml` | `pwsh-sandbox`, `tool-pwsh` | `disabled: process.platform !== 'win32'` |
| `dsh-web-app/cordis.patch.yml` | `tool-bash`, `tool-pwsh` | `disabled: true` (moved to presets) |
| `presets/standard.patch.yml` | `tool-bash` / `tool-pwsh` | win32 / non-win32 split |

So `bash` is not merely unconfigured on Windows — it is switched off at three layers. This plugin supplies the missing piece: a `ctx.shell` provider that runs commands through Git Bash, plus an agent preset that mounts it.

## It reuses your installed toolchain — automatically

This is the main practical question, and it was measured rather than assumed. A **non-login** `bash -c` inherits the Windows `PATH` and MSYS2 converts it to `/c/...` form on its own. No profile, no `PATH` injection, no wrapper script:

```
$ uname -s                    → MINGW64_NT-10.0-22621
$ command -v python           → /d/Code/anaconda/python
$ python --version            → Python 3.13.9
$ command -v node             → /d/code/nodejs/node
$ node --version              → v24.18.0
$ command -v pip              → /d/Code/anaconda/Scripts/pip
$ command -v git              → /mingw64/bin/git
$ pwd                         → the session working directory
```

That is why `loginShell` defaults to `false`. `-l` is available as an escape hatch for users who want their `~/.bash_profile` sourced, but it is not needed for toolchain access.

## Security: this bash is NOT sandboxed

**Read this before using the mode.**

The `bash` tool in this mode runs with the harness process's own authority. It is **not** confined by DSH's file sandbox, unlike the `pwsh` tool in 「标准模式」 (which goes through `dsh-pwsh-sandbox`).

This is a platform constraint, not a shortcut. `dsh-bash-sandbox` cannot be used here, because **MSYS2 cannot start under the Windows ACL sandbox**. Measured with a directly constructed `AclSandbox` in `workspace-write` mode:

| Program | Runtime | Result |
|---|---|---|
| `node.exe` | native Win32 | ✅ `exit=0` |
| `git.exe` | native Win32 | ✅ `exit=0` |
| `bash.exe` (`bin` and `usr/bin` copies) | MSYS2 | ❌ `STATUS_DLL_INIT_FAILED` (3221225794) |
| `sh.exe` | MSYS2 | ❌ same |

The failure is `fatal error - couldn't create signal pipe, Win32 error 5` (access denied). Ruled out as causes: `stdio: 'pipe'` vs `'inherit'` (both fail), and pointing `TMP`/`TEMP`/`TMPDIR` at a granted directory (still fails). The root cause is a documented boundary of `dsh-sandbox-windows-acl`: a write-restricted token cannot create named pipes, and MSYS2's signal pipe is one.

The sandbox itself is healthy — native Win32 binaries run fine under it.

**What this plugin does about it:** the executor does not claim a sandbox mode (`sandboxMode` stays `undefined`), so `dsh-tool-bash` advertises **no `sandbox_permissions` parameter** and offers no escalation path that does not exist. The mode is labelled as unsandboxed in its own description. There is no pretense of confinement.

If you need confinement on Windows, use 「标准模式」 with `pwsh`, or run the harness inside WSL/a container where the POSIX sandbox stack is available.

## Install

### 1. The bundle

```sh
# from npm (the normal third-party path)
dsh plugin add @very12345/dsh-bash-windows

# from a git checkout
dsh plugin add https://github.com/Very12345/dsh-bash-windows

# from a local directory
dsh plugin add file:D:\Code\Atomcode\dsh-bash-windows
```

Or pack it first and install the tarball:

```sh
cd D:\Code\Atomcode\dsh-bash-windows
npm pack
# then install the produced very12345-dsh-bash-windows-0.1.0.tgz
dsh plugin add file:D:\Code\Atomcode\dsh-bash-windows\very12345-dsh-bash-windows-0.1.0.tgz
```

Restart the host afterwards.

> Installing a bundle modifies the profile's `package.json` / `pnpm-lock.yaml` and therefore affects **every** session in that profile. Roll back with `dsh plugin remove @very12345/dsh-bash-windows`.

### 2. Nothing else

`presets/bash-windows.patch.yml` is part of the bundle: `dsh.bundle.patch` lists it, so the preset declaration is installed and registered by the same `dsh plugin add`. There is no second step and no directory to copy.

This is worth stating because older DSH versions discovered presets by scanning `$DSH_HOME/.agent-presets`. **That mechanism is retired.** In 0.2.0 the registry "neither scans directories nor accepts preset paths" — a preset is an `@deepseek-ai/dsh-agent-preset` plugin row contributed by a bundle patch, which is exactly what this package ships.

Restart the host, then create a **new** session and pick 「Bash 模式（Git Bash）」. A session can only switch presets while it has produced nothing, which is the existing DSH rule.

### Making it the default (optional)

To make new sessions start in this mode, add to your profile's `cordis.patch.yml`:

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: bash-windows
```

`cordis.patch.yml` in this package is deliberately empty and is the place to put that, if you want it applied from here.

## Configuration

The preset row accepts these fields:

| Field | Default | Meaning |
|---|---|---|
| `bashPath` | auto-resolved | Absolute path to `bash.exe`. Set this only when auto-resolution picks the wrong install. |
| `loginShell` | `false` | Use `-lc` so `~/.bash_profile` is sourced. |
| `cwd` | `process.cwd()` | Default working directory. |
| `timeoutMs` | `120000` | Default foreground timeout. |
| `maxTimeoutMs` | `600000` | Cap for per-call `timeoutMs` overrides. |
| `maxOutputBytes` | `64000` | Per-stream in-memory cap; overflow spills to a temp file. |
| `maxSpillBytes` | `67108864` | Per-stream spill-file cap. |
| `graceMs` | `3000` | Grace period for kill escalation and pipe draining. |

The budgets are inherited from `@deepseek-ai/dsh-bash-local`, so their meaning and validation are the parent's, unchanged.

`bash.exe` resolution order:

1. `bashPath`, which must exist (otherwise a hard error).
2. Derived from `git.exe` on `PATH`: Git for Windows lays out `<root>\cmd\git.exe` beside `<root>\bin\bash.exe`, so the sibling `bin` directory follows from whichever `cmd` directory was found. This keeps it correct for non-standard install locations.
3. `C:\Program Files\Git\bin\bash.exe`
4. `C:\Program Files (x86)\Git\bin\bash.exe`
5. `D:\Code\Git\bin\bash.exe`

If all fail, the error lists every attempted path so you can copy the right one into `bashPath`. A missing Git Bash fails at plugin load, so the preset appears as a broken row naming the cause rather than failing on the first command.

## Working with paths

Git Bash wants Unix-style paths:

| | |
|---|---|
| ✅ | `cd /d/Code/Project` |
| ✅ | `cat "D:\Code\my file.txt"` (quoted; MSYS2 translates it) |
| ❌ | `cd D:\Code\Project` (bare backslashes) |

The command string is passed as a single `argv` element to `bash -c`. There is no extra quoting or escaping layer, so what you write is exactly what bash parses.

CRLF line endings can break shell scripts. Use a `.gitattributes` with `*.sh text eol=lf`, or run `dos2unix`.

## What the mode contains

The preset is a copy of the shipped `standard` composition with **only the shell section changed**. Verified by parsing both files and deep-comparing every other row: they are identical, and the shell section replaces `tool-bash` + `tool-pwsh` with one `shell` group.

Two deliberate structural choices:

**The executor is isolated.** The preset wraps it in `cordis:group` with `isolate: {shell: true}`. The registry audits every mounted preset and **rejects** one whose row publishes a service into the root realm (`Preset services require isolate realms`). On Windows the host plane already owns `ctx.shell` with `dsh-pwsh-sandbox`, so an unisolated mount would both collide with it and be rejected as a leak. This is also why this bundle's `cordis.patch.yml` is empty rather than mounting the provider at host level.

**`shell-env` stays on the host plane.** It publishes `DSH_WEB_URL`/`DSH_WEB_MODE`, and `dsh-web-app` injects it before any session exists. Moving it behind a preset realm would stop those variables reaching the model. `tool-bash` reads that host registry through its scope chain, exactly as it does in `standard`.

### Why subclass `dsh-bash-local`?

`LocalBashExecutor` hardcodes `['bash', '-c', command]` and exposes `executeArgv(spec, argv)` precisely so a subclass can substitute the shell argv "at an execution boundary". On Windows `bash.exe` is not on `PATH`, so the absolute path must be injected somewhere — that substitution is the whole of the override.

Everything else is inherited deliberately, so this executor is not a lookalike:

- `resolve()` fills and caps `workdir`, `timeoutMs`, `onExpiry`, `stdoutMaxBytes` from the same schema fields;
- `executeArgv()` owns deadline fusion, first-cause `timedOut`/`aborted` classification, the synchronous-spawn-failure path, the provider-failure note, and the background read merge;
- `spawnSpec()` applies `maxSpillBytes`, the model-friendly `ENV_OVERRIDES`, and the caller `env`/`dshEnv` layering.

`dsh-tool-bash` therefore renders exactly as it does on POSIX — `(no output)`, `[output truncated; full output: <path>]`, `[timed out after <ms>ms]`, `[exit code: N]` — without a line of duplicated rendering logic here.

## Tests

```
npm test
```

24 tests:

- `test/bash.test.js` — pure helpers, no harness peers needed. Path resolution order, case-insensitive `PATH`, explicit-path validation, argv construction, command preservation.
- `test/executor.test.js` — the executor over a **real** `ctx.subprocess` provider. Asserts it mounts as `ctx.shell`, runs through MINGW (not WSL), reaches the installed Python/Node/git, delivers `cwd`, classifies non-zero exits and timeouts, reports no sandbox mode, streams and kills background processes, and that the `isolate` realm both contains the service and is required (an unisolated mount is detected as a root-realm leak). It also parses the shipped preset and asserts the declaration shape.

The integration tests need the `@deepseek-ai/*` peers resolvable from this directory. `node_modules` is a junction to a peer tree extracted from the harness's own `app.asar` for that purpose; when it is absent, those tests skip with a reason instead of failing. That junction is a local test convenience and is gitignored.

## Layout

```
src/bash.js                        pure path resolution + argv construction (no peers)
src/executor.js                    GitBashExecutor extends LocalBashExecutor
src/index.js                       plugin entry (the exported class IS the plugin)
presets/bash-windows.patch.yml     the agent-preset declaration (bundle patch)
cordis.patch.yml                   intentionally empty; see the comment inside
test/                              pure + integration suites
```

## Compatibility

Built and verified against DSH **0.2.0-rc.2** (`@deepseek-ai/dsh-bash-local` 0.2.0-rc.2, `@deepseek-ai/dsh-agent-preset-registry` 0.2.0-rc.2).

The 0.2.0 shell API differs from 0.1.5 in ways this package depends on: `Config` fields are `volatile()` and read through `.get()`, `resolve()` carries an `onExpiry`, the execution call is `execute()`, and a background run is `resolve({ onExpiry: 'none' })`. The parent's `executeArgv()` seam and its no-settings-section constructor are also 0.2.0 facts. On a 0.1.5 host this package will not load.

## Rollback

```powershell
dsh plugin remove @very12345/dsh-bash-windows
```

Then restart the host. The mode disappears from the picker; other modes are unaffected. Sessions already running on the preset keep running until they end.

## Known limitations

- **Unconfined** — see the security section above. This is the significant one.
- **No persistent shell** — every call is a fresh `bash -c`. State does not survive between calls; pass `workdir` instead of `cd`.
- **`loginShell: true` may add output** — sourcing a profile can print banners or change `cwd`. Leave it `false` unless you specifically need it.
- **The preset is a copy, not a patch** — DSH has no patch semantics at the preset layer, so upgrading the harness does not update this preset. Re-copy `standard.patch.yml` and re-apply the shell section when that matters. The shipped `cordis`, `ptc`, and `minimal` presets accept the same cost.
- **Installation is profile-wide** — installing the bundle touches every session in the profile.

## License

MIT
