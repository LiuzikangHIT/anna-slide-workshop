import { cleanText, counts, example, generateDeck, limits, themes } from './deck.js'
import { createPptx, deckFilename, number } from './pptx.js'

const find = (id) => document.getElementById(id)
const form = find('brief-form')
const generate = find('generate')
const download = find('download')
const feedback = find('feedback')
const connection = find('connection')
const stage = find('stage')
const pages = find('pages')
const editor = find('editor')
const replacement = find('replace-dialog')
let deck = example
let current = 0
let anna
let pending = false
let exporting = false
let downloadUrl

function make(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function announce(message, isError = false) {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl)
    downloadUrl = undefined
  }
  feedback.dataset.error = String(isError)
  feedback.textContent = message
}

function renderSlide() {
  const theme = themes[find('theme').value]
  const canvas = make('article', current ? 'canvas' : 'canvas cover')
  for (const name of ['dark', 'paper', 'text', 'muted', 'accent', 'line', 'card']) {
    canvas.style.setProperty('--' + name, '#' + theme[name])
  }
  const item = current ? deck.slides[current - 1] : deck
  canvas.setAttribute('aria-label', '第 ' + (current + 1) + ' 页')
  canvas.append(make('h3', 'slide-title', item.title))
  const footer = make('footer', 'slide-foot')
  const count = number(deck.slides.length + 1)
  if (current === 0) {
    const art = make('div', 'cover-art')
    art.setAttribute('aria-hidden', 'true')
    art.append(make('i'), make('i'), make('i'))
    canvas.append(make('div', 'marker'), art, make('p', 'subtitle', deck.subtitle))
    footer.append(make('span', '', '01 / ' + count))
  } else {
    const points = make('div', 'points')
    item.points.forEach((point, index) => {
      const card = make('div', 'point')
      card.append(make('b', '', number(index + 1)), make('strong', '', point.heading), make('p', '', point.body))
      points.append(card)
    })
    canvas.append(points)
    footer.append(make('span', '', deck.title), make('span', '', number(current + 1) + ' / ' + count))
  }
  canvas.append(footer)
  stage.replaceChildren(canvas)
}

function updateDownload() {
  const valid = deck.title && deck.subtitle && deck.slides.every((slide) =>
    slide.title && slide.points.every((point) => point.heading && point.body))
  download.disabled = exporting || !valid
  download.title = valid ? '' : '请填写所有页标题和要点后再下载'
}

function renderEditor() {
  editor.hidden = deck === example
  if (editor.hidden) return
  const item = current ? deck.slides[current - 1] : deck
  const fields = make('div', 'editor-fields')
  const field = (label, model, key, multiline = false) => {
    const wrapper = make('label')
    const control = make(multiline ? 'textarea' : 'input')
    control.maxLength = limits[key]
    control.value = model[key]
    control.addEventListener('input', () => {
      model[key] = cleanText(control.value, limits[key])
      renderSlide()
      if (downloadUrl) announce('内容已修改，可重新下载 PPTX。')
      updateDownload()
    })
    control.required = true
    wrapper.append(make('span', '', label), control)
    return wrapper
  }
  fields.append(field('页标题', item, 'title'))
  if (current === 0) fields.append(field('副标题', deck, 'subtitle'))
  else item.points.forEach((point, i) => {
    const group = make('div', 'editor-group')
    group.append(field('要点 ' + (i + 1), point, 'heading'), field('说明 ' + (i + 1), point, 'body', true))
    fields.append(group)
  })
  editor.replaceChildren(make('h3', '', '编辑第 ' + (current + 1) + ' 页'), fields)
}

function selectSlide(index) {
  current = index
  Array.from(pages.children).forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  renderSlide()
  renderEditor()
}

function showDeck() {
  const total = deck.slides.length + 1
  find('deck-label').textContent = total + ' 页 · 16:9'
  find('example-callout').hidden = deck !== example
  pages.replaceChildren(...Array.from({ length: total }, (_, index) => {
    const button = make('button', 'page', number(index + 1))
    button.type = 'button'
    button.setAttribute('aria-label', '第 ' + (index + 1) + ' 页')
    button.addEventListener('click', () => selectSlide(index))
    return button
  }))
  updateDownload()
  selectSlide(0)
}

find('theme').addEventListener('change', () => {
  if (downloadUrl) announce('配色已修改，可重新下载 PPTX。')
  renderSlide()
})
find('use-example').addEventListener('click', () => {
  form.elements.topic.value = '新员工知识库培训'
  form.elements.audience.value = '刚加入团队的同事'
  form.elements.source.value = '知识库支持按关键词搜索。新同事先搜业务流程，找到文档负责人和更新时间。更新文档时写清适用范围、操作步骤与维护人。培训结束前请同事独立按一页文档完成一项任务。'
  form.elements.count.value = '5'
  form.elements.purpose.value = 'Practical training'
  form.elements.topic.focus()
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!anna || pending || replacement.open) return
  const input = Object.fromEntries(new FormData(form))
  input.count = Number(input.count)
  if (!input.topic.trim()) {
    announce('请输入演示主题。', true)
    return
  }
  if (!counts.includes(input.count)) return
  if (deck !== example) {
    // 使用页面内对话框，避免 Anna iframe 对浏览器确认框的限制
    replacement.returnValue = ''
    const decision = new Promise((resolve) => replacement.addEventListener('close', resolve, { once: true }))
    replacement.showModal()
    await decision
    if (replacement.returnValue !== 'replace') return
  }

  pending = true
  generate.disabled = true
  generate.textContent = 'Anna AI 正在起草…'
  announce('正在组织演示结构与逐页要点。')
  try {
    const result = await generateDeck(anna, input)
    deck = result.deck
    showDeck()
    const usage = Number.isFinite(result.cu) ? ' · 本次 ' + result.cu + ' CU' : ''
    announce('已生成 ' + input.count + ' 页' + usage + '。可逐页编辑并下载。')
  } catch (error) {
    const quota = error.code === 'quota_exceeded' || error.code === 429 || error.data?.requiredCu
    announce(quota ? 'Anna 额度不足，请检查余额或尝试生成 5 页。' :
      '生成失败。' + (error.message?.startsWith('生成') || error.message?.startsWith('模型')
        ? error.message : '请检查 Anna 连接后重试。'), true)
  } finally {
    pending = false
    generate.disabled = false
    generate.textContent = '用 Anna AI 生成'
  }
})

download.addEventListener('click', async () => {
  exporting = true
  updateDownload()
  try {
    // 先生成文件，再显示可直接点击的下载链接，保留浏览器用户手势
    const filename = deckFilename(deck.title)
    const blob = await createPptx(window.PptxGenJS, deck, themes[find('theme').value])
      .write({ outputType: 'blob', compression: true })
    announce('PPTX 已生成。')
    downloadUrl = URL.createObjectURL(blob)
    const link = make('a', '', '点击保存 ' + filename)
    link.href = downloadUrl
    link.download = filename
    feedback.append(' ', link)
    link.focus()
  } catch {
    announce('PPTX 生成失败，请重试。', true)
  } finally {
    exporting = false
    updateDownload()
  }
})

showDeck()
generate.disabled = true
try {
  const { AnnaAppRuntime } = await import('/static/anna-apps/_sdk/latest/index.js')
  anna = await AnnaAppRuntime.connect()
  const applyBrief = (payload) => {
    for (const key of ['topic', 'audience']) {
      if (!form.elements[key].value) form.elements[key].value = cleanText(payload?.[key], limits[key])
    }
  }
  applyBrief(anna.entryPayload)
  anna.on('entry_payload', applyBrief)
  connection.textContent = '生成调用 Anna AI 并使用你的平台额度。'
  generate.disabled = false
} catch {
  connection.textContent = '从 Anna 工作台打开应用即可使用 AI 生成。'
}
