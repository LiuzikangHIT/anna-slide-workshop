import { layouts } from './deck.js'

const key = 'slide-workshop/draft'
const rowLimit = 56000
const byteSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length

export function readDraft(value) {
  if (value?.version !== 1) throw new Error('草稿版本不兼容。请下载原始副本后使用对应版本打开。')
  const strings = (obj, keys) => keys.every((name) => typeof obj?.[name] === 'string')
  const unique = (items) => new Set(items.map(({ id }) => id)).size === items.length
  if (!strings(value.brief, ['topic', 'audience', 'goal', 'source', 'required', 'scenario', 'language']) ||
    !['string', 'number'].includes(typeof value.brief.count) ||
    !Array.isArray(value.sections) || !value.sections.every((s) => strings(s, ['id', 'title'])) || !unique(value.sections) ||
    !Array.isArray(value.pages) || !value.pages.every((p) => strings(p, ['id', 'sectionId', 'planTitle', 'goal', 'title', 'body', 'notes', 'evidence', 'layout', 'density', 'align', 'unit', 'visualSource']) &&
      Object.hasOwn(layouts, p.layout) && value.sections.some(({ id }) => id === p.sectionId) &&
      Array.isArray(p.visual) && p.visual.every((item) => strings(item, ['label']) && (item.detail === undefined || typeof item.detail === 'string') &&
        (item.value === undefined || typeof item.value === 'number' || typeof item.value === 'string'))) || !unique(value.pages) ||
    !Array.isArray(value.batches) || !Array.isArray(value.review) || !value.review.every((entry) => strings(entry, ['id', 'quote', 'reason', 'suggestion', 'evidence'])) ||
    !strings(value.preferences, ['model', 'effort']) || ![1, 2, 3].includes(Number(value.preferences.batchSize)) ||
    !Number.isFinite(value.usage?.total) || !Number.isInteger(value.usage?.missing) ||
    !Number.isInteger(value.step) || value.step < 0 || value.step > 5) throw new Error('草稿结构损坏。可下载原始副本供恢复。')
  if (!value.pages.some(({ id }) => id === value.current)) value.current = value.pages[0]?.id ?? null
  // 已进入设计的旧稿沿用现有版式，新稿只补齐尚未排版的页面
  value.templateChosen ??= Boolean(value.designReached)
  for (const page of value.pages) page.designed ??= Boolean(value.designReached)
  return value
}

export function apsStore(storage) {
  let etag
  let parts = []
  let initialized = false
  let conflict = false
  const get = (name) => storage.get({ scope: 'app', key: name })
  const set = (name, value, match) => storage.set({ scope: 'app', key: name, value, ...(match === undefined ? {} : { if_match: match }) })
  const remove = (name) => storage.delete?.({ scope: 'app', key: name })
  return {
    async restore() {
      const root = await get(key)
      if (typeof root?.exists !== 'boolean' || root.exists && typeof root.etag !== 'string') throw new Error('宿主未返回 APS 版本信息。')
      etag = root.etag
      let raw = root.exists ? root.value : null
      parts = []
      if (root.exists && root.value?.parts) {
        parts = root.value.parts
        if (!Array.isArray(parts) || !parts.length || !parts.every((part) => typeof part === 'string' && part.startsWith(key + '/'))) throw new Error('Anna 草稿索引无效。')
        const rows = await Promise.all(parts.map(get))
        if (rows.some((row) => !row.exists || typeof row.value !== 'string')) throw new Error('草稿分片不可读，请重新打开草稿。')
        raw = JSON.parse(rows.map(({ value }) => value).join(''))
      }
      if (root.exists) {
        try { readDraft(raw) } catch (error) { error.raw = raw; throw error }
      }
      initialized = true
      return raw
    },
    async save(value) {
      if (conflict) throw new Error('另一窗口已更新草稿。请下载当前副本，再重新打开以读取 Anna 最新版。')
      if (!initialized) throw new Error('需先成功读取 Anna 草稿。可先下载当前副本。')
      const pending = []
      let committing = false
      try {
        let stored = value
        if (byteSize(value) > rowLimit) {
          // 先写齐新分片，再原子更新带 ETag 的根索引
          const raw = JSON.stringify(value)
          const prefix = key + '/' + crypto.randomUUID()
          for (let start = 0, i = 0; start < raw.length; i++) {
            let end = Math.min(raw.length, start + 16000)
            while (byteSize(raw.slice(start, end)) > rowLimit) end = start + Math.floor((end - start) / 2)
            const part = prefix + '/' + i
            pending.push(part)
            await set(part, raw.slice(start, end))
            start = end
          }
          stored = { parts: pending }
        }
        // APS 对尚未创建的键要求省略 if_match，因此写入前再检查一次
        if (etag === undefined && (await get(key)).exists) throw new Error('precondition_failed')
        committing = true
        const result = await set(key, stored, etag)
        if (typeof result?.etag !== 'string') throw new Error('Anna 未确认保存版本。')
        etag = result.etag
      } catch (error) {
        const knownConflict = /precondition|412|32023/i.test([error.code, error.message].join(' '))
        if (!committing || knownConflict) await Promise.allSettled(pending.map(remove))
        if (knownConflict) {
          conflict = true
          throw new Error('Anna 草稿已在另一窗口更新。请下载当前副本，再重新打开。')
        }
        throw error
      }
      const previous = parts
      parts = pending
      await Promise.allSettled(previous.map(remove))
    },
  }
}

export function saving(store, status) {
  let pending
  let active
  let timer
  async function flush(snapshot) {
    clearTimeout(timer)
    if (snapshot) pending = structuredClone(snapshot)
    if (!pending || active) return active
    active = (async () => {
      while (pending) {
        const value = pending
        pending = undefined
        status('saving')
        try {
          await store.save(value)
          if (!pending) status('saved', new Date())
        } catch (error) {
          pending ??= value
          status('failed', error)
          return false
        }
      }
      return true
    })()
    try { return await active } finally { active = undefined }
  }
  return {
    flush,
    schedule(value) {
      pending = structuredClone(value)
      clearTimeout(timer)
      status('saving')
      timer = setTimeout(() => { void flush() }, 450)
    },
  }
}
