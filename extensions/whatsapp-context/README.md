# Extensão Aspen — contexto comercial no WhatsApp Web

Extensão interna Chromium/Chrome que mostra o contexto comercial do Aspen ao lado de uma conversa individual no WhatsApp Web.

## Escopo da primeira versão

- identifica apenas o contato visível da conversa ativa;
- usa telefone como candidato de consulta, nunca como chave primária de conversa;
- mostra match de cliente/lead, não encontrado, ambíguo ou não suportado;
- abre o cadastro existente ou o novo cadastro pré-preenchido;
- não lê o histórico completo de mensagens;
- não envia mensagens;
- não altera o WhatsApp Web.

## Instalação local

1. Confirme o domínio do Aspen em `config.js` e em `manifest.json`.
2. Configure no servidor o domínio/origem da extensão em `WHATSAPP_CONTEXT_EXTENSION_ORIGIN`.
3. Abra `chrome://extensions`.
4. Ative o modo desenvolvedor.
5. Use **Carregar sem compactação** e selecione este diretório.
6. Faça login no Aspen na mesma instalação/ambiente configurado.
7. Abra uma conversa individual em `web.whatsapp.com`.

A extensão não contém credenciais permanentes. As consultas dependem da sessão autenticada do Aspen e do endpoint protegido de contexto comercial.
