# Fundação de dados do Escarlate CRM

Esta branch preserva o site atual e prepara a camada de dados persistente.

## Banco gratuito
1. Crie um projeto no Supabase (plano Free).
2. Abra **SQL Editor** e execute o conteúdo de `supabase/schema.sql`.
3. Em **Project Settings → API**, copie a Project URL e a chave `service_role`.
4. Configure essas duas variáveis somente no servidor Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

**Nunca** coloque `service_role` em variável `NEXT_PUBLIC_*`, no navegador ou em arquivos versionados.

## Modelo
- `leads`: cadastro permanente, etapa comercial, observações, origem e dados públicos do negócio.
- `search_jobs`: histórico e estado das pesquisas automáticas.
- Índices únicos evitam duplicação por telefone normalizado ou URL do Google Maps.

## Próximas etapas
- Conectar a tela atual às rotas server-side e preservar importação/exportação CSV.
- Proteger o serviço de captura e conectá-lo ao mesmo banco.
- Executar testes de build e fluxo antes de abrir/mesclar o pull request.

O plano gratuito tem limites e pode pausar projetos inativos. Não é uma garantia de armazenamento ilimitado ou disponibilidade contínua.
