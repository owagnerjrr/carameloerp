import { Prisma, type Sale } from "@caramelo/database";
import { cents, reais } from "@caramelo/contracts";
import { HttpError, type AuthContext, type Transaction } from "../context.js";
import { lock } from "./stock.js";

export async function recordCreditIssue(
  tx: Transaction,
  a: AuthContext,
  credit: {
    id: string;
    customerId: string;
    returnId: string;
    amount: Prisma.Decimal;
  },
  branchId: string,
) {
  await tx.customerCreditMovement.create({
    data: {
      companyId: a.companyId,
      creditId: credit.id,
      customerId: credit.customerId,
      actorId: a.membershipId,
      returnId: credit.returnId,
      kind: "ISSUE",
      amount: credit.amount,
      beforeBalance: 0,
      afterBalance: credit.amount,
    },
  });
  await tx.auditLog.create({
    data: {
      companyId: a.companyId,
      actorId: a.membershipId,
      module: "returns",
      action: "CREDIT_ISSUED",
      recordId: credit.id,
      metadata: {
        returnId: credit.returnId,
        customerId: credit.customerId,
        amount: String(credit.amount),
        branchId,
      },
    },
  });
}
async function updateObligation(
  tx: Transaction,
  companyId: string,
  returnId: string,
  amount: Prisma.Decimal,
  balance: Prisma.Decimal,
) {
  await tx.financialEntry.updateMany({
    where: { companyId, returnId, type: "PAYABLE" },
    data: {
      settledAmount: amount.minus(balance),
      status: balance.isZero() ? "SETTLED" : "OPEN",
      settledAt: balance.isZero() ? new Date() : null,
    },
  });
}
export async function redeemCredits(
  tx: Transaction,
  a: AuthContext,
  sale: Sale,
  amount: string,
) {
  if (!sale.customerId)
    throw new HttpError(
      400,
      "Identifique o cliente para utilizar vale-crédito.",
    );
  await lock(tx, a.companyId + ":customer-credit:" + sale.customerId);
  const credits = await tx.customerCredit.findMany({
    where: {
      companyId: a.companyId,
      customerId: sale.customerId,
      status: "AVAILABLE",
      balance: { gt: 0 },
      returnOperation: { branchId: sale.branchId },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let remaining = cents(amount);
  if (credits.reduce((n, c) => n + cents(String(c.balance)), 0n) < remaining)
    throw new HttpError(
      409,
      "Saldo de vale-crédito insuficiente para este cliente e filial.",
    );
  for (const credit of credits) {
    if (!remaining) break;
    const before = cents(String(credit.balance)),
      used = before < remaining ? before : remaining,
      after = before - used;
    remaining -= used;
    const updated = await tx.customerCredit.update({
      where: { id: credit.id },
      data: {
        balance: reais(after),
        status: after === 0n ? "USED" : "AVAILABLE",
      },
    });
    await tx.customerCreditMovement.create({
      data: {
        companyId: a.companyId,
        creditId: credit.id,
        customerId: sale.customerId,
        actorId: a.membershipId,
        returnId: credit.returnId,
        saleId: sale.id,
        kind: "REDEEM",
        amount: reais(-used),
        beforeBalance: credit.balance,
        afterBalance: updated.balance,
      },
    });
    await updateObligation(
      tx,
      a.companyId,
      credit.returnId,
      credit.amount,
      updated.balance,
    );
    await tx.auditLog.create({
      data: {
        companyId: a.companyId,
        actorId: a.membershipId,
        module: "sales",
        action: "CREDIT_REDEEMED",
        recordId: credit.id,
        metadata: {
          branchId: sale.branchId,
          saleId: sale.id,
          customerId: sale.customerId,
          amount: reais(used),
          before: String(credit.balance),
          after: String(updated.balance),
        },
      },
    });
  }
}
export async function restoreCredits(
  tx: Transaction,
  a: AuthContext,
  sale: Sale,
) {
  if (!sale.customerId) return;
  await lock(tx, a.companyId + ":customer-credit:" + sale.customerId);
  const movements = await tx.customerCreditMovement.findMany({
    where: { companyId: a.companyId, saleId: sale.id, kind: "REDEEM" },
    orderBy: { creditId: "asc" },
  });
  for (const movement of movements) {
    const credit = await tx.customerCredit.findUniqueOrThrow({
      where: {
        companyId_id: { companyId: a.companyId, id: movement.creditId },
      },
    });
    const restored = movement.amount.negated(),
      balance = credit.balance.plus(restored);
    if (balance.gt(credit.amount))
      throw new HttpError(409, "Restauração excede o valor original do vale.");
    await tx.customerCredit.update({
      where: { id: credit.id },
      data: { balance, status: "AVAILABLE" },
    });
    await tx.customerCreditMovement.create({
      data: {
        companyId: a.companyId,
        creditId: credit.id,
        customerId: credit.customerId,
        actorId: a.membershipId,
        returnId: credit.returnId,
        saleId: sale.id,
        kind: "RESTORE",
        amount: restored,
        beforeBalance: credit.balance,
        afterBalance: balance,
      },
    });
    await updateObligation(
      tx,
      a.companyId,
      credit.returnId,
      credit.amount,
      balance,
    );
    await tx.auditLog.create({
      data: {
        companyId: a.companyId,
        actorId: a.membershipId,
        module: "sales",
        action: "CREDIT_RESTORED",
        recordId: credit.id,
        metadata: {
          branchId: sale.branchId,
          saleId: sale.id,
          customerId: credit.customerId,
          amount: String(restored),
          before: String(credit.balance),
          after: String(balance),
        },
      },
    });
  }
}
