import React from 'react';
import { Bot, UserRound } from 'lucide-react';
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

export function ConversationTimeline({
  groupedMessages = [],
  messageStreamRef,
  messagesEndRef,
  onRetryAudioMedia,
  scrollToLatest,
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
          const imageGallery = ['image', 'sticker'].includes(mediaKind) ? consecutiveImageGallery(groupedMessages, index) : null;
          const senderClass = message.isAi ? 'ai' : message.isAgent ? 'agent' : 'contact';
          const bubbleClasses = [
            'bubble',
            senderClass,
            `pos-${message.groupPosition}`,
            message.isGroupStart ? 'is-group-start' : '',
            message.isGroupEnd ? 'is-group-end' : '',
            isSticker ? 'is-sticker' : '',
            isVisualMedia ? 'has-visual-media' : '',
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
                    {message.isAi && <Bot size={12} aria-hidden="true" />}
                    {message.isAgent && <UserRound size={12} aria-hidden="true" />}
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
                {(() => {
                  const loc = message.location || (
                    (message.text && ['[location]', 'location', '[localização]', '[localizacao]'].includes(message.text.trim().toLowerCase()))
                      ? { isResolving: true }
                      : null
                  );
                  return loc ? <LocationAttachment location={loc} /> : null;
                })()}
                {(() => {
                  if (!message.text) return null;
                  if (isVisualMedia) return null;
                  if (!message.media && isMediaPlaceholderForKind(message.text, 'audio')) {
                    return null;
                  }
                  if (message.media && isTechnicalMediaPlaceholder(message.text, message.media)) {
                    return null;
                  }
                  const trimmed = message.text.trim().toLowerCase();
                  if ((message.location || ['[location]', 'location', '[localização]', '[localizacao]'].includes(trimmed)) && (
                    trimmed === '[location]' ||
                    trimmed === 'location' ||
                    trimmed === '[localização]' ||
                    trimmed === '[localizacao]'
                  )) {
                    return null;
                  }
                  const displayText = normalizeTechnicalMediaPlaceholder(message.text);
                  if (!displayText) return null;
                  return <p className="bubble-text">{displayText}</p>;
                })()}
                {!isVisualMedia && <MediaMeta meta={{ time: message.formattedTime, showChecks: message.isAi || message.isAgent }} />}
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
