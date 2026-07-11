import { createRoot } from 'react-dom/client';
// Self-hosted UI font (offline cluster — no runtime CDN). Weights used by the
// chrome: 400 body · 600 semibold · 700 bold · 800 stat numerals.
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import './styles/base.css';
import './styles/home.css';
import './styles/x-cloak.css';
import App from './App';

// NOTE: NOT wrapped in StrictMode — biApp's imperative renderActive() must
// fire EXACTLY ONCE per active-page change to match the mockup's render
// behaviour (the paginated_table renderer auto-sets `ws.sort = options[0]`
// after first render, so a second call sorts the rows and breaks pixel-diff
// against the mockup which never re-renders).
createRoot(document.getElementById('root')!).render(<App />);
