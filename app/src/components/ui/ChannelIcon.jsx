import React from 'react';
import { Instagram, Send, Globe } from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';

export function ChannelIcon({ channel, size = 14 }) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('insta')) {
    return <Instagram size={size} />;
  }
  if (type.includes('whats') || type.includes('zap')) {
    return <SiWhatsapp size={size} aria-hidden="true" />;
  }
  if (type.includes('telegram')) {
    return <Send size={size} />;
  }
  return <Globe size={size} />;
}

export function getChannelClass(channel) {
  const type = String(channel || '').toLowerCase();
  if (type.includes('whats') || type.includes('zap')) return 'channel-whatsapp';
  if (type.includes('insta')) return 'channel-instagram';
  if (type.includes('telegram')) return 'channel-telegram';
  return 'channel-webchat';
}
