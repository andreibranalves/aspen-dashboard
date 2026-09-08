# Evidências — Configurações

Bloco D validado em 08/09/2026 com APIs mockadas e sem gravação externa. A composição usa as cinco abas previstas: Padrões, Modelos de documento, Fluxos WhatsApp, Empresa e Canais.

## Temas e larguras

| Estado         | 1440×900                          | 1280×800                          | 1024×800                          | 390×844                          |
| -------------- | --------------------------------- | --------------------------------- | --------------------------------- | -------------------------------- |
| Padrões claro  | [PNG](padroes-light-1440x900.png) | [PNG](padroes-light-1280x800.png) | [PNG](padroes-light-1024x800.png) | [PNG](padroes-light-390x844.png) |
| Padrões escuro | [PNG](padroes-dark-1440x900.png)  | [PNG](padroes-dark-1280x800.png)  | [PNG](padroes-dark-1024x800.png)  | [PNG](padroes-dark-390x844.png)  |

## Abas e estados

- [Modelos — prévia](modelos-dark-1440x900.png) inicia em prévia e mantém edição avançada explícita.
- [Fluxos — três colunas](fluxos-dark-1440x900.png) separa lista, edição e prévia da etapa ativa.
- [Empresa](empresa-dark-1440x900.png) mantém somente os seis campos existentes.
- [Canais](canais-dark-1440x900.png) exibe “Estado não consultado”; detalhes técnicos começam recolhidos e não mostram valores secretos.
- [Foco](foco-dark-1440x900.png) cobre foco visível no formulário.
- [Confirmação](confirmacao-escape-dark-1440x900.png) cobre proteção de alterações pendentes; Escape fecha o diálogo.
- [Vazio](vazio-fluxos-dark-1440x900.png) cobre fluxo sem registros.
- [Erro](erro-configuracoes-dark-1440x900.png) cobre falha segura de carregamento e retry.

Validação executada: `tests/settings-evidence.spec.js` 1/1; o conjunto focado `tests/settings.spec.js tests/settings-evidence.spec.js tests/ui-v2-settings-login-notfound.spec.js tests/communication-ui-v2.spec.js tests/communication-email-settings.spec.js --project=chromium --workers=1` passou 16/16 com APIs mockadas, `DOTENV_CONFIG_PATH=/dev/null` e `PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright`.

Limitação preexistente: no servidor Vite de desenvolvimento, `vite.config.js` aponta `publicDir: static` sem esse diretório, então o logo expandido não é servido e as capturas exibem o texto alternativo; nenhum arquivo em `public/` foi alterado.
