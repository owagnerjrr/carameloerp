BEGIN;
-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "closingNotes" TEXT,
ADD COLUMN     "openingNotes" TEXT;

-- CreateTable
CREATE TABLE "CustomerCreditMovement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "creditId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "saleId" UUID,
    "returnId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "beforeBalance" DECIMAL(14,2) NOT NULL,
    "afterBalance" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerCreditMovement_companyId_customerId_createdAt_idx" ON "CustomerCreditMovement"("companyId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditMovement_companyId_creditId_saleId_kind_key" ON "CustomerCreditMovement"("companyId", "creditId", "saleId", "kind");

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_creditId_fkey" FOREIGN KEY ("companyId", "creditId") REFERENCES "CustomerCredit"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_actorId_fkey" FOREIGN KEY ("companyId", "actorId") REFERENCES "Membership"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_saleId_fkey" FOREIGN KEY ("companyId", "saleId") REFERENCES "Sale"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_companyId_returnId_fkey" FOREIGN KEY ("companyId", "returnId") REFERENCES "ReturnOperation"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashSession" DISABLE TRIGGER protect_closed_cash;
UPDATE "CashSession" SET "openingNotes"=CASE WHEN status='OPEN' THEN notes ELSE NULL END,"closingNotes"=CASE WHEN status='CLOSED' THEN notes ELSE NULL END;
ALTER TABLE "CashSession" ENABLE TRIGGER protect_closed_cash;
UPDATE "FinancialEntry" SET "settledAmount"=amount WHERE status='SETTLED';
ALTER TABLE "FinancialEntry" ADD CONSTRAINT financial_settlement_range CHECK ("settledAmount">=0 AND "settledAmount"<=amount);
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT credit_movement_values CHECK (
 "beforeBalance">=0 AND "afterBalance">=0 AND "afterBalance"="beforeBalance"+amount AND
 ((kind='ISSUE' AND "saleId" IS NULL AND amount>0 AND "beforeBalance"=0) OR
 (kind='REDEEM' AND "saleId" IS NOT NULL AND amount<0) OR
 (kind='RESTORE' AND "saleId" IS NOT NULL AND amount>0)));
CREATE UNIQUE INDEX credit_one_issue ON "CustomerCreditMovement" ("companyId","creditId") WHERE kind='ISSUE';
INSERT INTO "CustomerCreditMovement" (id,"companyId","creditId","customerId","actorId","returnId",kind,amount,"beforeBalance","afterBalance","createdAt")
SELECT gen_random_uuid(),c."companyId",c.id,c."customerId",r."actorId",r.id,'ISSUE',c.amount,0,c.amount,c."createdAt" FROM "CustomerCredit" c JOIN "ReturnOperation" r ON r.id=c."returnId" AND r."companyId"=c."companyId";
COMMIT;
