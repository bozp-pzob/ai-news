// setupX402Payment.ts
import { Application, RequestHandler } from "express";
import path from "path";
import fs from "fs";
import { HexString } from "../types";
import { toHexString } from "../helpers/generalHelper";
import { paymentMiddleware } from "x402-express";

export function setupX402Payment(app: Application) {
  const ETHEREUM_WALLET: HexString | undefined = toHexString(process.env.ETHEREUM_WALLET);
  const REPORT_USDC_PRICE: string | undefined = process.env.REPORT_USDC_PRICE;

  if (!ETHEREUM_WALLET || !REPORT_USDC_PRICE) return;

  const paywallGate: RequestHandler = (req, res, next) => {
    const url = req.originalUrl;

    // Match /report and /report/* (handles optional trailing slash)
    if (url === "/report" || url === "/report/") {
      const mw = paymentMiddleware(ETHEREUM_WALLET, {
        "/report": {
          price: REPORT_USDC_PRICE,
          network: "base-sepolia",
          config: { description: "Access to generated reports based on data gathered." },
        },
      });
      return mw(req, res, next);
    }
    if (url.startsWith("/report/")) {
      const mw = paymentMiddleware(ETHEREUM_WALLET, {
        [url.replace(/\/+$/, "")]: {
          price: REPORT_USDC_PRICE,
          network: "base-sepolia",
          config: { description: "Access to generated reports based on data gathered." },
        },
      });
      return mw(req, res, next);
    }
    next();
  };

  app.use(paywallGate);

  // GET /report/daily -> default/latest
  app.get("/report/daily", (req, res) => {
    const reportPath = path.join(__dirname, "../../json/daily.json");
    res.sendFile(reportPath, (err) => {
      if (err) {
        console.error("Error sending daily report:", err);
        res.status(500).json({ error: "Failed to retrieve report" });
      }
    });
  });

  // GET /report/daily/:date -> ./json/YYYY-MM-DD.json
  app.get("/report/daily/:date", (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }
    const reportPath = path.join(__dirname, `../../json/${date}.json`);
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: `Report for ${date} not found` });
    }
    res.sendFile(reportPath, (err) => {
      if (err) {
        console.error(`Error sending report for ${date}:`, err);
        res.status(500).json({ error: "Failed to retrieve report" });
      }
    });
  });
}
