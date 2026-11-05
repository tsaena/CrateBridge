import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { spotify } from './lib/spotify/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

void spotify.completeLogin(window.location.href, (url) => window.history.replaceState(null, '', url)).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
