import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function usage() {
  console.log('Usage: npm run presets:ship -- [--message="Publish preset bundle"] [--no-push] [--no-pages] [--no-commit]');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
  return result.stdout ?? '';
}

function status(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'ignore' });
  if (result.error) throw result.error;
  return result.status;
}

function capture(command, args, cwd = repoRoot) {
  return run(command, args, { cwd, stdio: 'pipe' }).trim();
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function writeJson(relativePath, value) {
  await writeFile(path.join(repoRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

async function removeWorktreeContents(worktree) {
  for (const entry of await readdir(worktree)) {
    if (entry === '.git') continue;
    await rm(path.join(worktree, entry), { recursive: true, force: true });
  }
}

async function copyDistContents(worktree) {
  const dist = path.join(repoRoot, 'dist');
  for (const entry of await readdir(dist)) {
    await cp(path.join(dist, entry), path.join(worktree, entry), { recursive: true, force: true });
  }
}

async function publishPages(message, push) {
  const worktree = path.join(os.tmpdir(), `sunset-sky-gh-pages-${process.pid}`);
  await rm(worktree, { recursive: true, force: true });

  run('git', ['fetch', 'origin', 'gh-pages']);
  run('git', ['worktree', 'add', '-B', 'gh-pages', worktree, 'origin/gh-pages']);
  try {
    await removeWorktreeContents(worktree);
    await copyDistContents(worktree);
    await writeFile(path.join(worktree, '.nojekyll'), '');
    run('git', ['add', '-A'], { cwd: worktree });
    if (status('git', ['diff', '--cached', '--quiet'], worktree) !== 0) {
      run('git', ['commit', '-m', message], { cwd: worktree });
    } else {
      console.log('gh-pages already matches dist.');
    }
    if (push) run('git', ['push', 'origin', 'gh-pages'], { cwd: worktree });
  } finally {
    run('git', ['worktree', 'remove', '--force', worktree]);
  }
}

let message;
let push = true;
let pages = true;
let commit = true;

for (const arg of process.argv.slice(2)) {
  if (arg === '--help' || arg === '-h') {
    usage();
    process.exit(0);
  } else if (arg === '--no-push') {
    push = false;
  } else if (arg === '--no-pages') {
    pages = false;
  } else if (arg === '--no-commit') {
    commit = false;
  } else if (arg.startsWith('--message=')) {
    message = arg.slice('--message='.length);
  } else {
    usage();
    throw new Error(`Unknown argument: ${arg}`);
  }
}

message ??= 'Publish preset bundle';

const localPresets = await readJson('presets.json');
await writeJson('public/presets.json', localPresets);
console.log(`Promoted ${Object.keys(localPresets).length} local presets to public/presets.json`);

run('npm', ['run', 'build']);

if (commit) {
  run('git', ['add', 'package.json', 'scripts/ship-presets.mjs', 'presets.json', 'public/presets.json']);
  if (status('git', ['diff', '--cached', '--quiet']) !== 0) {
    run('git', ['commit', '-m', message]);
  } else {
    console.log('No preset changes to commit on main.');
  }
  if (push) {
    const branch = capture('git', ['branch', '--show-current']);
    run('git', ['push', 'origin', branch]);
  }
}

if (pages) {
  await publishPages(message, push);
}
