import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { batchPlan, exampleDraft, invalidate, makeOutline, newDraft, nextBatch, outlineProblem, pageCount, pendingPages } from '../src/deck.js'
import { complete, makeRequest, parseResponse } from '../src/anna.js'
import { createPptx, deckFilename } from '../src/pptx.js'
import { localReview } from '../src/review.js'
import { apsStore, readDraft, saving } from '../src/storage.js'
import { scene, validChart } from '../src/visual.js'

const response = (value, extra) => ({ content: { text: JSON.stringify(value) }, ...extra })
const mocked = (fn) => ({ llm: { complete: fn } })

function memory() {
  const rows = new Map()
  let writes = 0
  let reject
  return {
    rows,
    reject(error) { reject = error },
    async get({ key, scope }) {
      assert.equal(scope, 'app')
      return rows.has(key) ? { exists: true, ...structuredClone(rows.get(key)) } : { exists: false, value: null }
    },
    async set({ key, scope, value, if_match }) {
      assert.equal(scope, 'app')
      if (reject) throw reject
      if (if_match !== undefined && if_match !== rows.get(key)?.etag) throw Object.assign(new Error('HTTP 412 precondition_failed'), { code: 'transport' })
      const bytes = Buffer.byteLength(JSON.stringify(value))
      assert.ok(bytes <= 56000)
      const etag = String(++writes)
      rows.set(key, structuredClone({ etag, value }))
      return { etag }
    },
    async delete({ key }) { rows.delete(key) },
  }
}

test('接受 5–30 的全部整数，并拒绝空、小数和越界', () => {
  const draft = newDraft()
  draft.brief.topic = '业务复盘'
  for (let count = 5; count <= 30; count++) {
    draft.brief.count = String(count)
    assert.equal(pageCount(draft.brief.count), count)
    Object.assign(draft, makeOutline(draft, 'manual'))
    assert.equal(draft.pages.length, count)
    assert.equal(draft.pages[0].layout, 'cover')
    assert.equal(draft.pages.at(-1).layout, 'action')
  }
  for (const invalid of ['', ' ', 4, 31, 5.5, '5.3', null, Infinity]) {
    assert.throws(() => pageCount(invalid), /整数/)
    draft.brief.count = invalid
    assert.throws(() => makeRequest('outline', draft), /整数/)
  }
})

test('大纲校验总页数和字段，按稳定 ID 保留人工稿和备注', () => {
  const draft = exampleDraft()
  const original = draft.pages[3]
  draft.pages.splice(8, 0, draft.pages.splice(3, 1)[0])
  assert.equal(draft.pages[8].id, original.id)
  assert.equal(draft.pages[8].notes, original.notes)
  assert.equal(outlineProblem(draft), '')
  draft.brief.count = '13'
  assert.match(outlineProblem(draft), /还差 1 页/)
  draft.brief.count = '11'
  assert.match(outlineProblem(draft), /超出 1 页/)
  invalidate(draft, [original])
  assert.deepEqual(pendingPages(draft).map(({ id }) => id), [original.id])
  assert.equal(original.written, true)
  assert.ok(original.notes)
})

test('英文暂停条件与 Unicode 原文经模型解析与存储完整保留', () => {
  const draft = exampleDraft(5, 'en')
  const page = draft.pages[3]
  const body = page.body + ' ' + '🎬'.repeat(80)
  assert.ok(page.body.length > 88)
  const answer = { id: page.id, title: 'A & < B', body, notes: page.notes, evidence: page.evidence }
  const reply = { content: { text: ['\x60\x60\x60json', JSON.stringify({ pages: [answer] }), '\x60\x60\x60'].join('\n') } }
  const [parsed] = parseResponse('script', reply, [page], draft)
  assert.equal(parsed.body, body)
  Object.assign(page, parsed)
  assert.equal(readDraft(JSON.parse(JSON.stringify(draft))).pages[3].body, body)
  assert.throws(() => parseResponse('script', response({ pages: [{ ...answer, id: 'wrong' }] }), [page], draft), /JSON/)
})

test('模型偏好、推理、路由回落和缺失回执', async () => {
  const draft = exampleDraft(5)
  const [page] = draft.pages
  for (const [model, effort] of [['vendor/one', 'high'], ['vendor/two', 'low']]) {
    Object.assign(draft.preferences, { model, effort, supportsThinking: true })
    await complete(mocked(async (request) => {
      assert.deepEqual(request.modelPreferences, { hints: [{ name: model }] })
      assert.deepEqual(request.thinking, { effort })
      assert.ok(request.maxTokens <= 8192)
      return response({ pages: [page] }, { model: 'routed/default', _meta: { quotaConsumed: .25, thinking: { effective: { effort: 'medium' } }, maxTokens: { effective: 4096 } } })
    }), 'rewrite', draft, [page], '修改标题')
    assert.equal(draft.usage.last.model, 'routed/default')
    assert.equal(draft.usage.last.effort, 'medium')
  }
  draft.preferences.supportsThinking = false
  assert.equal(makeRequest('rewrite', draft, [page]).thinking, undefined)
  await complete(mocked(async () => response({ issues: [{ id: page.id, quote: '主题', reason: '缺少来源', suggestion: '补充来源', evidence: '凭空捏造' }] })),
    'review', draft, [page]).then((issues) => assert.equal(issues[0].evidence, '待核实'))
  assert.equal(draft.usage.total, .5)
  assert.equal(draft.usage.last.model, null)
  assert.equal(draft.usage.last.cu, null)
  assert.equal(draft.usage.missing, 1)
})

test('429、长度触顶、错误 JSON 和错误类型均保留原页', async () => {
  const draft = exampleDraft(5)
  const [page] = draft.pages
  const before = structuredClone(page)
  const attempts = [
    [async () => { throw Object.assign(new Error('no credits'), { code: 429 }) }, /额度/],
    [async () => response({}, { stopReason: 'maxTokens', _meta: { quotaConsumed: .1 } }), /输出上限/],
    [async () => ({ content: { text: 'stray {' } }), /JSON/],
    [async () => response({ pages: [{ ...page, notes: [] }] }), /字段/],
  ]
  for (const [reply, error] of attempts) await assert.rejects(complete(mocked(reply), 'rewrite', draft, [page], '更新'), error)
  assert.deepEqual(page, before)
  assert.equal(draft.usage.total, .1)
})

test('从 APS 恢复 30 页稿，续跑保留已完成批次并还原选中页', async () => {
  const storage = memory()
  const backend = apsStore(storage)
  assert.equal(await backend.restore(), null)
  const draft = exampleDraft(30)
  const ids = draft.pages.map(({ id }) => id)
  assert.ok(Buffer.byteLength(JSON.stringify(draft)) > 56000)
  const original = structuredClone(draft)
  for (const page of draft.pages) page.stale = true
  const estimated = batchPlan(draft, ids, 3)
  assert.ok(estimated > 10)
  const first = nextBatch(draft, ids, 3)
  first.forEach((page) => { page.stale = false })
  draft.batches.push({ ids: first.map(({ id }) => id) })
  const interrupted = nextBatch(draft, ids, 3)
  await assert.rejects(complete(mocked(async () => ({ stopReason: 'maxTokens' })), 'script', draft, interrupted), /输出上限/)
  draft.current = ids[3]
  draft.step = 4
  draft.template = 'editorial'
  draft.pages[3].title = '人工更新'
  await backend.save(draft)
  assert.ok(storage.rows.size > 1)
  const resumed = await apsStore(storage).restore()
  assert.deepEqual(resumed.pages.slice(0, 3), original.pages.slice(0, 3))
  assert.deepEqual(nextBatch(resumed, ids, 3).map(({ id }) => id), interrupted.map(({ id }) => id))
  assert.equal(resumed.pages[3].title, '人工更新')
  assert.equal(resumed.pages[3].notes, draft.pages[3].notes)
  assert.equal(resumed.step, 4)
  assert.equal(resumed.current, ids[3])
  assert.equal(resumed.template, 'editorial')
  assert.equal(resumed.batches.length, 1)
})

test('串行保存合并输入，拒绝与冲突保留旧读取和新的本地副本', async () => {
  const storage = memory()
  const first = apsStore(storage)
  await first.restore()
  const draft = exampleDraft(5)
  const history = []
  const queue = saving(first, (status) => history.push(status))
  draft.brief.topic = '旧修改'
  const a = queue.flush(draft)
  draft.brief.topic = '新修改'
  const b = queue.flush(draft)
  await Promise.all([a, b])
  assert.deepEqual(history, ['saving', 'saving', 'saved'])
  const incoming = apsStore(storage)
  assert.equal((await incoming.restore()).brief.topic, '新修改')
  storage.reject(new Error('permission_denied'))
  draft.brief.topic = '人工修改'
  assert.equal(await queue.flush(draft), false)
  assert.equal(history.at(-1), 'failed')
  storage.reject()
  const other = structuredClone(draft)
  other.brief.topic = '另一窗口'
  await incoming.save(other)
  assert.equal(await queue.flush(), false)
  assert.equal((await apsStore(storage).restore()).brief.topic, '另一窗口')
  assert.equal(draft.brief.topic, '人工修改')
  assert.throws(() => readDraft({ version: 99 }), /版本/)
})

test('审查定位培训流程漏项、无来源数字、溢出和空页', () => {
  const draft = exampleDraft()
  draft.brief.required = '二级三级由处理人复核并确认客户可接受'
  const page = draft.pages[3]
  page.body = '自动处理用时 90 分钟。'
  page.visual[0].value = 95
  draft.pages[5].body = '超长中文正文'.repeat(250)
  draft.pages[6].title = ''
  draft.pages[7].title = draft.pages[5].title
  const issues = localReview(draft)
  assert.ok(issues.some((issue) => issue.quote === draft.brief.required && /必讲/.test(issue.reason)))
  assert.ok(issues.some((issue) => issue.id === page.id && issue.quote === '90 分钟'))
  assert.ok(issues.some((issue) => issue.id === page.id && /分派 95 分钟/.test(issue.quote)))
  assert.ok(issues.some((issue) => issue.id === draft.pages[5].id && /溢出/.test(issue.reason)))
  assert.ok(issues.some(({ blocking, id }) => blocking && id === draft.pages[6].id))
  assert.ok(issues.some(({ reason }) => /重复/.test(reason)))
  page.unit = ''
  assert.equal(validChart(page), false)
  assert.ok(localReview(draft).some(({ blocking, id }) => blocking && id === page.id))
})

test('四套模板改变封面及正文构图，切换保留原稿', () => {
  const draft = exampleDraft()
  for (const index of [0, 4]) {
    const page = draft.pages[index]
    const before = JSON.stringify(page)
    const geometry = (template) => scene(page, template, index, 12).blocks.map(({ x, y, h, w }) => [x, y, h, w])
    assert.notDeepEqual(geometry('briefing'), geometry('minimal'))
    assert.notDeepEqual(geometry('editorial'), geometry('classroom'))
    assert.equal(JSON.stringify(page), before)
  }
})

test('实际生成 5、12、30 页 PPTX，核对 16:9、文字、图形、图表、备注和转义', async () => {
  for (const count of [5, 12, 30]) {
    const draft = exampleDraft(count)
    draft.pages[0].title = '规划 & 执行 <草案> 🎬'
    draft.pages[3].title = '已编辑第 4 页'
    draft.pages[3].visual[0].value = 49.5
    draft.template = 'minimal'
    draft.transition = 'fade'
    const archive = await JSZip.loadAsync(await createPptx(PptxGenJS, draft).write({ outputType: 'nodebuffer', compression: true }))
    const read = (name) => archive.file(name).async('string')
    assert.equal(Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, count)
    assert.match(await read('ppt/presentation.xml'), /cx="12192000" cy="6858000"/)
    const cover = await read('ppt/slides/slide1.xml')
    assert.match(cover, /规划 &amp; 执行 &lt;草案&gt; 🎬/)
    assert.doesNotMatch(cover, /<p:pic>|<p:transition/)
    assert.match(await read('ppt/slides/slide2.xml'), /<p:sp>.*人工排队分派/)
    assert.match(await read('ppt/slides/slide3.xml'), /确认升级/)
    assert.match(await read('ppt/slides/slide4.xml'), /已编辑第 4 页/)
    assert.match(await read('ppt/slides/slide4.xml'), /本周工单记录/)
    const chart = archive.file(/^ppt\/charts\/chart\d+\.xml$/)
    assert.equal(chart.length, 1)
    assert.match(await chart[0].async('string'), /49.5/)
    assert.match(await chart[0].async('string'), /分钟/)
    assert.equal(archive.file(/^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/).length, 1)
    assert.match(await read('ppt/notesSlides/notesSlide4.xml'), /请与会者确认负责人/)
    assert.match(await read('ppt/slides/slide' + count + '.xml'), /确认试点负责人/)
  }
  assert.equal(deckFilename('NUL'), '_NUL.pptx')
  assert.equal(deckFilename('计划/汇报:*'), '计划 汇报.pptx')
})

test('浏览器版构建生成完整英文长句的 PPTX', async () => {
  const file = new URL('../node_modules/pptxgenjs/dist/pptxgen.bundle.js', import.meta.url)
  const scope = { setTimeout, clearTimeout, Blob, TextEncoder, Uint8Array, ArrayBuffer }
  scope.window = scope
  scope.self = scope
  runInNewContext(await readFile(file, 'utf8'), scope)
  const draft = exampleDraft(5, 'en')
  const blob = await createPptx(scope.PptxGenJS, draft).write({ outputType: 'blob', compression: true })
  const archive = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.ok((await archive.file('ppt/slides/slide4.xml').async('string')).includes(draft.pages[3].body))
})
