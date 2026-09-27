BEGIN;
-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "paymentId" UUID,
ADD COLUMN     "saleId" UUID;

-- AlterTable
ALTER TABLE "CashRegister" ADD COLUMN     "branchId" UUID;

-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "branchId" UUID,
ADD COLUMN     "installment" INTEGER,
ADD COLUMN     "paymentId" UUID;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "change" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "installments" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "receivedAmount" DECIMAL(14,2),
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestKey" UUID,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "requestKey" UUID,
ADD COLUMN     "subtotal" DECIMAL(14,2),
ADD COLUMN     "warehouseId" UUID;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "author" TEXT,
ADD COLUMN     "isbn" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "saleId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_companyId_paymentId_kind_key" ON "CashMovement"("companyId", "paymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_companyId_branchId_key" ON "CashRegister"("companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEntry_companyId_paymentId_installment_key" ON "FinancialEntry"("companyId", "paymentId", "installment");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_id_key" ON "Payment"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_companyId_requestKey_key" ON "Sale"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_companyId_cancelRequestKey_key" ON "Sale"("companyId", "cancelRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_companyId_saleId_productId_type_key" ON "StockMovement"("companyId", "saleId", "productId", "type");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_saleId_fkey" FOREIGN KEY ("companyId", "saleId") REFERENCES "Sale"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_companyId_cancelledById_fkey" FOREIGN KEY ("companyId", "cancelledById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_companyId_paymentId_fkey" FOREIGN KEY ("companyId", "paymentId") REFERENCES "Payment"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_saleId_fkey" FOREIGN KEY ("companyId", "saleId") REFERENCES "Sale"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_companyId_paymentId_fkey" FOREIGN KEY ("companyId", "paymentId") REFERENCES "Payment"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" DROP CONSTRAINT "stock_movement_balances";
ALTER TABLE "StockMovement" ADD CONSTRAINT "stock_movement_balances" CHECK (("documentId" IS NULL AND "saleId" IS NULL) OR ("beforeQuantity" IS NOT NULL AND "afterQuantity" IS NOT NULL AND "beforeQuantity">=0 AND "afterQuantity">=0 AND "afterQuantity"="beforeQuantity"+quantity));
ALTER TABLE "StockMovement" ADD CONSTRAINT "stock_movement_one_origin" CHECK ("documentId" IS NULL OR "saleId" IS NULL);
ALTER TABLE "Sale" ADD CONSTRAINT "operational_sale_fields" CHECK ("requestKey" IS NULL OR ("warehouseId" IS NOT NULL AND "requestHash" IS NOT NULL AND subtotal IS NOT NULL AND subtotal>=total AND status IN ('COMPLETED','CANCELLED')));
ALTER TABLE "Payment" ADD CONSTRAINT "payment_installments" CHECK (installments BETWEEN 1 AND 12 AND (method='CREDIT_CARD' OR installments=1));
ALTER TABLE "Payment" ADD CONSTRAINT "payment_cash_change" CHECK (("receivedAmount" IS NULL AND change=0) OR (method='CASH' AND "receivedAmount">=amount AND change="receivedAmount"-amount));
ALTER TABLE "CashMovement" ADD CONSTRAINT "cash_movement_kind" CHECK (kind='LEGACY' OR ("saleId" IS NOT NULL AND "paymentId" IS NOT NULL AND ((kind='RECEIPT' AND amount>0) OR (kind='REVERSAL' AND amount<0))));
INSERT INTO "Permission" (code,description) VALUES ('sales:read','Consultar vendas'),('sales:create','Concluir vendas'),('sales:discount','Conceder descontos limitados pelo perfil'),('sales:cancel','Cancelar vendas') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE (r.name IN ('Administrador','Gerente') AND p.code IN ('sales:read','sales:create','sales:discount','sales:cancel')) OR (r.name='Vendedor' AND p.code IN ('sales:read','sales:create','sales:discount')) ON CONFLICT DO NOTHING;
COMMIT;