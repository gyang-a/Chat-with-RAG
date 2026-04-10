// application module
// File: C:\Users\yango\Desktop\Chat\src\components\panel\SourcePanel.jsx
import { ExternalLink } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

function isWordRef(item) {
  const name = String(item?.name || '').toLowerCase()
  const url = String(item?.url || '').toLowerCase()
  return name.endsWith('.doc') || name.endsWith('.docx') || url.endsWith('.doc') || url.endsWith('.docx')
}

function resolveRefHref(item) {
  if (item?.viewUrl) return item.viewUrl
  if (item?.docId && isWordRef(item)) {
    return `/api/kb/docs/${encodeURIComponent(String(item.docId))}/view`
  }
  return item?.url || '#'
}

function withPreviewToken(url = '', token = '') {
  const safeUrl = String(url || '')
  const safeToken = String(token || '').trim()
  if (!safeUrl) return '#'
  if (!safeToken) return safeUrl
  if (!safeUrl.startsWith('/api/kb/docs/')) return safeUrl
  const joiner = safeUrl.includes('?') ? '&' : '?'
  return `${safeUrl}${joiner}access_token=${encodeURIComponent(safeToken)}`
}

export function SourcePanel({ refs }) {
  const token = useAuthStore((s) => s.token)
  return (
    <section>
      <h3 className='mb-2 text-sm font-semibold'>引用来源</h3>
      <div className='space-y-2'>
        {refs.length === 0 ? (
          <p className='rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground'>当前回答暂无引用来源</p>
        ) : (
          refs.map((item, index) => (
            // DOC/DOCX 默认跳站内预览页；PDF 等类型继续走原始链接。
            <a
              key={`${item.docId || item.url}_${index}`}
              href={withPreviewToken(resolveRefHref(item), token)}
              target='_blank'
              rel='noreferrer'
              className='block rounded-lg border border-border bg-card p-3 transition hover:border-primary/40 hover:shadow-soft'
            >
              <p className='line-clamp-3 text-xs leading-5 text-foreground'>{item.snippet || '引用文档片段'}</p>
              <p className='mt-2 inline-flex items-center text-xs text-primary'>查看原文 <ExternalLink className='ml-1 h-3 w-3' /></p>
            </a>
          ))
        )}
      </div>
    </section>
  )
}
