import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];
const words = (await Promise.all(levelFiles.map(async (file) => JSON.parse(await readFile(path.join(content, "hsk", file), "utf8"))))).flat();
const characters = JSON.parse(await readFile(path.join(content, "characters.json"), "utf8"));
const frequency = JSON.parse(await readFile(path.join(content, "frequency.json"), "utf8"));
const sentences = JSON.parse(await readFile(path.join(content, "sentences", "hsk.json"), "utf8"));
const openDictionary = JSON.parse(await readFile(path.join(content, "open-dictionary.json"), "utf8"));

const cjk = /[\u3400-\u9fff]/u;
const levelValue = (level) => level === "7-9" ? 7 : Number(level);
const stripTone = (pinyin = "") => pinyin.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\d/g, "").toLowerCase();
const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
const pinyinFinal = (pinyin = "") => { const base = stripTone(pinyin).replace(/ü/g, "v"); return initials.find((initial) => base.startsWith(initial)) ? base.slice(initials.find((initial) => base.startsWith(initial)).length) : base; };
const usefulSemanticComponents = new Set(["亻", "人", "女", "子", "口", "讠", "言", "忄", "心", "扌", "手", "氵", "水", "火", "灬", "木", "艹", "日", "月", "目", "耳", "足", "辶", "宀", "门", "钅", "金", "饣", "食", "衤", "衣", "纟", "糸", "疒", "虫", "贝", "力", "页", "土", "石", "车", "雨", "竹", "米", "禾", "阝", "刂", "刀", "攵", "广", "厂", "穴", "皿", "舟", "马", "鸟", "鱼"]);
const charRank = (char) => frequency[char]?.rank ?? 12000;
const averageRank = (text) => {
  const chars = [...text].filter((char) => cjk.test(char));
  return chars.length ? chars.reduce((sum, char) => sum + charRank(char), 0) / chars.length : 12000;
};
const stopWords = new Set(["的", "了", "是", "在", "我", "你", "他", "她", "它", "我们", "你们", "他们", "这", "那", "这个", "那个", "和", "与", "也", "都", "很", "有", "没有", "没", "不", "把", "被", "吗", "呢", "吧", "啊", "呀", "着", "过", "就", "还", "又", "再", "才", "而", "但", "或", "因为", "所以", "如果", "那么", "一个", "一些", "什么", "怎么", "为什么", "谁", "哪里", "哪儿", "这里", "那里", "自己", "已经", "可以", "可能", "应该", "需要", "会", "能", "要", "让", "给", "对", "从", "到", "为", "以", "于", "及", "并", "地", "得", "所", "其", "之", "并且", "而且", "或者", "还是", "比较", "非常", "真", "最", "更", "太", "挺", "请"]);
const unsafeChunkEdges = new Set([...stopWords, "您", "她们", "个", "位", "张", "条", "次", "种", "些"]);
const wordsByText = new Map(words.map((word) => [word.word, word]));
const openByWord = new Map(openDictionary.map((word) => [word.word, word]));
const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));

function shortGloss(value = "") {
  return value.split(/[;(（]/)[0].replace(/^to\s+/i, "").trim().slice(0, 58);
}

const wordToSentences = new Map();
for (const sentence of sentences) {
  for (const token of new Set(sentence.words ?? [])) {
    if (!wordToSentences.has(token)) wordToSentences.set(token, []);
    wordToSentences.get(token).push(sentence);
  }
}

function candidateSentences(targets, fallbackPool = sentences) {
  const found = new Map();
  for (const target of targets) for (const sentence of wordToSentences.get(target) ?? []) found.set(sentence.id, sentence);
  return found.size ? [...found.values()] : fallbackPool;
}

function wordScore(word) {
  const level = levelValue(word.level);
  const length = [...word.word].filter((char) => cjk.test(char)).length;
  const rankScore = 1 - Math.min(1, averageRank(word.word) / 12000);
  const lengthScore = length === 2 ? 1 : length === 3 ? 0.75 : length === 1 ? 0.62 : 0.45;
  const posScore = /名|动|形|副/.test(word.partOfSpeech ?? "") ? 0.15 : 0;
  return (8 - level) * 0.26 + rankScore * 2.2 + lengthScore + posScore;
}

function sentenceCoverage(sentence, targets) {
  let score = 0;
  for (const target of targets) {
    if (sentence.words?.includes(target)) score += 4;
    else if (sentence.chinese.includes(target)) score += 2;
  }
  if (sentence.chinese.length <= 28) score += 1.2;
  if (sentence.chinese.length > 55) score -= 1;
  return score;
}

function chooseSentences(targets, pool = sentences, limit = 10) {
  const remaining = new Set(targets);
  const selected = [];
  const source = pool === sentences ? candidateSentences(targets, pool) : pool;
  const candidates = source.map((sentence) => ({ sentence, base: sentenceCoverage(sentence, targets) })).filter((item) => item.base > 0);
  while (selected.length < limit && candidates.length) {
    candidates.sort((a, b) => {
      const aNew = [...remaining].reduce((sum, target) => sum + (a.sentence.chinese.includes(target) ? 1 : 0), 0);
      const bNew = [...remaining].reduce((sum, target) => sum + (b.sentence.chinese.includes(target) ? 1 : 0), 0);
      return (b.base + bNew * 3) - (a.base + aNew * 3) || a.sentence.chinese.length - b.sentence.chinese.length;
    });
    const chosen = candidates.shift();
    if (!chosen) break;
    selected.push(chosen.sentence.id);
    for (const target of targets) if (chosen.sentence.chinese.includes(target)) remaining.delete(target);
  }
  return selected;
}

function collocationsFor(targets, pool = sentences, limit = 10) {
  const counts = new Map();
  const targetSet = new Set(targets);
  const source = pool === sentences ? candidateSentences(targets, pool) : pool;
  for (const sentence of source) {
    const tokens = sentence.words ?? [];
    for (let i = 0; i < tokens.length; i += 1) {
      if (!targetSet.has(tokens[i])) continue;
      for (const [start, end] of [[i - 1, i + 1], [i, i + 2]]) {
        if (start >= 0 && end <= tokens.length) {
          const parts = tokens.slice(start, end);
          if (unsafeChunkEdges.has(parts[0]) || unsafeChunkEdges.has(parts.at(-1))) continue;
          const phrase = parts.join("");
          const exact = openByWord.get(phrase);
          const english = shortGloss(exact?.definitions?.[0]);
          if (phrase.length >= 2 && phrase.length <= 8 && exact?.pinyin && english) {
            const current = counts.get(phrase) ?? { count: 0, pinyin: exact.pinyin, english };
            current.count += 1;
            counts.set(phrase, current);
          }
        }
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([phrase, data]) => ({ phrase, pinyin: data.pinyin, english: data.english, count: data.count }));
}

// Productive character-centered word webs.
const charToWords = new Map();
for (const word of words) {
  for (const char of new Set([...word.word].filter((item) => cjk.test(item)))) {
    if (!charToWords.has(char)) charToWords.set(char, []);
    charToWords.get(char).push(word);
  }
}
const wordWebs = [...charToWords.entries()]
  .filter(([char, entries]) => entries.length >= 7 && charRank(char) <= 5000)
  .map(([anchor, entries]) => {
    const sorted = [...entries].sort((a, b) => wordScore(b) - wordScore(a));
    const unique = [...new Map(sorted.map((word) => [word.word, word])).values()].slice(0, 30);
    const targetWords = unique.map((word) => word.word);
    return {
      id: `web-${anchor}`,
      anchor,
      title: `${anchor} word web`,
      subtitle: `Build ${targetWords.length} useful compounds around one reusable character.`,
      minLevel: Math.min(...unique.map((word) => levelValue(word.level))),
      wordKeys: targetWords,
      sentenceIds: chooseSentences(targetWords, sentences, 10),
      collocations: collocationsFor(targetWords, sentences, 10),
      productivity: entries.length,
      frequencyRank: charRank(anchor),
    };
  })
  .sort((a, b) => (b.productivity / Math.sqrt(b.frequencyRank)) - (a.productivity / Math.sqrt(a.frequencyRank)))
  .slice(0, 500);

// Phonetic families: same sound-bearing component, with member pronunciations kept visible rather than assumed identical.
const phoneticGroups = new Map();
for (const [char, data] of Object.entries(characters)) {
  const phonetic = data.etymology?.phonetic;
  if (!phonetic || !cjk.test(phonetic[0] ?? "") || charRank(char) > 8500) continue;
  if (!phoneticGroups.has(phonetic)) phoneticGroups.set(phonetic, []);
  phoneticGroups.get(phonetic).push(char);
}
const soundFamilies = [...phoneticGroups.entries()]
  .filter(([, members]) => new Set(members).size >= 4)
  .map(([component, rawMembers]) => {
    const members = [...new Set(rawMembers)]
      .sort((a, b) => charRank(a) - charRank(b))
      .slice(0, 14)
      .map((char) => ({
        char,
        pinyin: characters[char]?.pinyin ?? [],
        definition: characters[char]?.definition ?? "",
        semantic: characters[char]?.etymology?.semantic ?? characters[char]?.radical ?? "",
      }));
    const bases = members.flatMap((member) => member.pinyin.slice(0, 1).map(pinyinFinal));
    const counts = new Map(); for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
    const [dominant, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const coherence = bases.length ? dominantCount / bases.length : 0;
    const relatedWords = words.filter((word) => members.some((member) => word.word.includes(member.char))).sort((a, b) => wordScore(b) - wordScore(a));
    const uniqueWords = [...new Map(relatedWords.map((word) => [word.word, word])).values()].slice(0, 28);
    return {
      id: `sound-${component}`,
      component,
      title: `${component} sound family`,
      subtitle: `Compare ${members.length} characters that share a phonetic clue${dominant ? ` near “${dominant}”` : ""}.`,
      minLevel: uniqueWords.length ? Math.min(...uniqueWords.map((word) => levelValue(word.level))) : 1,
      coherence,
      members,
      wordKeys: uniqueWords.map((word) => word.word),
      sentenceIds: chooseSentences(uniqueWords.map((word) => word.word), sentences, 9),
    };
  })
  .filter((family) => family.coherence >= 0.5)
  .sort((a, b) => b.coherence - a.coherence || b.members.length - a.members.length || charRank(a.members[0]?.char ?? "") - charRank(b.members[0]?.char ?? ""))
  .slice(0, 180);

// Semantic component families.
const semanticGroups = new Map();
for (const [char, data] of Object.entries(characters)) {
  const component = data.etymology?.semantic || data.radical;
  if (!component || !usefulSemanticComponents.has(component) || charRank(char) > 9000) continue;
  if (!semanticGroups.has(component)) semanticGroups.set(component, []);
  semanticGroups.get(component).push(char);
}
const meaningFamilies = [...semanticGroups.entries()]
  .filter(([, members]) => new Set(members).size >= 6)
  .map(([component, rawMembers]) => {
    const members = [...new Set(rawMembers)].sort((a, b) => charRank(a) - charRank(b)).slice(0, 16).map((char) => ({
      char,
      pinyin: characters[char]?.pinyin ?? [],
      definition: characters[char]?.definition ?? "",
      hint: characters[char]?.etymology?.hint ?? "",
    }));
    const relatedWords = words.filter((word) => members.some((member) => word.word.includes(member.char))).sort((a, b) => wordScore(b) - wordScore(a));
    const uniqueWords = [...new Map(relatedWords.map((word) => [word.word, word])).values()].slice(0, 30);
    return {
      id: `meaning-${component}`,
      component,
      title: `${component} meaning family`,
      subtitle: `Use a recurring meaning component to organize ${members.length} high-value characters.`,
      minLevel: uniqueWords.length ? Math.min(...uniqueWords.map((word) => levelValue(word.level))) : 1,
      members,
      wordKeys: uniqueWords.map((word) => word.word),
      sentenceIds: chooseSentences(uniqueWords.map((word) => word.word), sentences, 9),
    };
  })
  .sort((a, b) => b.members.length - a.members.length || charRank(a.members[0]?.char ?? "") - charRank(b.members[0]?.char ?? ""))
  .slice(0, 160);

const scenarioLabels = {
  greetings: ["Meeting people", "Introductions, greetings, and polite first exchanges."],
  identity: ["Identity and relationships", "Talk about yourself, other people, roles, and relationships."],
  daily_actions: ["Daily routines", "Describe what people do from morning to night."],
  school_work: ["School and work", "Study, meetings, tasks, progress, and professional communication."],
  shopping: ["Shopping and services", "Prices, choices, payment, delivery, and customer service."],
  transport: ["Transport and directions", "Move around cities, ask directions, and plan journeys."],
  health_body: ["Health and the body", "Symptoms, care, exercise, and practical medical language."],
  food: ["Food and restaurants", "Order, describe tastes, cook, and talk about meals."],
  feelings: ["Feelings and opinions", "Express reactions, emotions, preferences, and judgments."],
  time: ["Time and planning", "Dates, schedules, duration, frequency, and deadlines."],
  location: ["Places and positions", "Find, describe, and compare locations."],
  weather_state: ["Weather and conditions", "Weather, states, changes, and everyday conditions."],
  sports_leisure: ["Leisure and interests", "Hobbies, sports, entertainment, and free time."],
  family: ["Family life", "Family members, home relationships, and shared activities."],
  questions: ["Questions and clarification", "Ask accurately, confirm meaning, and keep conversations moving."],
  nature: ["Nature and the environment", "Animals, plants, geography, and environmental topics."],
  numbers: ["Numbers and quantities", "Count, compare, calculate, and discuss amounts."],
  objects_misc: ["Objects and descriptions", "Everyday objects, properties, and practical descriptions."],
  misc: ["Everyday connectors", "High-frequency expressions that connect many real situations."],
};
const topicGroups = Map.groupBy ? Map.groupBy(sentences, (sentence) => sentence.topic) : sentences.reduce((map, sentence) => {
  const list = map.get(sentence.topic) ?? [];
  list.push(sentence);
  map.set(sentence.topic, list);
  return map;
}, new Map());
const automaticScenarios = [...topicGroups.entries()].map(([topic, pool]) => {
  const counts = new Map();
  for (const sentence of pool) for (const token of sentence.words ?? []) {
    if (!wordsByText.has(token) || stopWords.has(token) || token.length > 5) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const selected = [...counts.entries()]
    .map(([word, count]) => ({ word: wordsByText.get(word), count }))
    .filter((item) => item.word)
    .sort((a, b) => (b.count * 0.7 + wordScore(b.word)) - (a.count * 0.7 + wordScore(a.word)))
    .slice(0, 34)
    .map((item) => item.word.word);
  const [title, description] = scenarioLabels[topic] ?? [topic, "A thematic pack built from graded sentence contexts."];
  return {
    id: `scenario-${topic}`,
    topic,
    title,
    subtitle: description,
    minLevel: Math.min(...pool.map((sentence) => sentence.hskLevel)),
    wordKeys: selected,
    sentenceIds: chooseSentences(selected, pool, 12),
    collocations: collocationsFor(selected, pool, 12),
  };
}).sort((a, b) => a.minLevel - b.minLevel || a.title.localeCompare(b.title));


const curatedScenarioBlueprints = [
  ["first-day-work", "First day at work", "Introductions, roles, departments, office routines, and asking for help.", ["公司","同事","部门","工作","负责","介绍","认识","办公室","经理","项目","任务","帮助","问题","学习","开始","欢迎","联系","安排"]],
  ["daily-standup", "Daily stand-up", "Report yesterday's work, today's plan, progress, blockers, and next steps.", ["昨天","今天","完成","正在","计划","进度","问题","影响","解决","继续","下一步","负责","预计","需要","确认","更新","报告","风险"]],
  ["project-planning", "Project planning", "Goals, scope, milestones, ownership, resources, deadlines, and risks.", ["项目","目标","范围","计划","阶段","任务","负责","资源","时间","截止","风险","优先","安排","需求","方案","决定","调整","完成"]],
  ["meeting-discussion", "Meetings and discussion", "Join a meeting, raise a point, ask questions, and summarize decisions.", ["会议","讨论","问题","意见","建议","提出","说明","确认","同意","不同","决定","结论","记录","参加","补充","重点","原因","下一步"]],
  ["technical-debugging", "Technical debugging", "Reproduce a problem, inspect logs, test hypotheses, and identify root causes.", ["技术","系统","问题","错误","异常","故障","复现","日志","检查","分析","原因","根本","假设","验证","配置","环境","影响","解决"]],
  ["software-testing", "Software testing", "Test cases, expected results, failures, regression, and validation.", ["软件","测试","用例","结果","预期","实际","通过","失败","步骤","条件","环境","版本","修复","回归","验证","稳定","功能","性能"]],
  ["bug-report", "Reporting a bug", "Describe what happened clearly and request the right follow-up.", ["发现","问题","发生","情况","步骤","每次","偶尔","无法","导致","影响","日志","截图","版本","设备","建议","排查","处理","回复"]],
  ["clarification", "Clarification and confirmation", "Understand fast conversations and prevent workplace misunderstandings.", ["意思","理解","明白","确认","解释","重复","慢","具体","例如","也就是说","如果","正确","清楚","区别","指的是","是不是","对吗","请问"]],
  ["feedback", "Giving useful feedback", "Praise strengths, describe problems, and suggest improvements politely.", ["反馈","表现","优点","问题","建议","改进","提高","清楚","具体","准确","有效","需要","可以","最好","希望","注意","继续","感谢"]],
  ["priority-deadline", "Priorities and deadlines", "Decide what is urgent, important, delayed, or ready to ship.", ["优先","重要","紧急","任务","时间","截止","延期","按时","尽快","完成","安排","影响","风险","目前","预计","提前","推迟","交付"]],
  ["presentation", "Presenting an idea", "Introduce background, explain evidence, and end with a recommendation.", ["介绍","背景","目的","主要","数据","结果","原因","分析","说明","重点","首先","然后","最后","总结","建议","方案","风险","问题"]],
  ["decision-making", "Decision-making", "Compare options, discuss trade-offs, and choose a direction.", ["选择","决定","方案","方法","优点","缺点","成本","效果","风险","影响","比较","考虑","适合","支持","反对","同意","建议","最终"]],
  ["work-messages", "Work chat and messages", "Send concise updates, requests, acknowledgments, and follow-ups.", ["收到","好的","明白","请","麻烦","确认","稍等","马上","处理","完成","更新","回复","发送","文件","消息","联系","跟进","谢谢"]],
  ["customer-support", "Customer support", "Understand a problem, apologize, troubleshoot, and propose a solution.", ["客户","服务","问题","订单","使用","情况","抱歉","影响","检查","提供","信息","解决","处理","退款","更换","联系","满意","感谢"]],
  ["restaurant", "Restaurant essentials", "Choose dishes, order naturally, describe taste, and pay.", ["餐厅","菜单","点菜","米饭","面条","肉","菜","汤","辣","甜","味道","好吃","推荐","一份","不要","买单","服务员","打包"]],
  ["coffee-social", "Coffee and casual conversation", "Invite someone, chat comfortably, and keep a conversation going.", ["咖啡","喝","一起","有空","最近","工作","生活","喜欢","兴趣","周末","怎么样","其实","当然","可以","聊天","认识","开心","下次"]],
  ["grocery-shopping", "Grocery shopping", "Find products, compare quality, ask prices, and choose quantities.", ["超市","东西","水果","蔬菜","牛奶","价格","多少钱","便宜","贵","新鲜","质量","公斤","一些","需要","选择","买","付款","袋子"]],
  ["online-shopping", "Online shopping", "Search, compare, order, track delivery, return, and review products.", ["网上","商品","搜索","价格","评价","质量","选择","购买","订单","付款","快递","发货","收到","退货","退款","客服","地址","优惠"]],
  ["delivery-return", "Delivery and returns", "Handle packages, address problems, and request exchanges or refunds.", ["快递","包裹","地址","电话","送到","收到","签收","损坏","错误","缺少","退货","换货","退款","联系","客服","照片","证明","处理"]],
  ["public-transport", "Public transport", "Read signs, buy tickets, transfer, and ask where to get off.", ["地铁","公交车","车站","路线","方向","上车","下车","换乘","出口","入口","票","到达","经过","附近","多久","分钟","地图","交通"]],
  ["taxi-directions", "Taxi and directions", "Explain a destination, route, distance, and preferred drop-off point.", ["出租车","司机","地址","去","到","路","左边","右边","前面","后面","附近","距离","堵车","快","慢","停","这里","导航"]],
  ["hotel", "Hotel stay", "Book, check in, request help, and solve room problems.", ["酒店","预订","房间","入住","退房","护照","前台","钥匙","早餐","网络","空调","干净","安静","问题","更换","服务","晚上","费用"]],
  ["airport-train", "Airport and train travel", "Tickets, luggage, gates, delays, and arrival information.", ["机场","火车站","飞机","火车","票","护照","行李","登机","出发","到达","时间","晚点","取消","入口","出口","座位","检查","旅行"]],
  ["doctor", "Doctor visit", "Describe symptoms, duration, pain, medicine, and medical advice.", ["医生","医院","身体","不舒服","疼","发烧","咳嗽","头疼","肚子","多久","检查","药","吃药","休息","严重","健康","治疗","需要"]],
  ["pharmacy", "At the pharmacy", "Ask what medicine is for, how to take it, and what to avoid.", ["药店","药","症状","感冒","过敏","一天","一次","饭前","饭后","注意","不能","可以","说明","效果","副作用","医生","需要","购买"]],
  ["exercise-health", "Exercise and health", "Build routines around sleep, food, exercise, and energy.", ["运动","锻炼","健康","身体","睡觉","休息","饮食","习惯","每天","坚持","跑步","走路","力量","感觉","精神","提高","减少","保持"]],
  ["making-friends", "Making friends", "Introduce yourself, find shared interests, invite, and stay in touch.", ["朋友","认识","介绍","来自","工作","学习","喜欢","兴趣","一起","有空","周末","吃饭","喝咖啡","联系","微信","聊天","高兴","下次"]],
  ["family-home", "Family and home", "Talk about relatives, household routines, responsibilities, and plans.", ["家庭","家人","父母","孩子","丈夫","妻子","哥哥","姐姐","住","房子","做饭","打扫","照顾","一起","周末","生活","关系","计划"]],
  ["renting-home", "Renting and housing", "Discuss rent, contracts, repairs, utilities, and moving.", ["房子","房间","租","房租","合同","押金","水","电","网络","家具","搬家","维修","坏","联系","房东","附近","交通","安全"]],
  ["weather-plans", "Weather and plans", "Use forecasts and changing conditions to make practical plans.", ["天气","今天","明天","晴","下雨","下雪","冷","热","温度","风","可能","准备","带","衣服","出门","计划","改变","取消"]],
  ["feelings", "Feelings and reactions", "Express mood, stress, surprise, disappointment, and satisfaction naturally.", ["心情","开心","高兴","难过","生气","紧张","担心","压力","累","满意","失望","惊讶","害怕","希望","感觉","原因","影响","放松"]],
  ["opinions", "Opinions and disagreement", "State a view, explain reasons, agree partly, and disagree politely.", ["觉得","认为","看法","意见","同意","不同意","理由","原因","因为","但是","虽然","可能","确实","其实","方面","考虑","理解","道理"]],
  ["social-media", "Social media", "Understand posts, comments, recommendations, trends, and reactions.", ["社交","网络","平台","发布","内容","视频","照片","评论","关注","分享","推荐","热门","网友","消息","真实","有趣","喜欢","影响"]],
  ["news", "News and current events", "Read headlines, identify events, sources, causes, and consequences.", ["新闻","报道","发生","事件","社会","国家","政府","经济","文化","国际","目前","表示","根据","原因","影响","结果","发展","情况"]],
  ["reading-books", "Reading Chinese books", "Follow characters, events, dialogue, description, and narrative time.", ["阅读","书","故事","小说","作者","人物","内容","章节","开始","后来","最后","发生","发现","告诉","想法","感觉","理解","意思"]],
  ["learning-chinese", "Learning Chinese", "Discuss goals, methods, mistakes, practice, and improvement.", ["中文","汉字","词语","句子","语法","发音","声调","阅读","写作","听力","口语","练习","复习","记住","忘记","错误","进步","方法"]],
  ["technology", "Technology and devices", "Talk about phones, computers, apps, networks, and settings.", ["技术","电脑","手机","设备","软件","应用","系统","网络","文件","数据","设置","安装","下载","更新","账号","密码","功能","使用"]],
  ["ai-data", "AI and data", "Discuss models, training, data, results, accuracy, and practical use.", ["人工智能","模型","数据","训练","学习","算法","结果","准确","性能","分析","生成","内容","工具","应用","技术","提高","问题","安全"]],
  ["research", "Research and evidence", "Form questions, gather data, analyze, compare, and report conclusions.", ["研究","问题","方法","数据","资料","调查","实验","分析","比较","结果","发现","证据","证明","结论","报告","准确","影响","限制"]],
  ["money-banking", "Money and banking", "Payments, accounts, transfers, budgets, and common financial problems.", ["钱","银行","账户","银行卡","现金","付款","支付","转账","收入","费用","价格","预算","密码","安全","成功","失败","记录","确认"]],
  ["emergency", "Emergencies", "Ask for urgent help, describe danger, location, injury, and immediate needs.", ["紧急","帮助","危险","安全","报警","警察","医院","受伤","火","事故","地址","位置","马上","联系","电话","等待","离开","注意"]],
  ["culture", "Culture and traditions", "Discuss festivals, customs, food, history, and cultural differences.", ["文化","传统","节日","春节","习惯","历史","国家","地方","活动","家庭","食物","庆祝","礼物","特别","不同","了解","尊重","有意思"]],
  ["goals-growth", "Goals and personal growth", "Set goals, make plans, persist, measure progress, and reflect.", ["目标","计划","希望","决定","开始","坚持","努力","习惯","每天","进步","提高","完成","困难","改变","成功","经验","总结","未来"]],
];

const curatedScenarios = curatedScenarioBlueprints.map(([id, title, subtitle, requested]) => {
  const wordKeys = requested.filter((item) => wordsByText.has(item));
  return {
    id: `scenario-curated-${id}`,
    topic: id,
    title,
    subtitle,
    minLevel: wordKeys.length ? Math.min(...wordKeys.map((item) => levelValue(wordsByText.get(item).level))) : 1,
    wordKeys,
    sentenceIds: chooseSentences(wordKeys, sentences, 14),
    collocations: collocationsFor(wordKeys, sentences, 14),
  };
}).filter((pack) => pack.wordKeys.length >= 8);

const scenarios = [...automaticScenarios, ...curatedScenarios]
  .filter((pack, index, values) => values.findIndex((other) => other.id === pack.id) === index)
  .sort((a, b) => a.minLevel - b.minLevel || a.title.localeCompare(b.title));

const contrastBlueprints = [
  ["methods", "Method, approach, or plan?", ["方法", "办法", "方案"], "Compare a general method, a practical way to solve something, and a planned proposal."],
  ["problems", "Problem, error, fault, or anomaly?", ["问题", "错误", "故障", "异常"], "Separate general issues from mistakes, equipment faults, and abnormal states."],
  ["thinking", "Think, believe, or mistakenly assume?", ["觉得", "认为", "以为"], "Distinguish personal impressions, considered opinions, and assumptions that may be wrong."],
  ["understanding", "Know, understand, or become clear?", ["知道", "了解", "理解", "明白"], "Move from knowing a fact to understanding background, logic, or meaning."],
  ["receiving", "Accept or receive?", ["接受", "接收", "收到"], "Compare accepting an idea, receiving a signal or item, and confirming receipt."],
  ["requirements", "Need, must, or should?", ["需要", "必须", "应该"], "Separate practical need, strict necessity, and recommendation or expectation."],
  ["finding", "Discover or invent?", ["发现", "发明"], "One finds what already exists; the other creates something new."],
  ["suitability", "Suitable or fitting?", ["适合", "合适"], "Compare a verb-like fit relationship with an adjective-like judgment."],
  ["completion", "Finally, in the end, or ultimately?", ["终于", "最后", "最终"], "Separate relief after a process, sequence position, and formal final outcome."],
  ["changes", "Change, modify, adjust, or optimize?", ["改变", "修改", "调整", "优化"], "Distinguish broad change, editing, tuning, and improvement."],
  ["checking", "Look, inspect, examine, or observe?", ["看", "查看", "检查", "观察"], "Choose the natural verb for casual seeing, information lookup, verification, or careful observation."],
  ["results", "Result or conclusion?", ["结果", "结论"], "A result is what happened; a conclusion is the judgment drawn from evidence."],
  ["continue", "Continue, persist, or be continuous?", ["继续", "持续", "连续", "坚持"], "Separate continuing an action, lasting over time, an unbroken sequence, and persistent effort."],
  ["improve", "Improve, raise, or increase?", ["提高", "提升", "增加", "改进"], "Compare raising a measurable level, upgrading quality, adding quantity, and improving a method."],
  ["requirement", "Requirement, demand, or need?", ["要求", "需求", "需要"], "Distinguish what someone asks for, a documented demand, and a practical need."],
  ["finish", "Complete, end, or achieve?", ["完成", "结束", "实现", "达到"], "Separate finishing a task, ending an event, realizing a goal, and reaching a target."],
  ["experience", "Experience or life event?", ["经验", "经历"], "经验 is knowledge gained; 经历 is what someone went through."],
  ["habit", "Adapt or become accustomed?", ["适应", "习惯"], "适应 emphasizes adjusting; 习惯 emphasizes a stable accustomed state or routine."],
  ["accuracy", "Correct or accurate?", ["正确", "准确", "精确"], "Choose between general correctness, accuracy, and technical precision."],
  ["importance", "Important, main, or primary?", ["重要", "主要", "重点", "首要"], "Separate importance, the main part, a focus point, and the first priority."],
  ["connection", "Contact, connect, or relationship?", ["联系", "连接", "关系"], "Compare communicating, physically or technically connecting, and a relationship."],
  ["effect", "Influence, effect, or function?", ["影响", "效果", "作用"], "Separate influence on something, a visible outcome, and a functional role."],
  ["evidence", "Prove, evidence, or certificate?", ["证明", "证据", "证件"], "Distinguish the act or document of proving, supporting evidence, and an identity document."],
  ["reason", "Cause or reason?", ["原因", "理由"], "原因 explains causation; 理由 is a reason offered to justify a choice or claim."],
  ["punctual", "Timely, on time, or punctual?", ["及时", "按时", "准时"], "及时 means before it is too late; 按时 follows a schedule; 准时 is punctual."],
  ["immediate", "Immediately: 马上, 立刻, or 立即?", ["马上", "立刻", "立即"], "All mean immediately, with different conversational and formal tendencies."],
  ["simple-easy", "Simple or easy?", ["简单", "容易"], "简单 describes low complexity; 容易 describes low difficulty or high likelihood."],
  ["hard", "Difficult or hard?", ["困难", "难", "难以"], "Compare a noun/adjective challenge, everyday 难, and formal 'difficult to'."],
  ["chance", "Opportunity or possibility?", ["机会", "可能"], "机会 is a favorable chance; 可能 expresses possibility or likelihood."],
  ["together", "Together or in total?", ["一起", "一共"], "一起 means jointly; 一共 gives a total quantity."],
  ["previous", "Already, once, or before?", ["已经", "曾经", "以前"], "Separate a completed current-state change, past experience, and an earlier time."],
].map(([id, title, items, subtitle]) => {
  const wordKeys = items.filter((item) => wordsByText.has(item));
  return { id: `contrast-${id}`, title, subtitle, minLevel: Math.min(...wordKeys.map((item) => levelValue(wordsByText.get(item).level))), wordKeys, sentenceIds: chooseSentences(wordKeys, sentences, 10), collocations: collocationsFor(wordKeys, sentences, 12) };
}).filter((set) => set.wordKeys.length >= 2);

const output = {
  generatedAt: new Date().toISOString(),
  sourceCounts: { words: words.length, characters: Object.keys(characters).length, sentences: sentences.length },
  wordWebs,
  soundFamilies,
  meaningFamilies,
  scenarios,
  contrastSets: contrastBlueprints,
};
await writeFile(path.join(content, "networks.json"), JSON.stringify(output));
console.log(`Networks ready: ${wordWebs.length} word webs, ${soundFamilies.length} sound families, ${meaningFamilies.length} meaning families, ${scenarios.length} scenarios, ${contrastBlueprints.length} contrast sets.`);
