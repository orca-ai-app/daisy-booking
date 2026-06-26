import { describe, it, expect } from 'vitest';
import { formatPence, formatDate, formatTime, escapeHtml } from '../src/widget/format';

describe('formatPence', () => {
  it('renders integer pence as GBP', () => {
    expect(formatPence(9500)).toBe('£95.00');
    expect(formatPence(2000)).toBe('£20.00');
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('formatDate', () => {
  it('renders a YYYY-MM-DD wall-clock date without UTC drift', () => {
    // 2026-07-20 is a Monday — must not slip to the 19th near midnight BST.
    expect(formatDate('2026-07-20')).toContain('20 Jul 2026');
  });
  it('handles empty', () => {
    expect(formatDate(null)).toBe('');
  });
});

describe('formatTime', () => {
  it('trims seconds', () => {
    expect(formatTime('10:00:00')).toBe('10:00');
    expect(formatTime(null)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes injection vectors', () => {
    expect(escapeHtml('<script>"&\'')).toBe('&lt;script&gt;&quot;&amp;&#39;');
  });
});
