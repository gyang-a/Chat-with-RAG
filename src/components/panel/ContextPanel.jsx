// application module
// File: C:\Users\yango\Desktop\Chat\src\components\panel\ContextPanel.jsx
export function ContextPanel({ docs }) {
  return (
    <section className='mt-4'>
      <h3 className='mb-2 text-sm font-semibold'>会话上下文</h3>
      <div className='space-y-2'>
        {docs.length === 0 ? (
          <p className='rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground'>暂无上下文文档</p>
        ) : (
          docs.map((doc, index) => (
            <div key={`${doc.name}_${index}`} className='rounded-lg border border-border bg-card p-3'>
              <p className='truncate text-xs font-medium'>{doc.name || '未命名文档'}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {doc.score ? `相关度 ${(doc.score * 100).toFixed(1)}%` : '已加入上下文'}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
