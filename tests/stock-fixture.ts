import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@caramelo/database";
import { permissions, rolePermissions } from "@caramelo/contracts";
import { hashPassword } from "../apps/api/src/security.js";
config({ quiet: true });
export function testDatabase() {
  const u = process.env.TEST_DATABASE_URL;
  if (
    !u ||
    !new URL(u).pathname.endsWith("_test") ||
    new URL(u).pathname === new URL(process.env.DATABASE_URL!).pathname ||
    !["localhost", "127.0.0.1"].includes(new URL(u).hostname) ||
    process.env.NODE_ENV === "production"
  )
    throw Error("Use um banco local separado terminado em _test");
  return createDatabase(u);
}
export async function stockFixture(db: Database) {
  const slug = "stock-" + randomUUID(),
    password = randomUUID() + "Aa1!";
  const company = await db.company.create({
    data: { name: "Rede de Livrarias Teste", slug },
  });
  const a = await db.branch.create({
      data: { companyId: company.id, name: "Filial A" },
    }),
    b = await db.branch.create({
      data: { companyId: company.id, name: "Filial B" },
    });
  const wa = await db.warehouse.create({
      data: { companyId: company.id, branchId: a.id, name: "Livros A" },
    }),
    wb = await db.warehouse.create({
      data: { companyId: company.id, branchId: b.id, name: "Livros B" },
    });
  for (const code of permissions)
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  const role = await db.role.create({
    data: {
      companyId: company.id,
      name: "Administrador",
      permissions: {
        create: permissions.map((permissionCode) => ({ permissionCode })),
      },
    },
  });
  const stockRole = await db.role.create({
    data: {
      companyId: company.id,
      name: "Estoque",
      permissions: {
        create: rolePermissions.Estoque!.map((permissionCode) => ({
          permissionCode,
        })),
      },
    },
  });
  const users: Array<{
    user: { id: string; email: string; name: string };
    member: { id: string; branchId: string | null };
  }> = [];
  for (const [name, roleId, branchId] of [
    ["Admin", role.id, null],
    ["Operador", stockRole.id, a.id],
  ] as const) {
    const user = await db.user.create({
      data: {
        email: name.toLowerCase() + "-" + slug + "@example.invalid",
        name,
        passwordHash: await hashPassword(password),
      },
    });
    const member = await db.membership.create({
      data: { companyId: company.id, userId: user.id, roleId, branchId },
    });
    users.push({ user, member });
  }
  const supplier = await db.supplier.create({
    data: { companyId: company.id, name: "Distribuidora Teste Caramelo" },
  });
  return {
    company,
    a,
    b,
    wa,
    wb,
    supplier,
    users,
    password,
    async cleanup() {
      await db.$transaction(async (tx) => {
        const where = { companyId: company.id };
        await tx.auditLog.deleteMany({ where });
        await tx.stockMovement.deleteMany({ where });
        await tx.cashMovement.deleteMany({ where });
        await tx.financialEntry.deleteMany({ where });
        await tx.payment.deleteMany({ where });
        await tx.saleItem.deleteMany({ where });
        await tx.sale.deleteMany({ where });
        await tx.cashRegister.deleteMany({ where });
        await tx.customer.deleteMany({ where });
        await tx.stockDocumentItem.deleteMany({ where });
        await tx.stockDocument.deleteMany({ where });
        await tx.stockBalance.deleteMany({ where });
        await tx.productIdentifier.deleteMany({ where });
        await tx.product.deleteMany({ where });
        await tx.supplier.deleteMany({ where });
        await tx.warehouse.deleteMany({ where });
        await tx.membership.deleteMany({ where });
        await tx.role.deleteMany({ where });
        await tx.branch.deleteMany({ where });
        await tx.company.delete({ where: { id: company.id } });
        await tx.user.deleteMany({
          where: { id: { in: users.map((u) => u.user.id) } },
        });
      });
    },
  };
}
