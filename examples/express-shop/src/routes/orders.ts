import { Router } from "express";
import { OrderInput } from "../schemas.js";
import { db } from "../db.js";
import { sendOrderConfirmation } from "../email.js";

export const ordersRouter = Router();

// Orders for the signed-in user only.
ordersRouter.get("/", async (req: any, res) => {
  const status = req.query.status as "pending" | "paid" | "shipped" | undefined;
  const orders = await db.orders.listForUser(req.user.id, { status });
  res.json({ data: orders });
});

ordersRouter.post("/", async (req: any, res) => {
  const parsed = OrderInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: "validation_error", message: parsed.error.message } });
  }
  for (const item of parsed.data.items) {
    const product = await db.products.find(item.productId);
    if (!product) return res.status(400).json({ error: { code: "unknown_product", message: `No product ${item.productId}` } });
    if (product.stock < item.quantity) {
      return res.status(409).json({ error: { code: "out_of_stock", message: `${product.name} is out of stock` } });
    }
  }
  const order = await db.orders.create(req.user.id, parsed.data);
  await sendOrderConfirmation(req.user.email, order);
  res.status(201).json({ data: order });
});

ordersRouter.post("/:orderId/cancel", async (req: any, res) => {
  const order = await db.orders.find(req.params.orderId);
  if (!order || order.userId !== req.user.id) {
    return res.status(404).json({ error: { code: "not_found", message: "Order not found" } });
  }
  if (order.status === "shipped") {
    return res.status(409).json({ error: { code: "already_shipped", message: "Shipped orders cannot be cancelled" } });
  }
  const updated = await db.orders.update(order.id, { status: "cancelled" });
  res.json({ data: updated });
});
