import jwt from "jsonwebtoken";

// Expects "Authorization: Bearer <jwt>". Sets req.user = { id, email, role }.
export function requireAuth(req: any, res: any, next: any) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: { code: "unauthorized", message: "Missing bearer token" } });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
    next();
  } catch {
    res.status(401).json({ error: { code: "unauthorized", message: "Invalid token" } });
  }
}

export function requireRole(role: "admin" | "customer") {
  return (req: any, res: any, next: any) => {
    if (req.user?.role !== role) return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    next();
  };
}
