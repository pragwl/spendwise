import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    // Create or find the General split tender
    const general = await tx.splitTender.upsert({
      where:  { name: "General" },
      update: {},
      create: {
        name:        "General",
        description: "Default split tender for all payment sources",
      },
    });

    console.log(`General split tender id: ${general.id}`);

    // Link all payment sources that have no split tender
    const srcUpdate = await tx.paymentSource.updateMany({
      where:  { splitTenderId: null },
      data:   { splitTenderId: general.id },
    });
    console.log(`Updated ${srcUpdate.count} payment sources → General`);

    // For each budget that has no BudgetSplitTender entries, create one
    const budgets = await tx.budget.findMany({
      where:   { splitTenders: { none: {} } },
      select:  { id: true, amount: true },
    });

    if (budgets.length > 0) {
      await tx.budgetSplitTender.createMany({
        data: budgets.map((b) => ({
          budgetId:        b.id,
          splitTenderId:   general.id,
          allocatedAmount: b.amount,
        })),
        skipDuplicates: true,
      });
      console.log(`Created BudgetSplitTender entries for ${budgets.length} budgets → General`);
    } else {
      console.log("All budgets already have split tender entries.");
    }
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
