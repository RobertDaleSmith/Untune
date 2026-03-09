import type { VercelRequest, VercelResponse } from "@vercel/node";
import Redis from "ioredis";

const TOKEN_REGEX = /^[0-9a-f]{64}$/;
const MAX_BODY = 2048;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_REDIS_URL;
    if (!url) throw new Error("UPSTASH_REDIS_REST_REDIS_URL not set");
    redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }
  return redis;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const token = req.query.token;

  if (typeof token !== "string" || !TOKEN_REGEX.test(token)) {
    res.status(400).send("Invalid token");
    return;
  }

  const key = `handoff:${token}`;
  const client = getRedis();

  if (req.method === "GET") {
    const state = await client.get(key);
    if (state === null) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(state);
    return;
  }

  if (req.method === "PUT") {
    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (body.length > MAX_BODY) {
      res.status(413).send("Body too large");
      return;
    }

    try {
      JSON.parse(body);
    } catch {
      res.status(400).send("Invalid JSON");
      return;
    }

    await client.set(key, body, "EX", TTL_SECONDS);
    res.status(200).send("OK");
    return;
  }

  res.status(405).send("Method not allowed");
}
