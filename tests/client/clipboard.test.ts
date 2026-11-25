import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from '../../src/services/clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('copying work summaries', () => {
  it('writes Arabic text using the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyTextToClipboard('تسليم الوردية\nمهمة عاجلة')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('تسليم الوردية\nمهمة عاجلة');
  });

  it('falls back after an embedded browser rejects clipboard access and removes its field', async () => {
    const textarea = { value: '', setAttribute: vi.fn(), style: { cssText: '' }, select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('HTMLElement', class {});
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', { body: { appendChild: vi.fn() }, activeElement: null, createElement: () => textarea, execCommand });
    expect(await copyTextToClipboard('المحتوى')).toBe(true);
    expect(textarea.value).toBe('المحتوى');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it('reports failure rather than displaying a false success', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', undefined);
    expect(await copyTextToClipboard('المحتوى')).toBe(false);
  });
});
