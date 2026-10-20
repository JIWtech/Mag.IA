# Follow Ups no Kanban da Genesis

## Escopo

Esta correcao habilita a mesma coluna operacional `Follow Ups` utilizada pela NB Bronze. Nao cria novas etapas comerciais: o lead conserva sua etapa e ganha um card operacional com a proxima retomada pendente ou em processamento (3h, 1 dia ou 15 dias).

O frontend anteriormente consultava e exibia esses jobs apenas para `clinica_nubia_oficial`. Alem disso, a permissao de leitura do banco e a coluna precisavam ser habilitadas para Genesis.

## Aplicacao

1. No SQL Editor do mesmo projeto Supabase, executar `clients/wesley_automoveis/16_kanban_follow_up.sql`. O script e reexecutavel e modifica apenas a coluna da Genesis e sua permissao de leitura para membros ativos.
2. Publicar o frontend atualizado de `prod` pelo processo habitual do app no Easypanel. Nao alterar variaveis de ambiente.
3. Atualizar o navegador e abrir o Kanban da Genesis. A coluna `Follow Ups` fica apos as etapas comerciais existentes.

Nao republicar nenhum workflow ou no n8n. Nao reexecutar a ativacao dos envios. Nao alterar os intervalos, textos, contatos excluidos ou estados dos leads.

## Validacao

- Um contato com varios jobs ativos aparece apenas uma vez na coluna, com a proxima etapa; um job em processamento tem prioridade.
- Apos o envio de 3h, passa a aparecer o job de 24h quando os dados do painel forem recarregados. Apos 24h, aparece o de 15 dias.
- Jobs enviados, cancelados, com falha ou incertos nao aparecem como pendentes. A coluna nao e um historico de envios.
- Se todos os jobs terminaram, a coluna fica vazia. Nao criar novos envios para preencher o Kanban.
- Os cards comerciais, os envios e o Kanban da NB Bronze permanecem preservados.
- Membros da Genesis nao recebem acesso aos jobs de outros tenants.

Para conferir os jobs ativos sem expor telefones:

```sql
select j.step_key,j.status,count(*)
from public.follow_up_jobs j join public.tenants t on t.id=j.tenant_id
where t.slug='wesley_automoveis' and j.status in ('pending','processing')
group by j.step_key,j.status;
```
