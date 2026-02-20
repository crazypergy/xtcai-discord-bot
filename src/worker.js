// Basic Cloudflare Worker for Discord Interactions (slash commands)
import { verifySignature } from "./verify.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Discord signature verification
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const publicKey = env.DISCORD_PUBLIC_KEY;
    const body = await request.text();

    if (!signature || !timestamp || !publicKey) {
      return new Response("Missing signature headers", { status: 401 });
    }

    const isValid = await verifySignature(
      publicKey,
      signature,
      timestamp,
      body,
    );
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // Ping-pong for Discord's initial verification
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // Respond to /explain command
    if (interaction.type === 2) {
      if (interaction.data && interaction.data.name === "explain") {
        return Response.json({
          type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
          data: {
            content: "Explain what?",
          },
        });
      } else {
        return Response.json({
          type: 4,
          data: {
            content: "Hello from XCTAI Discord Worker!",
          },
        });
      }
    }

    return new Response("Unhandled interaction", { status: 400 });
  },
};
