// application module
// File: C:\Users\yango\Desktop\Chat\src\components\markdown\MarkdownRenderer.jsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import { CodeBlock } from '@/components/markdown/CodeBlock'

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

export function MarkdownRenderer({ content }) {
  const safeContent = normalizeMarkdownContent(content)

  return (
    <div className='markdown-body text-base leading-7 text-foreground'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeKatex]}
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
