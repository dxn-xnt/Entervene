import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.tsx'
import AppErrorBoundary from './components/app-error-boundary'
import StatusPage from './pages/StatusPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {import.meta.env.VITE_MAINTENANCE_MODE === 'true' ? <StatusPage variant="maintenance" /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
)
