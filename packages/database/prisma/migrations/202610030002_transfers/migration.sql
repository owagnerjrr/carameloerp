BEGIN;
-- AlterTable
ALTER TABLE "StockDocument" ADD COLUMN     "transferId" UUID;

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "originWarehouseId" UUID NOT NULL,
    "destinationWarehouseId" UUID NOT NULL,
    "transitWarehouseId" UUID NOT NULL,
    "responsibleId" UUID NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "returned" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferDivergence" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expected" INTEGER NOT NULL,
    "observed" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferDivergence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transitWarehouseId_key" ON "StockTransfer"("transitWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_status_createdAt_idx" ON "StockTransfer"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_originWarehouseId_idx" ON "StockTransfer"("companyId", "originWarehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_companyId_destinationWarehouseId_idx" ON "StockTransfer"("companyId", "destinationWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_id_key" ON "StockTransfer"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_code_key" ON "StockTransfer"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_companyId_transitWarehouseId_key" ON "StockTransfer"("companyId", "transitWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferItem_companyId_transferId_productId_key" ON "StockTransferItem"("companyId", "transferId", "productId");

-- CreateIndex
CREATE INDEX "TransferDivergence_companyId_documentId_idx" ON "TransferDivergence"("companyId", "documentId");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_transferId_createdAt_idx" ON "StockDocument"("companyId", "transferId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_transferId_fkey" FOREIGN KEY ("companyId", "transferId") REFERENCES "StockTransfer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_originWarehouseId_fkey" FOREIGN KEY ("companyId", "originWarehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_destinationWarehouseId_fkey" FOREIGN KEY ("companyId", "destinationWarehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_transitWarehouseId_fkey" FOREIGN KEY ("companyId", "transitWarehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_companyId_responsibleId_fkey" FOREIGN KEY ("companyId", "responsibleId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_companyId_transferId_fkey" FOREIGN KEY ("companyId", "transferId") REFERENCES "StockTransfer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferDivergence" ADD CONSTRAINT "TransferDivergence_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "StockDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Warehouse" DROP CONSTRAINT warehouse_kind;
ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_kind CHECK (kind IN ('STANDARD','EVENT','EVENT_TRANSIT','TRANSFER_TRANSIT'));
ALTER TABLE "StockDocument" DROP CONSTRAINT stock_document_kind;
ALTER TABLE "StockDocument" ADD CONSTRAINT stock_document_kind CHECK (("transferId" IS NULL AND kind IN ('ENTRY','ADJUSTMENT')) OR ("transferId" IS NOT NULL AND kind IN ('TRANSFER_CREATE','TRANSFER_EDIT','TRANSFER_PREPARE','TRANSFER_SEND','TRANSFER_RECEIVE','TRANSFER_RETURN','TRANSFER_CANCEL','TRANSFER_DIVERGENCE')));
ALTER TABLE "StockTransfer" ADD CONSTRAINT transfer_locations CHECK ("originWarehouseId"<>"destinationWarehouseId" AND "originWarehouseId"<>"transitWarehouseId" AND "destinationWarehouseId"<>"transitWarehouseId");
ALTER TABLE "StockTransfer" ADD CONSTRAINT transfer_status CHECK (status IN ('DRAFT','READY','IN_TRANSIT','PARTIALLY_RECEIVED','RECEIVED','CLOSED_RETURNED','CANCELLED'));
ALTER TABLE "StockTransferItem" ADD CONSTRAINT transfer_quantities CHECK (quantity>0 AND received>=0 AND returned>=0 AND received+returned<=quantity);
ALTER TABLE "TransferDivergence" ADD CONSTRAINT transfer_divergence_values CHECK (expected>=0 AND observed>=0 AND length(reason)>=8 AND kind IN ('MISSING','DAMAGED','WRONG','EXCESS','UNEXPECTED'));
CREATE FUNCTION check_transfer_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc uuid; product uuid; tenant uuid; n integer; total numeric;
BEGIN
 doc=COALESCE(NEW."documentId",OLD."documentId");product=COALESCE(NEW."productId",OLD."productId");tenant=COALESCE(NEW."companyId",OLD."companyId");
 IF EXISTS (SELECT 1 FROM "StockDocument" WHERE id=doc AND "companyId"=tenant AND "transferId" IS NOT NULL AND kind IN ('TRANSFER_SEND','TRANSFER_RECEIVE','TRANSFER_RETURN')) THEN
  SELECT count(*),sum(quantity) INTO n,total FROM "StockMovement" WHERE "companyId"=tenant AND "documentId"=doc AND "productId"=product AND type='TRANSFER' AND "transferGroup"=doc;
  IF n<>2 OR total<>0 THEN RAISE EXCEPTION 'Transfer requires balanced counterpart movements'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transfer_pair AFTER INSERT OR UPDATE OR DELETE ON "StockMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_pair();
INSERT INTO "Permission" (code,description) SELECT code,code FROM unnest(ARRAY['transfers:read','transfers:create','transfers:send','transfers:receive','transfers:cancel','transfers:return']) code ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE r.name IN ('Administrador','Gerente','Estoque') AND p.code LIKE 'transfers:%' ON CONFLICT DO NOTHING;
COMMIT;
