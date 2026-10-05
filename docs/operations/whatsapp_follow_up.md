# Follow-up global do WhatsApp

O fluxo compartilhado usa a politica de cada tenant para criar jobs com 3 horas,
24 horas e 15 dias. Ele busca o `system_prompt` e o modelo ativos no
`tenant_settings.settings` quando envia cada mensagem.

## Publicacao

1. Execute `supabase/migrations/019_follow_up_jobs.sql` no SQL Editor.
2. Execute `supabase/migrations/020_nubia_follow_up_kanban.sql` no SQL Editor.
   Ela cria a coluna **Follow Ups** apenas no board da `clinica_nubia_oficial`.
3. Execute `supabase/migrations/021_follow_up_cancel_on_appointment.sql` no SQL Editor.
   Ela bloqueia e cancela follow-ups para agendamentos e pré-agendamentos futuros.
4. Faça deploy da versão atualizada do painel.
5. Importe `n8n/workflows/magia_whatsapp_follow_up.json` no n8n e ative-o.
6. Publique a versão atualizada de `magia_whatsapp_evolution_mvp.json`.
7. Habilite somente os tenants aprovados:

```sql
update public.follow_up_policies p
set enabled = true, updated_at = now()
from public.tenants t
where t.id = p.tenant_id
  and t.slug = 'clinica_nubia_oficial'
  and p.channel_type = 'whatsapp'
  and p.name = 'Sequencia padrao';
```

As politicas sao criadas desativadas. Cada tenant precisa de aprovacao antes de
iniciar contatos proativos.

## Regras operacionais

- Uma resposta elegivel da IA cria jobs para 3h, 24h e 15d.
- Resposta do cliente, handoff humano ou encerramento cancelam jobs pendentes.
- Cada job recebe uma lease de cinco minutos; duas execucoes nao enviam o mesmo
  follow-up.
- Erro de entrega apos tentativa de envio fica como `uncertain` e exige revisao.
- Agendamentos, pagamento de sinal, conversa encerrada e atendimento humano nao
  criam follow-up.
- Um agendamento ou pré-agendamento futuro cancela os jobs pendentes. O n8n
  verifica isso novamente antes de cada envio.
- No painel da Clínica da Núbia, a coluna **Follow Ups** mostra um card por
  conversa e a próxima etapa ativa: `3h`, `1 dia` ou `15 dias`.
