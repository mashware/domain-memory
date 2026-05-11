// Lazy-loaded local embedder using Transformers.js + all-MiniLM-L6-v2.
// Produces 384-dim, L2-normalized Float32Array embeddings. The model is
// downloaded on first use and cached by Transformers.js under its own
// cache directory.
//
// Failure handling: once the pipeline fails to load (network down, corrupt
// cache, disk full, …) the embedder stays in `failed` state for the rest
// of the process. Callers should check `status` before each query and
// degrade gracefully — re-attempting the load on every search would burn
// CPU on a known-broken setup.

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: Float32Array }>;

export interface EmbedderOptions {
  model?: string;
}

export type EmbedderStatus = 'unknown' | 'ready' | 'failed';

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

export class Embedder {
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  private _status: EmbedderStatus = 'unknown';
  private _failureReason: string | null = null;
  private readonly model: string;

  constructor(options: EmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
  }

  get status(): EmbedderStatus {
    return this._status;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get modelName(): string {
    return this.model;
  }

  async embed(text: string): Promise<Float32Array> {
    if (this._status === 'failed') {
      throw new Error(`embedder unavailable: ${this._failureReason ?? 'unknown'}`);
    }
    try {
      const pipeline = await this.getPipeline();
      const result = await pipeline(text, { pooling: 'mean', normalize: true });
      if (result.data.length !== EMBEDDING_DIM) {
        throw new Error(
          `Unexpected embedding dimension: ${result.data.length} (expected ${EMBEDDING_DIM})`,
        );
      }
      this._status = 'ready';
      return result.data;
    } catch (err) {
      this._status = 'failed';
      this._failureReason =
        err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      out.push(await this.embed(text));
    }
    return out;
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.loadPipeline();
    }
    return this.pipelinePromise;
  }

  // Protected so test subclasses can substitute a synthetic pipeline without
  // touching @xenova/transformers (which would download the real model).
  protected async loadPipeline(): Promise<FeatureExtractionPipeline> {
    const transformers = (await import('@xenova/transformers')) as {
      pipeline: (task: string, model: string) => Promise<FeatureExtractionPipeline>;
    };
    return transformers.pipeline('feature-extraction', this.model);
  }
}

export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
