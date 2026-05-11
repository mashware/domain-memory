import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBootstrap } from './bootstrap.js';
import { silenceOutput, writeKnowledgeFixture } from './test-helpers.js';

describe('runBootstrap', () => {
  let root: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dm-bootstrap-'));
    restoreOutput = silenceOutput();
  });

  afterEach(() => {
    restoreOutput();
    rmSync(root, { recursive: true, force: true });
  });

  function seedSource(): void {
    const src = join(root, 'src');
    mkdirSync(join(src, 'checkout'), { recursive: true });
    mkdirSync(join(src, 'auth'), { recursive: true });
    mkdirSync(join(src, 'trivial'), { recursive: true });
    writeFileSync(join(src, 'checkout', 'CheckoutController.ts'), 'export {};\n');
    writeFileSync(join(src, 'checkout', 'TaxCalculator.ts'), 'export {};\n');
    writeFileSync(join(src, 'checkout', 'StripeGateway.ts'), 'export {};\n');
    writeFileSync(join(src, 'checkout', 'WebhookController.ts'), 'export {};\n');
    writeFileSync(join(src, 'auth', 'AuthService.ts'), 'export {};\n');
    writeFileSync(join(src, 'auth', 'JwtAuth.ts'), 'export {};\n');
    writeFileSync(join(src, 'auth', 'Session.ts'), 'export {};\n');
    writeFileSync(join(src, 'trivial', 'one.ts'), 'export {};\n'); // only 1 file
  }

  it('writes a plan file with the new candidates', async () => {
    seedSource();
    const code = await runBootstrap({ root, sourceRoot: 'src' });
    expect(code).toBe(0);

    const planPath = join(root, '.domain-memory', 'bootstrap-plan.md');
    expect(existsSync(planPath)).toBe(true);

    const content = readFileSync(planPath, 'utf-8');
    expect(content).toContain('# Bootstrap plan');
    expect(content).toContain('checkout');
    expect(content).toContain('auth');
    // trivial has only 1 file, under the default min-files threshold
    expect(content).not.toContain('### [ ] trivial');
  });

  it('marks already-documented candidates as [x] done', async () => {
    seedSource();
    // Seed a pre-existing feature under the same slug.
    writeKnowledgeFixture({
      root,
      featureSlug: 'checkout',
      featureId: 'feat_checkout_existing',
      filePath: 'src/checkout/CheckoutController.ts',
    });

    const code = await runBootstrap({ root, sourceRoot: 'src' });
    expect(code).toBe(0);

    const content = readFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'utf-8',
    );
    expect(content).toMatch(/\[x\] checkout/);
    expect(content).toContain('already documented');
    expect(content).toMatch(/\[ \] auth/);
  });

  it('skips directories under the min-files threshold', async () => {
    const src = join(root, 'src');
    mkdirSync(join(src, 'tiny'), { recursive: true });
    writeFileSync(join(src, 'tiny', 'a.ts'), 'export {};\n');

    const code = await runBootstrap({ root, sourceRoot: 'src', minFiles: 5 });
    expect(code).toBe(0);

    const planPath = join(root, '.domain-memory', 'bootstrap-plan.md');
    if (existsSync(planPath)) {
      const content = readFileSync(planPath, 'utf-8');
      expect(content).not.toContain('tiny');
    }
  });

  it('refuses to overwrite an existing plan without --force', async () => {
    seedSource();
    await runBootstrap({ root, sourceRoot: 'src' });

    const original = readFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'utf-8',
    );

    // Re-run without --force. Should fail and leave file untouched.
    const code = await runBootstrap({ root, sourceRoot: 'src' });
    expect(code).toBe(1);
    const after = readFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'utf-8',
    );
    expect(after).toBe(original);
  });

  it('overwrites the plan when --force is passed', async () => {
    seedSource();
    await runBootstrap({ root, sourceRoot: 'src' });
    // Edit the file manually.
    writeFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'manually edited',
      'utf-8',
    );

    const code = await runBootstrap({ root, sourceRoot: 'src', force: true });
    expect(code).toBe(0);

    const content = readFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'utf-8',
    );
    expect(content).not.toBe('manually edited');
    expect(content).toContain('# Bootstrap plan');
  });

  it('ignores node_modules, vendor, and dotfiles', async () => {
    const src = join(root, 'src');
    mkdirSync(join(src, 'node_modules/big-dep'), { recursive: true });
    mkdirSync(join(src, 'vendor/other'), { recursive: true });
    mkdirSync(join(src, '.hidden'), { recursive: true });
    mkdirSync(join(src, 'real'), { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(src, 'node_modules', 'big-dep', `${i}.ts`), '');
      writeFileSync(join(src, 'vendor', 'other', `${i}.ts`), '');
      writeFileSync(join(src, '.hidden', `${i}.ts`), '');
      writeFileSync(join(src, 'real', `${i}.ts`), '');
    }

    await runBootstrap({ root, sourceRoot: 'src' });

    const content = readFileSync(
      join(root, '.domain-memory', 'bootstrap-plan.md'),
      'utf-8',
    );
    expect(content).toContain('real');
    expect(content).not.toContain('node_modules');
    expect(content).not.toContain('vendor');
    expect(content).not.toContain('.hidden');
  });

  it('fails cleanly when the source root does not exist', async () => {
    const code = await runBootstrap({ root, sourceRoot: 'nonexistent' });
    expect(code).toBe(1);
  });
});
