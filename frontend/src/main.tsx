import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import { mark } from './startup'
import './index.css'

// The first mark measures everything before this line: webview boot, asset
// serving and parsing the bundle. See startup.ts.
mark('script start')

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

mark('react mount')
