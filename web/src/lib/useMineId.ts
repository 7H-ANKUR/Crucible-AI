'use client';

/**
 * useMineId — shared mine selector state.
 * Fetches the full list of mines the user can access and lets them switch
 * between mines. The selected mine ID is persisted in sessionStorage so it
 * survives page navigation within the same tab.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';

const SESSION_KEY = 'crucible_selected_mine';

export interface Mine {
  mine_id: string;
  mine_name?: string;
  state?: string;
}

export function useMineId(): string {
  const { selectedMine } = useMineSelector();
  return selectedMine;
}

/**
 * Full mine selector hook — returns the mine list, the selected mine, and a setter.
 * Use this on pages that need to show a mine picker dropdown.
 */
export function useMineSelector(): {
  mines: Mine[];
  selectedMine: string;
  setSelectedMine: (id: string) => void;
} {
  const { getToken } = useAuth();

  // Restore from sessionStorage so selection survives navigation
  const [selectedMine, setSelectedMineState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) return stored;
    }
    return 'MH-NAGPUR-01';
  });

  const [mines, setMines] = useState<Mine[]>([]);

  const setSelectedMine = (id: string) => {
    setSelectedMineState(id);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, id);
    }
  };

  useEffect(() => {
    let alive = true;
    getToken().then(token => {
      if (!token) return;
      apiFetch<any>('/mines', undefined, token)
        .then((data) => {
          const list: Mine[] = Array.isArray(data)
            ? data
            : data?.mines ?? [];
          if (alive && list.length > 0) {
            setMines(list);
            // Only override default if nothing was saved in session
            const stored = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
            if (!stored) {
              setSelectedMine(list[0].mine_id);
            }
          }
        })
        .catch(() => {
          // Keep fallback defaults
        });
    });
    return () => { alive = false; };
  }, [getToken]);

  return { mines, selectedMine, setSelectedMine };
}
