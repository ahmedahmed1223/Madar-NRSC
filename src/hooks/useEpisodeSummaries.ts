import { useEffect, useState } from 'react';
import { ApiService, type EpisodeSummaries } from '../services/api';
import { useLiveData } from './useLiveData';

export type EpisodeSummariesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; summaries: EpisodeSummaries };

export function useEpisodeSummaries(): EpisodeSummariesState {
  const [state, setState] = useState<EpisodeSummariesState>({ status: 'loading' });
  const revision = useLiveData(['episodes', 'programs']);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void ApiService.getEpisodeSummaries(controller.signal)
      .then(summaries => {
        if (!controller.signal.aborted) setState({ status: 'ready', summaries });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [revision]);

  return state;
}
