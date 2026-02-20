var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/verify.js
async function verifySignature(publicKey, signature, timestamp, body) {
  function hexToUint8Array(hex) {
    return new Uint8Array(
      hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
    );
  }
  __name(hexToUint8Array, "hexToUint8Array");
  const encoder = new TextEncoder();
  const publicKeyUint8 = hexToUint8Array(publicKey);
  const signatureUint8 = hexToUint8Array(signature);
  const dataUint8 = encoder.encode(timestamp + body);
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyUint8,
    { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
    false,
    ["verify"]
  );
  return await crypto.subtle.verify(
    "NODE-ED25519",
    key,
    signatureUint8,
    dataUint8
  );
}
__name(verifySignature, "verifySignature");

// src/worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
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
      body
    );
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }
    const interaction = JSON.parse(body);
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }
    if (interaction.type === 2) {
      if (interaction.data && interaction.data.name === "explain") {
        let cardName = "Lightning Bolt";
        if (interaction.data.options && Array.isArray(interaction.data.options)) {
          const cardOption = interaction.data.options.find(
            (opt) => opt.name === "card"
          );
          if (cardOption && cardOption.value) {
            cardName = cardOption.value;
          }
        }
        const scryfallUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
        const scryfallHeaders = {
          "User-Agent": "xtcai-discord-bot/1.0 (https://github.com/crazypergy/xctai)",
          Accept: "application/json"
        };
        try {
          const scryfallResp = await fetch(scryfallUrl, {
            headers: scryfallHeaders
          });
          const debugInfo = `Scryfall URL: ${scryfallUrl}
Status: ${scryfallResp.status}`;
          if (!scryfallResp.ok) {
            const errorText = await scryfallResp.text();
            return Response.json({
              type: 4,
              data: {
                content: `Card not found: ${cardName}
${debugInfo}
Scryfall error: ${errorText}`
              }
            });
          }
          const cardData = await scryfallResp.json();
          if (!cardData.oracle_text) {
            return Response.json({
              type: 4,
              data: {
                content: `No text box found for this card.
${debugInfo}
Scryfall data: ${JSON.stringify(cardData)}`
              }
            });
          }
          let rulingsText = "";
          if (cardData.rulings_uri) {
            try {
              const rulingsResp = await fetch(cardData.rulings_uri, {
                headers: scryfallHeaders
              });
              if (rulingsResp.ok) {
                const rulingsData = await rulingsResp.json();
                if (rulingsData.data && rulingsData.data.length > 0) {
                  rulingsText = "\n\nRulings:";
                  for (const ruling of rulingsData.data) {
                    rulingsText += `
- (${ruling.published_at}) ${ruling.comment}`;
                  }
                }
              }
            } catch (e) {
              rulingsText += `

[Error fetching rulings: ${e && e.message ? e.message : e}]`;
            }
          }
          const aiInput = `Card: ${cardName}
Text: ${cardData.oracle_text}${rulingsText}`;
          let aiResponse = "";
          try {
            const geminiResp = await fetch(
              "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + env.GEMINI_API_KEY,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: aiInput }] }]
                })
              }
            );
            if (geminiResp.ok) {
              const geminiData = await geminiResp.json();
              aiResponse = geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts && geminiData.candidates[0].content.parts[0].text ? geminiData.candidates[0].content.parts[0].text : "[No AI response]";
            } else {
              aiResponse = `[Gemini error: ${geminiResp.status}]`;
            }
          } catch (e) {
            aiResponse = `[Gemini error: ${e && e.message ? e.message : e}]`;
          }
          return Response.json({
            type: 4,
            data: { content: aiResponse }
          });
        } catch (e) {
          return Response.json({
            type: 4,
            data: {
              content: `Error fetching card: ${cardName}
${e && e.message ? e.message : e}`
            }
          });
        }
      } else {
        return Response.json({
          type: 4,
          data: {
            content: "Hello from XCTAI Discord Worker!"
          }
        });
      }
    }
    return new Response("Unhandled interaction", { status: 400 });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
