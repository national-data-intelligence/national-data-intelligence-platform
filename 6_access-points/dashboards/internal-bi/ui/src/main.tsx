import { createRoot } from 'react-dom/client';
// Self-hosted fonts (offline cluster — no runtime CDN). Inter is the UI face
// (matches the reference goldens — FINAL owner mandate 2026-07-07 supersedes the
// earlier Nunito decree); Cormorant Garamond only for the auth splash serif;
// JetBrains Mono for code.
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
