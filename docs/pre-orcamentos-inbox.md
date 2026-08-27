# Dados históricos de pré-orçamentos

> **Documento histórico (não-normativo).** Registro de execução/análise concluída, mantido como evidência; nenhum comando aqui é política executável atual. Fontes normativas: [`AGENTS.md`](../AGENTS.md) e [`docs/release-lanes.md`](./release-lanes.md).

A tela de Pré-orçamentos e os endpoints de ingestão e fila foram removidos do dashboard.

A tabela `quote_leads` permanece para preservar histórico, vínculos de CRM, conversas WhatsApp e conversão de orçamentos já existentes.

O Aspen não fornece uma Inbox de atendimento. A extensão contextual em `extensions/whatsapp-context/` consulta vínculos comerciais no WhatsApp Web; os módulos PostgreSQL permanecem preservados para envio, entrega, CRM e histórico.

A captura Typebot não faz parte do runtime atual e não existe webhook ativo neste aplicativo.

Não há migração destrutiva nem remoção de dados nesta fase.
