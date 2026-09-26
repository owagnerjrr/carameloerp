import { identifier } from "@caramelo/contracts";
import type { Transaction } from "../context.js";
export async function saveIdentifiers(
  tx: Transaction,
  companyId: string,
  product: {
    id: string;
    code: string;
    barcode: string | null;
    isbn10: string | null;
    isbn13: string | null;
  },
) {
  const values = [
    ...new Set(
      [product.code, product.barcode, product.isbn10, product.isbn13]
        .filter((v): v is string => !!v)
        .map(identifier),
    ),
  ];
  await tx.productIdentifier.deleteMany({
    where: { companyId, productId: product.id },
  });
  await tx.productIdentifier.createMany({
    data: values.map((value) => ({ companyId, productId: product.id, value })),
  });
}
/** Future provider adapter; no remote calls or fictional metadata. */
export interface BibliographyProvider {
  lookup(isbn13: string): Promise<{
    title: string;
    author?: string;
    publisher?: string;
    coverUrl?: string;
    source: string;
  } | null>;
}
