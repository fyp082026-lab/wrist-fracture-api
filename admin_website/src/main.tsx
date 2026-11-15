/**
 * Entry point of the admin website. The browser loads this file first; it
 * mounts <App /> (App.tsx) into the #root element of index.html.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
