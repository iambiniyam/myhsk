#!/usr/bin/env node
// Download the human Tatoeba recordings referenced by the spoken-sentence sprint corpus
// and serve them locally so playback is instant and offline. Attribution is retained in
// each sentence record (Tatoeba audio is CC BY 2.0 FR).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { get } from "node:https";

const ROOT = resolve(import.meta.dirname, "..");
const SPOKEN = resolve(ROOT, "public/content/spoken-sentences.json");
const TARGET = resolve(ROOT, "public/audio/tatoeba");
const CONCURRENCY = 8;

function download(url, target) {
  return new Promise((resolvePromise, reject) => {
    get(url, { headers: { "user-agent": "MyHSK/1.0 tatoeba audio sync", "accept": "audio/*" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, url).toString();
        get(redirectUrl, { headers: { "user-agent": "MyHSK/1.0 tatoeba audio sync", "accept": "audio/*" } }, (redirect) => {
          if (redirect.statusCode !== 200) { redirect.resume(); reject(new Error(`${url} -> ${redirect.statusCode}`)); return; }
          const chunks = [];
          redirect.on("data", (chunk) => chunks.push(chunk));
          redirect.on("end", async () => {
            const body = Buffer.concat(chunks);
            if (body.length < 1024) { reject(new Error(`${url} returned ${body.length} bytes`)); return; }
            await writeFile(target, body);
            resolvePromise();
          });
          redirect.on("error", reject);
        }).on("error", reject);
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
  const spoken = JSON.parse(await readFile(SPOKEN, "utf8"));
  const sentences = spoken.sentences ?? [];
  const remote = sentences.filter((sentence) => typeof sentence.audioNormal === "string" && sentence.audioNormal.includes("tatoeba.org/audio/download/"));
  console.log(`Tatoeba audio to fetch: ${remote.length}`);
  if (!remote.length) return;
  await mkdir(TARGET, { recursive: true });
  let index = 0;
  let ok = 0;
  let failed = 0;
  async function worker() {
    while (index < remote.length) {
      const sentence = remote[index];
      index += 1;
      const id = sentence.audioNormal.match(/download\/(\d+)/)?.[1];
      if (!id) { failed += 1; continue; }
      const target = resolve(TARGET, `${id}.mp3`);
      try {
        await download(sentence.audioNormal, target);
        sentence.audioNormal = `audio/tatoeba/${id}.mp3`;
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await writeFile(SPOKEN, JSON.stringify(spoken, null, 2));
  console.log(`Downloaded ${ok} tatoeba recordings (${failed} failed); spoken corpus now serves audio locally.`);
}

await main();
