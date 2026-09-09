# Consolidação de clientes

Operação CRITICAL, manual. Não cria migrations e não envia mensagens.

`node scripts/consolidate-clients.mjs` mostra apenas contagens. A conexão externa
`DATABASE_URL` deve corresponder a `PRODUCTION_DATABASE_URL`.

Agrupa telefones sem formatação; acrescenta 55 somente a formatos nacionais
brasileiros plausíveis. Não inventa nono dígito. Documentos diferentes impedem a
consolidação do grupo. Mantém o cadastro com o orçamento de criação mais recente;
sem orçamento, mantém o cadastro criado mais recentemente; empates usam UUID.

Todos os orçamentos, negócios e pedidos passam ao cadastro mantido. Revisões e
documentos emitidos permanecem intactos. Campos vazios recebem valores únicos do
grupo; endereços são copiados como bloco, somente quando o endereço mantido está
inteiramente vazio. Observações distintas são concatenadas; acima de 4.000
caracteres, a transação é recusada.

Para aplicar, após a prévia, testes e revisão:

```sh
node scripts/consolidate-clients.mjs --apply --backup <arquivo-absoluto-fora-do-checkout.json>
```

O arquivo precisa ser novo. O backup contém os clientes originais e os donos
originais de cada vínculo, inclusive os registros mantidos. É sincronizado e
relido antes da primeira alteração. No Windows, recebe ACL exclusiva do usuário
e SYSTEM antes da escrita; em POSIX, modo 0600. Não publicar ou versionar esse
arquivo. Falha em backup, lock ou FK aborta toda a transação. Os quatro conjuntos
de dados ficam bloqueados para escrita durante a consolidação.

Recuperação: em transação, bloquear as mesmas tabelas, revalidar alterações
posteriores à limpeza, liberar documentos únicos dos cadastros mantidos,
restaurar os registros originais e devolver cada vínculo ao `clientId` do
snapshot. Não restaurar cegamente após novas alterações do operador. O teste
PostgreSQL cobre a restauração do snapshot, inclusive o documento único.

O teste PostgreSQL usa apenas tabelas temporárias. Normalmente utiliza
`TEST_DATABASE_URL` local. Com autorização operacional explícita, pode receber
`CLIENT_CONSOLIDATION_TEMP_DATABASE_URL` igual a `RESTORE_DATABASE_URL`, desde que
distinto de `PRODUCTION_DATABASE_URL`. Essa exceção não altera o isolamento dos
demais testes e não executa migrations nem escreve nas tabelas existentes.
