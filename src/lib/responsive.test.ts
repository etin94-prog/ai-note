import { describe, expect, it } from 'vitest';

import { DETAIL_WIDTH, workspaceLayout } from './responsive';

describe('workspace capacity', () => {
  it.each([375, 390, 768, 1024 - 180])('keeps narrow workspaces readable at %ipx', (width) => {
    expect(workspaceLayout(width)).toEqual({ canSplit: false, canTable: false });
  });
  it('allows a table on a small desktop without reserving an empty detail panel', () => {
    expect(workspaceLayout(1280 - 180)).toEqual({ canSplit: false, canTable: true });
  });
  it('preserves at least 720px of main content when details open', () => {
    const width = 1440 - 180;
    expect(workspaceLayout(width).canSplit).toBe(true);
    expect(width - DETAIL_WIDTH - 48).toBeGreaterThanOrEqual(720);
  });
  it('uses a single column for a 200% native text setting', () => {
    expect(workspaceLayout(1440 - 180, 2)).toEqual({ canSplit: false, canTable: false });
  });
});
