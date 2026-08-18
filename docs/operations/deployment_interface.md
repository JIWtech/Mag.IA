# Deploy da interface Mag.IA

## Estado atual

Ainda nao vamos hospedar definitivamente. A interface esta preparada para deploy estatico.

## Build

```powershell
cd magia/app
npm install
npm run build
```

Saida:

```text
magia/app/dist
```

## Variaveis necessarias

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_N8N_BASE_URL=
VITE_TENANT_SLUG=jiw
```

Sem Supabase configurado, a interface usa dados mockados.
Com Supabase configurado, a interface busca `channel_events` do tenant `jiw`.

## Render Static Site

Arquivo preparado:

```text
infra/render/render.yaml
```

Config recomendada:

```text
Root directory: magia/app
Build command: npm install && npm run build
Publish directory: dist
```

## Observacao

Frontend estatico nao deve conter service role key do Supabase.
Usar apenas anon key com RLS configurado.
