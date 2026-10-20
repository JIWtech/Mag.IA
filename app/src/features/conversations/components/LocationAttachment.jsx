import React, { useState } from 'react';
import { ExternalLink, MapPin, MapPinOff } from 'lucide-react';
import { MediaMeta } from './MediaMeta.jsx';
import { formatCoordinates } from '../../../utils/audioUtils.js';

const toCoordinate = (value) => {
  if (value == null || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Monta as URLs do Google Maps: o embed (sem chave de API) para o mapa dentro da
 * bolha e o link para abrir o local completo em outra aba.
 */
export function buildLocationMapUrls({ latitude, longitude, address, url }) {
  const hasCoords = latitude != null && longitude != null && (latitude !== 0 || longitude !== 0);
  const query = hasCoords ? `${latitude},${longitude}` : String(address || '').trim();
  if (!query) return { hasCoords, embedUrl: '', openUrl: url || '' };
  const encoded = encodeURIComponent(query);
  return {
    hasCoords,
    embedUrl: `https://maps.google.com/maps?q=${encoded}&z=16&hl=pt-BR&output=embed`,
    openUrl: url || `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  };
}

export function LocationAttachment({
  location,
  meta = null,
  onLocationLoad = null,
  storeLocation = null,
  isOutbound = false,
}) {
  const [mapLoaded, setMapLoaded] = useState(false);
  if (!location) return null;

  // Mensagens enviadas pela loja sem nome/endereço no webhook usam a localização
  // oficial configurada no tenant.
  const useStore = isOutbound && storeLocation;
  const name = location.name || (useStore ? storeLocation.name : '') || '';
  const address = location.address || (useStore ? storeLocation.address : '') || '';
  let latitude = toCoordinate(location.latitude);
  let longitude = toCoordinate(location.longitude);
  if (latitude == null && longitude == null && useStore) {
    latitude = toCoordinate(storeLocation.latitude);
    longitude = toCoordinate(storeLocation.longitude);
  }

  const { hasCoords, embedUrl, openUrl } = buildLocationMapUrls({ latitude, longitude, address, url: location.url });
  const coordsLabel = hasCoords ? formatCoordinates(latitude, longitude) : '';

  const isLiveLocation = Boolean(
    location.isLive
    || location.isLiveLocation
    || /tempo real|\blive\b/i.test(name),
  );
  const title = name || (isLiveLocation ? 'Localização em tempo real' : 'Localização compartilhada');
  const subtitle = address || coordsLabel;

  return (
    <div className={`location-media-message ${embedUrl ? 'has-map' : 'no-map'}`}>
      {embedUrl ? (
        <a
          className={`location-map-container ${mapLoaded ? 'is-loaded' : ''}`}
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir ${title} no Google Maps`}
        >
          <iframe
            className="location-map-frame"
            src={embedUrl}
            title={`Mapa: ${title}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            tabIndex={-1}
            onLoad={() => {
              setMapLoaded(true);
              onLocationLoad?.();
            }}
          />
          {isLiveLocation && (
            <span className="location-live-badge">
              <span className="location-live-dot" aria-hidden="true" />
              Ao vivo
            </span>
          )}
          <span className="location-map-open-hint" aria-hidden="true">
            <ExternalLink size={13} /> Abrir no Maps
          </span>
        </a>
      ) : (
        <div className="location-map-missing">
          <MapPinOff size={18} aria-hidden="true" />
          <span>
            {isLiveLocation
              ? 'Localização em tempo real sem coordenadas disponíveis no momento.'
              : 'O canal não enviou coordenadas nem endereço desta localização.'}
          </span>
        </div>
      )}

      <div className="location-info-section">
        <div className="location-text-block">
          <span className="location-title" title={title}>
            <MapPin size={13} aria-hidden="true" />
            {title}
          </span>
          {subtitle && <span className="location-subtitle" title={subtitle}>{subtitle}</span>}
        </div>
        <div className="location-footer-row">
          {openUrl ? (
            <a className="location-action-link" href={openUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} aria-hidden="true" />
              <span>Abrir no Google Maps</span>
            </a>
          ) : (
            <span className="location-action-spacer" />
          )}
          {meta && <MediaMeta meta={meta} />}
        </div>
      </div>
    </div>
  );
}
