// application module
// File: C:\Users\yango\Desktop\Chat\src\stores\uiStore.js
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useUIStore = create(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      rightPanelOpen: false,
      darkMode: false,
      ragEnabled: true,
      ragTopK: 4,
      retrievalMode: 'hybrid',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      // RAG 开关：关闭后聊天请求会降级为模型直答。
      setRagEnabled: (ragEnabled) => set({ ragEnabled: Boolean(ragEnabled) }),
      // TopK 用于右侧面板可视化设置，当前先在前端持久化，后续可透传后端。
      setRagTopK: (ragTopK) =>
        set({
          ragTopK: Math.min(12, Math.max(1, Number(ragTopK) || 4)),
        }),
      setRetrievalMode: (retrievalMode) =>
        set({
          retrievalMode:
            retrievalMode === 'text' ||
            retrievalMode === 'semantic' ||
            retrievalMode === 'hybrid' ||
            retrievalMode === 'direct'
              ? retrievalMode
              : 'hybrid',
        }),
    }),
    {
      name: '灵犀_ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        darkMode: state.darkMode,
        ragEnabled: state.ragEnabled,
        ragTopK: state.ragTopK,
        retrievalMode: state.retrievalMode,
      }),
    },
  ),
)
//流程：
/*点击切换暗黑按钮
  ↓
调用 toggleDarkMode()
  ↓
darkMode 变成 true / false
  ↓
自动保存到本地存储（刷新不丢）
  ↓
页面给 html 加/删 class="dark"
  ↓
Tailwind 切换深浅色主题
*/