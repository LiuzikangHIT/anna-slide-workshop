export const scenarios = { report: '工作汇报', proposal: '提案', training: '培训' }
export const layouts = { cover: '封面', evidence: '结论与证据', compare: '双栏对比', steps: '步骤流程', chart: '数据图表', action: '行动收束' }

export function pageCount(value) {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(n) || n < 5 || n > 30) throw new Error('总页数必须是 5–30 的整数。')
  return n
}

export function validateBrief(brief) {
  const count = pageCount(brief.count)
  if (!brief.topic.trim()) throw new Error('请填写演示主题。')
  return { ...brief, count }
}

export function newDraft() {
  return {
    version: 1, brief: { topic: '', audience: '', goal: '', source: '', required: '', scenario: 'report', count: '7', language: 'zh' },
    sections: [], pages: [], confirmed: false, scriptConfirmed: false, designReached: false, step: 0, current: null,
    template: 'briefing', templateChosen: false, transition: 'none', batches: [], review: [], acknowledged: false,
    preferences: { model: '', supportsThinking: false, effort: '', batchSize: 3 }, usage: { total: 0, missing: 0, last: null },
  }
}

export function newPage(sectionId, title = '', goal = '', layout = 'evidence') {
  return {
    id: crypto.randomUUID(), sectionId, planTitle: title, goal,
    title: '', body: '', notes: '', evidence: '', visual: [], unit: '', visualSource: '',
    layout, density: 'normal', align: 'template', written: false, stale: false, designed: false,
  }
}

export function makeOutline(draft, kind) {
  const { topic, language, count } = validateBrief(draft.brief)
  const en = language === 'en'
  if (kind === 'manual') {
    const sections = [{ id: crypto.randomUUID(), title: en ? 'Main section' : '主要章节' }]
    const pages = Array.from({ length: count }, (_, i) => newPage(sections[0].id, i ? '' : topic, '', i === 0 ? 'cover' : i === count - 1 ? 'action' : 'evidence'))
    return { sections, pages }
  }
  const stages = en
    ? ['Context', 'Findings', 'Decision', 'Execution']
    : ['背景与目标', '发现与证据', '决策与取舍', '执行与复盘']
  const sections = stages.slice(0, count <= 7 ? 1 : count <= 15 ? 2 : 4).map((title) => ({ id: crypto.randomUUID(), title }))
  const pages = Array.from({ length: count }, (_, i) => {
    const section = sections[Math.floor(i * sections.length / count)]
    const title = i === 0 ? topic : i === count - 1 ? (en ? 'Agree on the next step' : '确定下一步行动') : section.title + ' · ' + i
    const goal = i === 0 ? (en ? 'Understand the purpose' : '理解本次演示目的')
      : i === count - 1 ? (en ? 'Identify the owner and deadline' : '明确责任人与完成时点')
        : (en ? 'Understand the evidence and its implications' : '理解这一环节的依据及影响')
    return newPage(section.id, title, goal, i === 0 ? 'cover' : i === count - 1 ? 'action' : 'evidence')
  })
  return { sections, pages }
}

export function exampleDraft(count = 12, language = 'zh') {
  const draft = newDraft()
  const en = language === 'en'
  const pause = 'Pause dual-write if reconciliation mismatch exceeds 0.2% for a 24-hour window, any unauthorized access is observed, or the legacy queue health degrades.'
  Object.assign(draft.brief, {
    count: String(pageCount(count)), language, topic: en ? 'Billing migration decision' : '客服响应复盘',
    audience: en ? 'Operations leads' : '运营与客服负责人',
    goal: en ? 'Agree on the pilot and pause criteria' : '明确瓶颈并确认试点负责人',
    source: en ? pause : '本周工单记录：分派 42 分钟，处理 18 分钟。高优先级工单须由主管确认升级。',
    required: en ? pause : '高优先级工单须由主管确认升级',
  })
  Object.assign(draft, makeOutline(draft, 'example'))
  const enBodies = ['Replay the current workflow before approving a pilot.', 'Keep access reviews in the existing process.', pause, 'Review pilot signals with the operations owner.']
  const topics = ['分派环节是优先改进项', '把高优先级工单及时分流', '用实测数据定位等待环节', '升级由主管确认', '保留原有响应规则', '先在一个队列验证', '统一记录工单状态', '复查分派和处理时间', '约定试点结束条件', '用复盘结果决定下一步']
  draft.pages.forEach((page, i) => {
    if (i > 0 && i < count - 1) page.planTitle = en ? 'Pilot decision · ' + i : topics[(i - 1) % topics.length] + (i > topics.length ? ' · ' + i : '')
    Object.assign(page, {
      written: true, designed: true, title: page.planTitle,
      body: i === 0 ? draft.brief.goal : i === count - 1 ? (en ? 'Confirm the owner and review date.' : '确认试点负责人与复盘时间。')
        : en ? enBodies[(i - 1) % enBodies.length] : '记录分派与处理时长。\n高优先级工单须由主管确认升级。',
      notes: en ? 'Read the full pause criteria to the audience. ' + pause : '先说明样本范围，再请与会者确认负责人。提醒听众，本周工单记录来自试点队列，结论需要在其他队列复查。',
      evidence: draft.brief.source,
    })
  })
  if (!en) {
    Object.assign(draft.pages[1], { layout: 'compare', visual: [{ label: '当前', detail: '人工排队分派' }, { label: '试点', detail: '高优先级单独分流' }] })
    Object.assign(draft.pages[2], { layout: 'steps', visual: ['识别优先级', '通知主管', '确认升级'].map((label) => ({ label, detail: '' })) })
    Object.assign(draft.pages[3], { layout: 'chart', unit: '分钟', visualSource: '本周工单记录', visual: [{ label: '分派', value: 42 }, { label: '处理', value: 18 }] })
  }
  if (count === 30) {
    draft.brief.source += '\n' + '核对回访记录与一线反馈，记录影响范围、决策依据及后续负责人。'.repeat(90)
    for (const page of draft.pages) page.notes += '\n' + '用具体的班次案例解释原因并邀请听众确认例外情形。'.repeat(25)
  }
  draft.confirmed = draft.scriptConfirmed = true
  draft.designReached = true
  draft.templateChosen = true
  draft.current = draft.pages[0].id
  draft.step = 3
  return draft
}

export function invalidate(draft, pages = draft.pages, outline = true) {
  if (outline) draft.confirmed = false
  draft.scriptConfirmed = false
  draft.acknowledged = false
  draft.review = []
  pages.forEach((page) => { if (page.written) page.stale = true })
}

export function outlineProblem(draft) {
  let count
  try { count = validateBrief(draft.brief).count } catch (error) { return error.message }
  const diff = count - draft.pages.length
  if (diff) return diff > 0 ? '还差 ' + diff + ' 页。' : '超出 ' + -diff + ' 页。'
  const sections = new Set(draft.sections.filter(({ title }) => title.trim()).map(({ id }) => id))
  if (draft.pages.some((page) => !page.planTitle.trim() || !page.goal.trim() || !sections.has(page.sectionId))) return '请填写每页标题、目标及所属章节。'
  return ''
}

export function hasOutlineWork(draft) {
  if (!draft.pages.length) return false
  const placeholderSection = draft.brief.language === 'en' ? 'Main section' : '主要章节'
  return draft.sections.length !== 1 || draft.sections[0].title.trim() !== placeholderSection ||
    draft.pages.length !== Number(draft.brief.count) ||
    draft.pages.some(({ written, planTitle, goal }, index) =>
      written || goal.trim() || Boolean(planTitle.trim() && (index !== 0 || planTitle.trim() !== draft.brief.topic.trim())))
}

export function pendingPages(draft, kind = 'script') {
  return draft.pages.filter(({ written, stale, designed }) => kind === 'visual' ? written && !stale && !designed : !written || stale)
}

export function nextBatch(draft, ids, size, kind) {
  const pending = pendingPages(draft, kind).filter(({ id }) => ids.includes(id))
  return pending.filter(({ sectionId }) => sectionId === pending[0]?.sectionId).slice(0, size)
}

export function batchPlan(draft, ids, size, kind) {
  const pending = pendingPages(draft, kind).filter(({ id }) => ids.includes(id))
  return draft.sections.reduce((total, { id }) => total + Math.ceil(
    pending.filter((page) => page.sectionId === id).length / size
  ), 0)
}
