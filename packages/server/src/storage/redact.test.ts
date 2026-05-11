import { describe, expect, it } from 'vitest';
import { containsPrivate, stripPrivate } from './redact.js';

describe('stripPrivate', () => {
  it('returns empty string unchanged', () => {
    expect(stripPrivate('')).toBe('');
  });

  it('returns text unchanged when there are no markers', () => {
    expect(stripPrivate('Hello world')).toBe('Hello world');
  });

  it('replaces a single block with the default placeholder', () => {
    expect(stripPrivate('Foo <private>secret</private> bar')).toBe(
      'Foo [redacted] bar',
    );
  });

  it('replaces multiple blocks independently', () => {
    expect(
      stripPrivate('a <private>x</private> b <private>y</private> c'),
    ).toBe('a [redacted] b [redacted] c');
  });

  it('handles multiline blocks', () => {
    const input = `Line 1
<private>
multi
line
secret
</private>
Line 2`;
    expect(stripPrivate(input)).toBe('Line 1\n[redacted]\nLine 2');
  });

  it('collapses nested blocks pessimistically', () => {
    const input = '<private>outer <private>inner</private> outer</private>';
    expect(stripPrivate(input)).toBe('[redacted]');
  });

  it('redacts everything from a stray opening tag to the end', () => {
    expect(stripPrivate('Before <private>oops never closed')).toBe(
      'Before [redacted]',
    );
  });

  it('redacts everything from the start to a stray closing tag', () => {
    expect(stripPrivate('oops never opened</private> after')).toBe(
      '[redacted] after',
    );
  });

  it('respects a custom replacement', () => {
    expect(
      stripPrivate('Foo <private>x</private>', { replacement: '***' }),
    ).toBe('Foo ***');
  });

  it('does not touch strings without markers even if the replacement is set', () => {
    expect(stripPrivate('Foo bar', { replacement: '***' })).toBe('Foo bar');
  });
});

describe('containsPrivate', () => {
  it('returns true when there is an open tag', () => {
    expect(containsPrivate('Foo <private>bar</private>')).toBe(true);
  });

  it('returns true on a stray close tag', () => {
    expect(containsPrivate('Foo </private> bar')).toBe(true);
  });

  it('returns false when there are no markers', () => {
    expect(containsPrivate('Foo bar')).toBe(false);
  });
});
