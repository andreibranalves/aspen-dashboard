# Manifesto de Descarte da Migração Frappe

**Status:** Aprovado para implementação pelo usuário em 2026-08-09.

## Contexto

O snapshot anonimizado possui divergências de identidade e financeiras que bloqueiam o apply fail-closed.

O usuário aprovou uma migração parcial e não exige 100% dos dados históricos.

O descarte deve ser explícito, reproduzível, auditável e limitado ao snapshot da migração.

O Frappe não será alterado ou apagado por este fluxo.

## Escopo aprovado

Descartar todos os blockers do snapshot atual.

O escopo observado contém 46 grupos de identidade ambígua, 5 unidades de produto/faixa ambíguas e 162 cotações na closure de dependências.

A closure inclui qualquer cotação com cliente descartado, produto descartado ou valor financeiro inválido.

A closure é maior que a lista direta do report porque o dry-run interrompe algumas validações depois de encontrar um cliente ausente.

A expectativa atual é preservar 56 produtos, 470 unidades locais de cliente e 513 das 675 cotações.

Essas contagens são verificadas novamente contra o snapshot e nunca são codificadas como constantes de produção.

## Não objetivos

Não apagar leads ou cotações no Frappe.

Não usar `--approve-divergence` como sinônimo de descarte.

Não filtrar manualmente a fixture sem registrar os registros removidos.

Não permitir cotações que referenciem produto ou cliente excluído.

## Manifesto

Adicionar um manifesto protegido de descarte com `schemaVersion` explícito.

O manifesto deve conter o hash do manifest do snapshot, o checksum do dry-run que o originou e a política de descarte aprovada.

Cada exclusão deve conter uma chave de origem opaca, razão, entidade dependente e origem da decisão.

O manifesto deve registrar as chaves raiz e a closure calculada, não apenas contagens agregadas.

O arquivo deve permanecer fora do checkout com modo `0600`.

Manifesto desconhecido, incompleto, alterado ou associado a outro snapshot deve falhar antes de qualquer write.

## Closure de dependências

Um grupo de cliente descartado exclui todas as cotações que apontam para qualquer membro do grupo.

Um produto ou faixa descartado exclui todas as cotações que usam o SKU afetado.

Uma cotação com preço sugerido, aplicado, quantidade ou total de linha inválido é excluída.

A closure deve ser determinística e validada contra o dataset atual.

Qualquer blocker fora do manifesto mantém o apply bloqueado.

## Execução

O dry-run aceita o manifesto e produz o conjunto exato de writes e exclusões.

O apply exige o mesmo manifesto, o hash esperado e o contrato do banco `aspen_test`.

A validação completa ocorre antes do primeiro write de produto, cliente ou cotação.

O relatório deve separar `criados`, `atualizados`, `ignorados`, `excluidos`, `divergentes` e `erros`.

Cada exclusão deve permanecer no report com razão e chave de origem.

O status só pode ser `completed` quando não houver blocker não descartado.

Sem manifesto, o comportamento atual fail-closed permanece.

## Reconciliação

A reconciliação compara o target apenas com unidades graváveis.

Ela também exige igualdade exata entre a closure calculada e a closure registrada no manifesto.

Ela deve rejeitar órfãos, lineage de unidades excluídas, blockers não listados e alteração de snapshot.

O report de apply, manifesto e reconciliação recebem checksums fora do checkout.

## Testes

Adicionar teste para manifesto válido excluir dependências sem escrever unidades excluídas.

Adicionar teste para hash de snapshot divergente falhar antes de abrir o repository.

Adicionar teste para chave desconhecida ou closure incompleta falhar antes de escrever.

Adicionar teste para cotações que usam produto descartado serem excluídas mesmo sem divergence direta.

Adicionar teste para apply sem manifesto continuar bloqueado.

Adicionar teste de reconciliação para contagens graváveis e closure de exclusões.

Garantir que report e erros não revelem PII, tokens ou payloads HTTP.

## Evidência de aceitação

O snapshot final deve ser reanonimizado após qualquer mudança na origem.

O dry-run final deve produzir zero blockers não descartados e zero erros.

O apply deve produzir apenas o subconjunto aprovado e reconciliado.

Nenhum write deve ocorrer no Frappe.

Canário, E2E, backup, restore e rollback continuam condicionados ao apply e à reconciliação bem-sucedidos.
