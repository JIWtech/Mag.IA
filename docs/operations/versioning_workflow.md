# Fluxo de Versionamento Mag.IA

Este documento define como o projeto Mag.IA deve ser versionado no GitHub.

Repositorio oficial:

```text
https://github.com/JIWtech/Mag.IA
```

## Branches oficiais

O projeto trabalha com duas branches principais:

```text
dev
prod
```

### dev

`dev` e a branch de desenvolvimento continuo.

Tudo que ainda esta sendo construido, corrigido ou validado deve entrar primeiro
em `dev`.

Use `dev` para:

- desenvolver novas funcionalidades;
- corrigir bugs;
- ajustar workflows n8n;
- alterar migrations e seeds do Supabase;
- evoluir a interface;
- testar novos tenants;
- validar integracoes com Telegram, Instagram, Gemini e Supabase;
- preparar documentacao operacional.

Nenhuma alteracao deve ir direto para `prod` sem antes passar por `dev`.

### prod

`prod` representa a versao aprovada para operacao real.

Essa branch deve conter apenas codigo, workflows, migrations e documentacao que
ja foram testados e aprovados coletivamente.

Use `prod` para:

- hospedar a interface de producao;
- servir como referencia da versao estavel;
- recuperar rapidamente o estado aprovado do produto;
- comparar mudancas novas antes de liberar para clientes.

Evite commits diretos em `prod`. O correto e promover uma versao ja validada de
`dev` para `prod`.

## Fluxo padrao de trabalho

O fluxo oficial e:

```text
dev -> testes -> aprovacao -> prod
```

Na pratica:

1. O desenvolvedor atualiza a branch `dev`.
2. A mudanca e testada localmente ou em ambiente de homologacao.
3. O time valida se a funcionalidade esta pronta.
4. A versao aprovada de `dev` e promovida para `prod`.
5. A hospedagem ou ambiente final usa a branch `prod`.

## Como iniciar trabalho local

Entre na pasta oficial:

```powershell
cd C:\Users\wever\Downloads\Setup-Avvento-Local\MagIA-Projeto-Oficial
```

Atualize a branch de desenvolvimento:

```powershell
git checkout dev
git pull origin dev
```

Depois faca as alteracoes normalmente.

## Como salvar uma alteracao em dev

Confira o que mudou:

```powershell
git status -sb
```

Revise os arquivos alterados antes de commitar:

```powershell
git diff
```

Adicione os arquivos do projeto:

```powershell
git add .
```

Crie o commit:

```powershell
git commit -m "Descricao curta da alteracao"
```

Envie para o GitHub:

```powershell
git push origin dev
```

## Checklist antes de aprovar uma versao

Antes de promover `dev` para `prod`, validar:

- a interface sobe sem erro;
- o build da interface passa;
- login funciona para o tenant testado;
- conversas aparecem corretamente;
- envio manual funciona pelo canal ativo;
- mensagens recebidas chegam no Supabase;
- mensagens enviadas pela interface tambem ficam salvas;
- Kanban/funil refletem os eventos esperados;
- workflows n8n alterados foram exportados e salvos em `n8n/workflows/`;
- migrations e seeds usados no Supabase foram salvos em `supabase/`;
- nenhum segredo real foi commitado.

Comando minimo para validar a interface:

```powershell
cd app
npm install
npm run build
```

## Como promover dev para prod

Depois de aprovado coletivamente:

```powershell
git checkout dev
git pull origin dev
git checkout prod
git pull origin prod
git merge dev
git push origin prod
```

Se `prod` deve ficar exatamente igual a `dev` em uma liberacao controlada:

```powershell
git checkout dev
git pull origin dev
git branch -f prod dev
git push origin prod
```

Use esse segundo caminho apenas quando a equipe tiver certeza de que a versao de
`dev` deve substituir a versao de `prod`.

## Regras de seguranca

Nunca commitar:

- `.env`;
- `app/.env.local`;
- tokens de bots;
- chaves Gemini;
- `SUPABASE_SERVICE_ROLE_KEY`;
- senhas de acesso;
- exports temporarios com credenciais;
- logs locais.

O projeto ja possui `.gitignore` para bloquear arquivos sensiveis comuns, mas a
responsabilidade final e de quem esta commitando.

Antes de commitar, se houver duvida, rode:

```powershell
git status -sb
```

E procure por arquivos suspeitos.

## Padrao de branches futuras

Quando o projeto crescer, novas funcionalidades podem ser desenvolvidas em
branches temporarias:

```text
feature/nome-da-funcionalidade
fix/nome-do-ajuste
hotfix/nome-do-problema
```

O fluxo continua o mesmo:

```text
feature/fix/hotfix -> dev -> testes -> prod
```

Para o momento atual do projeto, `dev` e `prod` sao suficientes.

