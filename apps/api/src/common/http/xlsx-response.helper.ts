import type { Response } from "express";

export function sendXlsxResponse(
  res: Response,
  fileName: string,
  buffer: Buffer,
): void {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.send(buffer);
}
