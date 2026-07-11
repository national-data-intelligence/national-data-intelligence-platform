import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted UI font (offline cluster — no runtime CDN). Weights used by the
// chrome: 400 body · 600 semibold · 700 bold · 800 stat numerals.
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import './styles/base.css';
import './styles/home.css';
import './styles/runtime.css';
import './styles/widgets.css';
import './styles/x-cloak.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
