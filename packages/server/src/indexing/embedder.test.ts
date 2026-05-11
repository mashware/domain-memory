import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIM, Embedder } from './embedder.js';

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: Float32Array }>;

class FailingEmbedder extends Embedder {
  loadAttempts = 0;

  protected override async loadPipeline(): Promise<FeatureExtractionPipeline> {
    this.loadAttempts += 1;
    throw new Error('synthetic load failure');
  }
}

class SyntheticEmbedder extends Embedder {
  loadAttempts = 0;

  protected override async loadPipeline(): Promise<FeatureExtractionPipeline> {
    this.loadAttempts += 1;
    return async () => ({ data: new Float32Array(EMBEDDING_DIM) });
  }
}

describe('Embedder', () => {
  it('starts in unknown status', () => {
    const e = new SyntheticEmbedder();
    expect(e.status).toBe('unknown');
    expect(e.failureReason).toBeNull();
  });

  it('flips to ready after a successful embed', async () => {
    const e = new SyntheticEmbedder();
    await e.embed('hello');
    expect(e.status).toBe('ready');
    expect(e.failureReason).toBeNull();
  });

  it('flips to failed when the pipeline cannot load', async () => {
    const e = new FailingEmbedder();
    await expect(e.embed('hello')).rejects.toThrow(/synthetic load failure/);
    expect(e.status).toBe('failed');
    expect(e.failureReason).toContain('synthetic load failure');
  });

  it('does not retry the pipeline load after a failure', async () => {
    const e = new FailingEmbedder();
    await expect(e.embed('first')).rejects.toThrow();
    await expect(e.embed('second')).rejects.toThrow(/embedder unavailable/);
    await expect(e.embed('third')).rejects.toThrow(/embedder unavailable/);
    // First call attempts the load; subsequent calls short-circuit on the
    // cached failure status without touching loadPipeline.
    expect(e.loadAttempts).toBe(1);
  });

  it('exposes the configured model name', () => {
    const e = new SyntheticEmbedder({ model: 'Xenova/test-model' });
    expect(e.modelName).toBe('Xenova/test-model');
  });
});
