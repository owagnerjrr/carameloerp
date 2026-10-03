BEGIN;
-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "obligationId" UUID,
ADD COLUMN     "penalty" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialObligation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID,
    "categoryId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "purchaseReceiptId" UUID,
    "origin" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "documentNumber" TEXT,
    "issuedAt" DATE NOT NULL,
    "competence" DATE NOT NULL,
    "notes" TEXT,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSettlement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCategory_companyId_id_key" ON "FinancialCategory"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCategory_companyId_name_key" ON "FinancialCategory"("companyId", "name");

-- CreateIndex
CREATE INDEX "FinancialObligation_companyId_branchId_issuedAt_idx" ON "FinancialObligation"("companyId", "branchId", "issuedAt");

-- CreateIndex
CREATE INDEX "FinancialObligation_companyId_supplierId_idx" ON "FinancialObligation"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "FinancialObligation_companyId_categoryId_idx" ON "FinancialObligation"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialObligation_companyId_id_key" ON "FinancialObligation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialObligation_companyId_purchaseReceiptId_key" ON "FinancialObligation"("companyId", "purchaseReceiptId");

-- CreateIndex
CREATE INDEX "FinancialSettlement_companyId_paidAt_idx" ON "FinancialSettlement"("companyId", "paidAt");

-- CreateIndex
CREATE INDEX "FinancialSettlement_companyId_entryId_idx" ON "FinancialSettlement"("companyId", "entryId");

-- CreateIndex
CREATE INDEX "FinancialAction_companyId_obligationId_createdAt_idx" ON "FinancialAction"("companyId", "obligationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAction_companyId_requestKey_key" ON "FinancialAction"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEntry_companyId_obligationId_installment_key" ON "FinancialEntry"("companyId", "obligationId", "installment");

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_companyId_obligationId_fkey" FOREIGN KEY ("companyId", "obligationId") REFERENCES "FinancialObligation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_supplierId_fkey" FOREIGN KEY ("companyId", "supplierId") REFERENCES "Supplier"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_categoryId_fkey" FOREIGN KEY ("companyId", "categoryId") REFERENCES "FinancialCategory"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "PurchaseOrder"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_companyId_purchaseReceiptId_fkey" FOREIGN KEY ("companyId", "purchaseReceiptId") REFERENCES "PurchaseReceipt"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSettlement" ADD CONSTRAINT "FinancialSettlement_companyId_entryId_fkey" FOREIGN KEY ("companyId", "entryId") REFERENCES "FinancialEntry"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSettlement" ADD CONSTRAINT "FinancialSettlement_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAction" ADD CONSTRAINT "FinancialAction_companyId_obligationId_fkey" FOREIGN KEY ("companyId", "obligationId") REFERENCES "FinancialObligation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAction" ADD CONSTRAINT "FinancialAction_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing receivables/credits retain their original range; new obligations include explicit adjustments.
ALTER TABLE "FinancialEntry" DROP CONSTRAINT financial_settlement_range;
ALTER TABLE "FinancialEntry" ADD CONSTRAINT financial_settlement_range CHECK (
 "settledAmount">=0 AND interest>=0 AND penalty>=0 AND discount>=0
 AND ("obligationId" IS NULL AND interest=0 AND penalty=0 AND discount=0 AND "settledAmount"<=amount
 OR "obligationId" IS NOT NULL AND type='PAYABLE' AND "branchId" IS NOT NULL AND installment BETWEEN 1 AND 60
 AND "saleId" IS NULL AND "paymentId" IS NULL AND "returnId" IS NULL AND "customerId" IS NULL
 AND amount+interest+penalty-discount>=0 AND "settledAmount"<=amount+interest+penalty-discount)
);
ALTER TABLE "FinancialObligation" ADD CONSTRAINT financial_obligation_values CHECK (
 "originalAmount">0 AND origin IN ('MANUAL','PURCHASE','OTHER')
 AND ((origin='PURCHASE' AND "purchaseOrderId" IS NOT NULL AND "purchaseReceiptId" IS NOT NULL AND "supplierId" IS NOT NULL)
 OR (origin<>'PURCHASE' AND "purchaseOrderId" IS NULL AND "purchaseReceiptId" IS NULL))
);
ALTER TABLE "FinancialSettlement" ADD CONSTRAINT financial_payment_values CHECK (amount>0 AND method IN ('CASH','PIX','BANK_SLIP','TRANSFER','DEBIT_CARD','CREDIT_CARD','OTHER'));
ALTER TABLE "FinancialAction" ADD CONSTRAINT financial_action_kind CHECK (kind IN ('CREATE','PAY','EDIT','CANCEL'));
INSERT INTO "Permission" (code,description)
SELECT code,code FROM unnest(ARRAY['payables:read','payables:create','payables:edit','payables:pay','payables:cancel']) code ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode")
SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE r.name IN ('Administrador','Gerente','Financeiro') AND p.code IN ('payables:read','payables:create','payables:edit','payables:pay','payables:cancel') ON CONFLICT DO NOTHING;
INSERT INTO "FinancialCategory" (id,"companyId",name)
SELECT gen_random_uuid(),c.id,n FROM "Company" c CROSS JOIN unnest(ARRAY['Compras de livros','Aluguel','Energia','Água','Internet','Telefone','Manutenção','Material de escritório','Frete','Contabilidade','Serviços','Marketing','Impostos e taxas','Outras despesas']) n ON CONFLICT DO NOTHING;

COMMIT;
