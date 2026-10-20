import React, { useState } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { MediaMeta } from './MediaMeta.jsx';
import { formatCoordinates } from '../../../utils/audioUtils.js';

/**
 * Calcula a URL do tile raster do OpenStreetMap para o zoom especificado (padrão 15).
 */
function getOsmTileUrl(lat, lng, zoom = 15) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, Number(lat)));
  const clampedLng = Math.max(-180, Math.min(180, Number(lng)));
  const x = Math.floor(((clampedLng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function LocationAttachment({
  location,
  meta = null,
  onLocationLoad = null,
  storeLocation = null,
  isOutbound = false,
}) {
  if (!location) return null;
  const { name, address, latitude, longitude, url } = location;

  const [mapError, setMapError] = useState(false);

  // Se a mensagem partiu da loja/atendente e não trouxe nome/endereço no webhook,
  // enriquece com a localização oficial e verificada do tenant (ex: Genesis Automóveis)
  const effectiveName = name || (isOutbound && storeLocation?.name ? storeLocation.name : '');
  const effectiveAddress = address || (isOutbound && storeLocation?.address ? storeLocation.address : '');

  // Coordenadas: se vieram no payload usa; se for outbound e o endereço da loja for conhecido,
  // resolve as coordenadas correspondentes da sede para renderizar o mapa real
  let parsedLat = latitude != null && !isNaN(parseFloat(latitude)) ? parseFloat(latitude) : null;
  let parsedLng = longitude != null && !isNaN(parseFloat(longitude)) ? parseFloat(longitude) : null;

  if (parsedLat == null && parsedLng == null && isOutbound) {
    if (storeLocation?.latitude && storeLocation?.longitude) {
      parsedLat = parseFloat(storeLocation.latitude);
      parsedLng = parseFloat(storeLocation.longitude);
    } else if (
      effectiveAddress.toLowerCase().includes('itapemirim')
      || effectiveAddress.toLowerCase().includes('nova iguaçu')
      || effectiveAddress.toLowerCase().includes('nova iguacu')
    ) {
      // Coordenadas de referência para a Av. Itapemirim 747, Boa Esperança, Nova Iguaçu - RJ
      parsedLat = -22.7533;
      parsedLng = -43.4357;
    }
  }

  const hasCoords = parsedLat != null && parsedLng != null && (parsedLat !== 0 || parsedLng !== 0);
  const coordsFormatted = hasCoords ? formatCoordinates(parsedLat, parsedLng) : '';

  const mapsUrl = url || (hasCoords
    ? `https://www.google.com/maps?q=${parsedLat},${parsedLng}`
    : (effectiveAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(effectiveAddress)}` : ''));

  const tileUrl = location.thumbnailUrl || location.previewUrl || (hasCoords ? getOsmTileUrl(parsedLat, parsedLng, 15) : null);

  const isLiveLocation = Boolean(
    location.isLive
    || location.isLiveLocation
    || String(effectiveName || '').toLowerCase().includes('tempo real')
    || String(effectiveName || '').toLowerCase().includes('live')
  );

  const displayTitle = effectiveName || (isLiveLocation ? 'Localização em tempo real' : 'Localização compartilhada');
  const subtitle = effectiveAddress || coordsFormatted || (isLiveLocation ? 'Localização em tempo real' : '');

  return (
    <div className="location-media-message">
      {/* Container do Preview de Mapa Real */}
      <a
        className="location-map-container"
        href={mapsUrl || '#'}
        target={mapsUrl ? '_blank' : undefined}
        rel="noopener noreferrer"
        onClick={!mapsUrl ? (e) => e.preventDefault() : undefined}
        aria-label={`Abrir mapa de ${displayTitle}`}
      >
        {tileUrl && !mapError ? (
          <div className="location-map-tile-wrap">
            <img
              src={tileUrl}
              alt={displayTitle}
              className="location-map-tile-img"
              loading="lazy"
              onLoad={() => onLocationLoad?.()}
              onError={() => setMapError(true)}
            />
          </div>
        ) : (
          <div className="location-map-fallback" aria-hidden="true">
            {/* Mapa rodoviário estilizado em SVG para visual dark autêntico de mapa */}
            <svg
              className="location-fallback-roads-svg"
              viewBox="0 0 320 140"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="320" height="140" fill="#141c27" />
              <path d="M-20 45 Q 90 70 170 35 T 340 55" stroke="#1c2635" strokeWidth="14" strokeLinecap="round" />
              <path d="M-20 45 Q 90 70 170 35 T 340 55" stroke="#263447" strokeWidth="6" strokeLinecap="round" />
              <path d="M60 -20 L 115 160" stroke="#1c2635" strokeWidth="12" strokeLinecap="round" />
              <path d="M60 -20 L 115 160" stroke="#263447" strokeWidth="5" strokeLinecap="round" />
              <path d="M225 -20 L 180 160" stroke="#1c2635" strokeWidth="12" strokeLinecap="round" />
              <path d="M225 -20 L 180 160" stroke="#263447" strokeWidth="5" strokeLinecap="round" />
              <path d="M-20 110 Q 140 85 340 120" stroke="#1c2635" strokeWidth="16" strokeLinecap="round" />
              <path d="M-20 110 Q 140 85 340 120" stroke="#263447" strokeWidth="7" strokeLinecap="round" />
              <path d="M170 35 L 180 110" stroke="#1c2635" strokeWidth="10" strokeLinecap="round" />
              <path d="M170 35 L 180 110" stroke="#263447" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Pin central discreto */}
        <div className="location-pin-marker" aria-hidden="true">
          <MapPin size={24} className="location-pin-icon" />
          <div className="location-pin-shadow" />
        </div>

        {/* Indicador de localização em tempo real */}
        {isLiveLocation && (
          <div className="location-live-badge" aria-label="Localização em tempo real">
            <span className="location-live-dot" />
            <span>Ao vivo</span>
          </div>
        )}
      </a>

      {/* Seção de informações (Abaixo do Mapa) */}
      <div className="location-info-section">
        <div className="location-text-block">
          <span className="location-title" title={displayTitle}>
            {displayTitle}
          </span>
          {subtitle && (
            <span className="location-subtitle" title={subtitle}>
              {subtitle}
            </span>
          )}
        </div>

        {/* Linha de rodapé com Ação + Metadados (timestamp) */}
        <div className="location-footer-row">
          {mapsUrl ? (
            <a
              className="location-action-link"
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
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
