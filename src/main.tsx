import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import '@fontsource/noto-sans-georgian/400.css';
import '@fontsource/noto-sans-georgian/500.css';
import '@fontsource/noto-sans-georgian/600.css';
import '@fontsource/noto-sans-georgian/700.css';
import App from './App';
import './styles.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('Fleetwise service worker registration failed.', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
