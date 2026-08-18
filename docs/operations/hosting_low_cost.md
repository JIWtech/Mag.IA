# Hospedagem de baixo custo - primeiros 10 clientes

Atualizado em: 2026-07-28

## Objetivo

Hospedar a Mag.IA com custo minimo, mas sem criar uma arquitetura descartavel.

## Recomendacao para os 10 primeiros clientes

```text
Frontend: Render Static Site ou equivalente gratuito/barato
Banco/Auth: Supabase Pro compartilhado
n8n: VPS self-hosted
Redis: mesmo servidor inicialmente ou gerenciado barato
Canal Telegram: API oficial sem custo por mensagem
WhatsApp: Evolution apenas quando cliente contratar
IA: Gemini/OpenAI com limite por tenant
```

## Custo mensal estimado

Premissa aproximada:

```text
USD 1 ~= R$5,10
EUR 1 ~= R$5,80
```

### Base compartilhada

```text
Supabase Pro: US$25/mes ~= R$128/mes
VPS n8n + Redis inicial: R$80 a R$250/mes
Backups/monitoramento basico: R$30 a R$100/mes
Frontend estatico: R$0 a R$50/mes
Dominio/Cloudflare: dominio anual + Cloudflare free
```

Total base provavel:

```text
R$238 a R$528/mes
```

Diluido em 10 clientes:

```text
R$24 a R$53 por cliente antes de IA/canais pagos
```

### Variavel por cliente

```text
Telegram: R$0
IA texto pequena: R$10 a R$100/mes
Storage/logs: R$5 a R$30/mes
WhatsApp Evolution: R$20 a R$100/mes quando houver
```

## Por que nao n8n Cloud agora

O n8n Cloud e bom para validar, mas cobra por execucao. Atendimento conversacional pode gerar muitas execucoes por mensagem/automacao.

Para 10 clientes, self-hosted tende a ser mais economico se aceitarmos a operacao.

## Quando subir nivel

Migrar para infra mais robusta quando houver:

- 10+ clientes ativos;
- 20k+ mensagens/mes;
- SLA comercial;
- clientes pagando planos maiores;
- necessidade de backups e logs com retencao formal;
- mais de um canal por cliente.

## Fontes oficiais consultadas

- Supabase Pricing: https://supabase.com/pricing
- n8n Pricing: https://n8n.io/pricing/
- Render Pricing: https://render.com/pricing
- Render Static Sites: https://render.com/docs/static-sites
- Railway Pricing: https://railway.com/pricing
