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
      retrievalMode: 'hybrid',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
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
      name: 'Kria_ui_v1',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        darkMode: state.darkMode,
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