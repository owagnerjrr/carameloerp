ALTER TABLE "Product" ADD CONSTRAINT "product_amounts_nonnegative" CHECK (cost >= 0 AND price >= 0 AND "minStock" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "sale_amounts_nonnegative" CHECK (total >= 0 AND discount >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "sale_item_amounts_valid" CHECK (quantity > 0 AND "unitPrice" >= 0 AND "unitCost" >= 0 AND discount >= 0 AND discount <= quantity * "unitPrice");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_positive" CHECK (amount > 0);
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "financial_entry_positive" CHECK (amount > 0);
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "settlement_consistency" CHECK ((status = 'SETTLED' AND "settledAt" IS NOT NULL) OR (status <> 'SETTLED' AND "settledAt" IS NULL));
ALTER TABLE "StockBalance" ADD CONSTRAINT "stock_balance_nonnegative" CHECK (quantity >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "stock_movement_sign" CHECK ((type = 'IN' AND quantity > 0) OR (type = 'OUT' AND quantity < 0) OR (type IN ('ADJUSTMENT','TRANSFER') AND quantity <> 0));
