import React from 'react';
import { createRoot } from 'react-dom/client';
import { OfflineAirApp } from './OfflineAirApp';
import './offline-air.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><OfflineAirApp/></React.StrictMode>);
