import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode is intentionally omitted: it double-invokes effects in development
// which causes html5-qrcode's camera stream to fail on the second mount.
createRoot(document.getElementById('root')!).render(<App />)
