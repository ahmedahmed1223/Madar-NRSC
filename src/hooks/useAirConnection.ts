import { useSyncExternalStore } from 'react';
import { dataStore } from '../services/dataStore';

const subscribe = (callback: () => void) => {
  const stop = dataStore.subscribe(event => { if (event.type === 'sync-status') callback(); });
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    stop();
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

const connection = () => navigator.onLine && dataStore.isServerOnline();

export const useAirConnection = () => useSyncExternalStore(subscribe, connection, () => false);
