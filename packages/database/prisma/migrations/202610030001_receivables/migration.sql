BEGIN;
-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "expectedDate" DATE,
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "FinancialSettlement" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN     "originalSettlementId" UUID,
ADD COLUMN     "sourceKey" TEXT;

-- AlterTable
ALTER TABLE "FinancialAction" ADD COLUMN     "entryId" UUID,
ALTER COLUMN "obligationId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSettlement_companyId_id_key" ON "FinancialSettlement"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSettlement_companyId_sourceKey_key" ON "FinancialSettlement"("companyId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSettlement_companyId_originalSettlementId_key" ON "FinancialSettlement"("companyId", "originalSettlementId");

-- CreateIndex
CREATE INDEX "FinancialAction_companyId_entryId_createdAt_idx" ON "FinancialAction"("companyId", "entryId", "createdAt");

-- AddForeignKey
ALTER TABLE "FinancialSettlement" ADD CONSTRAINT "FinancialSettlement_companyId_originalSettlementId_fkey" FOREIGN KEY ("companyId", "originalSettlementId") REFERENCES "FinancialSettlement"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "FinancialAction" ADD CONSTRAINT "FinancialAction_companyId_entryId_fkey" FOREIGN KEY ("companyId", "entryId") REFERENCES "FinancialEntry"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialAction" DROP CONSTRAINT financial_action_kind;
ALTER TABLE "FinancialAction" ADD CONSTRAINT financial_action_kind CHECK (
 ("obligationId" IS NOT NULL AND "entryId" IS NULL AND kind IN ('CREATE','PAY','EDIT','CANCEL')) OR
 ("obligationId" IS NULL AND "entryId" IS NOT NULL AND kind IN ('RECEIVE','FORECAST')));
ALTER TABLE "FinancialSettlement" ADD CONSTRAINT financial_settlement_kind CHECK (
 (kind IN ('PAYMENT','RECEIPT') AND "originalSettlementId" IS NULL) OR (kind='REVERSAL' AND "originalSettlementId" IS NOT NULL));
-- Preserve historical immediate receipts, using the actual sale actor/date/amount.
INSERT INTO "FinancialSettlement" (id,"companyId","entryId","actorId",amount,"paidAt",method,kind,"sourceKey")
SELECT gen_random_uuid(),e."companyId",e.id,s."sellerId",e."settledAmount",
 (COALESCE(e."settledAt",s."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date,p.method::text,'RECEIPT','sale:'||e.id
FROM "FinancialEntry" e JOIN "Sale" s ON s.id=e."saleId" AND s."companyId"=e."companyId"
JOIN "Payment" p ON p.id=e."paymentId" AND p."companyId"=e."companyId"
WHERE e.type='RECEIVABLE' AND e."settledAmount">0 AND p.method<>'STORE_CREDIT';
INSERT INTO "FinancialSettlement" (id,"companyId","entryId","actorId",amount,"paidAt",method,kind,"sourceKey","originalSettlementId",notes)
SELECT gen_random_uuid(),f."companyId",f."entryId",COALESCE(s."cancelledById",s."sellerId"),f.amount,
 (s."cancelledAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date,f.method,'REVERSAL','cancel:'||f.id,f.id,'Histórico: cancelamento administrativo da venda.'
FROM "FinancialSettlement" f JOIN "FinancialEntry" e ON e.id=f."entryId"
JOIN "Sale" s ON s.id=e."saleId" WHERE f.kind='RECEIPT' AND e.status='CANCELLED' AND s."cancelledAt" IS NOT NULL;
INSERT INTO "Permission" (code,description)
SELECT code,code FROM unnest(ARRAY['receivables:read','receivables:receive','receivables:edit','finance:read']) code ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode")
SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE r.name IN ('Administrador','Gerente','Financeiro') AND p.code IN ('receivables:read','receivables:receive','receivables:edit','finance:read') ON CONFLICT DO NOTHING;
COMMIT;
