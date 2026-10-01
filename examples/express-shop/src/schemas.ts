import { z } from "zod";

export const ProductInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "GBP"]).default("USD"),
  category: z.string(),
  stock: z.number().int().min(0).default(0),
});

export const OrderInput = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10) }))
    .min(1),
  shippingAddress: z.object({
    line1: z.string(),
    city: z.string(),
    postalCode: z.string(),
    country: z.string().length(2),
  }),
  note: z.string().max(500).optional(),
});

// Shape returned by the API for a product.
export interface Product {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: "USD" | "EUR" | "GBP";
  category: string;
  stock: number;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  status: "pending" | "paid" | "shipped" | "cancelled";
  items: { productId: string; quantity: number; unitPriceCents: number }[];
  totalCents: number;
  createdAt: string;
}
