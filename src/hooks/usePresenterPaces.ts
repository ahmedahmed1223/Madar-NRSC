import { useMemo } from 'react';
import { apiService } from '../services/api';
import { presenterPaces } from '../shared/presenterTiming';
import { useLiveData } from './useLiveData';

export function usePresenterPaces() {
  const version = useLiveData(['onAir', 'bulletinStories']);
  return useMemo(() => presenterPaces(apiService.getOnAirStates(), apiService.getBulletinStories()), [version]);
}
