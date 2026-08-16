#!/usr/bin/env node
// Download the CosyVoice2 HSK sentence audio pack (no7z/hsk-sentences-audio, CC BY-SA 4.0)
// directly from the HuggingFace resolve URLs and serve it locally from public/audio.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { get } from "node:https";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST = resolve(ROOT, "public/audio/manifest.json");
const TARGET = resolve(ROOT, "public/audio");
const CONCURRENCY = 12;

function download(url, target) {
  return new Promise((resolvePromise, reject) => {
    get(url, { headers: { "user-agent": "MyHSK/1.0 audio pack sync", "accept": "audio/*" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirect = new URL(response.headers.location, url).toString();
        download(redirect, target).then(resolvePromise, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`${url}: ${response.statusCode}`)); return; }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", async () => {
        const body = Buffer.concat(chunks);
        if (body.length < 1024) { reject(new Error(`${url} returned ${body.length} bytes`)); return; }
        await writeFile(target, body);
        resolvePromise();
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const entries = Object.entries(manifest.clips ?? {}).filter(([, clip]) => clip?.normal?.includes("huggingface.co"));
  console.log(`Remote clips to fetch: ${entries.length}`);
  if (!entries.length) return;
  const queue = [];
  for (const [key, clip] of entries) {
    for (const speed of ["normal", "slow"]) {
      const url = clip[speed];
      if (!url || !url.includes("huggingface.co")) continue;
      const name = basename(new URL(url).pathname);
      queue.push({ key, speed, url, name });
    }
  }
  let index = 0;
  let ok = 0;
  let failed = 0;
  async function worker() {
    while (index < queue.length) {
      const item = queue[index];
      index += 1;
      const target = resolve(TARGET, item.name);
      try {
        await download(item.url, target);
        manifest.clips[item.key][item.speed] = `audio/${item.name}`;
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const { readFile: rf } = await import("node:fs/promises");
  const stamp = new Date().toISOString();
  manifest.generatedAt = stamp;
  manifest.source = "no7z/hsk-sentences-audio (CC BY-SA 4.0), CosyVoice2 synthesized";
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Downloaded ${ok} clips (${failed} failed); manifest now serves audio locally.`);
}

await main();
