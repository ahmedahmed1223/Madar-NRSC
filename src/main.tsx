import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppShell from './AppShell.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { DialogHost } from './components/common/DialogHost.tsx';
import './index.css';
import { installArabicValidation } from './services/formValidation';
import { takeOrphanedLocks } from './services/heldLocks';
import { apiService } from './services/api';

installArabicValidation();

// Locks the previous page in this tab held when it reloaded (an editor still open takes it again).
takeOrphanedLocks().forEach((id) => apiService.releaseLockIdOnServer(id));

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
