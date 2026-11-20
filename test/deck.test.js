import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { example, generateDeck, makeRequest, parseDeck, themes } from '../src/deck.js'
import { createPptx, deckFilename } from '../src/pptx.js'

const brief = {
  topic: '新员工知识库培训',
  audience: '新同事',
  source: '先搜索，再补充上下文',
  count: 5,
  language: 'Simplified Chinese',
  purpose: 'Practical training',
}

test('passes the brief to Anna in a single capped completion', async () => {
  let calls = 0
  const anna = { llm: { complete: async (request) => {
    calls += 1
    assert.match(request.messages[1].content.text, /exactly 4/)
    assert.match(request.messages[1].content.text, /新员工知识库培训/)
    assert.equal(request.maxTokens, 1550)
    return { stopReason: 'endTurn', content: { text: JSON.stringify(example) }, _meta: { quotaConsumed: 3 } }
  } } }
  assert.deepEqual(await generateDeck(anna, brief), { deck: example, cu: 3 })
  assert.equal(calls, 1)
  assert.ok(makeRequest({ ...brief, count: 9 }).maxTokens < 2500)
})

test('accepts fenced JSON, rejects invalid shapes and keeps Unicode intact', () => {
  assert.deepEqual(parseDeck('```json\n' + JSON.stringify(example) + '\n```', 5), example)
  assert.throws(() => parseDeck(JSON.stringify(example), 7), /页数/)
  assert.throws(() => parseDeck(JSON.stringify({ ...example, title: '  ' }), 5), /必要内容/)
  const item = { ...example, title: '🎬'.repeat(70) }
  assert.equal(parseDeck(JSON.stringify(item), 5).title, '🎬'.repeat(64))
  for (const count of [7, 9]) {
    const slides = Array.from({ length: count - 1 }, () => example.slides[0])
    assert.equal(parseDeck(JSON.stringify({ ...example, slides }), count).slides.length, count - 1)
  }
})

test('handles a truncated completion without retrying or replacing the deck', async () => {
  let calls = 0
  const anna = { llm: { complete: async () => {
    calls += 1
    return { stopReason: 'maxTokens', content: { text: '{' } }
  } } }
  await assert.rejects(generateDeck(anna, brief), /长度上限/)
  assert.equal(calls, 1)
})

test('produces a five-slide editable widescreen PPTX with safely escaped Chinese text', async () => {
  const deck = structuredClone(example)
  deck.title = '规划 & 执行 <草案>'
  const pptx = createPptx(PptxGenJS, deck, themes.sand)
  const archive = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer', compression: true }))
  assert.equal(Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 5)
  const presentation = await archive.file('ppt/presentation.xml').async('string')
  assert.match(presentation, /cx="12192000" cy="6858000"/)
  const cover = await archive.file('ppt/slides/slide1.xml').async('string')
  assert.match(cover, /<p:sp>/)
  assert.match(cover, /<a:t>规划 &amp; 执行 &lt;草案&gt;<\/a:t>/)
  assert.doesNotMatch(cover, /<p:pic>/)
  const content = await archive.file('ppt/slides/slide2.xml').async('string')
  assert.match(content, /减少重复提问/)
  assert.match(content, /FAF3E9/)
  assert.equal(deckFilename('NUL'), '_NUL.pptx')
  assert.equal(deckFilename('计划/汇报:*'), '计划 汇报.pptx')
})

test('the vendored browser bundle exports the constructor used by the App', async () => {
  const file = new URL('../node_modules/pptxgenjs/dist/pptxgen.bundle.js', import.meta.url)
  const scope = { setTimeout, clearTimeout, Blob, TextEncoder, Uint8Array, ArrayBuffer }
  scope.window = scope
  scope.self = scope
  runInNewContext(await readFile(file, 'utf8'), scope)
  const blob = await createPptx(scope.PptxGenJS, example, themes.ink).write({ outputType: 'blob', compression: true })
  const archive = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.ok(archive.file('ppt/slides/slide5.xml'))
})
