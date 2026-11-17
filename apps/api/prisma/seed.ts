import { PrismaClient, SubscriptionPlanCode } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PLANS = [
  {
    code: SubscriptionPlanCode.FREE_TRIAL,
    name: "Dùng thử miễn phí 14 ngày",
    priceMonthly: "0.00",
    maxBranches: 2,
    maxUsers: 5,
    maxSkus: 500,
    storageQuotaMb: 256,
    features: {
      posOffline: true,
      splitPayments: true,
      multiBranchTransfer: false,
      omnichannelApi: false,
    },
  },
  {
    code: SubscriptionPlanCode.LITE,
    name: "POS Lite",
    priceMonthly: "290000.00",
    maxBranches: 1,
    maxUsers: 5,
    maxSkus: 2000,
    storageQuotaMb: 1024,
    features: {
      posOffline: true,
      splitPayments: true,
      multiBranchTransfer: false,
      omnichannelApi: false,
    },
  },
  {
    code: SubscriptionPlanCode.PRO,
    name: "POS Pro",
    priceMonthly: "690000.00",
    maxBranches: 10,
    maxUsers: 50,
    maxSkus: 50000,
    storageQuotaMb: 10240,
    features: {
      posOffline: true,
      splitPayments: true,
      multiBranchTransfer: true,
      omnichannelApi: true,
    },
  },
] as const;

async function main() {
  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        maxBranches: plan.maxBranches,
        maxUsers: plan.maxUsers,
        maxSkus: plan.maxSkus,
        storageQuotaMb: plan.storageQuotaMb,
        features: plan.features,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error("Failed to seed subscription plans:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
