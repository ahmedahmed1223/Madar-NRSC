import { useState, useEffect } from 'react';
import { selfHealingService, SelfHealingReport } from '../services/selfHealingService';
import { networkResilienceManager, NetworkHealthState } from '../services/networkManager';
import { draftVaultManager, DraftVaultEntry } from '../services/draftVault';

export function useSystemHealth() {
  const [report, setReport] = useState<SelfHealingReport>(() => selfHealingService.getLastReport());
  const [networkState, setNetworkState] = useState<NetworkHealthState>(() => networkResilienceManager.getState());
  const [draftSnapshots, setDraftSnapshots] = useState<DraftVaultEntry[]>(() => draftVaultManager.getAllSnapshots());
  const [isRepairing, setIsRepairing] = useState(false);

  useEffect(() => {
    const unsubNetwork = networkResilienceManager.subscribe((state) => {
      setNetworkState(state);
    });

    const interval = setInterval(() => {
      setReport(selfHealingService.getLastReport());
      setDraftSnapshots(draftVaultManager.getAllSnapshots());
    }, 5000);

    return () => {
      unsubNetwork();
      clearInterval(interval);
    };
  }, []);

  const triggerSelfHealing = async (logActivity = true): Promise<SelfHealingReport> => {
    setIsRepairing(true);
    // Allow brief UI animation
    await new Promise((resolve) => setTimeout(resolve, 400));
    const newReport = selfHealingService.runFullDiagnosticsAndRepair(logActivity);
    setReport(newReport);
    setIsRepairing(false);
    return newReport;
  };

  const triggerNetworkDrain = async () => {
    return await networkResilienceManager.drainOfflineQueue();
  };

  return {
    report,
    networkState,
    draftSnapshots,
    isRepairing,
    triggerSelfHealing,
    triggerNetworkDrain,
  };
}
