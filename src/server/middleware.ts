import { Request, Response, NextFunction } from "express";

export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
}

export function validateRoomCreate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { userId, name, phone } = req.body;
  if (!userId || !name || !phone) {
    res.status(400).json({
      error: "Missing required fields: userId, name, phone",
    });
    return;
  }
  next();
}

export function validateRoomJoin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { userId, name, phone } = req.body;
  if (!userId || !name || !phone) {
    res.status(400).json({
      error: "Missing required fields: userId, name, phone",
    });
    return;
  }
  next();
}
