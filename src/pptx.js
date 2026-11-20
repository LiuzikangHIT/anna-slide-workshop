import { scene } from './visual.js'

export function deckFilename(title) {
  let name = Array.from(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().replace(/[. ]+$/, '')).slice(0, 75).join('').replace(/[. ]+$/, '')
  if (!name) name = '演示文稿'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name + '.pptx'
}

export function createPptx(PptxGenJS, draft) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '演示工坊'
  pptx.title = draft.brief.topic
  draft.pages.forEach((page, index) => {
    const slide = pptx.addSlide()
    const { bg, blocks } = scene(page, draft.template, index, draft.pages.length)
    slide.background = { color: bg }
    for (const block of blocks) {
      const { x, y, w, h, color } = block
      if (block.type === 'text') {
        slide.addText(block.value, { x, y, w, h, color, align: block.align, valign: 'mid',
          bold: block.bold, fontFace: block.font, fontSize: block.size, margin: 0, fit: 'shrink', wrap: true })
      } else if (block.type === 'rect') {
        slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color }, line: { transparency: 100 } })
      } else {
        slide.addChart(pptx.ChartType.bar, [{
          name: block.unit, labels: block.values.map(({ label }) => label), values: block.values.map(({ value }) => Number(value)),
        }], {
          x, y, w, h, barDir: 'bar', catAxisLabelFontFace: block.font, valAxisLabelFontFace: block.font,
          chartColors: [color], catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFormatCode: 'General',
          catAxisOrientation: 'maxMin', catAxisLabelPos: 'low',
          showValue: true, dataLabelPosition: 'outEnd', showLegend: false, valAxisMinVal: 0, valAxisTitle: block.unit,
          showValAxisTitle: true, valAxisTitleFontSize: 10,
        })
      }
    }
    slide.addNotes([page.notes])
  })
  return pptx
}
