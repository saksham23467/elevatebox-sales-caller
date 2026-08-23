# ElevateBox voice agent

Live outbound sales agent. It calls a lead, sells e-commerce website development in Telugu / Hindi / English, classifies Hot / Warm / Cold, sends WhatsApp **during** the call on high intent, books spoken callbacks, then follows up with call context, resume, number, and the architecture image.

This is a working prototype, not a deck.

## Stack

- Voice + India telephony: OmniDimension (Soniox STT, female voice, office noise, interruptions)
- Decision engine + scheduler: this Node server
- WhatsApp: Baileys (WAPI-style session — required so resume + image can go out without a 24h Cloud API window)
- LLM: GPT-4.1-mini on the call; OpenAI key in `.env` for local helpers

## One-time setup

1. Copy `.env.example` → `.env` (already filled for local use except OmniDimension).
2. Create an OmniDimension account: https://omnidim.io — API key at https://omnidim.io/api-management — add INR credits for a few minutes. Paste `OMNIDIM_API_KEY` into `.env`.
3. Install and run:

```bash
npm install
npm run dev
```

4. Expose the server. OmniDimension must reach `/tools/*` **while the call is live**:

```bash
npx --yes cloudflared tunnel --url http://localhost:3000
```

Put the `https://…trycloudflare.com` URL in `.env` as `PUBLIC_URL`, restart, then:

```bash
npm run setup-agent
```

That creates the agent, post-call webhook, and (if the API allows) the three mid-call tools. If a tool fails to attach, add it in the OmniDimension dashboard → Integrations → Custom API:

| Name | URL | When |
|---|---|---|
| Classify Lead | `PUBLIC_URL/tools/classify` | enough signal |
| Send WhatsApp Now | `PUBLIC_URL/tools/send-whatsapp` | Hot, or they asked for details |
| Book Callback | `PUBLIC_URL/tools/book-callback` | they named a time |

Header on every tool: `X-Tool-Secret: ` value from `.env`.

5. Open http://localhost:3000 and scan the WhatsApp QR (Linked devices). Wait until the pill is **ready**.
6. Click **Test: call my number first**. Say “send me the details”. WhatsApp should arrive before you hang up.
7. Only then click **Call +91 86886 64337**.

## Scoring map

| They check | Where it lives |
|---|---|
| Dials itself | `POST /api/call` → OmniDimension `dispatchCall` |
| Language | Agent prompt + Soniox + `languages: English (India), Hindi, Telugu` |
| Discovery | Prompt: one question at a time |
| Classify | `src/qualify/classify.ts` + mid-call tool |
| Mid-call WhatsApp | `/tools/send-whatsapp` |
| Callback | `src/schedule/parseTime.ts` + worker |
| Follow-up packet | `/webhooks/omnidim` + `src/whatsapp/copy.ts` |

Keep receipts. They reimburse API spend if you join.
