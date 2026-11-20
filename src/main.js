import { exampleDraft, hasOutlineWork, invalidate, layouts, makeOutline, newDraft, newPage, nextBatch, outlineProblem, pageCount, pendingPages, scenarios, validateBrief } from './deck.js'
import { complete, OutlineResponseError } from './anna.js'
import { apsStore, readDraft, saving } from './storage.js'
import { fits, height, recommended, scene, templates, width } from './visual.js'
import { localReview } from './review.js'
import { createPptx, deckFilename } from './pptx.js'

const find = (id) => document.getElementById(id)
const stepNames = ['演示需求', '大纲', '文字稿', '风格', '排版', '审查与导出']
const views = [briefView, outlineView, scriptView, designView, editView, reviewView]
let draft
let anna
let store
let saver
let stored
let unreadable
let storageError
let payload
let local = true
let home = true
let connected = false
let catalog = []
let activeModelSettings
let showThinking = false
let job
let candidate
let rewrite = ''
let returning
let downloadUrl
let exportVersion = 0
let exportBusy = false
let serial = 0
const pane = { pages: false, properties: false }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'on') Object.entries(value).forEach(([event, listener]) => node.addEventListener(event, listener))
    else if (key === 'class') node.className = value
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value)
  }
  node.append(...children.flat().filter((child) => child != null && child !== false))
  return node
}

function button(title, run, options = {}) {
  const { primary, ...attrs } = options
  return el('button', { type: 'button', class: primary ? 'primary' : '', on: { click: run }, ...attrs }, title)
}

function field(label, model, key, options = {}) {
  const { rows, choices, update = () => changed(), help, ...attrs } = options
  const control = choices ? el('select', attrs, Object.entries(choices).map(([value, name]) => el('option', { value }, name)))
    : rows ? el('textarea', { rows, ...attrs }) : el('input', attrs)
  control.value = model[key] ?? ''
  control.addEventListener(choices ? 'change' : 'input', () => {
    model[key] = control.value
    update(control)
  })
  return el('label', { class: 'field' }, el('span', {}, label), control, help && el('small', {}, help))
}

function text(tag, content, css) { return el(tag, { class: css }, content) }
function actions(...children) { return el('div', { class: 'actions' }, children) }
function card(...children) { return el('section', { class: 'card' }, children) }

function notify(message = '', error = false) {
  const status = find('status')
  status.hidden = !message
  status.textContent = message
  status.dataset.error = String(error)
}

function savingStatus(state, detail) {
  find('retry').hidden = state !== 'failed'
  const save = find('save')
  save.textContent = state === 'saving' ? '保存中'
    : state === 'saved' ? '已保存 · ' + detail.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '保存失败'
  save.title = state === 'failed' ? detail.message : ''
  if (state === 'failed') notify(detail.message || 'Anna 保存失败，可下载草稿副本。', true)
}

function changed({ immediate = false, content = false } = {}) {
  if (content) {
    draft.acknowledged = false
    draft.review = []
  }
  exportVersion++
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl)
    downloadUrl = undefined
    find('export-link')?.remove()
  }
  if (!local) {
    stored = draft
    if (immediate) return saver.flush(draft)
    saver.schedule(draft)
  }
}

function fileLink(value, name, label) {
  const url = URL.createObjectURL(value)
  return { url, link: el('a', { class: 'button primary', href: url, download: name }, label) }
}

function modal(title, body, ok) {
  const dialog = find('dialog')
  const heading = el('h2', { id: 'dialog-title' }, title)
  dialog.setAttribute('aria-labelledby', 'dialog-title')
  dialog.replaceChildren(heading, body, actions(button(ok ? '取消' : '关闭', () => dialog.close(), { autofocus: true }),
    ok && button('确认', () => { dialog.close(); ok() }, { primary: true })))
  dialog.showModal()
}

function go(step, focus = true) {
  if (step >= 2 && !draft.pages.length) return
  if (step >= 3 && !draft.scriptConfirmed && !draft.designReached) return
  if (step >= 4 && !draft.designReached && pendingPages(draft, 'visual').length) return
  home = false
  draft.step = step
  void changed({ immediate: true })
  notify()
  render(focus)
}

function begin(value, offline) {
  const issue = unreadable !== undefined || storageError
  draft = value
  local = offline || !saver || !anna
  candidate = undefined
  rewrite = ''
  returning = undefined
  home = false
  if (catalog.length && draft.preferences.effort) {
    const model = catalog.find(({ modelName }) => modelName === draft.preferences.model)
    if (!model?.capabilities?.thinking?.levels?.includes(draft.preferences.effort)) {
      draft.preferences.effort = ''
      draft.preferences.supportsThinking = false
    }
  }
  if (local) {
    find('retry').hidden = true
    find('save').textContent = '文件草稿 · 可下载副本'
  } else {
    for (const name of ['topic', 'audience']) {
      if (!draft.brief[name] && typeof payload?.[name] === 'string' && payload[name].trim()) {
        draft.brief[name] = payload[name]
        invalidate(draft)
      }
    }
    void changed({ immediate: true })
    if (issue) notify(storageError?.message ?? '原草稿需要恢复。', true)
  }
  render(true)
}

function newProject() {
  const start = () => {
    const value = newDraft()
    for (const name of ['topic', 'audience']) if (typeof payload?.[name] === 'string') value.brief[name] = payload[name]
    value.template = recommended[value.brief.scenario][0]
    begin(value, !saver || Boolean(storageError))
  }
  if (stored) modal('新建并替换 Anna 草稿？', text('p', 'Anna 为此 App 保存一份草稿。建议先下载当前草稿副本，接下来会保存新的演示。'), start)
  else if (draft && local) modal('新建演示？', text('p', '当前文件草稿将从窗口移除。可先下载它的副本。'), start)
  else start()
}

function homeView() {
  const resume = stored ?? draft
  const openExample = () => begin(exampleDraft(), true)
  return el('section', { class: 'welcome' },
    el('div', { class: 'welcome-copy' },
      text('h1', '创建演示文稿'),
      text('p', '填写演示需求，审阅大纲和文字稿，调整风格与排版后导出可编辑的 PPTX。'),
      actions(resume && button('继续上次草稿', () => {
        if (resume === draft) { home = false; render(true) } else begin(resume, false)
      }, { primary: true }),
      stored && draft && local && button('继续文件草稿', () => { home = false; render(true) }),
      button('新建演示', newProject, { primary: !resume, disabled: !connected }),
      button('体验示例', () => {
        if (draft && local) modal('打开示例？', text('p', '当前文件草稿将从窗口移除。可先下载它的副本。'), openExample)
        else openExample()
      }, { disabled: Boolean(job) }),
      button('导入草稿文件', () => find('import').click(), { disabled: Boolean(job) })),
      unreadable !== undefined && button('下载待恢复的 APS 原始副本', () => backup(unreadable)),
      storageError && text('p', storageError.message, 'warning'),
      resume && text('p', (resume.brief.topic || '未命名演示') + ' · ' + stepNames[resume.step], 'resume-label')),
    el('div', { class: 'welcome-visual', 'aria-hidden': 'true' }, canvas(exampleDraft(5).pages[0], 'briefing', 0, 5)))
}

function pageBar(title, subtitle, main, ...extras) {
  return el('section', { class: 'page-bar' }, el('div', {},
    el('h1', { id: 'view-title', tabindex: '-1' }, title), subtitle && text('p', subtitle, 'subtle')),
    actions(main, ...extras))
}

function render(focus = false) {
  const workspace = find('workspace')
  const stepNav = find('steps')
  find('project').textContent = !home && draft ? draft.brief.topic || '未命名演示' : ''
  find('backup').hidden = !draft
  renderAnnaBar()
  stepNav.hidden = home
  if (home) workspace.replaceChildren(homeView())
  else {
    stepNav.replaceChildren(...stepNames.map((name, index) => button(name, () => go(index), {
      'aria-current': draft.step === index ? 'step' : undefined,
      disabled: index >= 2 && !draft.pages.length || index >= 3 && !draft.scriptConfirmed && !draft.designReached ||
        index >= 4 && !draft.designReached && pendingPages(draft, 'visual').length > 0,
    })))
    workspace.replaceChildren(...[job && progress(), views[draft.step]()].filter(Boolean))
    stepNav.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  if (focus) {
    window.scrollTo(0, 0)
    ;(find('view-title') ?? workspace.querySelector('button'))?.focus({ preventScroll: true })
  }
}

function usePayload(value) {
  if (!value) return
  payload = value
  if (!draft) return
  let edited = false
  for (const name of ['topic', 'audience']) {
    if (!draft.brief[name] && typeof value[name] === 'string' && value[name].trim()) {
      draft.brief[name] = value[name]
      edited = true
    }
  }
  if (edited && !local) {
    invalidate(draft)
    void changed({ immediate: true })
  }
  render()
}

function briefView() {
  const model = draft.brief
  const canStart = () => anna && !hasOutlineWork(draft)
  const primary = button('', () => {
    try { validateBrief(model) } catch (error) { notify(error.message, true); return }
    if (canStart()) requestOutline()
    else if (draft.pages.length) go(1)
    else startManualOutline()
  }, { primary: true, disabled: Boolean(job) })
  const updatePrimary = () => { primary.textContent = canStart() ? '用 Anna 起草大纲' : '进入大纲' }
  updatePrimary()
  function edit(control) {
    invalidate(draft)
    changed()
    if (control.name === 'count') validateCount(control)
    find('project').textContent = model.topic || '未命名演示'
    updatePrimary()
  }
  const count = field('总页数', model, 'count', { name: 'count', type: 'number', min: 5, max: 30, step: 1, 'aria-describedby': 'count-error', update: edit })
  const countError = el('small', { id: 'count-error', class: 'warning', role: 'status' })
  count.append(countError)
  function validateCount(control) {
    try { pageCount(control.value); countError.textContent = ''; control.removeAttribute('aria-invalid') }
    catch (error) { countError.textContent = error.message; control.setAttribute('aria-invalid', 'true') }
  }
  validateCount(count.querySelector('input'))
  const fields = card(
    field('主题', model, 'topic', { placeholder: '例如：客服响应复盘', required: true, update: edit }),
    el('div', { class: 'field-grid' },
      field('受众', model, 'audience', { placeholder: '例如：运营与客服负责人', update: edit }),
      field('场景', model, 'scenario', { choices: scenarios, update: edit }),
      count,
      field('文稿语言', model, 'language', { choices: { zh: '简体中文', en: 'English' }, update: edit })),
    field('演示目标', model, 'goal', { rows: 2, placeholder: '例如：说明试点结果并确定推广方案', update: edit }),
    field('素材', model, 'source', { rows: 5, placeholder: '粘贴会议记录、调研结果或已有段落', update: edit }),
    field('必讲内容', model, 'required', { rows: 3, placeholder: '事实、数据或限制条件，每行一项', update: edit }),
    payload && ['topic', 'audience'].some((key) => payload[key] && payload[key] !== model[key]) &&
      button('使用 Anna 入口提供的主题和受众', () => modal('替换当前需求字段？', text('p', '替换后保留大纲和文字稿，相关页面标为待更新。'), () => {
        for (const name of ['topic', 'audience']) if (typeof payload[name] === 'string' && payload[name].trim()) model[name] = payload[name]
        invalidate(draft)
        void changed({ immediate: true })
        render()
      })))
  return el('div', { class: 'narrow' },
    pageBar(stepNames[0], '主题为必填项。总页数含封面、过渡页和结尾。', primary), fields)
}

function startManualOutline() {
  try { Object.assign(draft, makeOutline(draft, 'manual')) } catch (error) { notify(error.message, true); return }
  draft.template = recommended[draft.brief.scenario]?.[0] ?? 'briefing'
  draft.current = draft.pages[0].id
  go(1)
}

function outlineView() {
  if (!draft.pages.length) return el('div', { class: 'narrow' },
    pageBar(stepNames[1], '大纲包括章节、页标题和主要内容，生成后可编辑。',
      anna && draft.brief.topic.trim() ? button(job ? '正在起草大纲…' : '用 Anna 起草大纲', requestOutline, { primary: true, disabled: Boolean(job) })
        : button('填写演示需求', () => go(0), { primary: true }),
      anna && draft.brief.topic.trim() && button('手工编写大纲', startManualOutline, { disabled: Boolean(job) })))
  const start = () => anna && !hasOutlineWork(draft)
  const primary = button('', () => start() ? requestOutline() : confirm(), { primary: true, disabled: Boolean(job) })
  const regenerate = button('Anna 起草大纲', requestOutline, { disabled: !anna || Boolean(job) })
  const target = field('目标页数', draft.brief, 'count', { type: 'number', min: 5, max: 30, step: 1, update: () => {
    invalidate(draft, [], true)
    changed()
    updateMeter()
  } })
  const meter = el('p', { role: 'status' })
  function updateMeter() {
    meter.textContent = '已规划 ' + draft.pages.length + ' / 目标 ' + (draft.brief.count || '—') + '。' + outlineProblem(draft)
    primary.textContent = start() ? '用 Anna 起草大纲'
      : anna && pendingPages(draft).length ? '确认大纲，生成文字稿' : '确认大纲，进入文字稿'
    regenerate.hidden = !anna || Boolean(start())
  }
  updateMeter()
  const mutate = (fn, affected = []) => {
    fn()
    invalidate(draft, affected)
    void changed({ immediate: true })
    render()
  }
  const sectionFields = draft.sections.map((section) => {
    const count = draft.pages.filter(({ sectionId }) => sectionId === section.id).length
    return el('div', { class: 'section-row' },
      field('章节名称', section, 'title', { update: () => { invalidate(draft, draft.pages.filter(({ sectionId }) => sectionId === section.id)); changed(); updateMeter() } }),
      text('span', count + ' 页', 'count-label'),
      !count && button('移除空章节', () => mutate(() => { draft.sections = draft.sections.filter(({ id }) => id !== section.id) })))
  })
  const move = (index, delta) => mutate(() => {
    const other = index + delta
    const pages = draft.pages
    ;[pages[index], pages[other]] = [pages[other], pages[index]]
  })
  const sectionChoices = Object.fromEntries(draft.sections.map(({ id, title }) => [id, title || '未命名章节']))
  const rows = draft.pages.map((page, index) => {
    const edited = () => { invalidate(draft, [page]); changed(); updateMeter() }
    return el('article', { class: 'outline-row' },
      text('strong', String(index + 1).padStart(2, '0'), 'index'),
      field('页标题', page, 'planTitle', { update: edited }),
      field('主要内容', page, 'goal', { update: edited }),
      field('所属章节', page, 'sectionId', { choices: sectionChoices, update: () => { edited(); render() } }),
      actions(button('上移', () => move(index, -1), { disabled: index <= 1, 'aria-label': '上移第 ' + (index + 1) + ' 页' }),
        button('下移', () => move(index, 1), { disabled: index === 0 || index === draft.pages.length - 1, 'aria-label': '下移第 ' + (index + 1) + ' 页' }),
        button('移除', () => modal('移除第 ' + (index + 1) + ' 页？',
          text('p', page.written ? '该页的人工文字、备注和图示将随页面移除。其他页保留。' : '该页计划将移除，其他页保留。'), () => mutate(() => {
            draft.pages.splice(index, 1)
            if (draft.current === page.id) draft.current = draft.pages[Math.min(index, draft.pages.length - 1)]?.id ?? null
          })), { disabled: index === 0 })))
  })
  const confirm = () => {
    const problem = outlineProblem(draft)
    if (problem) return notify(problem, true)
    const enter = () => { draft.confirmed = true; go(2) }
    if (anna && pendingPages(draft).length) requestBatches('script', pendingPages(draft).map(({ id }) => id), enter)
    else enter()
  }
  return el('div', {},
    pageBar(stepNames[1], '封面固定在首位。重新排序时，文字与备注跟随原页。', primary,
      returning && button('返回问题复查', returnToReview), regenerate),
    card(actions(target, meter), el('details', {}, text('summary', '章节与页数'), sectionFields,
      button('新增章节', () => mutate(() => { draft.sections.push({ id: crypto.randomUUID(), title: '新章节' }) })))),
    el('div', { class: 'outline-list' }, rows),
    button('新增页面', () => modal('新增页面？', text('p', '将在大纲末尾新增一个空白页面。请重新核对目标页数。'),
      () => mutate(() => { draft.pages.push(newPage(draft.sections.at(-1).id)) }))))
}

function editorFields(page, update) {
  return el('div', { class: 'fields' },
    field('结论式标题', page, 'title', { update }),
    field('投影正文', page, 'body', { rows: 4, update }),
    field('演讲者备注', page, 'notes', { rows: 4, update }),
    field('素材依据或待核实项', page, 'evidence', { rows: 2, update }))
}

function pageTextChanged(page) {
  page.written = Boolean(page.title.trim() && page.body.trim())
  changed({ content: true })
}

function scriptView() {
  const confirm = () => {
    if (!draft.confirmed) return notify('请先确认大纲。', true)
    const remaining = pendingPages(draft)
    if (remaining.length) return notify('还有 ' + remaining.length + ' 页缺稿或待更新。', true)
    const enter = () => { draft.scriptConfirmed = true; go(3) }
    if (anna && pendingPages(draft, 'visual').length) requestBatches('visual', pendingPages(draft, 'visual').map(({ id }) => id), enter)
    else {
      draft.designReached = true
      enter()
    }
  }
  const primary = button('', () => {
    const pending = pendingPages(draft)
    if (anna && pending.length) requestBatches('script', pending.map(({ id }) => id))
    else confirm()
  }, { primary: true })
  const bar = pageBar(stepNames[2], '文字稿进度', primary, returning && button('返回问题复查', returnToReview))
  const updateProgress = () => {
    const pending = pendingPages(draft).length
    bar.querySelector('.subtle').textContent = '已完成 ' + (draft.pages.length - pending) + ' / ' + draft.pages.length + ' 页 · 正文和讲者备注分别编辑。'
    primary.textContent = job ? '生成中…' : anna && pending ? '继续起草文字稿'
      : anna && pendingPages(draft, 'visual').length ? '确认文字稿，生成排版' : '确认文字稿，进入风格'
    primary.disabled = !draft.confirmed || Boolean(job) || !anna && pending > 0
  }
  updateProgress()
  const pages = draft.pages.map((page, index) => {
    const tag = text('p', '', 'subtle')
    const capacity = () => {
      const fields = scene(page, draft.template, index, draft.pages.length).blocks.filter((block) => block.field && !fits(block)).map(({ field }) => field)
      tag.textContent = fields.length ? [...new Set(fields)].join('、') + ' 可能溢出。可把解释移入备注，或在排版中换版式。' : ''
    }
    capacity()
    const status = text('span', page.stale ? '待更新' : page.written ? '已起草' : '待起草', 'subtle')
    return el('article', { class: 'card', id: 'script-' + page.id },
      el('div', { class: 'panel-head' }, text('h2', (index + 1) + '. ' + page.planTitle), status),
      text('p', page.goal, 'subtle'),
      el('details', {
        open: page.id === draft.current, on: { toggle: (event) => {
          if (event.currentTarget.open && draft.current !== page.id && document.contains(event.currentTarget)) {
            draft.current = page.id
            changed()
          }
        } },
      }, text('summary', '编辑本页'), editorFields(page, () => {
        pageTextChanged(page)
        updateProgress()
        status.textContent = page.stale ? '待更新' : page.written ? '已起草' : '待起草'
        capacity()
      }), page.stale && button('已复核，保留本页现稿', () => {
        page.stale = false
        void changed({ immediate: true, content: true })
        render()
      })),
      el('div', { class: 'script-read' }, el('strong', {}, page.title || '标题待填写'),
        text('p', page.body || '正文待填写'), page.notes && text('p', '备注 · ' + page.notes, 'subtle'),
        page.evidence && text('p', '依据 · ' + page.evidence, 'subtle')),
      tag, page.stale && button('Anna 更新此页', () => requestBatches('script', [page.id]), { disabled: !draft.confirmed || !anna || Boolean(job) }))
  })
  for (const article of pages) {
    article.addEventListener('input', () => {
      const page = draft.pages.find(({ id }) => article.id === 'script-' + id)
      article.querySelector('.script-read').replaceChildren(el('strong', {}, page.title || '标题待填写'), text('p', page.body || '正文待填写'),
        page.notes && text('p', '备注 · ' + page.notes, 'subtle') || '', page.evidence && text('p', '依据 · ' + page.evidence, 'subtle') || '')
    })
  }
  return el('div', { class: 'narrow' }, bar, pages)
}
function canvas(page, template, index, total, animate = false) {
  const { bg, blocks } = scene(page, template, index, total)
  const element = el('article', { class: 'slide' + (animate ? ' fade' : ''), 'aria-label': '第 ' + (index + 1) + ' 页 · ' + (page.title || page.planTitle) })
  element.style.background = '#' + bg
  for (const block of blocks) {
    const node = el('div', { class: 'block ' + block.type, 'aria-hidden': block.type === 'rect' ? 'true' : null })
    Object.assign(node.style, {
      left: (block.x / width * 100) + '%', top: (block.y / height * 100) + '%',
      width: (block.w / width * 100) + '%', height: (block.h / height * 100) + '%',
      color: '#' + block.color,
    })
    if (block.type === 'rect') node.style.background = '#' + block.color
    if (block.type === 'text') {
      Object.assign(node.style, {
        fontFamily: '"' + block.font + '", sans-serif', fontSize: (block.size / (width * 72) * 100) + 'cqw',
        fontWeight: block.bold ? '700' : '400', textAlign: block.align,
      })
      const copy = text('span', block.value)
      node.append(copy)
      if (block.field) node.dataset.field = block.field
    }
    if (block.type === 'chart') {
      const max = Math.max(1, ...block.values.map(({ value }) => Number(value)))
      node.append(text('strong', block.unit),
        ...block.values.map(({ value, label }) => {
          const bar = el('i')
          bar.style.background = '#' + block.color
          bar.style.width = (Number(value) / max * 100) + '%'
          return el('div', { class: 'bar-row' }, text('span', label), el('div', { class: 'bar-track' }, bar), text('b', String(value)))
        }))
    }
    element.append(node)
  }
  return element
}

function selected() { return draft.pages.find(({ id }) => id === draft.current) ?? draft.pages[0] }

function selectPage(id) {
  if (candidate?.id !== id) candidate = undefined
  if (draft.current !== id) rewrite = ''
  draft.current = id
  void changed({ immediate: true })
  render()
  find('active-page')?.focus({ preventScroll: true })
}

function pagePicker(page, update) {
  const choices = Object.fromEntries(draft.pages.map(({ id, title, planTitle }, i) => [id, (i + 1) + '. ' + (title || planTitle)]))
  return field('当前页', { id: page.id }, 'id', { choices, update: (input) => update(input.value) })
}

function layoutFields(page, update) {
  const index = draft.pages.indexOf(page)
  const offered = index === 0 ? { cover: layouts.cover } : Object.fromEntries(Object.entries(layouts).slice(1))
  function refresh() {
    page.designed = true
    void changed({ immediate: true, content: true })
    render()
  }
  const chart = page.layout === 'chart'
  const visual = chart || page.layout === 'steps' || page.layout === 'compare'
  const previous = page.layout
  return el('div', { class: 'fields' },
    field('页面版式', page, 'layout', { choices: offered, update: () => {
      page.visualByLayout ??= {}
      if (visual) page.visualByLayout[previous] = page.visual
      page.visual = page.visualByLayout[page.layout] ?? []
      delete page.visualByLayout[page.layout]
      if (['compare', 'steps'].includes(page.layout) && !page.visual.length) page.visual = [{ label: '', detail: '' }, { label: '', detail: '' }]
      if (page.layout === 'chart' && !page.visual.length) page.visual = [{ label: '', value: '' }]
      refresh()
    } }),
    field('信息密度', page, 'density', { choices: { normal: '标准', compact: '紧凑' }, update }),
    field('正文对齐', page, 'align', { choices: { template: '跟随模板', left: '左对齐', center: '居中' }, update }),
    visual && el('div', { class: 'visual-fields' },
      chart && field('单位', page, 'unit', { update }),
      chart && field('数据来源', page, 'visualSource', { update }),
      page.visual.map((item, i) => el('div', { class: 'visual-row' },
        field('图示标签 ' + (i + 1), item, 'label', { update }),
        chart ? field('数值 ' + (i + 1), item, 'value', { type: 'number', min: 0, step: 'any', update }) : field('图示说明 ' + (i + 1), item, 'detail', { update }),
        button('移除项', () => { page.visual.splice(i, 1); refresh() }, { 'aria-label': '移除图示第 ' + (i + 1) + ' 项' }))),
      button('新增图示项', () => { page.visual.push(chart ? { label: '', value: '' } : { label: '', detail: '' }); refresh() },
        { disabled: page.visual.length >= (chart ? 8 : page.layout === 'compare' ? 2 : 5) })))
}

function designView() {
  const page = selected()
  const index = draft.pages.indexOf(page)
  const first = recommended[draft.brief.scenario] ?? recommended.report
  const choices = [...first, ...Object.keys(templates).filter((id) => !first.includes(id))]
  const pending = pendingPages(draft, 'visual')
  const edit = () => { draft.designReached = true; go(4) }
  return el('div', {},
    pageBar(stepNames[3], pending.length && anna ? '还有 ' + pending.length + ' 页待生成初始排版。' : '可切换模板、修改版式和图示。原稿与讲者备注随页面保留。',
      anna && pending.length ? button(job ? '正在生成排版…' : '继续生成排版', () => requestBatches('visual', pending.map(({ id }) => id)),
        { primary: true, disabled: !draft.scriptConfirmed || Boolean(job) }) : button('进入排版', edit, { primary: true }),
      anna && pending.length && !job && button('保留当前版式，手工调整', edit)),
    el('div', { class: 'design-grid' }, el('div', {},
      el('div', { class: 'panel-head' }, el('h2', { id: 'active-page', tabindex: '-1' }, '模板 · 第 ' + (index + 1) + ' 页'), pagePicker(page, selectPage)),
      el('div', { class: 'template-grid' }, choices.map((id) => el('div', { class: 'template' },
        canvas(page, id, index, draft.pages.length),
        el('div', { class: 'template-info' },
          button(templates[id].name, () => {
            draft.template = id
            draft.templateChosen = true
            void changed({ immediate: true, content: true })
            render()
            document.querySelector('[data-template="' + id + '"]')?.focus({ preventScroll: true })
          }, { 'aria-pressed': String(id === draft.template), 'data-template': id }),
          text('p', (first.includes(id) ? '场景推荐 · ' : '') + templates[id].description, 'subtle')))))),
    card(text('h2', '本页版式'), layoutFields(page, () => {
      page.designed = true
      changed({ content: true })
      document.querySelectorAll('.template .slide').forEach((node, i) => node.replaceWith(canvas(page, choices[i], index, draft.pages.length)))
    }))))
}

function responsivePanel(id, name, inside) {
  const desktop = matchMedia('(min-width: 761px)').matches
  return el('details', { class: 'editor-panel card panel-' + id, open: desktop || pane[id], on: { toggle: (event) => {
    if (!desktop && document.contains(event.currentTarget)) pane[id] = event.currentTarget.open
  } } }, text('summary', name), inside)
}

function editView() {
  const page = selected()
  const index = draft.pages.indexOf(page)
  const stage = el('div', { class: 'stage' }, canvas(page, draft.template, index, draft.pages.length))
  const advisory = text('p', '', 'subtle')
  const heading = el('h2', { id: 'active-page', tabindex: '-1' }, '第 ' + (index + 1) + ' 页 · ' + (page.title || page.planTitle))
  const updateWarning = () => {
    const blocks = [...stage.querySelectorAll('[data-field]')]
    const fields = blocks.filter((node) => node.scrollHeight > node.clientHeight + 1).map((node) => node.dataset.field)
    advisory.textContent = fields.length ? [...new Set(fields)].join('、') + ' 可能溢出，请精简投影文字或换版式。' : ''
  }
  requestAnimationFrame(updateWarning)
  const refresh = () => {
    pageTextChanged(page)
    stage.replaceChildren(canvas(page, draft.template, index, draft.pages.length))
    heading.textContent = '第 ' + (index + 1) + ' 页 · ' + (page.title || page.planTitle)
    updateWarning()
  }
  const deckNav = el('nav', { class: 'thumbs', 'aria-label': '幻灯片缩略图' },
    draft.pages.map((item, i) => el('div', { class: 'thumbnail' },
      button((i + 1) + '. ' + (item.title || item.planTitle || '待填写'), () => selectPage(item.id),
        { 'aria-current': item.id === page.id ? 'page' : undefined }),
      canvas(item, draft.template, i, draft.pages.length))))
  const revision = { instruction: rewrite }
  const properties = el('div', { class: 'property-fields' },
    editorFields(page, refresh),
    el('details', { open: true }, text('summary', '布局与图示'), layoutFields(page, () => { page.designed = true; refresh() })),
    anna && el('details', { open: Boolean(candidate) }, text('summary', '只重写本页'),
      field('修改要求', revision, 'instruction', { rows: 2, placeholder: '例如：标题先说说服听众的理由', update: () => { rewrite = revision.instruction } }),
      button('生成候选', () => requestRewrite(page), { disabled: Boolean(job) })),
    page.stale && button('已复核，保留本页现稿', () => {
      page.stale = false
      void changed({ immediate: true, content: true })
      render()
    }))
  function move(delta) {
    if (draft.pages[index + delta]) selectPage(draft.pages[index + delta].id)
  }
  const stageRegion = el('section', { class: 'canvas-region', on: { keydown: (event) => {
    if (event.target === heading && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }
  } } }, heading, stage, advisory,
  actions(button('上一页', () => move(-1), { disabled: !index }), button('下一页', () => move(1), { disabled: index === draft.pages.length - 1 }),
    button('放映预览', () => present(index))),
  field('预览切换', draft, 'transition', { choices: { none: '无切换', fade: '淡入淡出' }, help: 'PPTX 使用静态切换。' }),
  candidate?.id === page.id && candidateView(page))
  return el('div', {}, pageBar(stepNames[4], draft.pages.length + ' 页 · 16:9',
    button(returning ? '返回问题复查' : '审查与导出', returnToReview, { primary: true })),
  el('div', { class: 'edit-grid' }, responsivePanel('pages', '幻灯片导航 · ' + (index + 1) + ' / ' + draft.pages.length, deckNav),
    stageRegion, responsivePanel('properties', '当前页属性', properties)))
}

function candidateView(page) {
  const held = candidate
  const compare = (name, item) => el('div', {},
    text('strong', name), text('p', item.title), text('p', item.body),
    text('p', '备注 · ' + item.notes, 'subtle'), text('p', '依据 · ' + item.evidence, 'subtle'))
  return card(text('h2', '修改候选'),
    el('div', { class: 'candidate-grid' }, compare('当前', page), compare('候选', held.result)),
    actions(button('放弃候选', () => { candidate = undefined; render() }),
      button('采纳候选', () => {
        if (JSON.stringify(page) !== held.before || draftSignature() !== held.signature) {
          notify('现稿已修改。请重新生成候选以避免覆盖编辑。', true)
          return
        }
        Object.assign(page, held.result)
        candidate = undefined
        void changed({ immediate: true, content: true })
        render()
      }, { primary: true })))
}

function present(index) {
  const dialog = find('dialog')
  dialog.classList.add('present')
  dialog.setAttribute('aria-label', '放映预览')
  dialog.removeAttribute('aria-labelledby')
  const slide = el('div', { class: 'presentation-stage' })
  let current = index
  const previous = button('上一页', () => advance(-1))
  const next = button('下一页', () => advance(1))
  const close = button('退出放映', () => dialog.close())
  function advance(delta) {
    current = Math.max(0, Math.min(draft.pages.length - 1, current + delta))
    slide.replaceChildren(canvas(draft.pages[current], draft.template, current, draft.pages.length, draft.transition === 'fade'))
    previous.disabled = current === 0
    next.disabled = current === draft.pages.length - 1
  }
  const keydown = (event) => {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      advance(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }
  dialog.replaceChildren(slide, actions(previous, next, close))
  dialog.addEventListener('keydown', keydown)
  dialog.addEventListener('close', () => {
    dialog.classList.remove('present')
    dialog.removeEventListener('keydown', keydown)
  }, { once: true })
  advance(0)
  dialog.showModal()
  close.focus()
}

function issueKey(issue, index) {
  const suffix = [issue.reason, issue.quote].join(' ').slice(0, 70)
  return 'issue-' + (issue.id ?? 'outline') + '-' + index + '-' + suffix
}

function returnToReview() {
  const id = returning
  returning = undefined
  go(5)
  if (id) (find(id) ?? document.querySelector('.issue'))?.focus()
}

function reviewView() {
  const problems = [...localReview(draft), ...draft.review]
  const blocking = problems.filter(({ blocking }) => blocking).length
  const advisory = problems.length - blocking
  const list = problems.map((issue, index) => {
    const pageIndex = draft.pages.findIndex(({ id }) => id === issue.id)
    const id = issueKey(issue, index)
    return el('article', { class: 'card issue', id, tabindex: '-1' },
      text('h2', (pageIndex < 0 ? '整份文稿' : '第 ' + (pageIndex + 1) + ' 页') + ' · ' + (issue.blocking ? '待修复' : '待审阅')),
      text('p', issue.reason), issue.quote && text('blockquote', issue.quote),
      text('p', '建议 · ' + issue.suggestion, 'subtle'),
      issue.evidence && text('p', '依据 · ' + issue.evidence, 'subtle'),
      button(pageIndex < 0 ? '返回大纲' : '打开第 ' + (pageIndex + 1) + ' 页', () => {
        returning = id
        if (pageIndex < 0) { go(1); return }
        draft.current = issue.id
        go(draft.pages[pageIndex].written ? 4 : 2)
        const where = find('active-page') ?? find('script-' + issue.id)
        if (where) { where.tabIndex = -1; where.focus(); where.scrollIntoView({ block: 'nearest' }) }
      }))
  })
  return el('div', { class: 'narrow' },
    pageBar(stepNames[5], blocking + ' 项待修复 · ' + advisory + ' 项待审阅',
      button(exportBusy ? '正在生成 PPTX…' : '准备 PPTX 下载', () => exportDeck(), { primary: true, disabled: exportBusy || blocking > 0 }),
      button('Anna 语义评审', requestReview, { disabled: !anna || !draft.scriptConfirmed || Boolean(job) })),
    el('div', { id: 'export-output' }),
    advisory > 0 && card(text('p', '复核建议与待核实项后，可自行决定是否导出。'),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: draft.acknowledged, on: { change: (event) => {
        draft.acknowledged = event.currentTarget.checked
        void changed({ immediate: true })
      } } }), '我已审阅这些提示')),
    !problems.length && card(text('p', '结构检查通过。可准备 16:9 的可编辑 PPTX。')),
    list)
}

const effortLabels = { minimal: '最少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' }

function renderModelControls(focusId) {
  const settings = draft.preferences
  const selectedModel = catalog.find(({ modelName }) => modelName === settings.model)
  const levels = selectedModel?.capabilities?.thinking?.levels ?? []
  const modelChoices = catalog.length ? {
    '': '平台默认',
    ...Object.fromEntries(catalog.map(({ modelName, displayName }) => [modelName, displayName || modelName])),
    ...(settings.model && !selectedModel ? { [settings.model]: settings.model } : {}),
  } : undefined
  const modelField = field('模型', settings, 'model', { id: 'anna-model', choices: modelChoices, placeholder: '平台默认',
    title: modelChoices ? '选择模型偏好' : '填写完整模型 ID，留空使用平台默认', update: () => {
      settings.supportsThinking = false
      settings.effort = ''
      changed()
      if (modelChoices && showThinking) renderModelControls('anna-model')
    } })
  const toggle = el('label', { class: 'check' }, el('input', { type: 'checkbox', id: 'anna-show-thinking', checked: showThinking,
    on: { change: (event) => {
      showThinking = event.currentTarget.checked
      renderModelControls('anna-show-thinking')
      renderAnnaBar()
    } } }), '显示推理强度')
  const controls = [modelField, toggle]
  if (showThinking && levels.length) controls.push(field('推理偏好', settings, 'effort', {
    choices: { '': '平台默认', ...Object.fromEntries(levels.map((level) => [level, effortLabels[level] ?? level])) },
    update: () => { settings.supportsThinking = Boolean(settings.effort); changed() },
  }))
  find('anna-controls').replaceChildren(...controls)
  activeModelSettings = settings
  if (focusId) find(focusId)?.focus({ preventScroll: true })
}

function renderAnnaBar() {
  const bar = find('anna-bar')
  bar.hidden = !anna || home || !draft
  if (bar.hidden) return
  if (activeModelSettings !== draft.preferences) renderModelControls()
  const last = draft.usage.last
  const cu = (value) => Number.isFinite(value) ? String(Number(value.toFixed(4))) : '—'
  const fields = [
    '实际调用模型 ' + (last?.model ?? '—'),
    '有效输出上限 ' + (last?.effectiveTokens ?? '—'),
    'CU ' + cu(last?.cu) + (draft.usage.total ? '（累计 ' + cu(draft.usage.total) + '）' : ''),
  ]
  if (showThinking) fields.push('有效推理强度 ' + (effortLabels[last?.effort] ?? last?.effort ?? '—'))
  const receipt = find('anna-usage')
  if (receipt.textContent !== fields.join('')) receipt.replaceChildren(...fields.map((item) => text('span', item)))
}

function draftSignature() {
  return JSON.stringify([draft.brief, draft.confirmed, draft.sections, draft.pages.map(({ id, sectionId, planTitle, goal }) => [id, sectionId, planTitle, goal])])
}

function progress() {
  return el('section', { class: 'job card', role: 'status', id: 'job-state' }, text('strong', job.label),
    button(job.stop ? '等待已发请求结束' : '停止后续批次', () => {
      job.stop = true
      render()
    }, { disabled: job.stop }))
}

function runAnna(title, run) {
  if (!anna || job || find('dialog').open) return
  try { validateBrief(draft.brief) } catch (error) { return notify(error.message, true) }
  const operation = { label: title, stop: false }
  job = operation
  candidate = undefined
  notify()
  render()
  void (async () => {
    try { await run(operation) }
    catch (error) { notify(operation.label + ' · ' + error.message, true) }
    finally {
      job = undefined
      void changed({ immediate: true })
      render()
    }
  })()
}

function requestOutline() {
  const existing = hasOutlineWork(draft)
  runAnna('Anna 起草大纲', async (op) => {
    go(1)
    const before = draftSignature()
    let result
    try {
      result = await complete(anna, 'outline', draft, [])
    } catch (error) {
      if (op.stop || before !== draftSignature()) return notify('大纲请求已结束，当前编辑已保留。')
      if (!(error instanceof OutlineResponseError)) throw error
      op.label = 'Anna 正在修正大纲'
      render()
      result = await complete(anna, 'outline', draft, [], error.message)
    }
    if (op.stop || before !== draftSignature()) return notify('大纲结果已过期，当前编辑已保留。')
    const apply = () => {
      if (before !== draftSignature()) return notify('大纲已修改，当前编辑已保留。')
      Object.assign(draft, result, { current: result.pages[0].id, batches: [], designReached: false, step: 1 })
      if (!draft.templateChosen) draft.template = recommended[draft.brief.scenario]?.[0] ?? 'briefing'
      invalidate(draft)
      void changed({ immediate: true })
      render()
    }
    if (existing) modal('采纳新大纲？',
      el('div', {}, text('p', '采纳会替换现有大纲、文字稿、讲者备注和图示。'),
        el('ol', {}, result.sections.map(({ id, title }) => el('li', {}, title + ' · ' + result.pages.filter((p) => p.sectionId === id).length + ' 页')))), apply)
    else apply()
  })
}

function requestBatches(kind, ids, enter) {
  const visual = kind === 'visual'
  if (!ids.length || !enter && !(visual ? draft.scriptConfirmed : draft.confirmed)) return
  const title = visual ? 'Anna 生成初始排版' : 'Anna 起草文字稿'
  runAnna(title, async (op) => {
    enter?.()
    const before = draftSignature()
    const settings = JSON.stringify(draft.preferences)
    let batch
    while (!op.stop && before === draftSignature() && settings === JSON.stringify(draft.preferences) && (batch = nextBatch(draft, ids, kind)).length) {
      const numbers = batch.map((page) => draft.pages.indexOf(page) + 1)
      op.label = title + ' · 正在处理第 ' + numbers.join('、') + ' 页 · 已完成 ' + (draft.pages.length - pendingPages(draft, kind).length) + ' / ' + draft.pages.length
      render()
      const pagesBefore = JSON.stringify(batch)
      const targets = batch.map(({ id, planTitle, goal, title, body, evidence }, i) =>
        visual ? { id, position: numbers[i], title, body, evidence } : { id, planTitle, goal })
      const result = await complete(anna, kind, draft, targets)
      if (op.stop || before !== draftSignature() || pagesBefore !== JSON.stringify(batch)) {
        notify('当前批次结果已过期，已有稿件已保留。')
        break
      }
      const results = visual ? result.pages : result
      if (visual && !draft.templateChosen && result.template) {
        draft.template = result.template
        draft.templateChosen = true
      }
      results.forEach((page, i) => Object.assign(batch[i], page))
      if (visual && !pendingPages(draft, 'visual').length) draft.designReached = true
      draft.batches.push({ kind, ids: results.map(({ id }) => id), completedAt: new Date().toISOString() })
      if (await changed({ immediate: true, content: true }) === false) {
        notify('批次已合入当前窗口，Anna 保存失败。请先重试保存，再继续。', true)
        break
      }
    }
    if (op.stop) notify('已停止后续批次，可继续尚未完成的页面。')
    else if (settings !== JSON.stringify(draft.preferences)) notify('已暂停，可使用新的模型设置继续。')
  })
}

function requestRewrite(page) {
  if (!rewrite.trim()) return notify('请输入本页修改要求。', true)
  if (!draft.confirmed) return notify('请先确认已修改的大纲。', true)
  runAnna('Anna 重写第 ' + (draft.pages.indexOf(page) + 1) + ' 页', async (op) => {
    const before = JSON.stringify(page)
    const signature = draftSignature()
    const [result] = await complete(anna, 'rewrite', draft, [page], rewrite)
    if (op.stop || before !== JSON.stringify(page) || signature !== draftSignature() || page.id !== draft.current) {
      return notify('单页候选已过期，人工修改已保留。')
    }
    candidate = { id: page.id, before, signature, result }
  })
}

function requestReview() {
  runAnna('Anna 语义评审', async (op) => {
    const before = JSON.stringify([draftSignature(), draft.pages])
    const result = await complete(anna, 'review', draft, draft.pages)
    if (op.stop || before !== JSON.stringify([draftSignature(), draft.pages])) return notify('评审结果已过期，当前编辑已保留。')
    draft.review = result
    draft.acknowledged = false
  })
}

async function exportDeck() {
  if (exportBusy) return
  const issues = localReview(draft)
  if (issues.some(({ blocking }) => blocking)) return notify('请先修复结构问题。', true)
  if ((issues.length || draft.review.length) && !draft.acknowledged) return notify('请审阅并勾选检查提示。', true)
  const revision = exportVersion
  exportBusy = true
  render()
  try {
    const pptx = createPptx(window.PptxGenJS, draft)
    const blob = await pptx.write({ outputType: 'blob', compression: true })
    if (revision !== exportVersion || draft.step !== 5 || home) return
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    const { url, link } = fileLink(blob, deckFilename(draft.brief.topic), '下载 PPTX')
    downloadUrl = url
    link.id = 'export-link'
    find('export-output').replaceChildren(link)
    link.focus()
    notify('PPTX 已准备好。')
  } catch { notify('PPTX 生成失败，请重试。', true) }
  finally {
    exportBusy = false
    if (!find('export-link')) render()
    else {
      const action = find('workspace').querySelector('.page-bar .primary')
      action.disabled = false
      action.textContent = '重新准备 PPTX'
    }
  }
}

function backup(value) {
  const { url, link } = fileLink(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    '演示草稿.json', '下载 JSON 草稿')
  modal('草稿副本', el('div', {}, text('p', '文件将保存到浏览器下载位置。可通过首页「导入草稿文件」恢复。'), link))
  find('dialog').addEventListener('close', () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true })
}

find('home').addEventListener('click', () => {
  if (job) { notify('请等待或停止正在处理的任务。'); return }
  if (draft && !local) void changed({ immediate: true })
  home = true
  notify()
  render(true)
})
find('retry').addEventListener('click', () => { if (draft && !local) void saver.flush(draft) })
find('backup').addEventListener('click', () => { if (draft) backup(draft) })
find('import').addEventListener('change', async (event) => {
  const control = event.currentTarget
  const file = control.files[0]
  control.value = ''
  if (!file || job) return
  try {
    const value = readDraft(JSON.parse(await file.text()))
    if (draft && local && draft !== value) modal('打开文件草稿？', text('p', '当前窗口中的文件草稿会被替换。可先下载它的副本。'), () => begin(value, true))
    else begin(value, true)
  } catch (error) { notify(error.message, true) }
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden && draft && !local) void saver.flush(draft)
})

render()
try {
  if (window === window.parent) throw new Error('standalone')
  const { AnnaAppRuntime } = await import('/static/anna-apps/_sdk/latest/index.js')
  anna = await AnnaAppRuntime.connect()
  payload = anna.entryPayload ?? anna.entry_payload
  anna.on('entry_payload', usePayload)
  const backend = apsStore(anna.storage)
  try {
    stored = await backend.restore()
    saver = saving(backend, savingStatus)
  } catch (error) {
    storageError = error
    unreadable = error.raw
  }
  try {
    const result = await anna.llm.catalog({ serviceType: 'text' }, { timeoutMs: 5000 })
    catalog = (result?.models ?? []).filter(({ modelName }) => typeof modelName === 'string' && modelName)
  } catch {
    // 目录不可用时允许填写平台核对过的模型 ID
  }
} catch {
  anna = undefined
} finally {
  connected = true
  if (home) find('save').textContent = stored ? 'Anna 草稿可恢复' : anna && !storageError ? 'Anna 已连接' : '文件草稿 · 本机下载'
  render()
}
