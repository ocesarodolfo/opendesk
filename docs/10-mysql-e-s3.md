# 10 — MySQL e S3 (produção) com local/SQLite no dev

Objetivo: **desenvolvimento continua idêntico** (SQLite + pasta `media/`), e
**produção** pode usar MySQL (RDS) e S3 sem mudar uma linha de código de app.

A troca é ligada por variáveis de ambiente — nada de IFs espalhados no código.

---

## 1. Banco de dados (Prisma)

O Prisma **fixa o provider no arquivo do schema**. Para não tocar o dev:

| Arquivo | Provider | Uso |
|---|---|---|
| `prisma/schema.prisma` | sqlite | **dev** (fonte da verdade dos models) |
| `prisma/schema.mysql.prisma` | mysql | **produção** (cópia dos models + tipos `@db.Text`/`@db.VarChar`) |

> Manutenção: toda mudança de model deve ser aplicada **nos dois arquivos**.
> (`Message.content`, `QuickReply.content`, `AuditLog.metadata`, `quotedSnippet`,
> `Sector.description` e `lastError` viram `@db.Text` no MySQL; strings curtas
> normalizadas viram `@db.VarChar(255)`.)

### Fluxo dev (não muda nada)

```bash
npm run dev                        # DATABASE_URL=file:./data/app.db
npm run db:push                    # aplica schema.prisma (sqlite)
```

### Fluxo produção (servidor EC2, serviço parado)

```bash
# 1. endpoint do banco no .env (RDS ou MySQL no mesmo EC2)
DATABASE_URL="mysql://central:senha@SEU-HOST:3306/central"

# 2. regenera o PrismaClient P/ MYSQL (o provider e' compilado no client)
npm run db:generate:mysql

# 3. cria/atualiza as tabelas no MySQL
npm run db:push:mysql

# 4. seed inicial (somente banco novo)
npm run db:seed

# 5. build e serviço
npm run build && sudo systemctl start atendimento
```

### Migração de dados SQLite → MySQL (uma vez)

Leia tudo do SQLite atual e insira no MySQL **preservando os IDs** (as
conversas/mensagens continuam amarradas):

```bash
node scripts/sqlite-to-mysql.mjs --yes
#   envs: SQLITE_DATABASE_URL (default file:./data/app.db)
#         MYSQL_DATABASE_URL  (mysql://user:senha@host:3306/central)
```

O script tem duas fases: A despeja todas as tabelas para um JSON temporário; B
regenera o client para mysql e insere em ordem correta (pais antes de filhos),
de forma idempotente (`deleteMany` antes de inserir). Ao final, **restaura o
client de desenvolvimento sozinho** e apaga o dump temporário.

### Voltar ao modo dev

```bash
npm run db:generate            # regenera o client p/ sqlite
# .env de volta a DATABASE_URL=file:./data/app.db
```

> Regra de ouro continua valendo: qualquer `db:push/generate` só com o serviço
> parado (a DLL do Prisma trava).

---

## 2. Storage de arquivos (mídia): local ↔ S3

`src/lib/media.ts` tem o driver único (`STORAGE_DRIVER`), usado por
**todas** as rotas de mídia — inclusive o servidor de arquivos autenticado
`/api/media/[name]`. O nome dos arquivos não muda (`msg-<uuid>.ext`), logo o
`mediaUrl` no banco continua igual em qualquer driver.

| Envs | local (dev) | s3 (produção) |
|---|---|---|
| `STORAGE_DRIVER` | `local` (default; sem env funciona) | `s3` |
| `MEDIA_DIR` | pasta em disco (`./media`) | não se aplica |
| `S3_BUCKET` | não se aplica | **obrigatório** |
| `S3_REGION` | não se aplica | ex. `sa-east-1` |
| `S3_PREFIX` | não se aplica | prefixo das chaves (default `media`) |
| `S3_ENDPOINT` | não se aplica | opcional (MinIO/LocalStack/Wasabi) — ativa `forcePathStyle` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | não se aplica | credenciais IAM (ou `AWS_*` padrão do SDK) |

### Como o S3 fica no fluxo do app

1. **Envio**: `saveMediaFile()` faz `PutObject` no bucket (com o mimetype
   correto) e devolve o mesmo nome de arquivo de antes.
2. **Leitura**: `/api/media/msg-<uuid>.jpg` continua **autenticado** (cookie de
   sessão) e faz `GetObject` on-demand, respondendo via proxy — o **bucket
   permanece 100% privado**, sem URLs públicas.
3. O cliente (inbox) não muda nenhum fetch.

### Bucket e IAM esperados

- Bloqueio geral: `block public access` total no bucket.
- Usuário IAM com a **política mínima** (privilégio mínimo, ver `docs/05`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "atendimentoMedia",
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::SEU-BUCKET/media/*"
  }]
}
```

- Versionamento no bucket (retenção/prova — LGPD) + lifecycle opcional para
  versões antigas. As conversas nunca apagam arquivo pelo app — o
  `DeleteObject` existirá apenas para limpeza operacional futura.

### Como migrar MÍDIA existente do disco para o S3

Um sync simples (a rodar na máquina que tem a pasta `media/`):

```bash
aws s3 sync ./media s3://SEU-BUCKET/media --only-show-errors
```

Os nomes (`msg-<uuid>.ext`) já são as chaves esperadas — nada mais a fazer.

---

## 3. Resumo das trocas

| Ambiente | banco (`DATABASE_URL`) | arquivos (`STORAGE_DRIVER`) |
|---|---|---|
| dev | `file:./data/app.db` + schema.prisma | `local` (pasta `media/`) |
| prod | `mysql://...` + schema.mysql.prisma | `s3` (bucket privado) |

## 4. Deploy EC2 (docs/09) — mudanças

- No passo 4 (antes do build): `npm run db:generate:mysql` + `npm run db:push:mysql`
  (e `db:migrate-to-mysql --yes` se quiser levar os dados do SQLite do dev).
- Ao ativar o S3, adicione as envs de S3 no `.env`/`EnvironmentFile` do systemd
  (`STORAGE_DRIVER=s3` + bucket/região/credenciais) e `systemctl restart atendimento`.
- Backup: com MySQL no RDS, o backup passa a ser o **snapshot automático do RDS**
  (com PITR) — o `sqlite3 VACUUM INTO` do runbook (docs/09) deixa de se aplicar;
  mantenha backup de `sessions/` e `media/`/`S3` (no S3 use versionamento +
  replicação se quiser redundância).
