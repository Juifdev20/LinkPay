import { create } from 'zustand';

const STORAGE_KEY = 'station-scope';

/**
 * Which station the owner is looking at on their dashboard and transactions:
 * one station, or all of them (null). Staff never use it — the API already
 * narrows everything to their own station. Remembered per device.
 */
interface StationScopeState {
  stationId: string | null;
  setStation: (id: string | null) => void;
}

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}

export const useStationScope = create<StationScopeState>((set) => ({
  stationId: readStored(),
  setStation: (id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* not persisted */ }
    set({ stationId: id });
  },
}));

/** The chosen station if it still exists among `stations`, else null (all stations). */
export function resolveStation(stationId: string | null, stations: { id: string }[] | undefined): string | null {
  if (!stationId || !stations?.some((s) => s.id === stationId)) return null;
  return stationId;
}
