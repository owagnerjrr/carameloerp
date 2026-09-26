BEGIN;
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "author" TEXT,
ADD COLUMN     "coauthor" TEXT,
ADD COLUMN     "coverType" TEXT,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "dimensions" TEXT,
ADD COLUMN     "edition" TEXT,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "genre" TEXT,
ADD COLUMN     "imprint" TEXT,
ADD COLUMN     "isbn10" TEXT,
ADD COLUMN     "isbn13" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "pages" INTEGER,
ADD COLUMN     "publicationYear" INTEGER,
ADD COLUMN     "publisher" TEXT,
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "synopsis" TEXT,
ADD COLUMN     "weightGrams" INTEGER;

-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "location" TEXT,
ADD COLUMN     "minStock" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "afterQuantity" DECIMAL(14,3),
ADD COLUMN     "beforeQuantity" DECIMAL(14,3),
ADD COLUMN     "documentId" UUID;

-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "companyId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("companyId","value")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "supplierId" UUID,
    "kind" TEXT NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "documentNumber" TEXT,
    "invoiceNumber" TEXT,
    "receivedAt" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocumentItem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "StockDocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductIdentifier_companyId_productId_idx" ON "ProductIdentifier"("companyId", "productId");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_createdAt_idx" ON "StockDocument"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_companyId_id_key" ON "StockDocument"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_companyId_requestKey_key" ON "StockDocument"("companyId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocumentItem_companyId_documentId_productId_key" ON "StockDocumentItem"("companyId", "documentId", "productId");

-- CreateIndex
CREATE INDEX "Product_companyId_author_idx" ON "Product"("companyId", "author");

-- CreateIndex
CREATE INDEX "Product_companyId_publisher_idx" ON "Product"("companyId", "publisher");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "StockDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_companyId_supplierId_fkey" FOREIGN KEY ("companyId", "supplierId") REFERENCES "Supplier"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentItem" ADD CONSTRAINT "StockDocumentItem_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "StockDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentItem" ADD CONSTRAINT "StockDocumentItem_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "Product"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockDocument" ADD CONSTRAINT "stock_document_kind" CHECK (kind IN ('ENTRY','ADJUSTMENT'));
ALTER TABLE "StockDocumentItem" ADD CONSTRAINT "stock_document_item_values" CHECK (quantity<>0 AND "unitCost">=0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "stock_movement_balances" CHECK (("documentId" IS NULL) OR ("beforeQuantity" IS NOT NULL AND "afterQuantity" IS NOT NULL AND "beforeQuantity">=0 AND "afterQuantity">=0 AND "afterQuantity"="beforeQuantity"+quantity));
ALTER TABLE "StockBalance" ADD CONSTRAINT "stock_minimum" CHECK ("minStock" IS NULL OR "minStock">=0);
CREATE FUNCTION pg_temp.book_identifier(input text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text:=upper(regexp_replace(input,'[[:space:]-]','','g')); first12 text; s int:=0; i int;
BEGIN
 IF c ~ '^[0-9]{9}[0-9X]$' THEN
  FOR i IN 1..10 LOOP s:=s+(CASE WHEN substr(c,i,1)='X' THEN 10 ELSE substr(c,i,1)::int END)*(11-i); END LOOP;
  IF s%11=0 THEN first12:='978'||substr(c,1,9);s:=0;FOR i IN 1..12 LOOP s:=s+substr(first12,i,1)::int*(CASE WHEN i%2=0 THEN 3 ELSE 1 END);END LOOP;RETURN first12||((10-s%10)%10)::text;END IF;
 END IF;
 IF c ~ '^[0-9]{13}$' THEN RETURN c;END IF;
 RETURN upper(trim(input));
END $$;
-- Unique index deliberately rejects legacy collisions rather than discarding records.
INSERT INTO "ProductIdentifier" ("companyId",value,"productId") SELECT DISTINCT "companyId",pg_temp.book_identifier(v),id FROM "Product" CROSS JOIN LATERAL unnest(ARRAY[code,barcode]) v WHERE v IS NOT NULL AND trim(v)<>'';
INSERT INTO "Permission" (code,description) VALUES ('stock:read','Consultar estoque e histórico'),('stock:receive','Confirmar entradas de livros'),('stock:adjust','Ajustar estoque') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionCode") SELECT r.id,p.code FROM "Role" r CROSS JOIN "Permission" p WHERE r.name IN ('Administrador','Gerente','Estoque') AND p.code IN ('stock:read','stock:receive','stock:adjust') ON CONFLICT DO NOTHING;
COMMIT;