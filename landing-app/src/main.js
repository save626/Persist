import { createSSRApp } from 'vue'
import App from './App.vue'
import './styles/landing.css'

// 客户端接管 SSR 预渲染出来的静态 HTML（hydrate）。
// 这样无 JS 时静态内容完整可读，有 JS 时 Vue 接手交互。
createSSRApp(App).mount('#app')
