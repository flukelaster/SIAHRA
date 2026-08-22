import { useEffect, useState } from "react";
import type { ActiveAlertsResponse, LocalAuthorityImpactResponse } from "@siahra/shared-types";

export interface UseLocalAuthorityImpactResult {
  impacts: LocalAuthorityImpactResponse[];
  activeAlerts: ActiveAlertsResponse["alerts"];
  selectedImpact: LocalAuthorityImpactResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLocalAuthorityImpact(
  provinceCode: string,
  selectedLaoId: string | null,
): UseLocalAuthorityImpactResult {
  const [impacts, setImpacts] = useState<LocalAuthorityImpactResponse[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlertsResponse["alerts"]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function loadData() {
      try {
        const [impactRes, alertRes] = await Promise.all([
          fetch(`/api/v1/local-authorities/impact?province=${provinceCode}`),
          fetch(`/api/v1/alerts/active?province=${provinceCode}`),
        ]);

        if (cancelled) return;

        if (impactRes.ok) {
          const impactJson = (await impactRes.json()) as { impacts: LocalAuthorityImpactResponse[] };
          setImpacts(impactJson.impacts ?? []);
        }

        if (alertRes.ok) {
          const alertJson = (await alertRes.json()) as ActiveAlertsResponse;
          setActiveAlerts(alertJson.alerts ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load decision-support data");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadData();

    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [provinceCode, tick]);

  const selectedImpact =
    (selectedLaoId ? impacts.find((i) => i.localAuthority.id === selectedLaoId) : null) ??
    impacts[0] ??
    null;

  return {
    impacts,
    activeAlerts,
    selectedImpact,
    isLoading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}
