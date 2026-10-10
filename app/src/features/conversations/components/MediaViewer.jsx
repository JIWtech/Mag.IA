import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ZoomOut,
  ZoomIn,
  RotateCcw,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export function MediaViewer({ kind, src, alt, poster, gallery = [], initialIndex = 0, onClose }) {
  const imageGallery = gallery.length ? gallery : [{ src, alt }];
  const [activeIndex, setActiveIndex] = useState(Math.max(0, Math.min(initialIndex, imageGallery.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const videoRef = useRef(null);
  const isImage = kind === 'image' || kind === 'sticker';
  const activeMedia = imageGallery[activeIndex] || { src, alt };
  const canGoPrevious = isImage && activeIndex > 0;
  const canGoNext = isImage && activeIndex < imageGallery.length - 1;
  const resetImage = useCallback(() => { setZoom(1); setPosition({ x: 0, y: 0 }); }, []);
  const closeViewer = useCallback(() => { if (videoRef.current) videoRef.current.pause(); onClose(); }, [onClose]);

  useEffect(() => {
    resetImage();
    return () => { if (videoRef.current) videoRef.current.pause(); };
  }, [kind, activeIndex, activeMedia.src, resetImage]);

  useEffect(() => {
    if (!isImage || typeof Image === 'undefined') return undefined;
    const preload = (index) => {
      if (!imageGallery[index]?.src) return;
      const image = new Image();
      image.src = imageGallery[index].src;
    };
    preload(activeIndex - 1);
    preload(activeIndex + 1);
    return undefined;
  }, [activeIndex, imageGallery, isImage]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeViewer();
      if (event.key === 'ArrowLeft' && canGoPrevious) setActiveIndex(index => index - 1);
      if (event.key === 'ArrowRight' && canGoNext) setActiveIndex(index => index + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canGoNext, canGoPrevious, closeViewer]);

  const setImageZoom = (nextZoom) => {
    const boundedZoom = Math.max(1, Math.min(4, nextZoom));
    setZoom(boundedZoom);
    if (boundedZoom === 1) setPosition({ x: 0, y: 0 });
  };
  const handleWheel = (event) => {
    if (!isImage) return;
    event.preventDefault();
    setImageZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
  };
  const handlePointerDown = (event) => {
    if (!isImage || zoom <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
  };
  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({ x: drag.origin.x + event.clientX - drag.x, y: drag.origin.y + event.clientY - drag.y });
  };
  const stopDragging = () => { dragRef.current = null; };
  const navigate = (direction) => {
    setActiveIndex(index => Math.max(0, Math.min(imageGallery.length - 1, index + direction)));
  };

  return (
    <div className="media-viewer-backdrop" role="dialog" aria-modal="true" aria-label={isImage ? 'Visualizador de imagem' : 'Visualizador de vídeo'} onClick={closeViewer}>
      <div className="media-viewer-toolbar" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        {isImage && imageGallery.length > 1 && <span className="media-viewer-counter">{activeIndex + 1} / {imageGallery.length}</span>}
        <div className="media-viewer-controls">
          {isImage && <>
            <button type="button" className="media-viewer-control" aria-label="Diminuir zoom" onClick={() => setImageZoom(zoom - 0.25)} disabled={zoom <= 1}><ZoomOut size={18} /></button>
            <span className="media-viewer-zoom-label" aria-live="polite">{zoom === 1 ? 'Ajustar' : `${Math.round(zoom * 100)}%`}</span>
            <button type="button" className="media-viewer-control" aria-label="Aumentar zoom" onClick={() => setImageZoom(zoom + 0.25)} disabled={zoom >= 4}><ZoomIn size={18} /></button>
            <button type="button" className="media-viewer-control" aria-label="Ajustar imagem à tela" onClick={resetImage} disabled={zoom === 1 && position.x === 0 && position.y === 0}><RotateCcw size={17} /></button>
          </>}
          <button type="button" className="media-viewer-control media-viewer-close" aria-label="Fechar visualizador" onClick={closeViewer}><X size={20} /></button>
        </div>
      </div>
      <div className={`media-viewer-stage ${isImage ? 'is-image' : 'is-video'}`} onClick={(event) => event.stopPropagation()} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onDoubleClick={() => isImage && setImageZoom(zoom > 1 ? 1 : 2.5)}>
        {isImage ? <img className={`media-viewer-image ${zoom > 1 ? 'is-zoomed' : ''}`} src={activeMedia.src} alt={activeMedia.alt || alt} draggable="false" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})` }} /> : <video ref={videoRef} className="media-viewer-video" controls autoPlay preload="metadata" poster={poster || undefined} src={src}>Seu navegador não suporta vídeo.</video>}
      </div>
      {isImage && imageGallery.length > 1 && <button type="button" className="media-viewer-nav media-viewer-nav-prev" aria-label="Imagem anterior" disabled={!canGoPrevious} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); navigate(-1); }}><ChevronLeft size={24} /></button>}
      {isImage && imageGallery.length > 1 && <button type="button" className="media-viewer-nav media-viewer-nav-next" aria-label="Próxima imagem" disabled={!canGoNext} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); navigate(1); }}><ChevronRight size={24} /></button>}
    </div>
  );
}
