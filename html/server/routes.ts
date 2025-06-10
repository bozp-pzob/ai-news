import type { Express } from "express";
import { createServer, type Server } from "http";

export function registerRoutes(app: Express): Server {
  // put application routes here
  // prefix all routes with /api

  const httpServer = createServer(app);

  return httpServer;
}
