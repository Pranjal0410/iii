import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHelpersGriffe, parseGriffe } from './parsers/parse-griffe.mjs'
import { parseHelpersRustdoc, parseRustdoc } from './parsers/parse-rustdoc.mjs'
import { parseBrowserTypedoc, parseHelpersTypedoc, parseNodeTypedoc } from './parsers/parse-typedoc.mjs'
import { renderSdkMdx } from './renderers/render-mdx.mjs'
import type { SdkDoc } from './types.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Inputs are resolved relative to the repo root (the pipeline runs from there).
const ROOT = process.cwd()
const DOCS_OUTPUT = resolve(__dirname, '../api-reference')

interface GenerationTarget {
  name: string
  jsonPath: string
  outputPath: string
  parser: (jsonPath: string) => SdkDoc
  /** SDK source dir whose doc-comments produce this page's prose. */
  sourcePath: string
}

const targets: GenerationTarget[] = [
  // ── Core SDKs (client + worker entry point) ──
  {
    name: 'Node.js SDK',
    jsonPath: resolve(ROOT, 'sdk/packages/node/iii/api-docs.json'),
    outputPath: resolve(DOCS_OUTPUT, 'sdk-node.mdx'),
    parser: parseNodeTypedoc,
    sourcePath: 'sdk/packages/node/iii/src',
  },
  {
    name: 'Python SDK',
    jsonPath: resolve(ROOT, 'sdk/packages/python/iii/api-docs.json'),
    outputPath: resolve(DOCS_OUTPUT, 'sdk-python.mdx'),
    parser: parseGriffe,
    sourcePath: 'sdk/packages/python/iii/src',
  },
  {
    name: 'Rust SDK',
    jsonPath: resolve(ROOT, 'target/doc/iii_sdk.json'),
    outputPath: resolve(DOCS_OUTPUT, 'sdk-rust.mdx'),
    parser: parseRustdoc,
    sourcePath: 'sdk/packages/rust/iii/src',
  },
  {
    name: 'Browser SDK',
    jsonPath: resolve(ROOT, 'sdk/packages/node/iii-browser/api-docs.json'),
    outputPath: resolve(DOCS_OUTPUT, 'sdk-browser.mdx'),
    parser: parseBrowserTypedoc,
    sourcePath: 'sdk/packages/node/iii-browser/src',
  },
  // ── @iii-dev/helpers / iii-helpers (library: per-submodule) ──
  {
    name: 'Helpers (Node.js)',
    jsonPath: resolve(ROOT, 'sdk/packages/node/helpers/api-docs.json'),
    outputPath: resolve(DOCS_OUTPUT, 'helpers-node.mdx'),
    parser: parseHelpersTypedoc,
    sourcePath: 'sdk/packages/node/helpers/src',
  },
  {
    name: 'Helpers (Python)',
    jsonPath: resolve(ROOT, 'sdk/packages/python/helpers/api-docs.json'),
    outputPath: resolve(DOCS_OUTPUT, 'helpers-python.mdx'),
    parser: parseHelpersGriffe,
    sourcePath: 'sdk/packages/python/helpers/src',
  },
  {
    name: 'Helpers (Rust)',
    jsonPath: resolve(ROOT, 'target/doc/iii_helpers.json'),
    outputPath: resolve(DOCS_OUTPUT, 'helpers-rust.mdx'),
    parser: parseHelpersRustdoc,
    sourcePath: 'sdk/packages/rust/helpers/src',
  },
]

mkdirSync(DOCS_OUTPUT, { recursive: true })

let hasErrors = false
const generated: string[] = []

for (const target of targets) {
  console.log(`\n[generate-api-docs] Processing ${target.name}...`)

  if (!existsSync(target.jsonPath)) {
    console.warn(`  [SKIP] JSON file not found: ${target.jsonPath}`)
    console.warn(`  Run the extraction step first (see .github/workflows/generate-api-docs.yml).`)
    continue
  }

  try {
    const doc = target.parser(target.jsonPath)
    doc.metadata.docSourcePath = target.sourcePath
    const mdx = renderSdkMdx(doc)
    writeFileSync(target.outputPath, mdx, 'utf-8')
    generated.push(target.outputPath)
    const counts = doc.isLibrary
      ? `Modules: ${doc.modules?.length ?? 0}, Types: ${(doc.modules ?? []).reduce((n, m) => n + m.types.length, 0)}`
      : `Methods: ${doc.methods.length}, Types: ${doc.types.length}`
    console.log(`  [OK] ${target.outputPath}  (${counts})`)
  } catch (err) {
    console.error(`  [ERROR] Failed to generate ${target.name}:`, err)
    hasErrors = true
  }
}

// Render the `<source>.skill.md` siblings for the pages we just generated, so
// `iii-skill-check verify-rendered` stays clean without a separate build step.
// Scoped to the generated files (rendering the whole docs root would touch
// unrelated, out-of-scope pages). Uses the canonical `iii-skill-render` binary
// so the output is byte-identical to what CI verifies.
if (generated.length > 0) {
  console.log('\n[generate-api-docs] Rendering skill siblings...')
  for (const file of generated) {
    const result = spawnSync('iii-skill-render', [file, '--write'], { encoding: 'utf-8' })
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      console.warn('  [WARN] `iii-skill-render` not found on PATH; skipping skill-sibling render.')
      console.warn('  Install it and re-run, or render manually: `iii-skill-render <file>.mdx --write`.')
      break
    }
    if (result.status !== 0) {
      console.error(`  [ERROR] iii-skill-render failed for ${file}:\n${result.stderr ?? ''}`)
      hasErrors = true
      continue
    }
    console.log(`  [OK] ${file}.skill.md`)
  }
}

console.log('\n[generate-api-docs] Done.')
if (hasErrors) process.exit(1)
