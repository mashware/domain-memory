#!/usr/bin/env node
// Domain Memory CLI — entry point.
// Commands: reindex, doctor. More coming (install, mode, check-drift).

import { Command } from 'commander';
import pc from 'picocolors';
import { runReindex } from './commands/reindex.js';
import { runDoctor } from './commands/doctor.js';
import { runInstall } from './commands/install.js';
import { runMode } from './commands/mode.js';
import { runCheckDrift, readStdinLines } from './commands/check-drift.js';
import { runVerify } from './commands/verify.js';
import { runWeb } from './commands/web.js';
import { runHttp } from './commands/http.js';
import { runDecay } from './commands/decay.js';
import { runExport } from './commands/export.js';
import { runBootstrap } from './commands/bootstrap.js';
import { runEnrich } from './commands/enrich.js';
import type { ClientId } from './install/detect.js';
import type { InstallMode } from './install/writers.js';

const program = new Command();

program
  .name('domain-memory')
  .description('Domain Memory — business-domain knowledge store for software projects')
  .version('0.1.0');

program
  .command('reindex')
  .description('Rebuild SQLite index and embeddings from the markdown files on disk')
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('--fresh', 'Delete the existing index.sqlite before rebuilding', false)
  .action(async (opts: { root: string; fresh: boolean }) => {
    await runReindex({ root: opts.root, fresh: opts.fresh });
  });

program
  .command('install')
  .description('Configure domain-memory for a project — interactive by default')
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option(
    '-m, --mode <mode>',
    'Install mode: local | team-direct | team-validated',
  )
  .option(
    '-c, --clients <list>',
    'Comma-separated client ids to configure (skips the prompt)',
  )
  .option('-y, --yes', 'Accept defaults without prompting', false)
  .action(
    async (opts: {
      root: string;
      mode?: string;
      clients?: string;
      yes: boolean;
    }) => {
      const mode = opts.mode as InstallMode | undefined;
      const clients = opts.clients
        ? (opts.clients.split(',').map((s) => s.trim()) as ClientId[])
        : undefined;
      await runInstall({ root: opts.root, mode, clients, yes: opts.yes });
    },
  );

program
  .command('doctor')
  .description('Run health checks on the local domain-memory installation')
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .action(async (opts: { root: string }) => {
    const code = await runDoctor({ root: opts.root });
    process.exit(code);
  });

program
  .command('mode [target]')
  .description(
    'Show or switch install mode (local, team-direct, team-validated)',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .action(async (target: string | undefined, opts: { root: string }) => {
    const code = await runMode({ root: opts.root, target });
    process.exit(code);
  });

program
  .command('verify <entry-id>')
  .description(
    'Mark an entry as verified now — bumps last_verified without changing the body',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .action(async (entryId: string, opts: { root: string }) => {
    const code = await runVerify({ root: opts.root, entryId });
    process.exit(code);
  });

program
  .command('bootstrap')
  .description(
    'Scan a mature project and write a plan for the agent to document it',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('-s, --source-root <path>', 'Path to the code directory (default: src/, app/, lib/)')
  .option('--min-files <n>', 'Minimum file count per candidate', '3')
  .option('--top-n <n>', 'Keep at most N candidates', '20')
  .option('--force', 'Overwrite an existing bootstrap-plan.md', false)
  .action(
    async (opts: {
      root: string;
      sourceRoot?: string;
      minFiles: string;
      topN: string;
      force: boolean;
    }) => {
      const code = await runBootstrap({
        root: opts.root,
        sourceRoot: opts.sourceRoot,
        minFiles: Number(opts.minFiles) || 3,
        topN: Number(opts.topN) || 20,
        force: opts.force,
      });
      process.exit(code);
    },
  );

program
  .command('enrich <target>')
  .description(
    'Print a guided prompt to deepen an existing feature entry (by id or slug)',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .action(async (target: string, opts: { root: string }) => {
    const code = await runEnrich({ root: opts.root, target });
    process.exit(code);
  });

program
  .command('decay')
  .description(
    'Persist the lazy confidence decay into stored values on disk (maintenance)',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('--write', 'Actually write the changes (default: dry run)', false)
  .action(async (opts: { root: string; write: boolean }) => {
    const code = await runDecay({ root: opts.root, write: opts.write });
    process.exit(code);
  });

program
  .command('export')
  .description('Render every web viewer page into a static directory')
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('-o, --out <dir>', 'Output directory', 'domain-memory-export')
  .action(async (opts: { root: string; out: string }) => {
    const code = await runExport({ root: opts.root, out: opts.out });
    process.exit(code);
  });

program
  .command('web')
  .description('Start the local web viewer (read-only)')
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('-p, --port <port>', 'Port to bind', '4373')
  .option(
    '--include-private',
    'Show <private> blocks verbatim (off by default — opt in only when you trust everyone on this loopback)',
    false,
  )
  .action(
    async (opts: {
      root: string;
      port: string;
      includePrivate: boolean;
    }) => {
      const port = Number(opts.port) || 4373;
      await runWeb({
        root: opts.root,
        port,
        includePrivate: opts.includePrivate,
      });
    },
  );

program
  .command('http')
  .description(
    'Start an HTTP API exposing the MCP tools (search, save, stage, read-staging, check-drift, resolve-topic-key)',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('-p, --port <port>', 'Port to bind', '4374')
  .option('--host <host>', 'Hostname to bind to (default 127.0.0.1)', '127.0.0.1')
  .action(async (opts: { root: string; port: string; host: string }) => {
    const port = Number(opts.port) || 4374;
    await runHttp({ root: opts.root, port, host: opts.host });
  });

program
  .command('check-drift')
  .description(
    'Given a list of file paths, print the knowledge entries that reference them',
  )
  .option('-r, --root <path>', 'Project root (defaults to cwd)', process.cwd())
  .option('-f, --files <list>', 'Comma-separated file paths', '')
  .option('--json', 'Emit JSON instead of a human-readable report', false)
  .action(
    async (opts: { root: string; files: string; json: boolean }) => {
      const filesFromFlag = opts.files
        ? opts.files.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : [];
      const filesFromStdin = filesFromFlag.length === 0 ? await readStdinLines() : [];
      const files = filesFromFlag.length > 0 ? filesFromFlag : filesFromStdin;
      const code = await runCheckDrift({ root: opts.root, files, json: opts.json });
      process.exit(code);
    },
  );

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(
    pc.red(
      `domain-memory: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    ),
  );
  process.exit(1);
});
