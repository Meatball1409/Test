import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthGate } from './auth';
import { ToastProvider } from './components';
import './styles.css';

registerSW({ immediate: true });
navigator.storage?.persist?.(); // Browser bitten, die Daten nicht automatisch zu löschen

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider><AuthGate><App /></AuthGate></ToastProvider>
  </StrictMode>,
);
