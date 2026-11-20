export const templates = {
  briefing: { name: '经营简报', description: '指标突出，证据放在独立色块', paper: 'F1F6F7', ink: '112E38', muted: '415D66', accent: '17776F', pale: 'DAEDE8', dark: '0B3038', bright: '72DBB7', font: 'Microsoft YaHei', cover: 'split', composition: 'cards', heading: 29 },
  editorial: { name: '编辑提案', description: '主张左对齐，证据沿竖线展开', paper: 'FCF4E8', ink: '302332', muted: '584656', accent: 'A73546', pale: 'F0DEDB', dark: '49273A', bright: 'F7AE9E', font: 'DengXian', cover: 'folio', composition: 'column', heading: 34 },
  classroom: { name: '课堂讲义', description: '编号步骤、练习提示与宽行距', paper: 'F1F4FF', ink: '1C2A50', muted: '46557B', accent: '414AA5', pale: 'E1E6FF', dark: '252D63', bright: 'B9C5FF', font: 'Microsoft YaHei', cover: 'banner', composition: 'list', heading: 28 },
  minimal: { name: '极简叙事', description: '居中观点、宽留白与细线', paper: 'FAF9F5', ink: '252921', muted: '4D5746', accent: '435E3F', pale: 'E8EEE3', dark: '283524', bright: 'D6E6BD', font: 'DengXian', cover: 'center', composition: 'open', heading: 35 },
}
export const recommended = {
  report: ['briefing', 'minimal'], proposal: ['editorial', 'briefing'], training: ['classroom', 'minimal'],
}
export const width = 13.333333
export const height = 7.5
export const number = (index) => String(index).padStart(2, '0')

export function validChart(page) {
  return Boolean(page.unit.trim() && page.visualSource.trim() && page.visual.length && page.visual.every(({ label, value }) =>
    label.trim() && value !== undefined && String(value).trim() && Number.isFinite(Number(value)) && Number(value) >= 0))
}

// 预览与 PPTX 使用同一组坐标、字号和内容
export function scene(page, template, index, total) {
  const t = templates[template] ?? templates.briefing
  const blocks = []
  const rect = (x, y, w, h, color) => blocks.push({ type: 'rect', x, y, w, h, color })
  const copy = (value, x, y, w, h, size, options = {}) => blocks.push({
    type: 'text', value, x, y, w, h, size, font: t.font, color: t.ink, align: 'left', ...options,
  })
  const cover = page.layout === 'cover'
  const action = page.layout === 'action'
  const align = page.align === 'center' ? 'center' : 'left'
  const dense = page.density === 'compact'
  const bodySize = dense ? 19 : 23
  const title = { bold: true, field: '页标题', align }
  const body = { field: '投影正文', align }
  const bg = cover ? t.dark : t.paper

  if (cover) {
    const centered = t.cover === 'center' || t.cover === 'banner'
    const x = t.cover === 'folio' ? 2.1 : .9
    const w = centered ? 11.5 : t.cover === 'folio' ? 9.8 : 8.4
    if (t.cover === 'split') {
      rect(10.15, 0, 3.18, height, t.accent)
      rect(10.75, 4.6, 2.58, .15, t.bright)
      rect(11.65, 5.05, 1.68, .15, t.bright)
    } else if (t.cover === 'folio') {
      rect(1.3, .85, .07, 5.8, t.bright)
    } else {
      rect(centered ? 5.8 : .9, t.cover === 'banner' ? 1.0 : 4.1, 1.7, .09, t.bright)
    }
    const coverAlign = centered && page.align === 'template' ? 'center' : align
    copy(page.title, x, 1.65, w, 2.3, t.cover === 'folio' ? 45 : 40, { ...title, color: 'FFFFFF', align: coverAlign })
    copy(page.body, x, 4.55, w, 1.6, bodySize, { ...body, color: t.bright, align: coverAlign })
  } else {
    const left = t.composition === 'column' ? 1.3 : .88
    const span = 13.33 - left - .88
    const titleAlign = t.composition === 'open' && page.align === 'template' ? 'center' : align
    rect(left, .50, t.composition === 'cards' ? 1.55 : t.composition === 'open' ? span : .62, .045, t.accent)
    copy(page.title, left, .74, span, 1.35, t.heading, { ...title, align: titleAlign })
    if (action || page.layout === 'evidence') {
      if (t.composition === 'cards' || action) rect(left, 2.28, span, 4.05, t.pale)
      if (t.composition === 'column') rect(left, 2.28, .075, 3.9, t.accent)
      if (t.composition === 'list') rect(left, 2.32, span, .08, t.accent)
      const inset = t.composition === 'open' ? 1.24 : .35
      copy(page.body, left + inset, 2.59, span - 2 * inset, 3.53, bodySize, { ...body, align: titleAlign })
    } else {
      copy(page.body, left, 2.07, span, 1.13, dense ? 16 : 19, body)
      if (page.layout === 'chart' && validChart(page)) {
        blocks.push({ type: 'chart', x: left, y: 3.27, w: span, h: 2.66, values: page.visual, unit: page.unit, color: t.accent, font: t.font })
        copy(page.visualSource, left, 6.02, span, .53, 12, { field: '图表来源', color: t.muted })
      } else if (page.layout === 'compare' || page.layout === 'steps') {
        const steps = page.layout === 'steps'
        const gap = .18
        const col = (span - (page.visual.length - 1) * gap) / Math.max(1, page.visual.length)
        page.visual.forEach(({ label, detail }, i) => {
          const x = left + (col + gap) * i
          rect(x, 3.44, col, 2.77, t.pale)
          rect(x, 3.44, col, .06, t.accent)
          if (steps) copy(number(i + 1), x + .16, 3.66, col - .32, .35, 13, { color: t.accent })
          copy(label, x + .16, steps ? 4.08 : 3.82, col - .32, .7, dense ? 15 : 19, { bold: true, field: '图示标签' })
          copy(detail ?? '', x + .16, 4.86, col - .32, 1.2, dense ? 13 : 16, { field: '图示说明' })
        })
      } else {
        rect(left, 3.45, span, 2.45, t.pale)
      }
    }
  }
  copy(number(index + 1) + ' / ' + number(total), .88, 6.83, 11.57, .32, 10, { align: 'right', color: cover ? t.bright : t.muted })
  return { bg, blocks }
}

export function fits(block) {
  const columns = Math.floor(block.w * 72 / block.size)
  const rows = Math.floor(block.h * 72 / (block.size * 1.24))
  const lineCount = block.value.split(/\r?\n/).reduce((sum, line) => {
    const word = (value) => Array.from(value).reduce((total, char) => total + (char.codePointAt(0) > 255 ? 1.03 : 'ilI., '.includes(char) ? .34 : .6), 0)
    return sum + Math.max(1, Math.ceil(word(line) / Math.max(1, columns)))
  }, 0)
  return lineCount <= rows
}
