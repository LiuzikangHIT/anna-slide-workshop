import { outlineProblem } from './deck.js'
import { fits, scene, validChart } from './visual.js'

function topicWords(value) {
  const normalized = value.toLowerCase()
  const latin = normalized.match(/[a-z]{4,}/g) ?? []
  const han = (normalized.match(/\p{Script=Han}{2,}/gu) ?? []).flatMap((word) => {
    const chars = Array.from(word)
    return chars.slice(1).map((next, index) => chars[index] + next)
  })
  return [...new Set([...latin, ...han])]
}

export function localReview(draft, measure = fits) {
  const issues = []
  const add = (page, quote, reason, suggestion, blocking = false) =>
    issues.push({ id: page?.id, quote, reason, suggestion, blocking })
  const structure = outlineProblem(draft)
  if (structure) add(null, draft.pages.length + ' / ' + draft.brief.count, structure, '返回大纲补齐或调整分页。', true)
  if (!draft.confirmed || !draft.scriptConfirmed) add(null, '', '大纲或文字稿待确认。', '回到大纲或文字稿复查内容并确认。', true)
  if (new Set(draft.pages.map(({ id }) => id)).size !== draft.pages.length) add(null, '', '页面标识重复。', '从可用的草稿副本恢复。', true)
  if (draft.pages.filter(({ layout }) => layout === 'cover').length !== 1 || draft.pages[0]?.layout !== 'cover') add(draft.pages[0], '', '封面应是唯一且排在首位。', '检查大纲顺序及页面版式。', true)
  const visited = new Set()
  const known = [draft.brief.source, draft.brief.required].join('\n')
  const text = draft.pages.map(({ title, body, notes }) => [title, body, notes].join('\n')).join('\n')
  for (const required of draft.brief.required.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    if (!text.toLowerCase().includes(required.toLowerCase())) add(null, required, '必讲项未找到原文，可能遗漏或已改写。', '检查大纲和备注，补充或核对对应表述。')
  }
  for (const section of draft.sections) {
    const pages = draft.pages.filter(({ sectionId }) => sectionId === section.id)
    if (!pages.length) add(null, section.title, '章节没有分配页面。', '在大纲里分配页面或移除此空章节。')
    if (draft.sections.length > 1 && pages.length > draft.pages.length * .7) add(pages[0], section.title, '此章节占文稿七成以上。', '比较各章节页数和演示目标，确认篇幅分配。')
  }
  draft.pages.forEach((page, index) => {
    const normalized = page.title.trim().toLowerCase()
    if (!page.written || !normalized || !page.body.trim()) add(page, page.title || page.planTitle, '存在空页或缺少标题、正文。', '补齐该页文字稿。', true)
    if (page.stale) add(page, page.title, '该页使用了修改前的需求或大纲。', '逐页更新，或复核后保留当前稿。', true)
    if (normalized && visited.has(normalized)) add(page, page.title, '与前页标题重复。', '让标题说清本页独有的结论。')
    visited.add(normalized)
    const focus = topicWords(page.planTitle)
    const projected = (page.title + '\n' + page.body).toLowerCase()
    if (page.written && focus.length >= 2 && !focus.some((word) => projected.includes(word))) {
      add(page, page.title, '投影文字与本页大纲未找到共同关键词。', '对照本页计划「' + page.planTitle + '」，复核是否离题或已换一种方式表达。')
    }
    if (!page.notes.trim()) add(page, page.title, '讲者备注为空。', '补充讲解、来源或业务条件。')
    if (page.evidence && !known.includes(page.evidence.trim())) add(page, page.evidence, '素材未找到这段依据，待核实。', '补充原文或标记为待核实。')
    if (page.layout === 'chart' && !validChart(page)) add(page, page.title, '图表需要非负数值、标签、单位和来源。', '补齐图表数据或改用定性版式。', true)
    if (page.layout === 'chart' && validChart(page)) {
      const evidence = known.includes(page.visualSource.trim())
      for (const item of page.visual) if (!evidence || !known.includes(String(item.value))) {
        add(page, item.label + ' ' + item.value + ' ' + page.unit, '素材中未找到对应数值或来源。', '核对原始记录、单位及来源。')
      }
    }
    if (['compare', 'steps'].includes(page.layout) && (page.visual.length < 2 || page.visual.length > (page.layout === 'compare' ? 2 : 5) || page.visual.some(({ label }) => !label.trim()))) {
      add(page, page.title, '图示缺少标签或项数不适合此版式。', '填写标签并调整图示项数，或更换版式。', true)
    }
    for (const block of scene(page, draft.template, index, draft.pages.length).blocks) {
      if (block.field && !measure(block)) add(page, block.value, block.field + '可能溢出。', '保留原稿，精简投影文字、把说明移到讲者备注或更换版式。')
    }
    const quantities = page.body.match(/\d+(?:\.\d+)?\s*(?:%|分钟|小时|秒|元|席|人|GBP|days?|hours?|seconds?|minutes?)/gi) ?? []
    for (const quantity of new Set(quantities)) if (!known.toLowerCase().includes(quantity.toLowerCase())) {
      add(page, quantity, '素材中未找到带单位的这一数值。', '核对数字、单位和对应来源。')
    }
    if (/\d/.test(page.body) && /(?:^|[：:，, ])\d+(?:\.\d+)?(?=[。；;，,\n]|$)/.test(page.body)) add(page, page.body, '正文中可能有未注明单位的数字。', '核对这些数字的单位。')
  })
  return issues
}
