import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "telegram-bot-api", ".next"],
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      // Satisfies adapters/database/mongoose.ts's module-load-time guard.
      // Tests never actually connect with this value — see
      // tests/helpers/testDb.ts, which pre-populates the shared connection
      // cache with a real mongodb-memory-server connection before any route
      // handler gets a chance to call connectDB().
      MONGODB_URI: "mongodb://placeholder-unused",
      // Fixed value so tests can compute a matching Telegram widget HMAC
      // (see server/auth/telegram.test.ts) without touching the real .env.
      TELEGRAM_BOT_TOKEN: "test-bot-token",
    },
  },
});
