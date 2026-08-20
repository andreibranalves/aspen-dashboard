# `api/_shared`

Estas regras complementam o `AGENTS.md` da raiz para autenticação, rate limiting, erros e helpers neutros de domínio.

- Mantenha handlers de endpoints, regras de negócio e escritas no banco fora deste diretório.
- Mantenha os contratos HTTP e adapters de transporte em `api/_http/`.
- Configuração de autenticação deve falhar de forma fechada quando valores obrigatórios estiverem ausentes.
- Cookies de sessão devem conter apenas identificadores assinados, nunca senhas ou segredos.
- Não adicione autenticação alternativa por headers.
- Não registre cookies, headers de autorização, connection strings ou dados pessoais.
- Trate rate limiting como proteção complementar e aplique limites de negócio nos repositórios.
