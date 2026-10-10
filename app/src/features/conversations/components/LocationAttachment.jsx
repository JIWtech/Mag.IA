import React, { useState } from 'react';
import { MapPin, Navigation, ExternalLink, Check, Copy } from 'lucide-react';
import { formatCoordinates } from '../../../utils/audioUtils.js';

export function LocationAttachment({ location }) {
  if (!location) return null;
  const { name, address, latitude, longitude, url, isResolving } = location;

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);

  const mapsUrl = url || (latitude != null && longitude != null
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : '');

  const hasCoords = latitude != null && longitude != null;
  const coordsFormatted = hasCoords ? formatCoordinates(latitude, longitude) : '';
  const coordsRaw = hasCoords ? `${latitude}, ${longitude}` : '';

  const title = name || 'Localização compartilhada';

  const handleCopyAddress = (e) => {
    e.stopPropagation();
    if (!address) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleCopyCoords = (e) => {
    e.stopPropagation();
    const toCopy = coordsRaw || coordsFormatted;
    if (!toCopy) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(toCopy);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 2000);
    }
  };

  return (
    <div className={`location-card ${isResolving ? 'is-resolving' : ''}`}>
      {/* Mini Mapa Estilizado / Header Visual */}
      <a
        className="location-map-preview"
        href={mapsUrl || '#'}
        target={mapsUrl ? '_blank' : undefined}
        rel="noopener noreferrer"
        aria-label={`Abrir mapa de ${title}`}
        onClick={!mapsUrl ? (e) => e.preventDefault() : undefined}
      >
        <div className="location-map-grid" aria-hidden="true">
          <div className="location-map-road horizontal" />
          <div className="location-map-road vertical" />
          <div className="location-map-road diagonal" />
        </div>
        <div className="location-pin-wrapper">
          <div className="location-pin-pulse" />
          <div className="location-pin-icon-wrap">
            <MapPin size={20} className="location-pin-icon" />
          </div>
        </div>
        {hasCoords && (
          <div className="location-map-tag">
            <Navigation size={10} />
            <span>{coordsFormatted}</span>
          </div>
        )}
      </a>

      {/* Conteúdo Informativo */}
      <div className="location-content">
        <div className="location-header-row">
          <div className="location-badge-icon">
            <MapPin size={17} />
          </div>
          <div className="location-text-info">
            <div className="location-title" title={title}>{title}</div>
            {address ? (
              <div className="location-subtitle" title={address}>{address}</div>
            ) : hasCoords ? (
              <div className="location-subtitle">{coordsFormatted}</div>
            ) : isResolving ? (
              <div className="location-resolving-placeholder">
                <span className="skeleton-line" style={{ width: '130px', height: '11px' }} />
              </div>
            ) : (
              <div className="location-subtitle">Coordenadas indisponíveis</div>
            )}
          </div>
        </div>

        {/* Linha de Ações */}
        <div className="location-actions-row">
          <a
            className={`location-btn primary ${!mapsUrl ? 'disabled' : ''}`}
            href={mapsUrl || '#'}
            target={mapsUrl ? '_blank' : undefined}
            rel="noopener noreferrer"
            onClick={!mapsUrl ? (e) => e.preventDefault() : undefined}
          >
            <ExternalLink size={13} />
            <span>Abrir localização</span>
          </a>
          {address ? (
            <button
              className="location-btn secondary"
              type="button"
              onClick={handleCopyAddress}
              title="Copiar endereço completo"
            >
              {copiedAddress ? <Check size={13} className="location-copied-icon" /> : <Copy size={13} />}
              <span>{copiedAddress ? 'Copiado!' : 'Copiar endereço'}</span>
            </button>
          ) : hasCoords ? (
            <button
              className="location-btn secondary"
              type="button"
              onClick={handleCopyCoords}
              title="Copiar coordenadas"
            >
              {copiedCoords ? <Check size={13} className="location-copied-icon" /> : <Copy size={13} />}
              <span>{copiedCoords ? 'Copiado!' : 'Copiar coordenadas'}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
