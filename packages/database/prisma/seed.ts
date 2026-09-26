import { saveIdentifiers } from "../../../apps/api/src/services/books.js";
import { config } from "dotenv";
import { resolve } from "node:path";
import { createDatabase } from "../src/index.js";
import { hashPassword } from "../../../apps/api/src/security.js";
import { rolePermissions, permissions } from "@caramelo/contracts";
config({ path: resolve(process.cwd(), ".env"), quiet: true });
if (process.env.NODE_ENV === "production")
  throw new Error("Seed de demonstração proibido em produção.");
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL.");
const password = process.env.SEED_DEMO_PASSWORD;
if (
  !password ||
  password.length < 12 ||
  password === "REPLACE_WITH_AT_LEAST_12_CHARACTERS"
)
  throw new Error("Defina SEED_DEMO_PASSWORD com pelo menos 12 caracteres.");
const db = createDatabase(process.env.DATABASE_URL);
try {
  if (await db.company.findUnique({ where: { slug: "caramelo-demo" } })) {
    console.log(
      "Empresa de demonstração já existe; dados e senhas preservados.",
    );
  } else {
    const passwordHash = await hashPassword(password);
    await db.$transaction(
      async (tx) => {
        const company = await tx.company.create({
          data: { name: "Caramelo Livrarias LTDA", slug: "caramelo-demo" },
        });
        const companyId = company.id;
        const branch = await tx.branch.create({
          data: { companyId, name: "Caramelo — Três Corações" },
        });
        for (const code of permissions)
          await tx.permission.upsert({
            where: { code },
            create: { code, description: code },
            update: {},
          });
        const roles: Record<string, string> = {};
        for (const [name, codes] of Object.entries(rolePermissions)) {
          const role = await tx.role.create({
            data: {
              companyId,
              name,
              permissions: {
                create: codes.map((permissionCode) => ({ permissionCode })),
              },
            },
          });
          roles[name] = role.id;
        }
        const user = await tx.user.create({
          data: {
            name: "Administrador Demo",
            email: "admin@caramelo.example",
            passwordHash,
          },
        });
        const member = await tx.membership.create({
          data: {
            companyId,
            userId: user.id,
            roleId: roles.Administrador!,
            branchId: branch.id,
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { companyId, branchId: branch.id, name: "Estoque principal" },
        });
        const cash = await tx.cashRegister.create({
          data: { companyId, name: "Caixa principal" },
        });
        const supplier = await tx.supplier.create({
          data: {
            companyId,
            name: "Distribuidora Horizonte — Fictícia",
            email: "contato@horizonte.example",
            city: "São Paulo",
            state: "SP",
          },
        });
        const category = await tx.category.create({
          data: { companyId, name: "Literatura" },
        });
        const today = new Date(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date()) + "T12:00:00-03:00",
        );
        const date = (days: number) =>
          new Date(today.getTime() - days * 86400000);
        const customers = [];
        for (const [i, name] of [
          "Mercado Aurora — Fictício",
          "Café da Praça — Fictício",
          "Empório Girassol — Fictício",
          "Bistrô Jardim — Fictício",
          "Loja Vila Nova — Fictícia",
          "Padaria Manhã — Fictícia",
        ].entries()) {
          customers.push(
            await tx.customer.create({
              data: {
                companyId,
                name,
                email: `cliente${i + 1}@exemplo.invalid`,
                city: ["Campinas", "São Paulo", "Santos"][i % 3],
                state: "SP",
                createdAt: date(i * 3),
                notes: "Cadastro fictício para demonstração.",
              },
            }),
          );
        }
        const products = [];
        for (const [i, [description, cost, price, quantity, minStock]] of [
          "Dom Casmurro|20.00|39.90|8|10",
          "O Pequeno Príncipe|18.00|34.90|42|12",
          "1984|25.00|49.90|5|8",
          "Livro de contos — demonstração|20.00|39.90|34|10",
          "Livro de poesia — demonstração|20.00|39.90|0|8",
          "Livro infantil — demonstração|20.00|39.90|56|15",
        ]
          .map((v) => v.split("|"))
          .entries()) {
          const product = await tx.product.create({
            data: {
              companyId,
              code: `CRM-${String(i + 1).padStart(3, "0")}`,
              description: description!,
              barcode: `DEMO-LIVRO-${i + 1}`,
              author:
                [
                  "Machado de Assis",
                  "Antoine de Saint-Exupéry",
                  "George Orwell",
                ][i] ?? "Autor fictício",
              publisher: "Editora demonstração (não representa edição real)",
              cost: cost!,
              price: price!,
              minStock: minStock!,
              categoryId: category.id,
              supplierId: supplier.id,
              brand: "Seleção Caramelo",
              location: `A-${i + 1}`,
            },
          });
          await saveIdentifiers(tx, companyId, product);
          products.push(product);
          await tx.stockBalance.create({
            data: {
              companyId,
              warehouseId: warehouse.id,
              productId: product.id,
              quantity: quantity!,
            },
          });
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: warehouse.id,
              productId: product.id,
              actorId: member.id,
              type: "IN",
              quantity: Number(quantity) + 30,
              reason: "Saldo de abertura demonstrativo",
              createdAt: date(31),
            },
          });
        }
        await tx.cashMovement.create({
          data: {
            companyId,
            cashRegisterId: cash.id,
            amount: "1200",
            description: "Saldo inicial demonstrativo",
            createdAt: date(31),
          },
        });
        for (let i = 0; i < 30; i++) {
          const product = products[i % products.length]!;
          const quantity = 6;
          const total = product.price.mul(quantity);
          const sale = await tx.sale.create({
            data: {
              companyId,
              branchId: branch.id,
              sellerId: member.id,
              customerId: customers[i % customers.length]!.id,
              number: 1001 + i,
              status: "COMPLETED",
              total,
              createdAt: date(i),
              items: {
                create: {
                  productId: product.id,
                  description: product.description,
                  quantity,
                  unitPrice: product.price,
                  unitCost: product.cost,
                },
              },
              payments: {
                create: {
                  method: i % 2 ? "PIX" : "CREDIT_CARD",
                  amount: total,
                  paidAt: i % 3 ? date(i) : null,
                },
              },
            },
          });
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: warehouse.id,
              productId: product.id,
              actorId: member.id,
              type: "OUT",
              quantity: -quantity,
              reason: `Venda demonstrativa ${sale.number}`,
              createdAt: date(i),
            },
          });
          await tx.financialEntry.create({
            data: {
              companyId,
              saleId: sale.id,
              customerId: customers[i % customers.length]!.id,
              type: "RECEIVABLE",
              status: i % 3 ? "SETTLED" : "OPEN",
              description: `Venda ${sale.number}`,
              amount: total,
              dueDate: date(i - 7),
              settledAt: i % 3 ? date(i) : null,
            },
          });
          if (i % 3)
            await tx.cashMovement.create({
              data: {
                companyId,
                cashRegisterId: cash.id,
                amount: total,
                description: `Recebimento venda ${sale.number}`,
                createdAt: date(i),
              },
            });
          if (i % 4 === 0) {
            await tx.financialEntry.create({
              data: {
                companyId,
                supplierId: supplier.id,
                type: "PAYABLE",
                description: "Reposição de mercadorias (demo)",
                amount: "85.00",
                dueDate: date(i - 3),
                status: i % 8 ? "SETTLED" : "OPEN",
                settledAt: i % 8 ? date(i) : null,
              },
            });
            if (i % 8)
              await tx.cashMovement.create({
                data: {
                  companyId,
                  cashRegisterId: cash.id,
                  amount: "-85.00",
                  description: "Pagamento fornecedor (demo)",
                  createdAt: date(i),
                },
              });
          }
        }
        await tx.auditLog.create({
          data: {
            companyId,
            actorId: member.id,
            action: "SEED",
            module: "system",
            recordId: companyId,
          },
        });
      },
      { timeout: 60000 },
    );
    console.log(
      "Demonstração criada: caramelo-demo / admin@caramelo.example. Senha definida no .env local.",
    );
  }
} finally {
  await db.$disconnect();
}
