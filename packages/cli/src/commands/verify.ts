// Marks an entry as verified right now: bumps last_verified (and
// updated_at) without touching the body. Resets the lazy confidence
// decay clock, so this is how a human says "I looked at this and it
// is still correct".

import pc from 'picocolors';
import { createServerContext, SaveKnowledgeFlow } from '@mashware/domain-memory-server';

export interface VerifyOptions {
  root: string;
  entryId: string;
}

export async function runVerify(opts: VerifyOptions): Promise<number> {
  const ctx = createServerContext(opts.root);
  const flow = new SaveKnowledgeFlow({
    db: ctx.db,
    paths: ctx.paths,
    entries: ctx.entries,
    indexer: ctx.indexer,
  });

  const result = await flow.verify(opts.entryId);
  ctx.db.close();

  if (result.status === 'ok') {
    process.stdout.write(
      pc.green(`Verified ${result.entry_id}`) +
        pc.dim(` (confidence reset to effective ${result.confidence_after})\n`),
    );
    return 0;
  }

  if (result.status === 'error' && result.code === 'not_found') {
    process.stderr.write(pc.red(`No entry found with id: ${opts.entryId}\n`));
    return 1;
  }

  process.stderr.write(
    pc.red(`Verify failed: ${JSON.stringify(result)}\n`),
  );
  return 1;
}
