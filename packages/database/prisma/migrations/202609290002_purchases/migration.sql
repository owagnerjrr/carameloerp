BEGIN;
-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "contact" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deliveryDays" INTEGER,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "orderedAt" DATE NOT NULL,
    "expectedAt" DATE,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL,
    "freight" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT,
    "author" TEXT,
    "publisher" TEXT,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "unitDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "freight" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "excessReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "allocatedCharges" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "previousCost" DECIMAL(14,2) NOT NULL,
    "resultingCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDivergence" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "PurchaseDivergence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseAction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "notes" TEXT,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_branchId_status_orderedAt_idx" ON "PurchaseOrder"("companyId", "branchId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_supplierId_idx" ON "PurchaseOrder"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_id_key" ON "PurchaseOrder"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_companyId_id_key" ON "PurchaseOrderItem"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_companyId_orderId_productId_key" ON "PurchaseOrderItem"("companyId", "orderId", "productId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_companyId_orderId_createdAt_idx" ON "PurchaseReceipt"("companyId", "orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_companyId_id_key" ON "PurchaseReceipt"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_companyId_documentId_key" ON "PurchaseReceipt"("companyId", "documentId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptItem_companyId_orderItemId_idx" ON "PurchaseReceiptItem"("companyId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptItem_companyId_receiptId_orderItemId_key" ON "PurchaseReceiptItem"("companyId", "receiptId", "orderItemId");

-- CreateIndex
CREATE INDEX "PurchaseDivergence_companyId_receiptId_idx" ON "PurchaseDivergence"("companyId", "receiptId");

-- CreateIndex
CREATE INDEX "PurchaseAction_companyId_orderId_createdAt_idx" ON "PurchaseAction"("companyId", "orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAction_companyId_requestKey_key" ON "PurchaseAction"("companyId", "requestKey");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_supplierId_fkey" FOREIGN KEY ("companyId", "supplierId") REFERENCES "Supplier"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_buyerId_fkey" FOREIGN KEY ("companyId", "buyerId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_createdById_fkey" FOREIGN KEY ("companyId", "createdById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_approvedById_fkey" FOREIGN KEY ("companyId", "approvedById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "PurchaseOrder"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "PurchaseOrder"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "StockDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_companyId_receiptId_fkey" FOREIGN KEY ("companyId", "receiptId") REFERENCES "PurchaseReceipt"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_companyId_orderItemId_fkey" FOREIGN KEY ("companyId", "orderItemId") REFERENCES "PurchaseOrderItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDivergence" ADD CONSTRAINT "PurchaseDivergence_companyId_receiptId_fkey" FOREIGN KEY ("companyId", "receiptId") REFERENCES "PurchaseReceipt"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDivergence" ADD CONSTRAINT "PurchaseDivergence_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAction" ADD CONSTRAINT "PurchaseAction_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "PurchaseOrder"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAction" ADD CONSTRAINT "PurchaseAction_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Supplier" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Preserve existing suppliers; abort instead of silently merging duplicates.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM "Supplier"
  WHERE NULLIF(regexp_replace(upper(document),'[./[:space:]-]','','g'),'') IS NOT NULL
  GROUP BY "companyId",regexp_replace(upper(document),'[./[:space:]-]','','g') HAVING COUNT(*)>1
 ) THEN RAISE EXCEPTION 'Fornecedores com CPF/CNPJ duplicado: revise os cadastros antes de migrar'; END IF;
END $$;
UPDATE "Supplier" SET document=NULLIF(regexp_replace(upper(document),'[./[:space:]-]','','g'),'');
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_purchase_fields_check" CHECK (
 "type" IN ('PUBLISHER','DISTRIBUTOR','WHOLESALER','OTHER') AND ("deliveryDays" IS NULL OR "deliveryDays" BETWEEN 0 AND 3650)
);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_values_check" CHECK (
 "status" IN ('DRAFT','PENDING','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')
 AND "number">0 AND subtotal>=0 AND discount>=0 AND discount<=subtotal AND freight>=0 AND expenses>=0
 AND total=subtotal-discount+freight+expenses AND ("expectedAt" IS NULL OR "expectedAt">="orderedAt")
);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_values_check" CHECK (
 quantity BETWEEN 1 AND 100000 AND "receivedQuantity">=0 AND "unitCost">=0 AND "unitDiscount">=0
 AND "unitDiscount"<="unitCost" AND subtotal=("unitCost"-"unitDiscount")*quantity
);
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_values_check" CHECK (freight>=0 AND expenses>=0 AND total>=0);
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_values_check" CHECK (
 quantity BETWEEN 1 AND 100000 AND "unitCost">=0 AND "allocatedCharges">=0
 AND total="unitCost"*quantity+"allocatedCharges" AND "previousCost">=0 AND "resultingCost">=0
);
ALTER TABLE "PurchaseDivergence" ADD CONSTRAINT "PurchaseDivergence_values_check" CHECK (
 "type" IN ('MISSING','EXCESS','UNORDERED','DAMAGED','EDITION','ISBN') AND quantity BETWEEN 1 AND 100000 AND length(trim(notes))>=8
);
INSERT INTO "Permission" (code,description)
SELECT code,code FROM unnest(ARRAY['purchases:read','purchases:create','purchases:edit','purchases:approve','purchases:receive','purchases:cancel','purchases:excess','suppliers:read','suppliers:write']) code
ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode")
SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p
WHERE (r.name IN ('Administrador','Gerente') AND p.code IN ('purchases:read','purchases:create','purchases:edit','purchases:approve','purchases:receive','purchases:cancel','purchases:excess','suppliers:read','suppliers:write'))
 OR (r.name='Estoque' AND p.code IN ('purchases:read','purchases:receive','suppliers:read'))
ON CONFLICT DO NOTHING;
COMMIT;
