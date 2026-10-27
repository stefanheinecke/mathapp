import nodemailer from "nodemailer";

const CANCELLATION_ALERT_EMAIL = process.env.CANCELLATION_ALERT_EMAIL || "stefan.heinecke1@gmail.com";
const DEFAULT_EMAIL_ADDRESS = "stefan.heinecke1@gmail.com";

export async function sendCancellationAlert({ username, currentPeriodEnd, errorMessage }) {
  const user = process.env.SMTP_USER || DEFAULT_EMAIL_ADDRESS;
  const password = process.env.SMTP_PASSWORD;
  if (!password) {
    throw new Error("SMTP_PASSWORD is not configured.");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: (process.env.SMTP_SECURE || "true").toLowerCase() === "true",
    auth: { user, pass: password },
  });
  const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString("de-CH") : "unknown";
  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to: CANCELLATION_ALERT_EMAIL,
    subject: `Manual subscription cancellation required: ${username}`,
    text: [
      `Automatic subscription cancellation failed for user ${username}.`,
      "Please manually cancel the subscription and verify that automatic renewal has stopped.",
      `Recorded access period end: ${periodEnd}.`,
      `Failure: ${errorMessage}`,
    ].join("\n\n"),
  });
}
