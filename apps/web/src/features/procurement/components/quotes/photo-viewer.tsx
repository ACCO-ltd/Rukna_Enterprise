'use client';

/**
 * Full-screen photo zoom for a quote (spec Q12): pinch and drag on a phone, double-tap to zoom,
 * + / − / 0 on a keyboard, ← / → between pages, Esc closes. Built on `FormDialog`, which is full
 * screen on a phone, traps focus and returns it to the photo that opened it.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, FormDialog, FormDialogBody } from '@erp/ui';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

import type { QuotePhoto } from '../../quotations/types';
import { QuotePhotoImage } from './quote-shared';

const MIN = 1;
const MAX = 5;
const STEP = 0.5;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

export function PhotoViewer({
  store,
  photos,
  initialPage = 0,
  onClose,
}: {
  store: string;
  photos: QuotePhoto[];
  initialPage?: number;
  onClose: () => void;
}) {
  const t = useTranslations('procurement.quotes.decision');
  const tCommon = useTranslations('common');
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  const photo = photos[page];
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const zoom = (next: number) => {
    const value = clamp(next);
    setScale(value);
    if (value === 1) setOffset({ x: 0, y: 0 });
  };
  const goTo = (index: number) => {
    if (index < 0 || index >= photos.length) return;
    setPage(index);
    reset();
  };

  // Keys work wherever focus sits inside the dialog (it opens with focus on the dialog itself).
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return;
      const clampTo = (value: number) => Math.min(MAX, Math.max(MIN, value));
      if (event.key === '+' || event.key === '=') setScale((v) => clampTo(v + STEP));
      else if (event.key === '-' || event.key === '_') {
        setScale((v) => clampTo(v - STEP));
      } else if (event.key === '0') {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && scale === 1) {
        const next = page + (event.key === 'ArrowRight' ? 1 : -1);
        if (next < 0 || next >= photos.length) return;
        setPage(next);
        setOffset({ x: 0, y: 0 });
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [scale, page, photos.length]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="2xl"
      initialFocus="dialog"
      title={t('zoomTitle', { store, page: page + 1, pages: photos.length })}
      subtitle={t('zoomHint')}
      closeLabel={tCommon('close')}
    >
      <FormDialogBody className="flex flex-col gap-3 p-0 sm:p-4">
        <div
          className="relative min-h-[60dvh] flex-1 touch-none select-none overflow-hidden bg-black/90"
          onPointerDown={(event) => {
            (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) pinch.current = { distance: distance(), scale };
            if (pointers.current.size === 1) {
              const now = Date.now();
              if (now - lastTap.current < 300) zoom(scale > 1 ? 1 : 2.5);
              lastTap.current = now;
            }
          }}
          onPointerMove={(event) => {
            const previous = pointers.current.get(event.pointerId);
            if (!previous) return;
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2 && pinch.current && pinch.current.distance > 0) {
              zoom(pinch.current.scale * (distance() / pinch.current.distance));
            } else if (pointers.current.size === 1 && scale > 1) {
              setOffset((o) => ({ x: o.x + event.clientX - previous.x, y: o.y + event.clientY - previous.y }));
            }
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId);
            pinch.current = null;
          }}
        >
          {photo ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                // At 1× the photo is always centred, whatever a drag left behind.
                transform: scale > 1 ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : 'none',
                transformOrigin: 'center',
              }}
            >
              <QuotePhotoImage
                fileId={photo.fileId}
                alt={t('zoomTitle', { store, page: page + 1, pages: photos.length })}
                fit="contain"
                className="max-h-full max-w-full"
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4 sm:px-0 sm:pb-0">
          {photos.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={t('pagePrevious')}
              disabled={page === 0}
              onClick={() => goTo(page - 1)}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label={t('zoomOut')} onClick={() => zoom(scale - STEP)}>
            <ZoomOut className="size-5" aria-hidden="true" />
          </Button>
          <span className="w-14 text-center text-caption tabular-nums text-muted-foreground" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label={t('zoomIn')} onClick={() => zoom(scale + STEP)}>
            <ZoomIn className="size-5" aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label={t('zoomReset')} onClick={reset}>
            <Maximize2 className="size-5" aria-hidden="true" />
          </Button>
          {photos.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={t('pageNext')}
              disabled={page === photos.length - 1}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </FormDialogBody>
    </FormDialog>
  );
}
