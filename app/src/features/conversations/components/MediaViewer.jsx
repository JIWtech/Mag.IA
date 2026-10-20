import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ZoomOut,
  ZoomIn,
  RotateCcw,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Video,
  Play,
} from 'lucide-react';
import { resolveSingleMediaUrl, getMediaUrlFromCache } from '../../../services/media/mediaUrlService.js';

export function MediaViewer({ kind = 'image', src, alt, poster, gallery = [], initialIndex = 0, onClose }) {
  const mediaGallery = gallery.length ? gallery : [{ src, alt, kind, poster }];
  const [activeIndex, setActiveIndex] = useState(Math.max(0, Math.min(initialIndex, mediaGallery.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [resolvedSrc, setResolvedSrc] = useState('');
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef(null);
  const videoRef = useRef(null);

  const activeMedia = mediaGallery[activeIndex] || { src, alt, kind, poster };
  const activeKind = String(activeMedia.kind || (activeIndex === initialIndex ? kind : 'image')).toLowerCase();
  const isCurrentImage = activeKind === 'image' || activeKind === 'sticker';
  const isCurrentVideo = activeKind === 'video';

  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < mediaGallery.length - 1;

  // Resolve signed URL on demand if item only has bucket/storagePath
  useEffect(() => {
    if (activeMedia.src) {
      setResolvedSrc(activeMedia.src);
      return undefined;
    }
    if (activeMedia.bucket && activeMedia.storagePath) {
      const cached = getMediaUrlFromCache(activeMedia.bucket, activeMedia.storagePath);
      if (typeof cached === 'string') {
        setResolvedSrc(cached);
        return undefined;
      }
      let isMounted = true;
      resolveSingleMediaUrl(activeMedia.bucket, activeMedia.storagePath)
        .then((url) => {
          if (isMounted && url) setResolvedSrc(url);
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
    setResolvedSrc('');
    return undefined;
  }, [activeMedia.src, activeMedia.bucket, activeMedia.storagePath]);

  const effectiveSrc = resolvedSrc || activeMedia.src || (activeIndex === initialIndex ? src : '');

  const resetImage = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const closeViewer = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    onClose();
  }, [onClose]);

  useEffect(() => {
    resetImage();
    if (videoRef.current) {
      videoRef.current.pause();
    }
    return () => {
      if (videoRef.current) videoRef.current.pause();
    };
  }, [activeIndex, activeMedia.src, resetImage]);

  // Preload adjacent images
  useEffect(() => {
    if (typeof Image === 'undefined') return undefined;
    const preload = (index) => {
      const item = mediaGallery[index];
      if (!item || item.kind === 'video' || !item.src) return;
      const image = new Image();
      image.src = item.src;
    };
    preload(activeIndex - 1);
    preload(activeIndex + 1);
    return undefined;
  }, [activeIndex, mediaGallery]);

  const setImageZoom = useCallback((nextZoom) => {
    const boundedZoom = Math.max(1, Math.min(4, Number(nextZoom.toFixed(2))));
    setZoom(boundedZoom);
    if (boundedZoom === 1) setPosition({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeViewer();
      if (event.key === 'ArrowLeft' && canGoPrevious) setActiveIndex((index) => index - 1);
      if (event.key === 'ArrowRight' && canGoNext) setActiveIndex((index) => index + 1);
      if (isCurrentImage) {
        if (event.key === '+' || event.key === '=') setImageZoom(zoom + 0.25);
        if (event.key === '-' || event.key === '_') setImageZoom(zoom - 0.25);
        if (event.key === '0') resetImage();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canGoNext, canGoPrevious, closeViewer, zoom, resetImage, setImageZoom, isCurrentImage]);

  const handleWheel = (event) => {
    if (!isCurrentImage) return;
    event.preventDefault();
    setImageZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
  };

  const handlePointerDown = (event) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    if (!isCurrentImage || zoom <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: position,
    };
  };

  const handlePointerMove = (event) => {
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragMovedRef.current = true;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: drag.origin.x + (event.clientX - drag.x),
      y: drag.origin.y + (event.clientY - drag.y),
    });
  };

  const stopDragging = (event) => {
    if (dragRef.current && event?.pointerId === dragRef.current.pointerId) {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
    }
    dragRef.current = null;
  };

  const handleTouchStart = (event) => {
    if (event.touches.length === 1 && zoom === 1) {
      touchStartRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (event) => {
    if (!touchStartRef.current) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (dt < 400 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0 && canGoNext) navigate(1);
      if (dx > 0 && canGoPrevious) navigate(-1);
    }
  };

  const handleStageClick = () => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    closeViewer();
  };

  const navigate = (direction) => {
    setActiveIndex((index) => Math.max(0, Math.min(mediaGallery.length - 1, index + direction)));
  };

  const handleDownload = async (event) => {
    event.stopPropagation();
    if (!effectiveSrc) return;
    try {
      const response = await fetch(effectiveSrc);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const cleanName = (activeMedia.alt || alt || 'midia')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 32);
      a.download = `${cleanName || 'arquivo'}.${isCurrentVideo ? 'mp4' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(effectiveSrc, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenExternal = (event) => {
    event.stopPropagation();
    if (effectiveSrc) {
      window.open(effectiveSrc, '_blank', 'noopener,noreferrer');
    }
  };

  const modal = (
    <div
      className="media-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isCurrentVideo ? 'Visualizador de vídeo' : 'Visualizador de imagem'}
      onClick={closeViewer}
    >
      <header
        className="media-viewer-header"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="media-viewer-header-left">
          <span className="media-viewer-badge">
            {isCurrentVideo ? (
              <Video size={14} className="media-viewer-badge-icon is-video" />
            ) : (
              <ImageIcon size={14} className="media-viewer-badge-icon" />
            )}
            <span className="media-viewer-badge-title">
              {mediaGallery.length > 1
                ? `${isCurrentVideo ? 'Vídeo' : 'Foto'} ${activeIndex + 1} de ${mediaGallery.length}`
                : (activeMedia.alt || (isCurrentVideo ? 'Visualização de vídeo' : 'Visualização de imagem'))}
            </span>
            {activeMedia.senderLabel && (
              <span className="media-viewer-badge-sender">• {activeMedia.senderLabel}</span>
            )}
            {activeMedia.formattedTime && (
              <span className="media-viewer-badge-time">({activeMedia.formattedTime})</span>
            )}
          </span>
        </div>

        <div className="media-viewer-header-actions">
          {isCurrentImage && (
            <div className="media-viewer-zoom-group">
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Diminuir zoom (-)"
                title="Diminuir zoom (-)"
                onClick={() => setImageZoom(zoom - 0.25)}
                disabled={zoom <= 1}
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-zoom-pill"
                aria-label="Alternar zoom"
                title="Clique para alternar zoom (100% / 200%)"
                onClick={() => (zoom > 1 ? resetImage() : setImageZoom(2))}
              >
                {zoom === 1 ? '100%' : `${Math.round(zoom * 100)}%`}
              </button>
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Aumentar zoom (+)"
                title="Aumentar zoom (+)"
                onClick={() => setImageZoom(zoom + 0.25)}
                disabled={zoom >= 4}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Ajustar imagem à tela (0)"
                title="Ajustar à tela (0)"
                onClick={resetImage}
                disabled={zoom === 1 && position.x === 0 && position.y === 0}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          )}

          {isCurrentImage && <div className="media-viewer-divider" role="separator" />}

          <button
            type="button"
            className="media-viewer-action-btn"
            aria-label="Baixar mídia"
            title="Baixar arquivo"
            onClick={handleDownload}
            disabled={!effectiveSrc}
          >
            <Download size={16} />
          </button>

          <button
            type="button"
            className="media-viewer-action-btn"
            aria-label="Abrir original em nova aba"
            title="Abrir em nova aba"
            onClick={handleOpenExternal}
            disabled={!effectiveSrc}
          >
            <ExternalLink size={16} />
          </button>

          <button
            type="button"
            className="media-viewer-action-btn media-viewer-close-btn"
            aria-label="Fechar visualizador (ESC)"
            title="Fechar (ESC ou clique fora)"
            onClick={closeViewer}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div
        className={`media-viewer-stage ${isCurrentImage ? 'is-image' : 'is-video'}`}
        onClick={handleStageClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {isCurrentImage ? (
          <img
            key={effectiveSrc || activeIndex}
            className={`media-viewer-image ${zoom > 1 ? 'is-zoomed' : ''}`}
            src={effectiveSrc}
            alt={activeMedia.alt || alt}
            draggable="false"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (zoom > 1) {
                resetImage();
              } else {
                setImageZoom(2.5);
              }
            }}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            }}
          />
        ) : (
          <video
            key={effectiveSrc || activeIndex}
            ref={videoRef}
            className="media-viewer-video"
            controls
            autoPlay
            preload="metadata"
            poster={activeMedia.poster || poster || undefined}
            src={effectiveSrc}
            onClick={(event) => event.stopPropagation()}
          >
            Seu navegador não suporta vídeo.
          </video>
        )}
      </div>

      {mediaGallery.length > 1 && (
        <>
          <button
            type="button"
            className="media-viewer-nav media-viewer-nav-prev"
            aria-label="Mídia anterior (Seta esquerda)"
            title="Mídia anterior"
            disabled={!canGoPrevious}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              navigate(-1);
            }}
          >
            <ChevronLeft size={24} />
          </button>

          <button
            type="button"
            className="media-viewer-nav media-viewer-nav-next"
            aria-label="Próxima mídia (Seta direita)"
            title="Próxima mídia"
            disabled={!canGoNext}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              navigate(1);
            }}
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {activeMedia.caption && (
        <div
          className={`media-viewer-caption ${mediaGallery.length > 1 ? 'has-thumbnails' : ''}`}
          aria-label="Legenda"
          onClick={(event) => event.stopPropagation()}
        >
          {activeMedia.caption}
        </div>
      )}

      {mediaGallery.length > 1 && (
        <div
          className="media-viewer-thumbnails"
          role="tablist"
          aria-label="Miniaturas da galeria"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {mediaGallery.map((item, idx) => {
            const isActive = idx === activeIndex;
            const isItemVideo = item.kind === 'video';
            const thumbSrc = item.poster || item.src;
            return (
              <button
                key={item.id || item.src || idx}
                type="button"
                className={`media-viewer-thumb-btn ${isActive ? 'is-active' : ''} ${isItemVideo ? 'is-video-thumb' : ''}`}
                aria-label={`Ver ${isItemVideo ? 'vídeo' : 'imagem'} ${idx + 1}`}
                aria-selected={isActive}
                role="tab"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex(idx);
                }}
              >
                {thumbSrc ? (
                  <img src={thumbSrc} alt="" loading="lazy" />
                ) : (
                  <div className="media-viewer-thumb-fallback">
                    {isItemVideo ? <Video size={16} /> : <ImageIcon size={16} />}
                  </div>
                )}
                {isItemVideo && (
                  <span className="media-viewer-thumb-play" aria-hidden="true">
                    <Play size={12} fill="currentColor" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="media-viewer-hint" aria-hidden="true">
        <span>Clique fora ou ESC para fechar</span>
        {isCurrentImage && <span>• Rolagem para zoom</span>}
        {mediaGallery.length > 1 && <span>• Setas para navegar</span>}
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body ? createPortal(modal, document.body) : modal;
}
