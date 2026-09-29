BEGIN;
-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "eventDocumentId" UUID;

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "responsibleId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "transitWarehouseId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDocument" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "warehouseId" UUID,
    "dispatchId" UUID,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDocumentItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT,
    "author" TEXT,
    "publisher" TEXT,
    "quantity" INTEGER NOT NULL,
    "expectedQuantity" INTEGER,

    CONSTRAINT "EventDocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_companyId_branchId_status_startsAt_idx" ON "Event"("companyId", "branchId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_companyId_id_key" ON "Event"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_companyId_code_key" ON "Event"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Event_companyId_warehouseId_key" ON "Event"("companyId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_companyId_transitWarehouseId_key" ON "Event"("companyId", "transitWarehouseId");

-- CreateIndex
CREATE INDEX "EventDocument_companyId_eventId_createdAt_idx" ON "EventDocument"("companyId", "eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_companyId_id_key" ON "EventDocument"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_companyId_code_key" ON "EventDocument"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_companyId_requestKey_key" ON "EventDocument"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocumentItem_companyId_documentId_productId_key" ON "EventDocumentItem"("companyId", "documentId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_companyId_eventDocumentId_warehouseId_product_key" ON "StockMovement"("companyId", "eventDocumentId", "warehouseId", "productId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_eventDocumentId_fkey" FOREIGN KEY ("companyId", "eventDocumentId") REFERENCES "EventDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_branchId_fkey" FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_responsibleId_fkey" FOREIGN KEY ("companyId", "responsibleId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_transitWarehouseId_fkey" FOREIGN KEY ("companyId", "transitWarehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_companyId_eventId_fkey" FOREIGN KEY ("companyId", "eventId") REFERENCES "Event"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_companyId_dispatchId_fkey" FOREIGN KEY ("companyId", "dispatchId") REFERENCES "EventDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocumentItem" ADD CONSTRAINT "EventDocumentItem_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "EventDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocumentItem" ADD CONSTRAINT "EventDocumentItem_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT warehouse_kind CHECK (kind IN ('STANDARD','EVENT','EVENT_TRANSIT'));
ALTER TABLE "Event" ADD CONSTRAINT event_dates CHECK ("endsAt">="startsAt"), ADD CONSTRAINT event_status CHECK (status IN ('DRAFT','PREPARING','IN_TRANSIT','OPEN','CLOSING','CLOSED','CANCELLED')), ADD CONSTRAINT event_distinct_locations CHECK ("warehouseId"<>"transitWarehouseId");
ALTER TABLE "EventDocumentItem" ADD CONSTRAINT event_item_quantity CHECK (quantity>=0 AND ("expectedQuantity" IS NULL OR ("expectedQuantity">=quantity)));
ALTER TABLE "EventDocument" ADD CONSTRAINT event_document_kind CHECK (kind IN ('CREATE','UPDATE','PREPARE','CLOSING','CLOSE','CANCEL','DISPATCH','RECEIVE','RETURN')), ADD CONSTRAINT event_document_status CHECK (status IN ('CONFIRMED','SENT','PARTIAL','RECEIVED'));
INSERT INTO "Permission" (code,description) VALUES ('events:read','Consultar eventos'),('events:create','Criar eventos'),('events:manage','Gerenciar eventos'),('events:stock','Movimentar estoque de eventos') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE (r.name IN ('Administrador','Gerente') AND p.code LIKE 'events:%') OR (r.name='Estoque' AND p.code IN ('events:read','events:stock')) ON CONFLICT DO NOTHING;

COMMIT;
