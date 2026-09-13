'use client';

/**
 * useMineId — shared demo mine id (first mine from /mines, MINE-A fallback).
 * Module-level cache so every page shares one request.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';

export function useMineId(): string {
  const { getToken } = useAuth();
  const [mineId, setMineId] = useState('MH-NAGPUR-01');

  useEffect(() => {
    let alive = true;
    getToken().then(token => {
      if (!token) return;
      apiFetch<any>('/mines', undefined, token)
        .then((mines) => {
          const first = Array.isArray(mines) ? mines[0] : mines?.mines?.[0];
          if (alive && first?.mine_id) {
            setMineId(first.mine_id);
          }
        })
        .catch(() => {
          // Keep fallback
        });
    });
    return () => {
      alive = false;
    };
  }, [getToken]);

  return mineId;
}
