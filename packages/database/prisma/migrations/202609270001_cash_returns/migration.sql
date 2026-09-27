BEGIN;
-- DropIndex
DROP INDEX "CashRegister_companyId_branchId_key";

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "actorId" UUID,
ADD COLUMN     "cashSessionId" UUID,
ADD COLUMN     "method" "PaymentMethod",
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "requestKey" UUID;

-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "returnId" UUID;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cashSessionId" UUID,
ADD COLUMN     "exchangeCredit" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "publisher" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "returnId" UUID;

-- CreateTable
CREATE TABLE "CashSession" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashRegisterId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "closedById" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingAmount" DECIMAL(14,2) NOT NULL,
    "expectedAmount" DECIMAL(14,2),
    "countedAmount" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "closingSummary" JSONB,
    "notes" TEXT,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "closeRequestKey" UUID,
    "closeRequestHash" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnOperation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "cashSessionId" UUID NOT NULL,
    "originalSaleId" UUID NOT NULL,
    "replacementSaleId" UUID,
    "customerId" UUID,
    "actorId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "returnedAmount" DECIMAL(14,2) NOT NULL,
    "newAmount" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "ReturnOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCredit" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSession_companyId_branchId_status_idx" ON "CashSession"("companyId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_companyId_id_key" ON "CashSession"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_companyId_requestKey_key" ON "CashSession"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_companyId_closeRequestKey_key" ON "CashSession"("companyId", "closeRequestKey");

-- CreateIndex
CREATE INDEX "ReturnOperation_companyId_originalSaleId_idx" ON "ReturnOperation"("companyId", "originalSaleId");

-- CreateIndex
CREATE INDEX "ReturnOperation_companyId_branchId_createdAt_idx" ON "ReturnOperation"("companyId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOperation_companyId_id_key" ON "ReturnOperation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOperation_companyId_number_key" ON "ReturnOperation"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOperation_companyId_requestKey_key" ON "ReturnOperation"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOperation_companyId_replacementSaleId_key" ON "ReturnOperation"("companyId", "replacementSaleId");

-- CreateIndex
CREATE INDEX "ReturnItem_companyId_saleItemId_idx" ON "ReturnItem"("companyId", "saleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_companyId_returnId_saleItemId_key" ON "ReturnItem"("companyId", "returnId", "saleItemId");

-- CreateIndex
CREATE INDEX "CustomerCredit_companyId_customerId_status_idx" ON "CustomerCredit"("companyId", "customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCredit_companyId_id_key" ON "CustomerCredit"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCredit_companyId_returnId_key" ON "CustomerCredit"("companyId", "returnId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_companyId_requestKey_key" ON "CashMovement"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_companyId_branchId_name_key" ON "CashRegister"("companyId", "branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_companyId_id_key" ON "SaleItem"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_companyId_returnId_productId_type_key" ON "StockMovement"("companyId", "returnId", "productId", "type");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_returnId_fkey" FOREIGN KEY ("companyId", "returnId") REFERENCES "ReturnOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_companyId_cashSessionId_fkey" FOREIGN KEY ("companyId", "cashSessionId") REFERENCES "CashSession"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_companyId_returnId_fkey" FOREIGN KEY ("companyId", "returnId") REFERENCES "ReturnOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_cashSessionId_fkey" FOREIGN KEY ("companyId", "cashSessionId") REFERENCES "CashSession"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_cashRegisterId_fkey" FOREIGN KEY ("companyId", "cashRegisterId") REFERENCES "CashRegister"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_openedById_fkey" FOREIGN KEY ("companyId", "openedById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_companyId_closedById_fkey" FOREIGN KEY ("companyId", "closedById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_cashSessionId_fkey" FOREIGN KEY ("companyId", "cashSessionId") REFERENCES "CashSession"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_originalSaleId_fkey" FOREIGN KEY ("companyId", "originalSaleId") REFERENCES "Sale"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_replacementSaleId_fkey" FOREIGN KEY ("companyId", "replacementSaleId") REFERENCES "Sale"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOperation" ADD CONSTRAINT "ReturnOperation_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_companyId_returnId_fkey" FOREIGN KEY ("companyId", "returnId") REFERENCES "ReturnOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_companyId_saleItemId_fkey" FOREIGN KEY ("companyId", "saleItemId") REFERENCES "SaleItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_companyId_returnId_fkey" FOREIGN KEY ("companyId", "returnId") REFERENCES "ReturnOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX cash_one_open_terminal ON "CashSession" ("companyId","cashRegisterId") WHERE status='OPEN';
ALTER TABLE "CashSession" ADD CONSTRAINT cash_session_status CHECK (status IN ('OPEN','CLOSED') AND "openingAmount">=0 AND ((status='OPEN' AND "closedAt" IS NULL) OR (status='CLOSED' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "expectedAmount" IS NOT NULL AND "countedAmount">=0 AND difference="countedAmount"-"expectedAmount" AND "closingSummary" IS NOT NULL)));
ALTER TABLE "CashMovement" DROP CONSTRAINT cash_movement_kind;
ALTER TABLE "CashMovement" ADD CONSTRAINT cash_movement_kind CHECK (kind='LEGACY' OR ("saleId" IS NOT NULL AND "paymentId" IS NOT NULL AND ((kind='RECEIPT' AND amount>0) OR (kind='REVERSAL' AND amount<0))) OR ("cashSessionId" IS NOT NULL AND "actorId" IS NOT NULL AND method='CASH' AND ((kind='OPENING' AND amount>=0) OR (kind='SUPPLY' AND amount>0) OR (kind='WITHDRAWAL' AND amount<0))));
ALTER TABLE "StockMovement" DROP CONSTRAINT stock_movement_balances;
ALTER TABLE "StockMovement" DROP CONSTRAINT stock_movement_one_origin;
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_one_origin CHECK (num_nonnulls("documentId","saleId","returnId")<=1);
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_movement_balances CHECK (num_nonnulls("documentId","saleId","returnId")=0 OR ("beforeQuantity" IS NOT NULL AND "afterQuantity" IS NOT NULL AND "beforeQuantity">=0 AND "afterQuantity">=0 AND "afterQuantity"="beforeQuantity"+quantity));
ALTER TABLE "ReturnOperation" ADD CONSTRAINT return_amounts CHECK (kind IN ('EXCHANGE','RETURN') AND "returnedAmount">=0 AND "newAmount">=0 AND difference="newAmount"-"returnedAmount");
ALTER TABLE "ReturnItem" ADD CONSTRAINT return_item_values CHECK (quantity>0 AND amount>=0);
ALTER TABLE "CustomerCredit" ADD CONSTRAINT customer_credit_values CHECK (amount>0 AND balance>=0 AND balance<=amount AND status IN ('AVAILABLE','USED'));
ALTER TABLE "Sale" ADD CONSTRAINT sale_exchange_credit CHECK ("exchangeCredit">=0 AND "exchangeCredit"<=total);
UPDATE "CashMovement" m SET method=p.method FROM "Payment" p WHERE m."companyId"=p."companyId" AND m."paymentId"=p.id;
INSERT INTO "CashRegister" (id,"companyId","branchId",name) SELECT gen_random_uuid(),b."companyId",b.id,'Caixa 01' FROM "Branch" b WHERE NOT EXISTS (SELECT 1 FROM "CashRegister" c WHERE c."companyId"=b."companyId" AND c."branchId"=b.id);
INSERT INTO "Permission" (code,description) VALUES ('cash:read','Consultar caixa'),('cash:operate','Operar caixa'),('cash:manage','Gerenciar terminais e caixas de outros operadores'),('returns:create','Trocar e devolver itens') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE (r.name IN ('Administrador','Gerente') AND p.code IN ('cash:read','cash:operate','cash:manage','returns:create')) OR (r.name='Vendedor' AND p.code IN ('cash:read','cash:operate','returns:create')) OR (r.name='Financeiro' AND p.code='cash:read') ON CONFLICT DO NOTHING;
CREATE FUNCTION protect_closed_cash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='CLOSED' THEN RAISE EXCEPTION 'Closed cash session is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_closed_cash BEFORE UPDATE ON "CashSession" FOR EACH ROW EXECUTE FUNCTION protect_closed_cash();
CREATE FUNCTION check_cash_movement_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "CashSession";
BEGIN
 IF NEW."cashSessionId" IS NOT NULL THEN
  SELECT * INTO s FROM "CashSession" WHERE id=NEW."cashSessionId" AND "companyId"=NEW."companyId" FOR UPDATE;
  IF s.status IS DISTINCT FROM 'OPEN' OR s."cashRegisterId"<>NEW."cashRegisterId" THEN RAISE EXCEPTION 'Cash session is closed or invalid'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_cash_movement_session BEFORE INSERT OR UPDATE ON "CashMovement" FOR EACH ROW EXECUTE FUNCTION check_cash_movement_session();
COMMIT;
