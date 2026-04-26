// application module
// File: C:\Users\yango\Desktop\Chat\src\components\markdown\MarkdownRenderer.jsx
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { CodeBlock } from '@/components/markdown/CodeBlock'

const MATH_MARKER_REGEX = /(\\\(|\\\[|\$\$?|\\begin\{(?:align\*?|aligned|gather\*?|cases|pmatrix|bmatrix|vmatrix)\})/

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // 保留代码语言类名（language-xxx），让自定义代码块组件可识别语言
    code: [...(defaultSchema.attributes?.code || []), ['className', /^language-[\w-]+$/]],
    pre: [...(defaultSchema.attributes?.pre || []), ['className', /^language-[\w-]+$/]],
  },
}

function normalizeMarkdownContent(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => normalizeMarkdownContent(item)).join('')

  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.content === 'string') return value.content
    if (Array.isArray(value.content)) {
      return value.content.map((item) => normalizeMarkdownContent(item)).join('')
    }
    return ''
  }

  return ''
}

function normalizeMathDelimiters(markdown = '') {
  const text = String(markdown || '')
  if (!text) return ''

  let next = text

  // 兼容模型输出的 \( ... \) 行内公式写法。
  next = next.replace(/\\\((.*?)\\\)/gs, (_, inner) => `$${inner}$`)

  // 兼容模型输出的 \[ ... \] 块级公式写法。
  next = next.replace(/\\\[(.*?)\\\]/gs, (_, inner) => `\n$$\n${inner}\n$$\n`)

  // 兼容被方括号包裹的 LaTeX 环境（例如: [\begin{align*} ... \end{align*}]）。
  next = next.replace(
    /\[\s*(\\begin\{[\s\S]*?\\end\{[\w*]+\})\s*\]/g,
    (_, env) => `\n$$\n${env}\n$$\n`,
  )

  // 若模型直接输出裸环境（无分隔符），自动补成块级公式。
  next = next.replace(
    /(^|\n)(\\begin\{(align\*?|aligned|gather\*?|cases|pmatrix|bmatrix|vmatrix)\}[\s\S]*?\\end\{\3\})(?=\n|$)/g,
    (_, prefix, env) => `${prefix}$$\n${env}\n$$`,
  )

  return next
}

export function MarkdownRenderer({ content }) {
  const safeContent = normalizeMathDelimiters(normalizeMarkdownContent(content))
  const hasMath = useMemo(() => MATH_MARKER_REGEX.test(safeContent), [safeContent])
  const [mathPlugins, setMathPlugins] = useState({ remarkMath: null, rehypeKatex: null })

  useEffect(() => {
    if (!hasMath) return

    let cancelled = false
    Promise.all([import('remark-math'), import('rehype-katex'), import('katex/dist/katex.min.css')])
      .then(([remarkMathModule, rehypeKatexModule]) => {
        if (cancelled) return
        setMathPlugins({
          remarkMath: remarkMathModule.default,
          rehypeKatex: rehypeKatexModule.default,
        })
      })
      .catch(() => null)

    return () => {
      cancelled = true
    }
  }, [hasMath])

  const remarkPlugins = useMemo(() => {
    if (hasMath && mathPlugins.remarkMath) {
      return [remarkGfm, mathPlugins.remarkMath]
    }
    return [remarkGfm]
  }, [hasMath, mathPlugins.remarkMath])

  const rehypePlugins = useMemo(() => {
    const plugins = [[rehypeSanitize, markdownSanitizeSchema]]
    if (hasMath && mathPlugins.rehypeKatex) {
      plugins.push(mathPlugins.rehypeKatex)
    }
    return plugins
  }, [hasMath, mathPlugins.rehypeKatex])

  return (
    <div className='markdown-body text-base leading-7 text-foreground'>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          code: ({ inline, className, children }) => (
            <CodeBlock inline={inline} className={className}>
              {children}
            </CodeBlock>
          ),
          a: ({ ...props }) => <a className='text-primary underline underline-offset-4' target='_blank' rel='noreferrer' {...props} />,
          blockquote: ({ ...props }) => (
            <blockquote className='my-3 border-l-4 border-border bg-muted/40 px-3 py-2 text-muted-foreground' {...props} />
          ),
          table: ({ ...props }) => <table className='my-3 w-full border-collapse text-left text-xs' {...props} />,
          th: ({ ...props }) => <th className='border border-border bg-muted px-2 py-1.5 font-medium' {...props} />,
          td: ({ ...props }) => <td className='border border-border px-2 py-1.5 align-top' {...props} />,
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  )
}
