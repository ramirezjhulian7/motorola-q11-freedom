import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The static demo (GitHub Pages) answers the router API in the browser.
// Vite replaces the flag at build time, so the router bundle never includes it.
const ready = import.meta.env.VITE_STATIC_DEMO === '1'
  ? import('../demo/browser-mock.ts')
  : Promise.resolve()

ready.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
