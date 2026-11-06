# Configuração do Escarlate 2.0

Tudo foi preparado usando serviços com plano gratuito. Os provedores podem impor limites, dormir por inatividade ou alterar suas regras; não há garantia de disponibilidade ilimitada.

## 1. Supabase (banco persistente)
1. Crie um projeto no Supabase no plano Free.
2. Abra **SQL Editor** e execute `supabase/schema.sql`.
3. Em **Project Settings → API**, copie a Project URL e a chave `service_role`.
4. Guarde esses valores para configurar as variáveis de ambiente.

## 2. Render (captura automática)
1. No Render, escolha **New → Blueprint** e conecte este repositório.
2. O Render encontrará `render.yaml` e criará o serviço gratuito `escarlate-capture`.
3. Nas variáveis de ambiente do serviço, configure:
   - `SUPABASE_URL`: Project URL do Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave service_role do Supabase.
   - `SCRAPER_API_TOKEN`: crie uma senha longa aleatória e guarde-a.
4. Aguarde o deploy ficar **Live** e copie a URL pública do serviço.

## 3. Vercel (site e CRM)
No projeto Vercel que publica o Escarlate, configure:
- `SUPABASE_URL`: mesma Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: mesma chave service_role.
- `SCRAPER_SERVICE_URL`: URL pública do serviço Render, sem barra no final.
- `SCRAPER_API_TOKEN`: exatamente o mesmo token configurado no Render.
- `CRM_ACCESS_USER`: usuário para proteger o CRM.
- `CRM_ACCESS_PASSWORD`: senha forte para abrir o CRM.

Depois, faça um novo deploy. O site usa autenticação HTTP Basic; o navegador mostrará uma caixa de usuário e senha. Sem as duas variáveis de acesso, o app fica bloqueado com erro 503 (fail-closed).

## 4. Segurança
- Nunca publique a chave `service_role` nem o token de captura no GitHub.
- Nunca use prefixo `NEXT_PUBLIC_` nessas variáveis.
- A chave de banco fica apenas no servidor; as rotas do Next.js são protegidas pela autenticação.
- A API de captura exige Bearer token e não fica aberta ao público.

## 5. Limites da captura
A pesquisa navega resultados públicos do Google Maps. A interface pode mudar e o Google pode apresentar CAPTCHA, bloqueio ou nenhum resultado. O sistema não tenta contornar essas barreiras. Use a captura de forma moderada e confira os dados antes de contatar empresas.

## 6. Teste
1. Abra `/prospeccao`.
2. Pesquise uma categoria e uma cidade com limite pequeno.
3. Aguarde a conclusão e confira os leads.
4. Altere a etapa e uma observação; atualize a página para confirmar a persistência.
5. Exporte os dados quando necessário (a exportação CSV do painel antigo continua disponível).
