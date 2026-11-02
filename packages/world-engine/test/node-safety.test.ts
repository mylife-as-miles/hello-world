/**
 * The server imports '@hello-world/world-engine/runtime' in Node. This test walks
 * the static import graph from src/runtime/index.ts and fails if anything
 * browser-only (React, three, Dexie, DOM-bound modules, .tsx) is reachable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/runtime/index.ts');
const ALLOWED_BARE = new Set(['@hello-world/contracts']);

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith('/') && /\.(ts|tsx)$/.test(c)) return c;
  }
  return null;
}

function walk(): { files: string[]; bare: Set<string> } {
  const files: string[] = [];
  const bare = new Set<string>();
  const queue = [entry];
  const seen = new Set<string>();
  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(importRe)) {
      const full = m[0];
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (/^\s*(import|export)\s+type\s/.test(full)) continue; // type-only imports are erased
      if (spec.startsWith('.')) {
        const r = resolveLocal(file, spec);
        if (r) queue.push(r);
      } else bare.add(spec);
    }
  }
  return { files, bare };
}

describe('runtime subpath is Node-safe', () => {
  it('imports only contracts + pure engine modules', () => {
    const { files, bare } = walk();
    expect(files.length).toBeGreaterThan(3);
    for (const spec of bare) expect(ALLOWED_BARE.has(spec) || spec.startsWith('node:')).toBe(true);
    for (const f of files) {
      expect(f.endsWith('.tsx')).toBe(false);
      expect(/\/(scene|creator|interactions|persistence)\//.test(f)).toBe(false);
      const src = readFileSync(f, 'utf8');
      expect(/\b(window|document|localStorage|indexedDB)\./.test(src)).toBe(false);
    }
  });

  it('runs headless without timers when autoTick is false', async () => {
    const { createWorldRuntime } = await import('../src/runtime/index');
    const rt = createWorldRuntime({ worldId: 'node-check', seedResidents: true, autoTick: false });
    const before = rt.getSnapshot();
    expect(before.schemaVersion).toBe(1);
    expect(before.residents.length).toBeGreaterThan(2);
    for (let i = 0; i < 20; i++) rt.tick();
    const after = rt.getSnapshot();
    expect(after.simulationTime).toBeGreaterThan(before.simulationTime);
    expect(Object.isFrozen(after)).toBe(true);
    rt.dispose();
  });
});
