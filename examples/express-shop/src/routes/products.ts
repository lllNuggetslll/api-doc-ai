import { Router } from "express";
import { ProductInput } from "../schemas.js";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const productsRouter = Router();

// Public: list products with pagination and optional category filter.
productsRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const cursor = req.query.cursor as string | undefined;
  const category = req.query.category as string | undefined;
  const { items, nextCursor } = await db.products.list({ limit, cursor, category });
  res.json({ data: items, nextCursor });
});

productsRouter.get("/:id", async (req, res) => {
  const product = await db.products.find(req.params.id);
  if (!product) return res.status(404).json({ error: { code: "not_found", message: "Product not found" } });
  res.json({ data: product });
});

productsRouter.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = ProductInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: "validation_error", message: parsed.error.message } });
  }
  const product = await db.products.create(parsed.data);
  res.status(201).json({ data: product });
});

productsRouter.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const deleted = await db.products.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: { code: "not_found", message: "Product not found" } });
  res.status(204).end();
});
