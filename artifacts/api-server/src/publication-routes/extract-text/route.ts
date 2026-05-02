import { NextResponse } from 'next/server'
import { importPublicationDocument } from '@/lib/publication-import-export'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const importResult = await importPublicationDocument({
      fileName: file.name,
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    })

    const text = importResult.ir.sections.map((section) => section.text).join('\n\n').trim() || importResult.document.body

    return NextResponse.json({
      text,
      markdown: importResult.markdown,
      ir: importResult.ir,
      warnings: importResult.warnings,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error extracting text:', error)
    return NextResponse.json(
      { error: 'Error processing file: ' + message },
      { status: 500 }
    )
  }
}
