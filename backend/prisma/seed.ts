import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  await prisma.expense.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.category.deleteMany();
  await prisma.paymentSource.deleteMany();

  const [food, travel, shopping, health, entertainment, bills, investment, other] =
    await Promise.all([
      prisma.category.create({ data: { name:"Food & Dining",     icon:"🍔", color:"#E07B5A" } }),
      prisma.category.create({ data: { name:"Travel",            icon:"✈️", color:"#4A90D9" } }),
      prisma.category.create({ data: { name:"Shopping",          icon:"🛍️", color:"#9B6DBF" } }),
      prisma.category.create({ data: { name:"Health",            icon:"💊", color:"#3BAF7E" } }),
      prisma.category.create({ data: { name:"Entertainment",     icon:"🎬", color:"#E8A838" } }),
      prisma.category.create({ data: { name:"Bills & Utilities", icon:"📄", color:"#5B8FD4" } }),
      prisma.category.create({ data: { name:"Investment",        icon:"📈", color:"#2E9E6B" } }),
      prisma.category.create({ data: { name:"Other",             icon:"💡", color:"#9E9389" } }),
    ]);

  const [hdfcCC, sbiDebit, gpay, cash, paytm, meal] =
    await Promise.all([
      prisma.paymentSource.create({ data: { name:"HDFC Credit Card", type:"Credit Card", icon:"💳", color:"#5B8FD4", balance: null  } }),
      prisma.paymentSource.create({ data: { name:"SBI Debit Card",   type:"Debit Card",  icon:"🏦", color:"#2E9E6B", balance:42500  } }),
      prisma.paymentSource.create({ data: { name:"Google Pay (UPI)", type:"UPI",         icon:"📱", color:"#E8A838", balance: null  } }),
      prisma.paymentSource.create({ data: { name:"Cash",             type:"Cash",        icon:"💵", color:"#9E9389", balance: 3200  } }),
      prisma.paymentSource.create({ data: { name:"Paytm Wallet",     type:"Wallet",      icon:"👛", color:"#9B6DBF", balance: 1500  } }),
      prisma.paymentSource.create({ data: { name:"Meal Card",        type:"Meal Card",   icon:"🍽️", color:"#E07B5A", balance: 2800  } }),
    ]);

  const [juneBudget, goaTrip, homeReno] = await Promise.all([
    prisma.budget.create({ data: {
      name:"June 2025 Budget", description:"Monthly household budget",
      amount:50000, startDate:new Date("2025-06-01"), endDate:new Date("2025-06-30"),
      color:"#C2623F", status:"active",
    }}),
    prisma.budget.create({ data: {
      name:"Goa Trip", description:"Vacation travel budget",
      amount:35000, startDate:new Date("2025-06-15"), endDate:new Date("2025-06-20"),
      color:"#E8A838", status:"active",
    }}),
    prisma.budget.create({ data: {
      name:"Home Renovation", description:"Kitchen & bathroom remodel",
      amount:120000, startDate:new Date("2025-05-01"), endDate:new Date("2025-07-31"),
      color:"#2E9E6B", status:"active",
    }}),
  ]);

  const expenses = [
    { title:"Zomato Order",      amount:450,   date:"2025-06-09", notes:"Dinner",                category:food,          budget:juneBudget, source:gpay,    tags:["dinner"] },
    { title:"Flight Tickets",    amount:8500,  date:"2025-06-08", notes:"Mumbai-Goa round trip", category:travel,        budget:goaTrip,    source:hdfcCC,  tags:["goa","flight"] },
    { title:"Electricity Bill",  amount:2200,  date:"2025-06-07", notes:"BESCOM June",           category:bills,         budget:juneBudget, source:sbiDebit,tags:["utility"] },
    { title:"Amazon Shopping",   amount:3400,  date:"2025-06-07", notes:"Gadgets",               category:shopping,      budget:juneBudget, source:hdfcCC,  tags:["online"] },
    { title:"Gym Membership",    amount:1500,  date:"2025-06-06", notes:"Monthly renewal",       category:health,        budget:juneBudget, source:sbiDebit,tags:[] },
    { title:"Movie + Dinner",    amount:1800,  date:"2025-06-05", notes:"Weekend outing",        category:entertainment, budget:juneBudget, source:hdfcCC,  tags:["weekend"] },
    { title:"Hotel Booking",     amount:12000, date:"2025-06-04", notes:"Goa beach resort 3N",   category:travel,        budget:goaTrip,    source:hdfcCC,  tags:["goa","hotel"] },
    { title:"Office Lunch",      amount:280,   date:"2025-06-09", notes:"Cafeteria",             category:food,          budget:juneBudget, source:meal,    tags:[] },
    { title:"SIP Investment",    amount:5000,  date:"2025-06-01", notes:"Mutual fund SIP",       category:investment,    budget:juneBudget, source:sbiDebit,tags:["sip"] },
    { title:"Tiles & Fittings",  amount:18000, date:"2025-06-03", notes:"Bathroom tiles",        category:shopping,      budget:homeReno,   source:sbiDebit,tags:["reno"] },
    { title:"Plumber Service",   amount:2500,  date:"2025-06-02", notes:"Labor charges",         category:bills,         budget:homeReno,   source:cash,    tags:["reno"] },
    { title:"Swiggy Breakfast",  amount:180,   date:"2025-06-08", notes:"Quick breakfast",       category:food,          budget:juneBudget, source:gpay,    tags:[] },
    { title:"Uber Rides",        amount:640,   date:"2025-06-06", notes:"Airport drop",          category:travel,        budget:juneBudget, source:gpay,    tags:["cab"] },
    { title:"Netflix + Spotify", amount:800,   date:"2025-06-02", notes:"Subscriptions",         category:entertainment, budget:juneBudget, source:hdfcCC,  tags:["sub"] },
  ];

  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        title:      e.title,
        amount:     e.amount,
        date:       new Date(e.date),
        notes:      e.notes,
        tags:       e.tags,
        categoryId: e.category.id,
        budgetId:   e.budget.id,
        sourceId:   e.source.id,
      },
    });
  }

  console.log("✅ Seed complete!");
  console.log(`   ${expenses.length} expenses`);
  console.log(`   3 budgets`);
  console.log(`   8 categories`);
  console.log(`   6 payment sources`);
}

main()
  .catch(e => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
