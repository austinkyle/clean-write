import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CleanWrite production launcher', () => {
  it('prepares client assets for the standalone Next runtime', () => {
    const launcher = readFileSync(path.join(process.cwd(), 'start.command'), 'utf8');

    expect(launcher).toContain('.next/standalone/.next/static');
    expect(launcher).toContain('runtime_assets_ready');
    expect(launcher).toContain('prepare_runtime_assets');
    expect(launcher).toContain('load_local_env');
  });
});
