import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { exportBlogMarkdown, rewriteBlogImagePaths } from './generate-blog-md'

test('rewriteBlogImagePaths maps source assets to built _astro URLs', () => {
  const body = '![banner](../../assets/blog/demo/banner.png)'
  const out = rewriteBlogImagePaths(body, ['banner.DU5X-Ggo_1kFy9f.webp'])
  assert.match(out, /https:\/\/iii\.dev\/blog\/_astro\/banner\.DU5X-Ggo_1kFy9f\.webp/)
})

test('exportBlogMarkdown writes slug.md and index.md', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iii-blog-md-'))
  const contentDir = path.join(root, 'content')
  const distDir = path.join(root, 'dist')
  await fs.mkdir(contentDir, { recursive: true })
  await fs.mkdir(path.join(distDir, '_astro'), { recursive: true })
  await fs.writeFile(
    path.join(contentDir, 'demo.md'),
    `---
title: 'Demo'
description: 'A demo post'
pubDate: 2026-06-01
---

![banner](../../assets/blog/demo/banner.png)
`,
    'utf8',
  )
  await fs.writeFile(path.join(distDir, '_astro', 'banner.abc123.webp'), '', 'utf8')

  const count = await exportBlogMarkdown(contentDir, distDir)
  assert.equal(count, 1)

  const exported = await fs.readFile(path.join(distDir, 'demo.md'), 'utf8')
  assert.match(exported, /title: 'Demo'/)
  assert.match(exported, /https:\/\/iii\.dev\/blog\/_astro\/banner\.abc123\.webp/)

  const index = await fs.readFile(path.join(distDir, 'index.md'), 'utf8')
  assert.match(index, /https:\/\/iii\.dev\/blog\/demo\.md/)
})
