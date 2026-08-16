import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];
const words = (await Promise.all(levelFiles.map(async (file) => JSON.parse(await readFile(path.join(content, "hsk", file), "utf8"))))).flat();
const characters = JSON.parse(await readFile(path.join(content, "characters.json"), "utf8"));
const frequency = JSON.parse(await readFile(path.join(content, "frequency.json"), "utf8"));
const networks = JSON.parse(await readFile(path.join(content, "networks.json"), "utf8"));
const sentences = JSON.parse(await readFile(path.join(content, "sentences", "hsk.json"), "utf8"));
const shardCount = 64;
const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
const cjk = /[\u3400-\u9fff]/u;
const glossOverrides = new Map([
  ["的", "structural and possessive particle"], ["了", "completed-action or change-of-state particle"],
  ["地", "earth; ground; adverb marker"], ["得", "obtain; complement marker"], ["着", "ongoing-action or state particle"],
  ["过", "pass; experienced-action marker"], ["和", "and; with"], ["是", "be; is; are"], ["有", "have; there is"],
  ["在", "at; in; be doing"], ["要", "want; need; will"], ["还", "still; also; return"], ["就", "then; exactly; as early as"],
  ["才", "only then; not until"], ["把", "handle; object-disposal marker"], ["被", "passive marker"],
  ["吗", "yes-or-no question particle"], ["呢", "question or topic particle"], ["吧", "suggestion or softening particle"],
]);

const visualGroups = [
  ["人", "入", "八"], ["土", "士"], ["未", "末"], ["己", "已", "巳"], ["日", "目", "曰"],
  ["口", "囗"], ["木", "本"], ["牛", "午"], ["大", "太", "犬"], ["千", "干"],
  ["今", "令"], ["问", "间", "闻"], ["请", "清", "情", "晴", "睛"], ["休", "体"],
  ["白", "百", "自"], ["刀", "力"], ["开", "井"], ["贝", "见"], ["王", "玉", "主"],
  ["厂", "广"], ["右", "石"], ["住", "往"], ["乌", "鸟"], ["候", "侯"],
  ["拔", "拨"], ["喝", "渴"], ["买", "卖"], ["休", "体", "本"], ["折", "拆"],
];

function shortGloss(value) {
  const text = String(value ?? "").split(/[;；]/)[0].replace(/^to\s+/i, "").trim();
  return text.length <= 72 ? text : `${text.slice(0, 69).replace(/\s+\S*$/u, "")}…`;
}

function levelOrder(level) { return levels.indexOf(level); }

function shardFor(character) {
  let hash = 2166136261;
  hash ^= character.codePointAt(0) ?? 0;
  hash = Math.imul(hash, 16777619);
  return (hash >>> 0) % shardCount;
}

const headwords = new Map();
for (const entry of words) {
  const existing = headwords.get(entry.word);
  if (!existing || levelOrder(entry.level) < levelOrder(existing.level)) headwords.set(entry.word, entry);
}

const wordsByCharacter = new Map();
const firstLevel = new Map();
for (const entry of headwords.values()) {
  for (const character of new Set(Array.from(entry.word).filter((value) => cjk.test(value)))) {
    if (!wordsByCharacter.has(character)) wordsByCharacter.set(character, []);
    wordsByCharacter.get(character).push(entry);
    const current = firstLevel.get(character);
    if (!current || levelOrder(entry.level) < levelOrder(current)) firstLevel.set(character, entry.level);
  }
}

const componentPower = new Map();
for (const data of Object.values(characters)) {
  for (const component of new Set([data.etymology?.semantic, data.etymology?.phonetic, data.radical].filter(Boolean))) {
    componentPower.set(component, (componentPower.get(component) ?? 0) + 1);
  }
}

const sentenceByCharacter = new Map();
for (const sentence of sentences) {
  for (const character of new Set(Array.from(sentence.chinese).filter((value) => cjk.test(value)))) {
    if (!sentenceByCharacter.has(character)) sentenceByCharacter.set(character, []);
    sentenceByCharacter.get(character).push(sentence);
  }
}

const index = [...firstLevel.keys()].map((character) => {
  const data = characters[character];
  const standalone = headwords.get(character);
  const containingWords = wordsByCharacter.get(character) ?? [];
  const fallbackRank = Math.min(...containingWords.map((word) => frequency[word.word]?.rank ?? 99999));
  return {
    char: character,
    pinyin: [...new Set([standalone?.pinyin, ...data.pinyin].filter(Boolean))].join(" · "),
    english: shortGloss(glossOverrides.get(character) || data.definition),
    level: firstLevel.get(character),
    frequencyRank: frequency[character]?.rank ?? fallbackRank,
    radical: data.radical ?? "",
    strokes: data.strokes ?? 0,
    wordCount: containingWords.length,
    componentPower: componentPower.get(character) ?? 0,
  };
}).sort((a, b) => levelOrder(a.level) - levelOrder(b.level) || teachingPriority(a) - teachingPriority(b) || a.char.localeCompare(b.char, "zh-CN"));

function teachingPriority(entry) {
  const frequency = Math.min(12000, entry.frequencyRank);
  const wordValue = Math.min(120, entry.wordCount) * 28;
  const reusableComponentValue = Math.min(80, entry.componentPower) * 34;
  const formCost = Math.max(0, entry.strokes - 4) * 12;
  return frequency - wordValue - reusableComponentValue + formCost;
}

const indexMap = new Map(index.map((entry) => [entry.char, entry]));
const compactMember = (character) => indexMap.get(character);
const familyFromNetwork = (network, kind) => ({
  id: network.id,
  kind,
  component: network.component,
  title: kind === "meaning" ? `${network.component} meaning clue` : `${network.component} sound clue`,
  subtitle: network.subtitle,
  minLevel: (network.minLevel || 1) >= 7 ? "7-9" : String(network.minLevel || 1),
  members: network.members.map((member) => compactMember(member.char)).filter(Boolean),
});

const meaningFamilies = networks.meaningFamilies.map((network) => familyFromNetwork(network, "meaning"));
const soundFamilies = networks.soundFamilies.map((network) => familyFromNetwork(network, "sound"));
const visualFamilies = visualGroups.map((group, indexNumber) => {
  const members = group.map(compactMember).filter(Boolean);
  return {
    id: `visual-${indexNumber + 1}`,
    kind: "visual",
    component: members.map((member) => member.char).join(" · "),
    title: "Look-alike contrast",
    subtitle: "Read the small shape differences before they become guessing habits.",
    minLevel: members.sort((a, b) => levelOrder(a.level) - levelOrder(b.level))[0]?.level ?? "1",
    members,
  };
}).filter((family) => family.members.length >= 2);

const familyByCharacter = { meaning: new Map(), sound: new Map(), visual: new Map() };
for (const family of meaningFamilies) for (const member of family.members) if (!familyByCharacter.meaning.has(member.char)) familyByCharacter.meaning.set(member.char, family.id);
for (const family of soundFamilies) for (const member of family.members) if (!familyByCharacter.sound.has(member.char)) familyByCharacter.sound.set(member.char, family.id);
for (const family of visualFamilies) for (const member of family.members) if (!familyByCharacter.visual.has(member.char)) familyByCharacter.visual.set(member.char, family.id);

function wordScore(word, character) {
  const startsWith = word.word.startsWith(character) ? 0 : 1;
  return levelOrder(word.level) * 100000 + startsWith * 10000 + (frequency[word.word]?.rank ?? 9999) + word.word.length * 10;
}

const detailShards = Array.from({ length: shardCount }, () => ({}));
for (const entry of index) {
  const data = characters[entry.char];
  const characterWords = [...(wordsByCharacter.get(entry.char) ?? [])]
    .sort((a, b) => wordScore(a, entry.char) - wordScore(b, entry.char))
    .slice(0, 18)
    .map((word) => ({ word: word.word, pinyin: word.pinyin, english: shortGloss(word.definitions.find(Boolean)), level: word.level }));
  const preferredWords = new Set(characterWords.slice(0, 8).map((word) => word.word));
  const examples = [...(sentenceByCharacter.get(entry.char) ?? [])]
    .sort((a, b) => Number(!a.words?.some((word) => preferredWords.has(word))) - Number(!b.words?.some((word) => preferredWords.has(word))) || Math.abs(a.hskLevel - Number(entry.level === "7-9" ? 7 : entry.level)) - Math.abs(b.hskLevel - Number(entry.level === "7-9" ? 7 : entry.level)) || a.chinese.length - b.chinese.length)
    .filter((sentence, indexNumber, source) => source.findIndex((candidate) => candidate.chinese === sentence.chinese) === indexNumber)
    .slice(0, 5);
  detailShards[shardFor(entry.char)][entry.char] = {
    ...entry,
    definition: [...new Set([glossOverrides.get(entry.char), data.definition].filter(Boolean))].join("; "),
    decomposition: data.decomposition ?? "",
    type: data.etymology?.type ?? "",
    hint: data.etymology?.hint ?? "",
    semantic: data.etymology?.semantic ?? data.radical ?? "",
    phonetic: data.etymology?.phonetic ?? "",
    words: characterWords,
    examples,
    familyIds: {
      meaning: familyByCharacter.meaning.get(entry.char),
      sound: familyByCharacter.sound.get(entry.char),
      visual: familyByCharacter.visual.get(entry.char),
    },
  };
}

const directory = path.join(content, "character-curriculum");
await rm(directory, { recursive: true, force: true });
await mkdir(path.join(directory, "details"), { recursive: true });
await writeFile(path.join(directory, "index.json"), JSON.stringify(index));
await writeFile(path.join(directory, "families.json"), JSON.stringify({ generatedAt: new Date().toISOString(), meaning: meaningFamilies, sound: soundFamilies, visual: visualFamilies }));
await Promise.all(detailShards.map((shard, shardIndex) => writeFile(path.join(directory, "details", `${String(shardIndex).padStart(2, "0")}.json`), JSON.stringify(shard))));
await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  characters: index.length,
  shardCount,
  levelCounts: Object.fromEntries(levels.map((level) => [level, index.filter((entry) => entry.level === level).length])),
  familyCounts: { meaning: meaningFamilies.length, sound: soundFamilies.length, visual: visualFamilies.length },
}));
console.log(`Character curriculum ready: ${index.length.toLocaleString()} HSK characters, ${meaningFamilies.length + soundFamilies.length + visualFamilies.length} clue families.`);
