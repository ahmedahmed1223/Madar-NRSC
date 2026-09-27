import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppShell from './AppShell.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { DialogHost } from './components/common/DialogHost.tsx';
import './index.css';

// Pictures that fail to load (dead links, offline hosts) are hidden instead of showing a broken icon.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && !img.dataset.keepOnError) img.style.display = 'none';
  },
  true
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
      <DialogHost />
    </ErrorBoundary>
  </StrictMode>,
);
