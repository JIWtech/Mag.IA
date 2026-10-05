    // Opt-in only. Preserve the existing confirmation path for every other client.
    if (settings.whatsapp_processing_mode === 'conversation_core_v1') {
      if (normalizedChannel !== 'whatsapp') throw new Error('Canal incorreto para este agendamento');
      const { supabaseUrl } = supabaseConfig();
      const appointmentPath = supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenant.id)
        + '&id=eq.' + encodeURIComponent(appointmentId);
      const rows = await httpJson('GET', appointmentPath + '&select=*', serviceHeaders());
      const row = rows[0];
      if (!row || row.channel_type !== normalizedChannel || row.external_conversation_id !== externalConversationId) {
        throw new Error('Agendamento nao pertence a esta conversa/canal');
      }
      if (row.status === 'confirmed') return { ok: true, command, already_confirmed: true, appointment: row };
      if (row.status !== 'payment_reported') throw new Error('Aguardando cliente informar o sinal');
      if (row.metadata?.signal_confirmation_state) throw new Error('Confirmacao em andamento ou entrega incerta. Verifique antes de reenviar.');
      const claimedMetadata = { ...row.metadata, signal_confirmation_state: 'sending',
        signal_confirmation_command: commandId, payment_confirmed_by: user.id };
      const claimed = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported&updated_at=eq.'
        + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
      { metadata: claimedMetadata, updated_at: new Date().toISOString() });
      if (claimed.length !== 1) throw new Error('Agendamento alterado por outro operador. Atualize o quadro.');
      let sent;
      try {
        sent = await sendWhatsApp(evolution, externalConversationId, paymentSignalConfirmationMessage(settings));
        if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
      } catch (error) {
        await httpJson('PATCH', appointmentPath, serviceHeaders(), { metadata: {
          ...claimedMetadata, signal_confirmation_state: 'uncertain' }, updated_at: new Date().toISOString() });
        throw new Error('Entrega da confirmacao nao comprovada. Verifique no WhatsApp antes de tentar novamente.');
      }
      const updated = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported', serviceHeaders('return=representation'), {
        status: 'confirmed', updated_at: new Date().toISOString(), metadata: { ...claimedMetadata,
          signal_confirmation_state: 'sent', confirmation_message_id: sent.messageId,
          payment_status: 'confirmed_by_operator', payment_confirmed_at: new Date().toISOString() },
      });
      if (updated.length !== 1) throw new Error('Mensagem enviada, mas registro alterado simultaneamente. Verifique o agendamento antes de repetir.');
      const event = { tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
        external_conversation_id: externalConversationId, external_message_id: sent.messageId,
        direction: 'outbound', sender_type: 'system', contact_name: row.contact_name || 'Contato',
        message_text: paymentSignalConfirmationMessage(settings), service: 'appointment_payment_confirmed',
        stage: 'Agendamento confirmado', handoff: true, response_text: null, ai_provider: 'operator_confirmation',
        sent_by_user: user.email || user.id, delivery_status: 'sent', command_id: commandId,
        raw_payload: { command, appointment_id: appointmentId, confirmed_by: user.id, appointment: updated[0] } };
      const saved = await insertEvent(event);
      return { ok:true, command, appointment: updated[0], saved };
    }
