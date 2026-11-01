import app from "./app";
import { logger } from "./lib/logger";
import { assertEncryptionConfiguration } from "./privacy/crypto-config";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Production boots refuse insecure configuration (cookies, database TLS,
// password hashing) — fail loud before the listener accepts traffic.
assertEncryptionConfiguration(process.env)
  .catch((error: unknown) => {
    logger.error({ err: error }, "Encryption configuration check failed");
    process.exit(1);
  })
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  });
