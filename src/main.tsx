import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StandaloneWindowContainer } from './components/window/StandaloneWindowContainer';
import { watchAppearance } from './config/appearance';
import './i18n';
import './index.css';

// Apply the persisted appearance (theme / scale / icons) to every window
// and keep it live across all open windows + OS theme changes.
watchAppearance();

const isStandaloneWindow = 
  window.location.hash.startsWith('#/window/') || 
  window.location.search.includes('popup=');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isStandaloneWindow ? <StandaloneWindowContainer /> : <App />}
  </React.StrictMode>,
);
