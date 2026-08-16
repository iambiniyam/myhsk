import { useEffect, useState } from "react";
import { ArrowRight, BookOpenText, Check, Flame, GitBranch, Library, Shapes, Sparkles } from "lucide-react";
import type { AppState, HskLevel, NetworkData, ReadingStory } from "../types";
import { loadNetworks, loadReadingStories, loadWords } from "../lib/content";
import { updatePreferences } from "../lib/storage";
import { readUiState } from "../lib/persistentUi";
import { buildCourseState, nextFamilySuggestion, nextLevel, type CourseState } from "../lib/course";

export function CourseHome({ state, setState, onStartGroup, onOpenReading, onOpenCharacters }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onStartGroup: () => void;
  onOpenReading: () => void;
  onOpenCharacters: () => void;
}) {
  const [levelWords, setLevelWords] = useState<string[]>([]);
  const [stories, setStories] = useState<ReadingStory[]>([]);
  const [networks, setNetworks] = useState<NetworkData>();

  useEffect(() => {
    let cancelled = false;
    void loadWords(state.preferences.level).then((entries) => { if (!cancelled) setLevelWords(entries.map((entry) => entry.word)); });
    void loadReadingStories().then((list) => { if (!cancelled) setStories(list); });
    void loadNetworks().then((data) => { if (!cancelled) setNetworks(data); });
    return () => { cancelled = true; };
  }, [state.preferences.level]);

  const [course, setCourse] = useState<CourseState>();
  useEffect(() => {
    let cancelled = false;
    void buildCourseState(state, levelWords).then((result) => { if (!cancelled) setCourse(result); });
    return () => { cancelled = true; };
  }, [levelWords, state]);

  if (!course) return <div className="course-home course-loading"><span className="skeleton"/></div>;

  const learnerLevel = state.preferences.level === "7-9" ? 7 : Number(state.preferences.level);
  const readingProgress = readUiState<Record<string, number>>("reading-progress", {});
  const story = stories.find((item) => item.hskLevel <= Math.min(6, learnerLevel + 1) && (readingProgress[item.id] ?? 0) < item.sentences.length);
  const family = nextFamilySuggestion(networks, state, state.preferences.level);
  const next = nextLevel(state.preferences.level);
  const dueTotal = course.dueWords + course.dueCharacters;
  const percent = Math.round(course.levelProgress * 100);
  const shownSkills = ["recognition", "meaning", "sound", "context"] as const;

  return <section className="course-home" aria-label="Your course">
    <div className="course-head">
      <div><span className="eyebrow">SELF-PACED COURSE</span><h2>Your learning path</h2><p>Learn as much as you want — every group adapts to your memory, so nothing is wasted.</p></div>
      <span className="course-streak"><Flame size={16}/><strong>{course.streak}</strong><small>day streak</small></span>
    </div>

    <div className="course-progress">
      <div className="course-progress-label"><span>HSK {course.level} · {course.masteredAtLevel.toLocaleString()} of {course.levelTotal.toLocaleString()} words</span><strong>{percent}%</strong></div>
      <div className="course-progress-track"><span style={{ width: `${percent}%` }}/></div>
      {course.readyForNextLevel && next && <div className="course-levelup"><Check size={14}/> <span>Level complete — you're ready for HSK {next}.</span><button onClick={() => setState((current) => updatePreferences(current, { level: next as HskLevel }))}>Move up <ArrowRight size={14}/></button></div>}
    </div>

    <button className="course-continue" onClick={onStartGroup}>
      <Sparkles size={20}/>
      <span><strong>Continue learning</strong><small>{dueTotal > 0 ? `${dueTotal} review${dueTotal === 1 ? "" : "s"} due + a fresh connected family` : "Start a connected family"}</small></span>
      <ArrowRight size={18}/>
    </button>

    <div className="course-next">
      {family && <button onClick={onStartGroup}><GitBranch size={17}/><span><strong>{family.title}</strong><small>{family.kind} · {family.wordCount} connected words</small></span><ArrowRight size={15}/></button>}
      {story && <button onClick={onOpenReading}><Library size={17}/><span><strong>{story.chineseTitle || story.title}</strong><small>HSK {story.hskLevel} story · {story.minutes} min</small></span><ArrowRight size={15}/></button>}
      <button onClick={onOpenCharacters}><Shapes size={17}/><span><strong>Character reading path</strong><small>Clue sets for the characters in your words</small></span><ArrowRight size={15}/></button>
    </div>

    <div className="course-week">
      <div><span>This week</span><strong>{course.weekWords} words</strong><small>last 7 days</small></div>
      {shownSkills.map((skill) => course.weekAccuracy[skill] !== undefined && <div key={skill}><span>{skill}</span><strong className={course.weekAccuracy[skill]! >= 80 ? "strong" : ""}>{course.weekAccuracy[skill]}%</strong><small>accuracy</small></div>)}
    </div>
  </section>;
}
