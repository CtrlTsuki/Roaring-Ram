// The Win32 layer must also work inside Electron, whose V8 memory cage forbids ArrayBuffers that
// point outside it (plain Node allows them, so the other tests can't catch that).
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import electron from 'electron'

describe.skipIf(process.platform !== 'win32')('win32 inside Electron', () => {
  test('reads the process snapshot and system memory without crashing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-electron-'))
    const bundle = path.join(dir, 'probe.cjs')
    const entry = path.join(dir, 'entry.ts')
    fs.writeFileSync(
      entry,
      `import { processes, systemMemory } from ${JSON.stringify(path.resolve('src/main/win32.ts').replace(/\\/g, '/'))}
       const list = processes(); const s = systemMemory()
       console.log(JSON.stringify({ count: list.length, self: list.some(p => p.pid === process.pid && p.name.length > 0), total: s.totalPhys }))`
    )
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['koffi'], nodePaths: [path.resolve('node_modules')], logLevel: 'silent' })
    const out = execFileSync(electron as unknown as string, [bundle], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: path.resolve('node_modules') },
      encoding: 'utf8'
    })
    const r = JSON.parse(out.trim().split('\n').pop()!)
    expect(r.count).toBeGreaterThan(10)
    expect(r.self).toBe(true)
    expect(r.total).toBeGreaterThan(0)
  })
})
