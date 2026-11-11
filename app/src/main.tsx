import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installMobileApiFetchBridge } from './lib/mobile-api'

installMobileApiFetchBridge({
  surface: import.meta.env.MODE === 'mobile' ? 'mobile' : 'web',
  baseUrl: import.meta.env.VITE_PERSIST_API_BASE_URL,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
