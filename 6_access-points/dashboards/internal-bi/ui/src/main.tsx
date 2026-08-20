import { createRoot } from 'react-dom/client';
// Self-hosted fonts (offline cluster — no runtime CDN). Nunito Sans is the UI
// body face and Cormorant Garamond the heading serif — the shared workshop face
// applied across every dashboard (global font decree). Inter is retained only
// for a few standalone screens that still hardcode it (auth splash, denied-access
// takeover); JetBrains Mono for code.
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/base.css';
import './styles/home.css';
import './styles/x-cloak.css';
import './styles/runtime.css';
import App from './App';
import { installDashboardApi } from './api/dashboardApi';

// Chatbot SPA-side action surface — see api/dashboardApi.ts.
installDashboardApi();

// NOTE: NOT wrapped in StrictMode — biApp's imperative renderActive() must
// fire EXACTLY ONCE per active-page change to match the mockup's render
// behaviour (the paginated_table renderer auto-sets `ws.sort = options[0]`
// after first render, so a second call sorts the rows and breaks pixel-diff
// against the mockup which never re-renders).
createRoot(document.getElementById('root')!).render(<App />);
