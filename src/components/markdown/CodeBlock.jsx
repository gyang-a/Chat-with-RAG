// application module
// File: C:\Users\yango\Desktop\Chat\src\components\markdown\CodeBlock.jsx
import { Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import { useUIStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'

SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('c', c)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('yaml', yaml)

const LANGUAGE_ALIAS = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  md: 'markdown',
  py: 'python',
  cxx: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
}

const STREAM_HIGHLIGHT_DELAY = 700
const STREAM_HIGHLIGHT_MAX_CHARS = 60000

function flattenNodeText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map((item) => flattenNodeText(item)).join('')
  if (isValidElement(node)) return flattenNodeText(node.props?.children)
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return node.text
    if (typeof node.value === 'string') return node.value
    if (node.props?.children) return flattenNodeText(node.props.children)
    return ''
  }
  return ''
}

export function CodeBlock({ inline, className, children = '', streaming = false }) {
  const darkMode = useUIStore((s) => s.darkMode)
  const [copied, setCopied] = useState(false)
  const [streamHighlightedText, setStreamHighlightedText] = useState('')
  const latestTextRef = useRef('')
  const highlightTimerRef = useRef(null)
  const pendingSnapshotRef = useRef('')

  const language = useMemo(() => {
    // 兼容 js、tsx、c++、objective-c 等语言标识
    const match = /language-([^\s]+)/.exec(className || '')
    const rawLanguage = (match?.[1] || 'text').toLowerCase()
    return LANGUAGE_ALIAS[rawLanguage] || rawLanguage
  }, [className])

  const text = flattenNodeText(Children.toArray(children)).replace(/\n$/, '')

  // 部分版本的 react-markdown 不稳定传递 inline，这里做兜底识别
  const isBlockCode = inline === false || /language-/.test(className || '') || text.includes('\n')

  useEffect(() => {
    latestTextRef.current = text
  }, [text])

  useEffect(() => {
    if (!streaming) {
      if (highlightTimerRef.current) {
        clearInterval(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      return undefined
    }

    if (highlightTimerRef.current) return undefined

    pendingSnapshotRef.current = text.length > STREAM_HIGHLIGHT_MAX_CHARS ? '' : text
    highlightTimerRef.current = setInterval(() => {
      setStreamHighlightedText(pendingSnapshotRef.current)
      pendingSnapshotRef.current =
        latestTextRef.current.length > STREAM_HIGHLIGHT_MAX_CHARS ? '' : latestTextRef.current
    }, STREAM_HIGHLIGHT_DELAY)

    return () => {
      if (!streaming && highlightTimerRef.current) {
        clearInterval(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [streaming, text])

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      clearInterval(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
  }, [])

  if (!isBlockCode) {
    return <code className='rounded bg-muted px-1.5 py-0.5 text-[13px]'>{text}</code>
  }

  const streamHighlightBoundary =
    streamHighlightedText === text ? streamHighlightedText.length : streamHighlightedText.lastIndexOf('\n') + 1
  const streamHighlightCandidate = streamHighlightedText.slice(0, streamHighlightBoundary)
  const highlightedPrefix =
    streaming && streamHighlightCandidate && text.startsWith(streamHighlightCandidate) ? streamHighlightCandidate : ''
  const plainTail = streaming ? text.slice(highlightedPrefix.length) : ''

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    toast.success('代码已复制')
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className='group relative my-3 overflow-hidden rounded-xl border border-border'>
      <div className='flex items-center justify-between border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground'>
        <span>{language}</span>
        <Button size='sm' variant='ghost' className='h-7 gap-1 px-2' onClick={handleCopy}>
          {copied ? <Check className='h-3.5 w-3.5 text-green-500' /> : <Copy className='h-3.5 w-3.5' />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      {streaming ? (
        highlightedPrefix ? (
          <div className='overflow-x-auto'>
            <SyntaxHighlighter
              language={language}
              style={darkMode ? oneDark : oneLight}
              customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', lineHeight: '1.55', paddingBottom: 0 }}
              wrapLongLines
            >
              {highlightedPrefix}
            </SyntaxHighlighter>
            {plainTail && (
              <pre
                className='whitespace-pre-wrap break-words text-[13px] leading-[1.55]'
                style={{ margin: 0, padding: '0 1em 1em', backgroundColor: 'transparent' }}
              >
                {plainTail}
              </pre>
            )}
          </div>
        ) : (
          <pre
            className='whitespace-pre-wrap break-words overflow-x-auto text-[13px] leading-[1.55]'
            style={{ margin: 0, padding: '1em', backgroundColor: 'transparent' }}
          >
            {text}
          </pre>
        )
      ) : (
        <SyntaxHighlighter
          language={language}
          style={darkMode ? oneDark : oneLight}
          customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', lineHeight: '1.55' }}
          wrapLongLines
        >
          {text}
        </SyntaxHighlighter>
      )}
    </div>
  )
}
