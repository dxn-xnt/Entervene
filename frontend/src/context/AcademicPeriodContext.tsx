import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";

export interface AcademicPeriodItem {
  id: number;
  period: string;
  period_sequence: number;
  total_periods: number;
  academicyear: string;
  academic_year_id: number;
  startDate: string | null;
  endDate: string | null;
  is_active: boolean;
  status: string;
}

interface AcademicPeriodContextType {
  periods: AcademicPeriodItem[];
  selectedPeriodId: number | null;
  setSelectedPeriodId: (id: number | null) => void;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const AcademicPeriodContext = createContext<AcademicPeriodContextType | null>(null);

export const AcademicPeriodProvider = ({ children }: { children: ReactNode }) => {
  const [periods, setPeriods] = useState<AcademicPeriodItem[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/v1/settings/academic-periods");
      if (res.ok) {
        const data = await res.json();
        const loadedPeriods: AcademicPeriodItem[] = data.periods || [];
        setPeriods(loadedPeriods);

        // Only set default if we haven't selected one yet
        if (loadedPeriods.length > 0) {
          const active = loadedPeriods.find(p => p.is_active) || loadedPeriods[0];
          setSelectedPeriodId(prev => prev ?? active.id);
        }
      }
    } catch (err) {
      console.error("Failed to load academic periods:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  return (
    <AcademicPeriodContext.Provider value={{ periods, selectedPeriodId, setSelectedPeriodId, isLoading, refetch: fetchPeriods }}>
      {children}
    </AcademicPeriodContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAcademicPeriod = () => {
  const ctx = useContext(AcademicPeriodContext);
  if (!ctx) {
    throw new Error("useAcademicPeriod must be used within an AcademicPeriodProvider");
  }
  return ctx;
};
