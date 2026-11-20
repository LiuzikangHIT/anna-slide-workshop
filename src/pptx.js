export const number = (index) => String(index).padStart(2, '0')

export function deckFilename(title) {
  let name = Array.from(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().replace(/[. ]+$/, '')).slice(0, 75).join('')
  if (!name) name = '演示文稿'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name
  return name + '.pptx'
}

export function createPptx(PptxGenJS, deck, theme) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '演示工坊'
  pptx.title = deck.title
  const width = 13.3333
  const height = 7.5
  const shape = (slide, type, x, y, w, h, color) =>
    slide.addShape(pptx.ShapeType[type], { x, y, w, h, fill: { color }, line: { transparency: 100 } })
  const text = (slide, value, x, y, w, h, fontSize, color, extra = {}) =>
    slide.addText(value, { x, y, w, h, fontSize, color, margin: 0, valign: 'mid', fontFace: 'Microsoft YaHei', ...extra })

  const cover = pptx.addSlide()
  cover.background = { color: theme.dark }
  shape(cover, 'rect', 0.8, 1.04, 0.72, 0.08, theme.accent)
  shape(cover, 'ellipse', 10.9, 1.85, 1.45, 1.45, theme.accent)
  shape(cover, 'rect', 10.5, 3.55, 2.23, 0.09, theme.accent)
  shape(cover, 'rect', 10.8, 3.84, 1.63, 0.09, theme.accent)
  text(cover, deck.title, 0.8, 2.0, 9.1, 2.15, 38, 'FFFFFF', { bold: true, fit: 'shrink' })
  text(cover, deck.subtitle, 0.8, 4.4, 8.9, 1.0, 19, theme.accent, { fit: 'shrink' })
  text(cover, '01 / ' + number(deck.slides.length + 1), 0.8, 6.65, 2, 0.34, 11, 'FFFFFF')

  for (const [index, item] of deck.slides.entries()) {
    const slide = pptx.addSlide()
    slide.background = { color: theme.paper }
    shape(slide, 'rect', 0, 0, width, 0.1, theme.dark)
    text(slide, item.title, 0.8, 0.87, 11.7, 1.35, 28, theme.text, { bold: true, fit: 'shrink' })
    const cardWidth = item.points.length === 3 ? 3.73 : 5.7
    item.points.forEach((point, pointIndex) => {
      const x = 0.8 + pointIndex * (cardWidth + 0.27)
      shape(slide, 'rect', x, 2.55, cardWidth, 3.64, theme.card)
      shape(slide, 'rect', x, 2.55, cardWidth, 0.065, theme.accent)
      text(slide, number(pointIndex + 1), x + 0.23, 2.85, cardWidth - 0.46, 0.33, 12, theme.muted)
      text(slide, point.heading, x + 0.23, 3.30, cardWidth - 0.46, 0.75, 19, theme.text, { bold: true, fit: 'shrink' })
      text(slide, point.body, x + 0.23, 4.19, cardWidth - 0.46, 1.7, 14, theme.muted, { valign: 'top', fit: 'shrink' })
    })
    shape(slide, 'rect', 0.8, 6.57, 11.72, 0.015, theme.line)
    text(slide, deck.title, 0.8, height - 0.72, 9.6, 0.30, 10, theme.muted, { fit: 'shrink' })
    text(slide, number(index + 2) + ' / ' + number(deck.slides.length + 1), 10.9, height - 0.72, 1.62, 0.3, 10, theme.muted, { align: 'right' })
  }

  return pptx
}
