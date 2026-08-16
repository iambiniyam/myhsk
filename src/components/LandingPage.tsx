import { ArrowRight, BookOpenText, Check, Cloud, GitBranch, Search, Shapes, Volume2 } from "lucide-react";
import type { AuthSessionData } from "../lib/auth";

export function LandingPage({ session, onStart, onAccount }: {
  session?: AuthSessionData | null;
  onStart: () => void;
  onAccount: () => void;
}) {
  return <div className="landing-page">
    <header className="landing-nav">
      <button className="brand landing-brand" aria-label="MyHSK home"><span className="brand-mark">汉</span><span><strong>MyHSK</strong><small>Words · Characters</small></span></button>
      <div>
        <button className="landing-signin" onClick={onAccount}>{session ? session.user.name.split(" ")[0] : "Sign in"}</button>
        <button className="landing-nav-cta" onClick={onStart}>Open MyHSK</button>
      </div>
    </header>

    <main>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="eyebrow">CHINESE THAT CONNECTS</span>
          <h1>Learn words in families.<br/><em>Read characters by clues.</em></h1>
          <p>Search the complete HSK 3.0 vocabulary, open any word, and learn how it connects to useful phrases, situations, and characters.</p>
          <div className="landing-actions">
            <button className="landing-primary" onClick={onStart}>Start learning free <ArrowRight size={18}/></button>
            <button className="landing-secondary" onClick={onAccount}>{session ? "View saved progress" : "Save progress across devices"}</button>
          </div>
          <div className="landing-proof"><span><Check size={14}/> No account required</span><span><Check size={14}/> Full HSK 3.0 syllabus</span><span><Check size={14}/> Mobile first</span></div>
        </div>

        <div className="landing-demo" aria-label="Connected vocabulary example">
          <div className="demo-search"><Search size={17}/><span>Search Chinese, pinyin, or English</span></div>
          <div className="demo-anchor"><span>学</span><div><small>THE FAMILY CLUE</small><strong>xué · learn, study</strong></div><Volume2 size={17}/></div>
          <div className="demo-family">
            <article><strong>学习</strong><span>xuéxí</span><small>to study; to learn</small></article>
            <article><strong>学生</strong><span>xuésheng</span><small>student</small></article>
            <article><strong>学校</strong><span>xuéxiào</span><small>school</small></article>
            <article><strong>同学</strong><span>tóngxué</span><small>classmate</small></article>
          </div>
          <footer><GitBranch size={16}/><span><strong>Learn the connection</strong><small>One useful family, remembered as a system</small></span></footer>
        </div>
      </section>

      <section className="landing-numbers" aria-label="MyHSK coverage">
        <div><strong>11,000+</strong><span>official syllabus entries</span></div>
        <div><strong>7 levels</strong><span>HSK 1 through 7–9</span></div>
        <div><strong>2 paths</strong><span>words and character reading</span></div>
      </section>

      <section className="landing-method">
        <div className="landing-section-heading"><span className="eyebrow">TWO FOCUSED TOOLS</span><h2>Everything needed.<br/>Nothing distracting.</h2><p>MyHSK separates vocabulary and character reading, then connects them exactly where the connection helps.</p></div>
        <div className="landing-method-grid">
          <article className="landing-feature words-feature">
            <div><BookOpenText size={21}/><span>01</span></div>
            <h3>Master vocabulary</h3>
            <p>Open any HSK word and understand pronunciation, meanings, character chunks, natural examples, related words, and useful collocations.</p>
            <ul><li><Check size={14}/> Search every level</li><li><Check size={14}/> Mark Learning or Known</li><li><Check size={14}/> Study complete connected groups</li></ul>
            <button onClick={onStart}>Explore words <ArrowRight size={16}/></button>
          </article>
          <article className="landing-feature characters-feature">
            <div><Shapes size={21}/><span>02</span></div>
            <h3>Learn to read characters</h3>
            <p>Build recognition from reusable meaning, sound, and visual clues—then meet each character inside high-value words.</p>
            <div className="character-family-demo"><span><b>青</b><small>qīng</small></span><i>→</i><span><b>清</b><small>qīng</small></span><span><b>情</b><small>qíng</small></span><span><b>请</b><small>qǐng</small></span></div>
            <button onClick={onStart}>Explore characters <ArrowRight size={16}/></button>
          </article>
        </div>
      </section>

      <section className="landing-sync">
        <div><Cloud size={28}/><span className="eyebrow">OPTIONAL ACCOUNT</span><h2>Start now. Save when it matters.</h2><p>Learning works immediately on this device. Create a free account whenever you want secure sessions and synchronized progress across devices.</p></div>
        <button onClick={onAccount}>{session ? "Open my account" : "Create a free account"}<ArrowRight size={17}/></button>
      </section>
    </main>

    <footer className="landing-footer"><span><strong>MyHSK</strong> · Learn connected Chinese</span><div><a href="/privacy">Privacy</a><button onClick={onStart}>Start learning</button></div></footer>
  </div>;
}
