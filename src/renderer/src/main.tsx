import React from 'react'
import ReactDOM from 'react-dom/client'
import 'flexlayout-react/style/light.css'
import './styles.css'
import './lib/monaco'
import { App } from './App'

async function bootstrapRenderer(): Promise<void> {
  if (!window.editorApi && import.meta.env.DEV) {
    const { installBrowserMock } = await import('./dev/browser-mock')
    installBrowserMock()
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrapRenderer()
