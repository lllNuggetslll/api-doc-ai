// Sample Express API used to try out api-doc-ai. Not meant to be run.
import express from "express";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/v1/products", productsRouter);
app.use("/api/v1/orders", requireAuth, ordersRouter);

// All errors use the same envelope.
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status ?? 500).json({ error: { code: err.code ?? "internal_error", message: err.message } });
});

app.listen(3000);
