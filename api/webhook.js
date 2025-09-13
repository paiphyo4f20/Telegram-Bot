import { Telegraf } from "telegraf";
import mongoose from "mongoose";
import QRCode from "qrcode";

// --- ENV VARIABLES ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const TARGET_CHAT_ID = Number(process.env.TARGET_CHAT_ID);
const MONGO_URI = process.env.MONGO_URI;
const KPAY_NUMBER = process.env.KPAY_NUMBER || "09799766739"; // change to yours

// --- INIT BOT ---
const bot = new Telegraf(BOT_TOKEN);

// --- DATABASE MODEL ---
await mongoose.connect(MONGO_URI);
const Order = mongoose.model("Order", new mongoose.Schema({
  userId: Number,
  months: Number,
  status: String,
  photoFileId: String,
  inviteLink: String,
  createdAt: Number,
  expiresAt: Number
}));

// --- PLANS ---
const PLANS = {
  "1": { months: 1, price: 10000 },
  "3": { months: 3, price: 25000 },
  "6": { months: 6, price: 50000 }
};

// --- START COMMAND ---
bot.start(async (ctx) => {
  await ctx.reply("👋 Welcome! Please choose a plan:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "1 Month (10000 Ks)", callback_data: "plan:1" }],
        [{ text: "3 Months (25000 Ks)", callback_data: "plan:3" }],
        [{ text: "6 Months (50000 Ks)", callback_data: "plan:6" }]
      ]
    }
  });
});

// --- CHOOSE PLAN ---
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith("plan:")) return;

  const planId = data.split(":")[1];
  const plan = PLANS[planId];

  await Order.create({
    userId: ctx.from.id,
    months: plan.months,
    status: "pending",
    createdAt: Date.now()
  });

  const qr = await QRCode.toBuffer(KPAY_NUMBER);
  await ctx.replyWithPhoto({ source: qr }, {
    caption: `✅ You chose ${plan.months} month(s).\n💵 Price: ${plan.price} Ks\n\n💳 Pay to KBZPay: ${KPAY_NUMBER}\n📷 Then send payment screenshot here.`
  });
});

// --- HANDLE PAYMENT SCREENSHOT ---
bot.on("photo", async (ctx) => {
  const photoId = ctx.message.photo.at(-1).file_id;

  await Order.updateOne(
    { userId: ctx.from.id, status: "pending" },
    { $set: { photoFileId: photoId, status: "awaiting_confirm" } }
  );

  await ctx.forwardMessage(ADMIN_ID);
  await ctx.telegram.sendMessage(ADMIN_ID, `User ${ctx.from.id} sent proof. Reply /confirm ${ctx.from.id} to approve.`);
  await ctx.reply("📩 Payment sent! Waiting for admin confirmation.");
});

// --- ADMIN CONFIRM ---
bot.command("confirm", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = ctx.message.text.split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /confirm <user_id>");
  const userId = Number(parts[1]);

  const order = await Order.findOne({ userId, status: "awaiting_confirm" });
  if (!order) return ctx.reply("No pending order for that user.");

  const expiresAt = Date.now() + (order.months * 30 * 24 * 60 * 60 * 1000);

  const invite = await ctx.telegram.createChatInviteLink(TARGET_CHAT_ID, {
    expire_date: Math.floor(expiresAt / 1000),
    member_limit: 1
  });

  order.status = "confirmed";
  order.inviteLink = invite.invite_link;
  order.expiresAt = expiresAt;
  await order.save();

  await ctx.telegram.sendMessage(userId, `🎉 Payment confirmed!\nHere is your invite link:\n${invite.invite_link}\n\nExpires in ${order.months} month(s).\n\nℹ️ To extend, type /start again.`);
  await ctx.reply(`Confirmed user ${userId} for ${order.months} month(s).`);
});

// --- CRON ENDPOINT (for expiry kicks) ---
export default async function handler(req, res) {
  await bot.handleUpdate(req.body);
  res.status(200).end();
}