import googleIt from 'google-it'

export async function performWebSearch(query) {
  try {
    // 优先使用 Tavily API (如果配置了 API Key)
    // eslint-disable-next-line no-undef
    if (process.env.TAVILY_API_KEY) {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // eslint-disable-next-line no-undef
          api_key: process.env.TAVILY_API_KEY,
          query: query,
          search_depth: "basic", // 基础搜索（更快、省额度），高级可选 "advanced"
          include_answer: false
        })
      })
      const data = await response.json()
      if (data && data.results) {
        const results = data.results
        const text = results.map(r => `[标题]: ${r.title}\n[链接]: ${r.url}\n[摘要]: ${r.content}`).join('\n\n')
        const refs = results.map(r => ({ name: r.title, url: r.url, snippet: r.content }))
        return { text, refs }
      }
    }

    // fallback: 如果没配置 Key，降级使用 google 免费爬虫
    const results = await googleIt({ query, limit: 5 })
    if (!results || results.length === 0) return null
    
    const limited = results.slice(0, 5)
    const text = limited.map(r => `[标题]: ${r.title}\n[链接]: ${r.link}\n[摘要]: ${r.snippet}`).join('\n\n')
    const refs = limited.map(r => ({ name: r.title, url: r.link, snippet: r.snippet }))
    return { text, refs }
  } catch(e) {
    console.warn("网络搜索失败:", e)
    return null
  }
}
