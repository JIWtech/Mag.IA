import React from 'react';
import { Bot, ChevronDown, UserRound } from 'lucide-react';
import {
  isMediaPlaceholderForKind,
  isTechnicalMediaPlaceholder,
  normalizeTechnicalMediaPlaceholder,
} from '../../../utils/audioUtils.js';
import {
  consecutiveImageGallery,
  resolveVisualMediaCaption,
} from '../utils/mediaPresentation.js';
import { AudioRecoveryNotice } from './AudioRecoveryNotice.jsx';
import { LocationAttachment } from './LocationAttachment.jsx';
import { MediaAttachment } from './MediaAttachment.jsx';
import { MediaMeta } from './MediaMeta.jsx';
import { TranscribedAudioCard } from './TranscribedAudioCard.jsx';

function ConversationTimelineComponent({
  groupedMessages = [],
  messageStreamRef,
  messagesEndRef,
  onRetryAudioMedia,
  scrollToLatest,
  isScrolledUp = false,
  storeLocation = null,
}) {
  return (
    <div className="message-stream" ref={messageStreamRef}>
      <div className="message-stream-inner">
        {groupedMessages.map((message, index) => {
          const key = message.eventId
            ? `event-${message.eventId}`
            : `msg-${message.createdAt || message.at}-${message.senderType || 'contact'}-${index}`;

          if (message.isSystem) {
            return (
              <React.Fragment key={key}>
                {message.showDateSeparator && (
                  <div className="date-separator" role="separator" aria-label={`Data: ${message.dateSeparatorLabel}`}>
                    <span className="date-separator-pill">{message.dateSeparatorLabel}</span>
                  </div>
                )}
                <div className="system-event-row" role="status" aria-label={message.systemLabel}>
                  <div className="system-event-pill">
                    <span className="system-event-text">{message.systemLabel}</span>
                    <span className="system-event-time">· {message.formattedTime}</span>
                  </div>
                </div>
              </React.Fragment>
            );
          }

          const mediaKind = String(message.media?.kind || message.media?.category || '').toLowerCase();
          const isVisualMedia = ['image', 'video', 'sticker'].includes(mediaKind);
          const isSticker = mediaKind === 'sticker';
          const visualCaption = isVisualMedia ? resolveVisualMediaCaption(message.media, message.text) : '';
          const mediaMeta = isVisualMedia ? { time: message.formattedTime, showChecks: message.isAi || message.isAgent } : null;
          const imageGallery = isVisualMedia ? consecutiveImageGallery(groupedMessages, index) : null;
          const senderClass = message.isAi ? 'ai' : message.isAgent ? 'agent' : 'contact';

          const trimmedText = String(message.text || '').trim().toLowerCase();
          const isLocPlaceholder = ['[location]', 'location', '[localização]', '[localizacao]', '[livelocation]', 'livelocation'].includes(trimmedText);
          const locationData = message.location || (isLocPlaceholder ? { isLive: trimmedText.includes('live') } : null);
          const isLocationMedia = Boolean(locationData);
          const locationMeta = isLocationMedia ? { time: message.formattedTime, showChecks: message.isAi || message.isAgent } : null;

          const bubbleClasses = [
            'bubble',
            senderClass,
            `pos-${message.groupPosition}`,
            message.isGroupStart ? 'is-group-start' : '',
            message.isGroupEnd ? 'is-group-end' : '',
            isSticker ? 'is-sticker' : '',
            isVisualMedia ? 'has-visual-media' : '',
            isLocationMedia ? 'has-visual-media is-location-bubble' : '',
          ].filter(Boolean).join(' ');

          return (
            <React.Fragment key={key}>
              {message.showDateSeparator && (
                <div className="date-separator" role="separator" aria-label={`Data: ${message.dateSeparatorLabel}`}>
                  <span className="date-separator-pill">{message.dateSeparatorLabel}</span>
                </div>
              )}
              <div className={bubbleClasses}>
                {message.isGroupStart && (
                  <div className="bubble-sender">
                    {message.isAi && <Bot size={13} aria-hidden="true" />}
                    {message.isAgent && <UserRound size={13} aria-hidden="true" />}
                    <span>{message.senderLabel}</span>
                  </div>
                )}
                {message.media && (
                  <MediaAttachment
                    media={message.media}
                    audioTranscription={message.audioTranscription}
                    onMediaLoad={scrollToLatest}
                    onRetry={() => onRetryAudioMedia?.(message)}
                    caption={visualCaption}
                    meta={mediaMeta}
                    gallery={imageGallery}
                  />
                )}
                {!message.media && message.audioTranscription && (
                  <TranscribedAudioCard transcription={message.audioTranscription} />
                )}
                {!message.media && !message.audioTranscription && isMediaPlaceholderForKind(message.text, 'audio') && (
                  <AudioRecoveryNotice state="missing_source" />
                )}
                {locationData && (
                  <LocationAttachment
                    location={locationData}
                    meta={locationMeta}
                    onLocationLoad={scrollToLatest}
                    storeLocation={storeLocation}
                    isOutbound={message.isAgent || message.isAi}
                  />
                )}
                {(() => {
                  if (!message.text) return null;
                  if (isVisualMedia) return null;
                  if (!message.media && isMediaPlaceholderForKind(message.text, 'audio')) {
                    return null;
                  }
                  if (message.media && isTechnicalMediaPlaceholder(message.text, message.media)) {
                    return null;
                  }
                  if (isLocationMedia && [
                    '[location]',
                    'location',
                    '[localização]',
                    '[localizacao]',
                    '[livelocation]',
                    'livelocation',
                  ].includes(trimmedText)) {
                    return null;
                  }
                  const displayText = normalizeTechnicalMediaPlaceholder(message.text);
                  if (!displayText) return null;
                  return <p className="bubble-text">{displayText}</p>;
                })()}
                {!isVisualMedia && !isLocationMedia && (
                  <MediaMeta meta={{ time: message.formattedTime, showChecks: message.isAi || message.isAgent }} />
                )}
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {isScrolledUp && (
        <button
          type="button"
          className="timeline-scroll-bottom-btn"
          onClick={() => scrollToLatest(true)}
          aria-label="Rolar para as mensagens mais recentes"
        >
          <ChevronDown size={14} aria-hidden="true" />
          <span>Mais recentes</span>
        </button>
      )}
    </div>
  );
}

export const ConversationTimeline = React.memo(ConversationTimelineComponent);
