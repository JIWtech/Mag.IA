import React, { useState, useRef, useLayoutEffect } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Bot,
  BotOff,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Headset,
  Info,
  Send,
  UserCheck,
  UserRound,
} from 'lucide-react';
import {
  isMediaPlaceholderForKind,
  isTechnicalMediaPlaceholder,
  normalizeTechnicalMediaPlaceholder,
} from '../../../utils/audioUtils.js';
import {
  consecutiveImageGallery,
  resolveVisualMediaCaption,
  suppressUnrecoverableVisualMedia,
} from '../utils/mediaPresentation.js';
import { AudioRecoveryNotice } from './AudioRecoveryNotice.jsx';
import { LocationAttachment } from './LocationAttachment.jsx';
import { MediaAttachment } from './MediaAttachment.jsx';
import { MediaMeta } from './MediaMeta.jsx';
import { TranscribedAudioCard } from './TranscribedAudioCard.jsx';

const SYSTEM_EVENT_ICONS = {
  closed: CheckCircle2,
  assigned: UserCheck,
  ai_on: Bot,
  ai_off: BotOff,
  handoff: Headset,
  abandoned: Archive,
  stage: ArrowRightLeft,
  payment: CircleDollarSign,
  follow_up: Send,
  generic: Info,
};

function SystemEventRow({ message }) {
  const rawEvent = message.systemEvent || { kind: 'generic', title: message.systemLabel, detail: '' };
  // "Atualização do atendimento" is a placeholder: the detail already says what happened.
  const event = rawEvent.kind === 'generic' && rawEvent.detail
    ? { ...rawEvent, title: rawEvent.detail, detail: '' } : rawEvent;
  const Icon = SYSTEM_EVENT_ICONS[event.kind] || Info;
  const label = [event.title, event.detail, message.formattedTime].filter(Boolean).join(' · ');
  return (
    <div className={`system-event-row kind-${event.kind}`} role="status" aria-label={label}>
      <span className="system-event-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <div className="system-event-body">
        <span className="system-event-title">{event.title}</span>
        {event.detail && <span className="system-event-detail">{event.detail}</span>}
      </div>
      {message.formattedTime && <time className="system-event-time">{message.formattedTime}</time>}
    </div>
  );
}

function ConversationTimelineComponent({
  groupedMessages = [],
  messageStreamRef,
  messagesEndRef,
  onRetryAudioMedia,
  scrollToLatest,
  isScrolledUp = false,
  storeLocation = null,
}) {
  const [visibleLimit, setVisibleLimit] = useState(80);
  const previousScroll = useRef(null);
  useLayoutEffect(() => {
    const stream = messageStreamRef?.current;
    if (stream && previousScroll.current) {
      stream.scrollTop = previousScroll.current.top + stream.scrollHeight - previousScroll.current.height;
      previousScroll.current = null;
    }
  }, [visibleLimit, messageStreamRef]);
  const visibleMessages = groupedMessages.slice(-visibleLimit);
  return (
    <div className="message-stream" ref={messageStreamRef}>
      <div className="message-stream-inner">
        {groupedMessages.length > visibleLimit && (
          <button type="button" className="timeline-load-older" onClick={() => {
            const stream = messageStreamRef?.current;
            if (stream) previousScroll.current = { top: stream.scrollTop, height: stream.scrollHeight };
            setVisibleLimit(limit => limit + 80);
          }}>
            Mostrar mensagens anteriores
          </button>
        )}
        {visibleMessages.map((message, index) => {
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
                <SystemEventRow message={message} />
              </React.Fragment>
            );
          }

          const mediaKind = String(message.media?.kind || message.media?.category || '').toLowerCase();
          const isVisualMedia = ['image', 'video', 'sticker'].includes(mediaKind);
          const shouldSuppressMediaBubble = suppressUnrecoverableVisualMedia(message.media);
          const isSticker = mediaKind === 'sticker';
          const visualCaption = isVisualMedia ? resolveVisualMediaCaption(message.media, message.text) : '';
          const mediaMeta = isVisualMedia ? {
            time: message.formattedTime,
            showChecks: message.isAi || message.isAgent,
            createdAt: message.createdAt || null,
          } : null;
          const imageGallery = isVisualMedia ? consecutiveImageGallery(visibleMessages, index) : null;
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
              {!shouldSuppressMediaBubble && <div className={bubbleClasses}>
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
              </div>}
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
