import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from './timeout.js';

describe('withTimeout', () => {
  it('resolves when the promise finishes inside the budget', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 200);
    });

    await expect(withTimeout(slow, 20, 'slow-op')).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('carries the elapsed budget and label on the error', async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 100);
    });

    try {
      await withTimeout(slow, 10, 'label-test');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.timeoutMs).toBe(10);
      expect(te.message).toContain('label-test');
      expect(te.message).toContain('10ms');
    }
  });

  it('propagates a rejection from the inner promise without wrapping it', async () => {
    const err = new Error('inner boom');
    await expect(withTimeout(Promise.reject(err), 100)).rejects.toBe(err);
  });
});
