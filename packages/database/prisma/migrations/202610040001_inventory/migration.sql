BEGIN;
-- AlterTable
ALTER TABLE "StockDocument" ADD COLUMN     "inventoryId" UUID;

-- CreateTable
CREATE TABLE "Inventory" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "responsibleId" UUID NOT NULL,
    "approvedById" UUID,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "selectedIds" JSONB NOT NULL,
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "blindRecount" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" DATE NOT NULL,
    "startedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT,
    "sku" TEXT NOT NULL,
    "systemQuantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "justification" TEXT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceQuantity" DECIMAL(14,3) NOT NULL,
    "movementCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAction" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inventory_companyId_branchId_status_createdAt_idx" ON "Inventory"("companyId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Inventory_companyId_warehouseId_status_idx" ON "Inventory"("companyId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_companyId_id_key" ON "Inventory"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_companyId_code_key" ON "Inventory"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_companyId_id_key" ON "InventoryItem"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_companyId_inventoryId_productId_key" ON "InventoryItem"("companyId", "inventoryId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_companyId_itemId_round_key" ON "InventoryCount"("companyId", "itemId", "round");

-- CreateIndex
CREATE INDEX "InventoryAction_companyId_inventoryId_createdAt_idx" ON "InventoryAction"("companyId", "inventoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAction_companyId_requestKey_key" ON "InventoryAction"("companyId", "requestKey");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_inventoryId_idx" ON "StockDocument"("companyId", "inventoryId");

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_inventoryId_fkey" FOREIGN KEY ("companyId", "inventoryId") REFERENCES "Inventory"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_companyId_responsibleId_fkey" FOREIGN KEY ("companyId", "responsibleId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_companyId_approvedById_fkey" FOREIGN KEY ("companyId", "approvedById") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_companyId_inventoryId_fkey" FOREIGN KEY ("companyId", "inventoryId") REFERENCES "Inventory"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "InventoryItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAction" ADD CONSTRAINT "InventoryAction_companyId_inventoryId_fkey" FOREIGN KEY ("companyId", "inventoryId") REFERENCES "Inventory"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAction" ADD CONSTRAINT "InventoryAction_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_status CHECK (status IN ('DRAFT','COUNTING','RECOUNT_REQUIRED','UNDER_REVIEW','APPROVED','CLOSED','CANCELLED'));
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_scope CHECK (scope IN ('FULL','PARTIAL') AND jsonb_typeof("selectedIds")='array');
ALTER TABLE "Inventory" ADD CONSTRAINT inventory_dates CHECK ((status NOT IN ('COUNTING','RECOUNT_REQUIRED','UNDER_REVIEW','APPROVED','CLOSED') OR "startedAt" IS NOT NULL) AND (status NOT IN ('APPROVED','CLOSED') OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)) AND (status<>'CLOSED' OR "closedAt" IS NOT NULL) AND (status<>'CANCELLED' OR ("cancelledAt" IS NOT NULL AND length("cancelReason")>=8)));
ALTER TABLE "InventoryItem" ADD CONSTRAINT inventory_item_values CHECK ("systemQuantity">=0 AND "unitCost">=0 AND "currentRound">=1 AND (reason IS NULL OR reason IN ('LOSS','DAMAGED','THEFT','OPERATIONAL','UNREGISTERED_IN','UNREGISTERED_OUT','COUNT_ERROR','LOCATION','OTHER')) AND (reason IS DISTINCT FROM 'OTHER' OR length(justification)>=3));
ALTER TABLE "InventoryCount" ADD CONSTRAINT inventory_count_values CHECK (quantity>=0 AND quantity<=1000000 AND round>=1 AND "referenceQuantity">=0 AND "movementCount">=0 AND source IN ('MANUAL','SCANNER'));
CREATE UNIQUE INDEX inventory_one_active ON "Inventory"("companyId","warehouseId") WHERE status IN ('COUNTING','RECOUNT_REQUIRED','UNDER_REVIEW','APPROVED');
ALTER TABLE "StockDocument" DROP CONSTRAINT stock_document_kind;
ALTER TABLE "StockDocument" ADD CONSTRAINT stock_document_kind CHECK (("transferId" IS NULL AND "inventoryId" IS NULL AND kind IN ('ENTRY','ADJUSTMENT')) OR ("transferId" IS NOT NULL AND "inventoryId" IS NULL AND kind IN ('TRANSFER_CREATE','TRANSFER_EDIT','TRANSFER_PREPARE','TRANSFER_SEND','TRANSFER_RECEIVE','TRANSFER_RETURN','TRANSFER_CANCEL','TRANSFER_DIVERGENCE')) OR ("transferId" IS NULL AND "inventoryId" IS NOT NULL AND kind='INVENTORY_ADJUSTMENT'));
CREATE FUNCTION inventory_warehouse_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Warehouse" WHERE id=NEW."warehouseId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."branchId" AND kind='STANDARD') THEN RAISE EXCEPTION 'Inventory requires an authorized standard warehouse'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_warehouse_guard BEFORE INSERT OR UPDATE ON "Inventory" FOR EACH ROW EXECUTE FUNCTION inventory_warehouse_guard();
INSERT INTO "Permission" (code,description) SELECT code,code FROM unnest(ARRAY['inventory:read','inventory:create','inventory:count','inventory:review','inventory:approve','inventory:close','inventory:cancel']) code ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE (r.name IN ('Administrador','Gerente') AND p.code LIKE 'inventory:%') OR (r.name='Estoque' AND p.code IN ('inventory:read','inventory:create','inventory:count')) ON CONFLICT DO NOTHING;
COMMIT;
