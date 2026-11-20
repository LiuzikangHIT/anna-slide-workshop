import { copyFile, cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const path = (relative) => fileURLToPath(new URL('../' + relative, import.meta.url))
await mkdir(path('bundle'), { recursive: true })
await cp(path('src'), path('bundle'), { recursive: true })
await copyFile(path('node_modules/pptxgenjs/dist/pptxgen.bundle.js'), path('bundle/pptxgen.bundle.js'))
await copyFile(path('node_modules/pptxgenjs/LICENSE'), path('bundle/PptxGenJS-LICENSE.txt'))
