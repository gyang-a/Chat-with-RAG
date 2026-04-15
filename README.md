
基于 RAG 技术的私有文档知识库问答系统

基于 RAG（检索增强生成） 架构实现私有文档智能问答系统，支持用户上传个人文档并构建专属知识库。系统对文档进行智能分块与结构化存储，同时构建文本索引与向量表征，依托 MongoDB 实现混合存储与高效检索。

系统内置四种问答模式：模型原生直答、关键词全文检索、语义向量检索及混合检索增强模式。其中混合检索通过融合稀疏文本匹配与稠密向量语义召回，兼顾专业术语、编号等精确查询与自然语言、同义表述等模糊查询场景，再经结果融合与重排策略优化上下文质量，显著提升大模型回答的准确性、相关性与事实一致性。

整体架构轻量化、可扩展，实现了私有数据安全可控、检索精准高效、生成内容可靠可信，适用于个人文档管理、内部知识库问答等实际落地场景。

前端相关技术栈：

核心框架：React 19
构建工具：Vite 8
样式体系：Tailwind CSS + PostCSS + tailwindcss-animate
UI 组件：Radix UI（AlertDialog、Dialog、Dropdown、Avatar 等）+ 自定义组件
状态管理：Zustand
Markdown 与代码渲染：react-markdown + remark-gfm + remark-math + rehype-katex + rehype-highlight + rehype-sanitize + react-syntax-highlighter
列表性能优化：react-virtuoso（虚拟滚动）
图标与交互提示：lucide-react + sonner
工具库：clsx + class-variance-authority + tailwind-merge

----------------------------------------------------------------------

后端相关技术栈：

运行时与模块：Node.js（ESM）
Web 框架：Express 5
中间件：cors、compression、multer、dotenv
数据库：MongoDB
文件与文本处理：pdf-parse、mammoth、word-extractor、iconv-lite、jschardet
鉴权与安全相关：基于 crypto 的令牌/签名逻辑
接口能力：SSE 流式聊天代理、文件上传、会话与消息持久化、RAG 服务（项目内模块）
## 启动

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 功能要点

- 左侧侧边栏：会话新建、重命名、删除、置顶、搜索、折叠动画
- 中间聊天区：空状态快捷提问、用户/AI气泡、消息操作栏、输入工具栏
- 右侧侧边栏：本地知识库管理、搜索模式选择、问题引用来源，会话上下文，索引重建
- Markdown：标题/列表/表格/引用/代码块（语法高亮+复制）
- SSE：流式增量渲染、停止生成、错误重试
- 右侧辅助面板：引用来源 + 上下文文档
- 会话与消息存储在 mongoDB
- 性能：react-virtuoso 虚拟滚动
- 安全：输入基础清理 + rehype-sanitize

## 后端接口对接

聊天接口文件：`src/services/chatApi.js`

- 默认地址：`VITE_CHAT_API_URL`
- 默认请求体：

```json
{
	"conversationId": "conv_xxx",
	"message": "用户问题"
}
```

- 默认 SSE 事件格式（可修改）：

```text
data: {"delta":"你好"}

data: {"delta":"，我是Kria"}

data: {"refs":[{"url":"https://...","snippet":"..."}],"contextDocs":[{"name":"A.pdf","score":0.91}]}

data: [DONE]
```

文件上传接口：`src/services/uploadApi.js`

- 默认地址：`VITE_UPLOAD_API_URL`
- 上传方式：`FormData(file)`

## Node.js + Express 后端（已内置）

后端文件：`server/index.js`

你只需要：

1. 复制 `.env.server.example` 为 `.env.server`
2. 填写 `UPSTREAM_CHAT_URL`（必填）
3. 按需填写 `UPSTREAM_API_KEY`
4. 启动服务：`npm run server`

后端支持三种模式：

- `UPSTREAM_MODE=openai`：对接 OpenAI 兼容流式接口
- `UPSTREAM_MODE=deepseek`：对接 DeepSeek（OpenAI 兼容）
- `UPSTREAM_MODE=sse_json`：对接你自己的 SSE JSON 接口（data: {delta: ...}）

前端无需改动，继续请求 `/api/chat/stream` 即可。

### DeepSeek 快速配置

在 `.env.server` 中填写：

```env
UPSTREAM_MODE=deepseek
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=你的Key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner
```

然后启动：

```bash
npm run server
```

## 语义检索（RAG）配置

语义检索功能依赖 MongoDB + 文档入库 +（可选）Embedding。最小可用只需要 MongoDB；配置 Embedding 后可启用 semantic/hybrid 检索。

在 `.env.server` 中补充以下配置：

```env
# ===== MongoDB =====
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=chat_app

# ===== Embedding（启用语义检索建议配置） =====
# 兼容 OpenAI Embedding 协议的接口地址
EMBEDDING_API_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_BATCH_SIZE=16

# ===== 向量检索（Mongo Atlas / 支持 $vectorSearch 时开启） =====
MONGODB_VECTOR_SEARCH_ENABLED=false
MONGODB_VECTOR_INDEX_NAME=kb_chunks_vector_index
MONGODB_VECTOR_SEARCH_LIMIT=40
MONGODB_VECTOR_SEARCH_NUM_CANDIDATES=160

# ===== RAG 路由阈值 =====
RAG_ROUTE_MIN_CONFIDENCE=0.32
RAG_ROUTE_MIN_CONFIDENCE_TEXT=0.12
RAG_ROUTE_PINNED_BOOST_ENABLED=true

# ===== 入库并发与队列 =====
KB_INGEST_CONCURRENCY=2
KB_INGEST_QUEUE_SIZE=80
```

说明：

- 当 `EMBEDDING_API_URL` 或 `EMBEDDING_MODEL` 为空时，系统会退化为关键词检索（text）。
- `MONGODB_VECTOR_SEARCH_ENABLED=true` 仅在 Mongo 环境支持 `$vectorSearch` 时建议开启。
- 若你不确定是否支持向量检索，先保持 `false`，系统仍可正常使用 text/hybrid 路由。

检索模式：

- `text`：纯关键词检索
- `semantic`：纯向量语义检索（需 Embedding）
- `hybrid`：关键词 + 语义融合（推荐）
- `direct`：不走知识库检索

知识库相关接口：

- `POST /api/kb/upload`：上传并入库文档
- `GET /api/kb/docs`：查询文档列表
- `POST /api/kb/docs/:docId/reindex`：重建单文档索引
- `DELETE /api/kb/docs/:docId`：删除单文档

常见问题：

- 文档已入库但预览乱码：优先使用 UTF-8 编码的 TXT/MD 原文，再执行重建索引。
- semantic 命中弱：优先检查 `EMBEDDING_*` 是否正确、模型是否可用，再微调 `RAG_ROUTE_MIN_CONFIDENCE`。

## 快捷键

- `Ctrl + N`: 新建会话
- `Enter`: 发送
- `Shift + Enter`: 换行
- `Ctrl + Enter`: 发送

## 目录摘要

- `src/components/layout`: 主布局
- `src/components/sidebar`: 侧边栏
- `src/components/chat`: 聊天相关组件
- `src/components/panel`: 右侧辅助面板
- `src/components/markdown`: Markdown 与代码块渲染
- `src/stores`: Zustand 状态管理
- `src/hooks`: 自动滚动、SSE 等逻辑
- `src/services`: 聊天与上传接口层

