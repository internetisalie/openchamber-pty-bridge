import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateManifest } from '../scripts/validate-manifest.ts';

const root = resolve(import.meta.dir, '..');

describe('installable package', () => {
  test('declares the exact native extension manifest', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as unknown;
    expect(() => validateManifest(pkg)).not.toThrow();
  });

  test('ships a classic IIFE panel artifact', () => {
    const html = readFileSync(resolve(root, 'panel/index.html'), 'utf8');
    const bundle = readFileSync(resolve(root, 'panel/main.js'), 'utf8');
    expect(html).toContain('<script src="main.js"></script>');
    expect(bundle.length).toBeGreaterThan(1_000);
    expect(bundle).not.toMatch(/(^|\n)\s*(import|export)\s/m);
  });
});
