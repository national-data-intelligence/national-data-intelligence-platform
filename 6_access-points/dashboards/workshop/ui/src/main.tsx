import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted UI font (offline cluster — no runtime CDN). Weights used by the
// chrome: 400 body · 600 semibold · 700 bold · 800 stat numerals.
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
// Self-hosted serif display + mono (offline cluster — no runtime CDN). Previously
// pulled from the Google Fonts CDN, which fails in the sealed cluster, so every
// serif heading (incl. the large project name) fell back to a system serif.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
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
