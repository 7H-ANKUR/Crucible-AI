'use client';

/**
 * Sheet — bottom-sheet drawer for the mobile exploration map.
 * Slides up over the map; backdrop tap or handle drag closes it.
 */
import React, { useEffect, useState } from 'react';

export function Sheet({
  open,
  onClose,
  title,
  children,
  maxHeight = '72vh',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: string;
}) {
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    if (!open) setDrag(0);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        className="relative bg-surface-parchment border-t border-earth-border rounded-t-[24px] shadow-2xl transition-transform duration-200"
        style={{ transform: `translateY(${Math.min(drag, 0)}px)`, maxHeight }}
      >
        <div
          className="pt-2.5 pb-1 flex justify-center cursor-grab touch-none"
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) setDrag(Math.min(0, t.clientY - 60));
          }}
          onTouchEnd={() => {
            if (drag < -70) onClose();
            setDrag(0);
          }}
        >
          <div className="w-12 h-1.5 rounded-full bg-secondary/30" />
        </div>
        {title && (
          <div className="px-5 pb-1 text-[10px] font-bold text-copper-accent uppercase tracking-widest">{title}</div>
        )}
        <div className="px-5 pb-[calc(20px+env(safe-area-inset-bottom))] overflow-y-auto" style={{ maxHeight: `calc(${maxHeight} - 52px)` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
