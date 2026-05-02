/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const, react-hooks/exhaustive-deps, @next/next/no-img-element */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { ZoomIn, ZoomOut, AlignLeft, AlignRight, AlignCenter } from 'lucide-react'

// Custom Google Docs Markup Extensions
const highlightExtension = {
  name: 'highlight',
  level: 'inline' as const,
  start(src: string) { return src.match(/==/)?.index; },
  tokenizer(this: any, src: string, tokens: any) {
    const match = /^==([^=]+)==/.exec(src);
    if (match) {
      return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    }
  }
}

const underlineExtension = {
  name: 'underline',
  level: 'inline' as const,
  start(src: string) { return src.match(/\+\+/)?.index; },
  tokenizer(this: any, src: string, tokens: any) {
    const match = /^\+\+([^+]+)\+\+/.exec(src);
    if (match) {
      return { type: 'underline', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
    }
  }
}

marked.use({ extensions: [highlightExtension, underlineExtension] })

// Same Interactive Image component from before!
function InteractiveImage({ 
  src, alt, style, className, currentWidth, initialY, onAction,
  isSelected, onSelectionToggle, children
}: { 
  src: string, alt: string, style: any, className?: string, currentWidth: number, initialY: number,
  onAction?: (url: string, action: any) => void,
  isSelected?: boolean,
  onSelectionToggle?: (url: string) => void,
  children?: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0 })

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    setDragOffset({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    
    if (Math.abs(dragOffset.y) > 5 || Math.abs(dragOffset.x) > 20) {
      if (onAction) onAction(src, { type: 'drag', alt: alt, dragDeltaY: dragOffset.y, dragDeltaX: dragOffset.x, initialAbsY: initialY })
    }
    setDragOffset({ x: 0, y: 0 })
  }

  return (
    <div 
      style={{ ...style, transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, zIndex: isDragging ? 500 : style.zIndex, cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={onAction ? handlePointerDown : undefined}
      onPointerMove={onAction ? handlePointerMove : undefined}
      onPointerUp={onAction ? handlePointerUp : undefined}
      className={`relative ${className || ''}`}
    >
      {children ? children : (
        <img src={src} alt={alt} style={{ width: '100%', height: '100%', borderRadius: '8px', boxShadow: isDragging ? '0 10px 15px -3px rgb(0 0 0 / 0.3)' : '0 4px 6px -1px rgb(0 0 0 / 0.1)', transition: isDragging ? 'none' : 'box-shadow 0.2s', objectFit: style.objectFit || 'contain' }} draggable={false} />
      )}
      
      {/* Overlay Toolbar container catches events so they don't trigger dragging */}
      {hover && onAction && !isDragging && (
         <div 
           onPointerDown={(e) => e.stopPropagation()}
           className="absolute top-2 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 shadow-2xl rounded-lg p-1.5 flex items-center gap-1 z-[100] text-gray-300"
         >
            <button title="Decrease Width" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(src, { type: 'width', alt: alt, value: Math.max(100, currentWidth - 50) })}} className="p-1.5 hover:bg-gray-700 hover:text-white rounded transition-colors"><ZoomOut size={14}/></button>
            <button title="Increase Width" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(src, { type: 'width', alt: alt, value: currentWidth + 50 })}} className="p-1.5 hover:bg-gray-700 hover:text-white rounded transition-colors"><ZoomIn size={14}/></button>
            <div className="w-px h-5 bg-gray-700 mx-1"></div>
            <button title="Float Left" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(src, { type: 'align', alt: alt, value: 'left' })}} className="p-1.5 hover:bg-gray-700 hover:text-white rounded transition-colors"><AlignLeft size={14}/></button>
            <button title="Center" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(src, { type: 'align', alt: alt, value: 'center' })}} className="p-1.5 hover:bg-gray-700 hover:text-white rounded transition-colors"><AlignCenter size={14}/></button>
            <button title="Float Right" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(src, { type: 'align', alt: alt, value: 'right' })}} className="p-1.5 hover:bg-gray-700 hover:text-white rounded transition-colors"><AlignRight size={14}/></button>
            
            {onSelectionToggle && (
               <>
                 <div className="w-px h-5 bg-gray-700 mx-1"></div>
                 <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelectionToggle(src); }} className={`p-1.5 rounded transition-colors text-xs font-bold flex items-center gap-1 ${isSelected ? 'bg-orange-500 text-white hover:bg-orange-600' : 'hover:bg-gray-700 hover:text-white'}`}>
                   <input type="checkbox" checked={isSelected||false} readOnly className="w-3 h-3 rounded-sm text-orange-500 pointer-events-none" />
                   Select
                 </button>
               </>
            )}
         </div>
      )}
    </div>
  )
}


export default function PretextRenderer({ 
    markdown, 
    maxWidth = 800,
    font = '"Times New Roman", Times, Georgia, serif',
    onImageAction,
    selectedImages = [],
    onSelectionToggle
}: { 
    markdown: string, 
    maxWidth?: number,
    font?: string,
    onImageAction?: (url: string, action: any) => void,
    selectedImages?: string[],
    onSelectionToggle?: (url: string) => void
}) {
  const containerWidth = maxWidth
  const [imageDims, setImageDims] = useState<Record<string, { width: number, height: number }>>({})

  useEffect(() => {
    const tokens = marked.lexer(markdown)
    const images: any[] = []
    tokens.forEach((t: any) => {
      if (t.type === 'paragraph' && t.tokens) images.push(...t.tokens.filter((tt: any) => tt.type === 'image'))
    })
    
    images.forEach(img => {
      if (!imageDims[img.href]) {
        const i = new Image()
        i.onload = () => setImageDims(prev => ({ ...prev, [img.href]: { width: i.naturalWidth, height: i.naturalHeight } }))
        i.src = img.href
      }
    })
  }, [markdown])

  const tokens = marked.lexer(markdown)
  
  // PASS 1: Generate Skeletons and Overlays for ABSOLUTE images
  const absImagesObjects: any[] = []
  
  tokens.forEach((t: any) => {
     if (t.type === 'paragraph') {
        const rawText = t.text || ''
        
        // INTERCEPT ABSOLUTE GALLERY MACRO
        if (rawText.startsWith('[gallery')) {
           const struct = rawText.match(/\[gallery(.*?)\]/)
           if (struct) {
              const alt = struct[1]
              const absYMatch = alt.match(/y[:=-]?(\d+)/i)
              if (absYMatch) {
                 const yCoord = parseInt(absYMatch[1])
                 const isRight = alt.includes('right')
                 const isLeft = alt.includes('left')
                 const floatType = isRight ? 'right' : isLeft ? 'left' : 'center'
                 
                 const widthMatch = alt.match(/[wW][:=-]?(\d+)/)
                 const customWidth = widthMatch ? parseInt(widthMatch[1]) : null
                 const maxImgWidth = customWidth ? customWidth : (isRight || isLeft ? containerWidth * 0.45 : containerWidth)
                 
                 const inlineImages = (t.tokens || []).filter((tt:any) => tt.type === 'image')
                 let columns = 1
                 if (inlineImages.length === 2) columns = 2
                 if (inlineImages.length === 3) columns = 3
                 if (inlineImages.length >= 4) columns = 2
                 
                 const rows = Math.ceil(inlineImages.length / columns)
                 const gapPx = 16
                 const gridItemSize = (maxImgWidth - (gapPx * (columns - 1))) / columns
                 const totalHeight = (gridItemSize * rows) + (gapPx * (rows - 1))
                 
                 absImagesObjects.push({
                    y: yCoord,
                    width: maxImgWidth + 24, // Collision padding
                    height: totalHeight + (floatType === 'center' ? 36 : 12),
                    float: floatType,
                    url: 'GALLERY',
                    alt: struct[0],
                    rawWidth: maxImgWidth, 
                    rawHeight: totalHeight, 
                    token: t,
                    isGalleryObj: true
                 })
                 return // Skip individual image handling
              }
           }
        }
        
        // STANDARD SINGLE IMAGE FALLBACK
        if (t.tokens) {
           t.tokens.filter((tt: any) => tt.type === 'image').forEach((img: any) => {
              const alt = img.text || ''
              const url = img.href
              const absYMatch = alt.match(/y[:=-]?(\d+)/i)
              if (absYMatch && imageDims[url]) {
                 const yCoord = parseInt(absYMatch[1])
                 const isRight = alt.includes('float-right') || alt.includes('float=right')
                 const isLeft = alt.includes('float-left') || alt.includes('float=left')
                 const floatType = isRight ? 'right' : isLeft ? 'left' : 'center'
                 
                 const widthMatch = alt.match(/[wW][:=-]?(\d+)/)
                 const customWidth = widthMatch ? parseInt(widthMatch[1]) : null
                 
                 const defaultWidth = containerWidth * 0.45
                 const maxImgWidth = customWidth ? customWidth : Math.min(imageDims[url].width, defaultWidth)
                 const scaleRatio = maxImgWidth / imageDims[url].width
                 const imgHeight = imageDims[url].height * scaleRatio
                 
                 absImagesObjects.push({
                    y: yCoord,
                    width: maxImgWidth + 24, // Wrap margin padding
                    height: imgHeight + (floatType === 'center' ? 36 : 12),
                    float: floatType,
                    url, alt, rawWidth: maxImgWidth, rawHeight: imgHeight, token: img
                 })
              }
           })
        }
      }
   })
  // 2. Resolve Horizontal Collisions Dynamically (The Coral Gallery Math)
  const pass2Images = [...absImagesObjects]
  pass2Images.forEach(imgA => {
     if (imgA.float === 'left') {
        pass2Images.forEach(imgB => {
           if (imgB.float === 'right') {
              // Check if they occupy the same Y-axis territory
              if (imgA.y < imgB.y + imgB.height && imgB.y < imgA.y + imgA.height) {
                 if (imgA.width + imgB.width > containerWidth) {
                    const scaleFactor = (containerWidth - 16) / (imgA.width + imgB.width)
                    imgA.width *= scaleFactor; imgA.height *= scaleFactor; 
                    imgA.rawWidth *= scaleFactor; imgA.rawHeight *= scaleFactor;
                    imgB.width *= scaleFactor; imgB.height *= scaleFactor; 
                    imgB.rawWidth *= scaleFactor; imgB.rawHeight *= scaleFactor;
                 }
              }
           }
        })
     }
  })

  // 3. Unified Geometric Float Rendering
  let leftY = 0, rightY = 0, centerY = 0
  
  const renderGalleryChildren = (f: any) => {
     if (!f.isGalleryObj) return undefined
     const inlineImages = (f.token.tokens || []).filter((tt:any) => tt.type === 'image')
     let columns = 1
     if (inlineImages.length === 2) columns = 2
     if (inlineImages.length === 3) columns = 3
     if (inlineImages.length >= 4) columns = 2
     return (
        <div className={`grid grid-cols-${columns} gap-4 w-full h-full p-2 bg-gray-50 rounded-lg shadow-inner overflow-hidden border border-gray-200 pt-7`}>
           <div className="absolute top-1 left-2 text-[10px] uppercase font-bold text-gray-400 bg-white px-2 rounded shadow-sm">Gallery Module</div>
           <InlineLayer tokens={inlineImages} isGallery={true} />
        </div>
     )
  }
  
  const unifiedSkeletons = pass2Images.sort((a,b) => a.y - b.y).map((f, i) => {
     const galleryKids = renderGalleryChildren(f)
     if (f.float === 'left') {
        const gap = Math.max(0, f.y - leftY)
        leftY = f.y + f.height
        return (
          <React.Fragment key={`skel-${i}`}>
            {gap > 0 && <div style={{ float: 'left', clear: 'left', width: 0, height: gap }} />}
            <div style={{ float: 'left', clear: 'left', width: f.width, height: f.height, position: 'relative' }}>
              <InteractiveImage src={f.url} alt={f.alt} currentWidth={f.rawWidth} initialY={f.y} onAction={onImageAction} isSelected={selectedImages.includes(f.url)} onSelectionToggle={onSelectionToggle} style={{ width: f.rawWidth, height: f.rawHeight, position: 'absolute', top: 4, left: 0 }}>
                 {galleryKids}
              </InteractiveImage>
            </div>
          </React.Fragment>
        )
     } else if (f.float === 'right') {
        const gap = Math.max(0, f.y - rightY)
        rightY = f.y + f.height
        return (
          <React.Fragment key={`skel-${i}`}>
            {gap > 0 && <div style={{ float: 'right', clear: 'right', width: 0, height: gap }} />}
            <div style={{ float: 'right', clear: 'right', width: f.width, height: f.height, position: 'relative' }}>
              <InteractiveImage src={f.url} alt={f.alt} currentWidth={f.rawWidth} initialY={f.y} onAction={onImageAction} isSelected={selectedImages.includes(f.url)} onSelectionToggle={onSelectionToggle} style={{ width: f.rawWidth, height: f.rawHeight, position: 'absolute', top: 4, right: 0 }}>
                 {galleryKids}
              </InteractiveImage>
            </div>
          </React.Fragment>
        )
     } else {
        const gap = Math.max(0, f.y - centerY)
        centerY = f.y + f.height
        return (
          <React.Fragment key={`skel-${i}`}>
            {gap > 0 && <div style={{ float: 'left', clear: 'both', width: 0, height: gap }} />}
            <div style={{ float: 'left', clear: 'both', width: '100%', height: f.height, position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <InteractiveImage src={f.url} alt={f.alt} currentWidth={f.rawWidth} initialY={f.y} onAction={onImageAction} isSelected={selectedImages.includes(f.url)} onSelectionToggle={onSelectionToggle} style={{ width: f.rawWidth, height: f.rawHeight, position: 'absolute', top: 12 }}>
                 {galleryKids}
              </InteractiveImage>
            </div>
          </React.Fragment>
        )
     }
  })

  // 4. Recursive Internal Markdown Parser Mapper
  function InlineLayer({ tokens, isGallery }: { tokens: any[], isGallery?: boolean }): any {
    return tokens.map((t, i) => {
       if (t.type === 'text') {
          const chunks = t.text.split(/(\$[^$]+\$)/g)
          return <React.Fragment key={i}>
             {chunks.map((chk: string, c: number) => {
                if (chk.startsWith('$') && chk.endsWith('$')) {
                   try { return <span key={c} dangerouslySetInnerHTML={{ __html: katex.renderToString(chk.slice(1, -1), { throwOnError: false }) }} /> } catch(e){ return chk }
                }
                return chk
             })}
          </React.Fragment>
       }
       if (t.type === 'highlight') return <mark key={i} className="bg-yellow-200 px-1 rounded shadow-sm text-gray-900"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></mark>
       if (t.type === 'underline') return <u key={i} className="underline decoration-1 underline-offset-2"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></u>
       if (t.type === 'strong') return <strong key={i} className="font-bold text-gray-900"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></strong>
       if (t.type === 'em') return <em key={i} className="italic"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></em>
       if (t.type === 'del') return <del key={i} className="line-through text-gray-500"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></del>
       if (t.type === 'codespan') return <code key={i} className="bg-gray-100 rounded px-1.5 py-0.5 font-mono text-sm">{t.text}</code>
       if (t.type === 'link') return <a key={i} href={t.href} className="text-blue-600 hover:underline"><InlineLayer tokens={t.tokens||[]} isGallery={isGallery} /></a>
       if (t.type === 'html') return <span key={i} dangerouslySetInnerHTML={{ __html: t.text }} />
       if (t.type === 'image') {
          const alt = t.text || ''
          if (alt.match(/y[:=-]?(\d+)/i)) return null // Rendered Absolutely Outside!
          
          const url = t.href
          if (!imageDims[url]) return <span key={i} className="text-gray-400 text-xs italic border border-gray-200 p-2 rounded block">Measuring layout block...</span>
          
          const isRight = alt.includes('float-right') || alt.includes('float=right')
          const isLeft = alt.includes('float-left') || alt.includes('float=left')
          
          const widthMatch = alt.match(/[wW][:=-]?(\d+)/)
          const customWidth = widthMatch ? parseInt(widthMatch[1]) : null
          const defaultWidth = (isRight || isLeft) ? (containerWidth * 0.45) : containerWidth
          const maxImgWidth = customWidth ? customWidth : Math.min(imageDims[url].width, defaultWidth)
          const scaleRatio = maxImgWidth / imageDims[url].width
          const imgHeight = imageDims[url].height * scaleRatio
          
          const mtMatch = alt.match(/mt[:=-]?(-?\d+)/i)
          const customMt = mtMatch ? parseInt(mtMatch[1]) : 0
          
          return (
             <div key={i} className={isGallery ? 'aspect-square relative rounded-lg overflow-hidden shadow-sm' : ''} style={{
                 width: isGallery ? '100%' : maxImgWidth, height: isGallery ? '100%' : imgHeight, 
                 float: isGallery ? 'none' : isRight ? 'right' : isLeft ? 'left' : 'none',
                 marginTop: customMt > 0 ? customMt : 0, 
                 marginBottom: customMt < 0 ? Math.abs(customMt) : (isGallery ? 0 : 10),
                 marginRight: isGallery ? 0 : (isLeft ? 16 : 0),
                 marginLeft: isGallery ? 0 : (isRight ? 16 : 0),
                 display: isGallery ? 'block' : (!isLeft && !isRight) ? 'flex' : 'block',
                 justifyContent: 'center',
                 clear: isGallery ? 'none' : (!isLeft && !isRight) ? 'both' : 'none'
             }}>
               <InteractiveImage 
                 src={url} alt={alt} currentWidth={maxImgWidth} initialY={0} onAction={(u, a) => onImageAction && onImageAction(u, { ...a, inGallery: isGallery })} isSelected={selectedImages.includes(url)} onSelectionToggle={onSelectionToggle} style={{ width: '100%', height: '100%', objectFit: isGallery ? 'cover' : 'contain' }}
               />
             </div>
          )
       }
       if (t.type === 'escape') return <React.Fragment key={i}>{t.text}</React.Fragment>
       return <React.Fragment key={i}>{t.raw}</React.Fragment>
    })
  }

  return (
    <div className="relative isolate text-gray-800 break-words leading-relaxed mx-auto" style={{ width: containerWidth, fontFamily: font }}>
       
       <div className="relative z-10 w-full text-justify pointer-events-auto">
         {/* Phantom Margin Skeletons MUST BE IN THE SAME FLOW STREAM AS THE TEXT! */}
         {unifiedSkeletons}

         {tokens.map((token: any, i: number) => {
            if (token.type === 'heading') {
               const depths = {
                 1: 'text-4xl font-bold mb-8 mt-6',
                 2: 'text-3xl font-bold mb-6 mt-5',
                 3: 'text-2xl font-bold mb-4 mt-4',
                 4: 'text-xl font-bold mb-3 mt-3'
               }
               const c = depths[token.depth as keyof typeof depths] || depths[4]
               let Tag = `h${token.depth}` as any
               
               let rawText = token.text || ''
               let align: any = 'left'
               if (rawText.startsWith('[center]')) { align = 'center'; rawText = rawText.substring(8).trim() }
               else if (rawText.startsWith('[right]')) { align = 'right'; rawText = rawText.substring(7).trim() }
               
               const headingToken = marked.lexer(rawText)[0] as any
               const modToken = { ...token, tokens: headingToken?.tokens || [] }
               return <Tag key={`h-${i}`} className={c} style={{ textAlign: align }}>{<InlineLayer tokens={modToken.tokens} />}</Tag>
            }
            
            if (token.type === 'paragraph') {
               let rawText = token.text || ''
               
               if (rawText.startsWith('[gallery')) {
                  const struct = rawText.match(/\[gallery(.*?)\]/)
                  if (struct && struct[1].match(/y[:=-]?(\d+)/i)) {
                     return null // Skip inline rendering completely. UnifiedSkeletons handles this payload absolutely globally!!
                  }
               }
               
               let align: any = 'left'
               let isGallery = false
               
               if (rawText.startsWith('[gallery')) { 
                  isGallery = true; 
                  rawText = rawText.replace(/\[gallery(.*?)\]/, '').trim() 
               }
               
               if (rawText.startsWith('[center]')) { align = 'center'; rawText = rawText.substring(8).trim() }
               else if (rawText.startsWith('[right]')) { align = 'right'; rawText = rawText.substring(7).trim() }
               else if (rawText.startsWith('[justify]')) { align = 'justify'; rawText = rawText.substring(9).trim() }
               
               let dropCap = null
               if (rawText.startsWith('[dropcap]')) {
                  rawText = rawText.substring(9).trim()
                  const firstChar = rawText.charAt(0)
                  rawText = rawText.substring(1).trim()
                  dropCap = <span style={{ float: 'left', fontSize: '380%', lineHeight: 0.8, marginRight: '8px', marginTop: '6px', fontWeight: 'bold', color: '#111827' }}>{firstChar}</span>
               }
               
               const paragraphLexerTokens = marked.lexer(rawText)[0] as any
               
               if (isGallery) {
                  const inlineImages = (paragraphLexerTokens?.tokens || []).filter((t:any) => t.type === 'image')
                  // Auto bunch photos: 3 in a row, or a 2x2 multi-grid!
                  let gridClass = 'grid-cols-1'
                  if (inlineImages.length === 2) gridClass = 'grid-cols-2'
                  if (inlineImages.length === 3) gridClass = 'grid-cols-3'
                  if (inlineImages.length >= 4) gridClass = 'grid-cols-2' // Creates a square grid!

                  return (
                    <div key={`p-${i}`} className={`mb-6 grid ${gridClass} gap-4`}>
                      <InlineLayer tokens={paragraphLexerTokens?.tokens || []} isGallery={true} />
                    </div>
                  )
               }

               return (
                 <div key={`p-${i}`} className="mb-6 text-[17px] leading-[1.8]" style={{ textAlign: align, textJustify: align === 'justify' ? 'inter-word' : undefined }}>
                   {dropCap}
                   <InlineLayer tokens={paragraphLexerTokens?.tokens || []} />
                 </div>
               )
            }
            
            if (token.type === 'list') {
               const Tag = token.ordered ? 'ol' : 'ul'
               return <Tag key={`l-${i}`} className={`mb-6 pl-8 ${token.ordered ? 'list-decimal' : 'list-disc'} space-y-2`}>
                 {token.items.map((item: any, j: number) => (
                    <li key={j}><InlineLayer tokens={item.tokens || []} /></li>
                 ))}
               </Tag>
            }
            
            if (token.type === 'blockquote') {
               return <blockquote key={`bq-${i}`} className="border-l-4 border-indigo-500 pl-4 py-1 pb-0 mb-6 bg-gray-50 italic text-gray-700 rounded-r">
                 {/* Blockquotes can contain paragraphs inner! */}
                 <InlineLayer tokens={token.tokens || []} />
               </blockquote>
            }
            
            return null
         })}
         <div style={{ clear: 'both' }}></div>
       </div>
       
    </div>
  )
}
