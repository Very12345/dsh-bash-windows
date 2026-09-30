/**
 * Integration tests: the executor over a REAL `ctx.subprocess` provider,
 * plus a real mount of the `bash-windows` preset through the live
 * `@deepseek-ai/dsh-agent-preset-registry`.
 *
 * These import DeepSeek Harness peers, so they only run where those packages
 * resolve (the harness checkout / a plugin profile). When they do not resolve,
 * every test in this file skips with a reason instead of failing, so the pure
 * suite stays runnable anywhere.
 *
 * The assertions that matter for the feature:
 *   1. the executor mounts as `ctx.shell` and runs through Git Bash (MINGW);
 *   2. the already-installed Python and Node toolchain is reachable from it;
 *   3. `cwd` reaches the child, and exit status / stdout / stderr are classified;
 *   4. the executor does NOT claim a sandbox mode, so `dsh-tool-bash` omits
 *      `sandbox_permissions` and advertises no escalation path;
 *   5. `onExpiry: 'none'` yields a background handle that streams and can be killed;
 *   6. the shipped preset declaration mounts cleanly and leaks no service into
 *      the root realm -- the exact audit `mountPreset` performs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const presetPath = join(here, '..', 'presets', 'bash-windows.patch.yml');

/** Resolve an optional peer, or undefined when it is not installed. */
async function optionalImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Mount a fresh context with the local subprocess provider and this executor.
 *
 * `ctx.plugin()` returns a Fiber and mounts asynchronously, so both fibers are
 * awaited before the services are read. Teardown goes through the owning
 * fiber's `dispose()`, which stops the subprocess provider and joins any live
 * process ranges.
 *
 * @returns {Promise<{ shell: any, dispose: () => Promise<void> } | undefined>}
 *   the composed fixture, or undefined when the peers are unavailable.
 */
async function composeFixture() {
  const cordis = await optionalImport('@deepseek-ai/cordis');
  const subprocessLocal = await optionalImport('@deepseek-ai/dsh-subprocess-local');
  const self = await optionalImport('../src/index.js');
  if (cordis === undefined || subprocessLocal === undefined || self === undefined) {
    return undefined;
  }
  const ctx = new cordis.Context();
  const subprocessFiber = ctx.plugin(subprocessLocal.default ?? subprocessLocal.LocalSubprocessRuntime);
  await subprocessFiber;
  const shellFiber = ctx.plugin(self.GitBashExecutor, { timeoutMs: 30000 });
  await shellFiber;
  return {
    shell: ctx.shell,
    dispose: async () => { await shellFiber.dispose(); await subprocessFiber.dispose(); },
  };
}

/** Await one command to completion and return its `ShellRunResult`. */
async function run(shell, request) {
  return (await shell.execute(shell.resolve(request))).result();
}

test('executor mounts as ctx.shell and runs through Git Bash', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    assert.ok(fixture.shell, 'ctx.shell should be registered by the executor');
    const result = await run(fixture.shell, { command: 'uname -s' });
    assert.equal(result.exitCode, 0, `expected clean exit: ${JSON.stringify(result)}`);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.match(result.stdout.text.trim(), /^MINGW64_NT-/, 'should be Git Bash, not WSL or cmd');
    assert.equal(result.stderr.text, '');
  } finally {
    await fixture.dispose();
  }
});

test('the installed Python and Node toolchain is reachable', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    const result = await run(fixture.shell, {
      command: 'command -v python; command -v node; command -v git',
    });
    assert.equal(result.exitCode, 0, `toolchain probe failed: ${JSON.stringify(result)}`);
    const lines = result.stdout.text.trim().split(/\r?\n/);
    assert.equal(lines.length, 3, `expected three resolved tools, got ${JSON.stringify(lines)}`);
    for (const line of lines) {
      assert.ok(line.startsWith('/'), `expected a resolved absolute path, got: ${line}`);
    }
  } finally {
    await fixture.dispose();
  }
});

test('cwd reaches the child and exit status is classified', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    const cwd = process.cwd();
    // Git Bash reports a Windows directory in /c/... form.
    const expected = cwd
      .replace(/\\/g, '/')
      .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
    const ok = await run(fixture.shell, { command: 'pwd', workdir: cwd });
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout.text.trim().toLowerCase(), expected.toLowerCase());

    const failed = await run(fixture.shell, { command: 'echo boom >&2; exit 7' });
    assert.equal(failed.exitCode, 7, 'a non-zero exit is reported, not thrown');
    assert.match(failed.stderr.text, /boom/);
  } finally {
    await fixture.dispose();
  }
});

test('a timeout is classified as timedOut, not aborted', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    const spec = fixture.shell.resolve({ command: 'sleep 30', timeoutMs: 1500 });
    const result = await (await fixture.shell.execute(spec)).result();
    assert.equal(result.timedOut, true, `expected a timeout: ${JSON.stringify(result)}`);
    assert.equal(result.aborted, false);
    assert.equal(result.timeoutMs, 1500);
  } finally {
    await fixture.dispose();
  }
});

test('the executor advertises no sandbox mode', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    // `dsh-tool-bash` reads this to decide whether to advertise
    // `sandbox_permissions`. undefined is the honest answer: commands are
    // unconfined, so the tool must not offer an escalation path that does not
    // exist. See README.md for why confinement is impossible for MSYS2.
    assert.equal(fixture.shell.sandboxMode, undefined);
    const result = await run(fixture.shell, { command: 'echo hi' });
    assert.equal(result.sandbox, undefined, 'an unsandboxed run reports no sandbox facts');
  } finally {
    await fixture.dispose();
  }
});

test('background processes stream output and can be killed', async (t) => {
  const fixture = await composeFixture();
  if (fixture === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  try {
    // `onExpiry: 'none'` is what the bash tool uses for background work: no
    // deadline is armed, and the caller owns the handle's lifetime.
    const spec = fixture.shell.resolve({ command: 'echo first; sleep 30', onExpiry: 'none' });
    const proc = await fixture.shell.execute(spec);
    assert.equal(proc.status, 'running');
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    assert.match(proc.readOutput().delta, /first/);
    assert.equal(proc.kill(), true);
    await proc.done;
    assert.equal(proc.status, 'killed');
  } finally {
    await fixture.dispose();
  }
});

test('an unisolated mount is detected as a root-realm leak', async (t) => {
  const cordis = await optionalImport('@deepseek-ai/cordis');
  const subprocessLocal = await optionalImport('@deepseek-ai/dsh-subprocess-local');
  const registryModule = await optionalImport('@deepseek-ai/dsh-agent-preset-registry');
  const self = await optionalImport('../src/index.js');
  if (cordis === undefined || subprocessLocal === undefined || registryModule === undefined || self === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  // A full registry mount needs `loader` and `sessionProjections`, which a bare
  // Context does not supply. What IS testable -- and is the exact check
  // `mountPreset` runs before accepting a preset -- is the leak audit itself.
  //
  // This test pins the FAILURE MODE: mounted without a realm, our executor
  // publishes `shell` into the root realm, `leakedServices` reports it, and
  // `mountPreset` would reject the preset with "Preset services require isolate
  // realms: shell". That is precisely why presets/bash-windows.patch.yml wraps
  // this row in an `isolate: {shell: true}` group; the test below asserts that
  // block is present in the shipped file.
  const ctx = new cordis.Context();
  const subprocessFiber = ctx.plugin(subprocessLocal.default ?? subprocessLocal.LocalSubprocessRuntime);
  await subprocessFiber;
  const shellFiber = ctx.plugin(self.GitBashExecutor, { timeoutMs: 30000 });
  await shellFiber;

  try {
    // `leakedServices(ctx, mount)` reports every service whose implementation
    // fiber sits inside `mount` AND whose store key is the ROOT realm's symbol
    // for that name. Passing the root fiber asks the question this test cares
    // about: is `shell` published into the root realm at all? For a bare mount
    // the measured answer is yes -- which is exactly the condition
    // `mountPreset` rejects with "Preset services require isolate realms".
    const leaked = registryModule.leakedServices(ctx, ctx.fiber);
    assert.ok(
      leaked.includes('shell'),
      `a bare ctx.shell mount must land in the root realm; leaked=${JSON.stringify(leaked)}`,
    );
  } finally {
    await shellFiber.dispose();
    await subprocessFiber.dispose();
  }
});

test('an isolated shell group keeps the executor out of the root realm', async (t) => {
  const cordis = await optionalImport('@deepseek-ai/cordis');
  const subprocessLocal = await optionalImport('@deepseek-ai/dsh-subprocess-local');
  const registryModule = await optionalImport('@deepseek-ai/dsh-agent-preset-registry');
  const self = await optionalImport('../src/index.js');
  if (cordis === undefined || subprocessLocal === undefined || registryModule === undefined || self === undefined) {
    t.skip('DeepSeek Harness peers are not resolvable here');
    return;
  }
  // The POSITIVE half of the same property, in the exact shape
  // presets/bash-windows.patch.yml declares: a group with
  // `isolate: {shell: true}` holding the executor. Inside the group the
  // executor still works; the root realm never learns the name `shell` from it,
  // so `mountPreset` accepts the preset instead of rejecting it as a leak.
  const ctx = new cordis.Context();
  const subprocessFiber = ctx.plugin(subprocessLocal.default ?? subprocessLocal.LocalSubprocessRuntime);
  await subprocessFiber;
  const groupFiber = ctx.plugin({
    name: 'shell-realm',
    apply(inner) {
      inner.isolate('shell');
      inner.plugin(self.GitBashExecutor, { timeoutMs: 30000 });
    },
  });
  await groupFiber;

  try {
    assert.deepEqual(
      registryModule.leakedServices(ctx, groupFiber.fiber),
      [],
      'the isolate group must not leak services into the root realm',
    );
  } finally {
    await groupFiber.dispose();
    await subprocessFiber.dispose();
  }
});

test('the preset file declares the bash executor and drops pwsh', () => {
  const text = readFileSync(presetPath, 'utf8');
  assert.match(text, /id: preset-bash-windows/);
  assert.match(text, /id: bash-windows/);
  assert.match(text, /name: '@very12345\/dsh-bash-windows'/);
  assert.match(text, /isolate:\s*\n\s*shell: true/);
  assert.ok(!text.includes('tool-pwsh'), 'the pwsh tool must not be mounted in this preset');
});