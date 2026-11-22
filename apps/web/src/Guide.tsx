import { useEffect, useRef, useState } from 'react';
import { CLASSIC, Card, scoreColumn } from '@el/engine';
import { CardBack, CardFace } from './cards';
import { Glyph, SUITS, suitVars } from './theme';

/** 게임 방법 열기 버튼 + 모달 */
export function GuideButton({ className = 'btn ghost', label = '게임 방법' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label={label}>
        📖 <span className="guide-label">{label}</span>
      </button>
      {open && <GuideModal onClose={() => setOpen(false)} />}
    </>
  );
}

const SECTIONS = [
  { id: 'goal', title: '목표' },
  { id: 'parts', title: '구성' },
  { id: 'turn', title: '내 차례' },
  { id: 'column', title: '탐험대 규칙' },
  { id: 'discard', title: '버림 더미' },
  { id: 'score', title: '점수 계산' },
  { id: 'end', title: '판의 끝' },
  { id: 'multi', title: '3~4인 · 팀전' },
  { id: 'custom', title: '규칙 설정' },
  { id: 'ui', title: '화면 사용법' },
];

let uid = 0;
const k = (color: number, value: number): Card => ({ id: `g${uid++}`, color, value }) as Card;

/** 짧은 플레이 영상 (자동 재생·반복·무음). 파일이 없으면 숨김 */
function Clip({ src, caption }: { src: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="g-clip">
      <video src={src} autoPlay muted loop playsInline preload="metadata" onError={() => setFailed(true)} aria-label={caption} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** 탐험대 한 줄 그림 + 점수 풀이 */
function Column({ cards, note, bad }: { cards: Card[]; note?: React.ReactNode; bad?: number }) {
  return (
    <div className="g-col">
      <div className="g-col-cards">
        {cards.map((c, i) => (
          <span key={c.id} className={`g-col-card ${bad === i ? 'bad' : ''}`}>
            <CardFace card={c} size="sm" />
            {bad === i && <span className="g-x">✕</span>}
          </span>
        ))}
      </div>
      {note && <div className="g-col-note">{note}</div>}
    </div>
  );
}

function ScoreLine({ cards }: { cards: Card[] }) {
  const s = scoreColumn(CLASSIC, cards);
  const mult = s.wagers + 1;
  return (
    <span>
      합 <b>{s.sum}</b> − 비용 {CLASSIC.expeditionCost} = <b className={s.sum - CLASSIC.expeditionCost < 0 ? 'neg' : ''}>{s.sum - CLASSIC.expeditionCost}</b>
      {mult > 1 && (
        <>
          {' '}
          × 투자 배수 <b>{mult}</b>
        </>
      )}
      {s.bonus > 0 && (
        <>
          {' '}
          + 보너스 <b>{s.bonus}</b>
        </>
      )}{' '}
      → <b className={`g-total ${s.total < 0 ? 'neg' : ''}`}>{s.total}점</b>
    </span>
  );
}

export function GuideModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState('goal');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id.replace('g-', ''));
      },
      { root, rootMargin: '0px 0px -65% 0px' },
    );
    root.querySelectorAll('section[id^="g-"]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  const go = (id: string) => (setActive(id), body.current?.querySelector(`#g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  const exGood = [k(0, 0), k(0, 3), k(0, 5), k(0, 6), k(0, 8), k(0, 9)];
  const exBad = [k(1, 4), k(1, 7)];
  const exBig = [k(3, 0), k(3, 0), k(3, 2), k(3, 3), k(3, 4), k(3, 6), k(3, 7), k(3, 9), k(3, 10)];

  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label="게임 방법" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="g-sheet">
        <header className="g-head">
          <div className="g-title">
            <span className="g-logo" aria-hidden>
              <Glyph color={2} size={22} />
            </span>
            <div>
              <h2>게임 방법</h2>
              <span className="muted small">Expedition Lines · 2~4인 · 한 판 약 15~20분</span>
            </div>
          </div>
          <button className="icon-btn g-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <nav className="g-nav" aria-label="목차">
          {SECTIONS.map((s, i) => (
            <button key={s.id} className={`chip ${active === s.id ? 'on' : ''}`} onClick={() => go(s.id)}>
              <span className="g-num">{i + 1}</span> {s.title}
            </button>
          ))}
        </nav>
        <div className="g-body" ref={body}>
          <section id="g-goal">
            <h3>1. 목표</h3>
            <p>
              다섯 지역으로 <b>탐험대</b>를 보내 점수를 모읍니다. 탐험대는 같은 색 카드를 <b>작은 숫자부터 큰 숫자 순서로</b> 쌓은 줄이에요.
              탐험을 시작하면 <b>비용 20점</b>을 먼저 내야 하므로, 끝까지 키울 수 있는 탐험대만 시작하는 게 핵심입니다.
            </p>
            <div className="g-row">
              <Column cards={exGood} note={<ScoreLine cards={exGood} />} />
            </div>
          </section>

          <section id="g-parts">
            <h3>2. 구성</h3>
            <div className="g-parts">
              <div className="g-part">
                <span className="g-part-art">
                  {[0, 1, 2, 3, 4].map((c) => (
                    <span key={c} className="g-suit" style={suitVars(c)}>
                      <Glyph color={c} size={16} />
                    </span>
                  ))}
                </span>
                <b>5개 지역(색)</b>
                <span>{SUITS.slice(0, 5).map((s) => s.name).join(' · ')}. 설정에서 2~6색으로 바꿀 수 있어요(6번째는 성운).</span>
              </div>
              <div className="g-part">
                <span className="g-part-art">
                  <CardFace card={k(1, 2)} size="sm" />
                  <CardFace card={k(1, 10)} size="sm" />
                </span>
                <b>숫자 카드 2~10</b>
                <span>색마다 9장. 숫자가 클수록 그림 속 목적지가 가까워져요.</span>
              </div>
              <div className="g-part">
                <span className="g-part-art">
                  <CardFace card={k(4, 0)} size="sm" />
                </span>
                <b>투자 카드</b>
                <span>색마다 3장. 탐험대 점수를 2배·3배·4배로 키우지만, 손해도 같이 커져요.</span>
              </div>
              <div className="g-part">
                <span className="g-part-art">
                  <CardBack size="sm" />
                  <CardBack size="sm" />
                </span>
                <b>덱 · 손패 8장</b>
                <span>각자 8장을 들고 시작. 손패는 나만 보여요.</span>
              </div>
            </div>
          </section>

          <section id="g-turn">
            <h3>3. 내 차례 — 내려놓고, 가져오기</h3>
            <ol className="g-steps">
              <li>
                <b>① 카드 1장 내려놓기</b> — 내 탐험대(같은 색 줄)에 <b>놓거나</b>, 같은 색 <b>버림 더미에 버립니다</b>.
              </li>
              <li>
                <b>② 카드 1장 가져오기</b> — <b>덱</b> 맨 위, 또는 아무 색 <b>버림 더미의 맨 위</b> 카드.
              </li>
            </ol>
            <p className="muted small">차례마다 손패는 항상 8장으로 돌아와요. 위쪽 배너가 지금 할 단계(① → ②)를 알려줘요.</p>
            <Clip src="/guide/play.mp4" caption="카드를 끌어다 탐험대에 놓고, 덱에서 1장 가져오기" />
          </section>

          <section id="g-column">
            <h3>4. 탐험대 규칙</h3>
            <ul className="g-list">
              <li>
                같은 색 줄에는 <b>앞 카드보다 큰 숫자만</b> 놓을 수 있어요. 3 다음에 7은 되지만, 7 다음에 5는 안 돼요.
              </li>
              <li>
                <b>투자 카드는 숫자 카드보다 먼저</b>만 놓을 수 있어요. 숫자를 하나라도 놓았으면 그 줄엔 투자 불가.
              </li>
              <li>건너뛴 숫자는 다시 돌아갈 수 없으니, 작은 숫자를 아껴 두는 것도 전략이에요.</li>
            </ul>
            <div className="g-row">
              <Column cards={[k(2, 0), k(2, 3), k(2, 7), k(2, 5)]} bad={3} note={<span>7 다음에 5 ✕ — 이 카드는 버림 더미로</span>} />
              <Column cards={[k(4, 4), k(4, 0)]} bad={1} note={<span>숫자 뒤에 투자 ✕</span>} />
            </div>
            <p className="muted small">설정의 "같은 숫자 이어 놓기 허용"을 켜면 같은 숫자도 놓을 수 있어요(4인용 2벌 덱에 권장).</p>
          </section>

          <section id="g-discard">
            <h3>5. 버림 더미</h3>
            <ul className="g-list">
              <li>색마다 하나씩. 버린 카드는 그 색 더미 맨 위에 쌓여요.</li>
              <li>
                가져올 때는 <b>맨 위 카드만</b>. 그리고 <b>방금 버린 카드는 같은 차례에 다시 가져올 수 없어요</b>.
              </li>
              <li>내가 버린 카드는 상대가 가져갈 수 있어요 — 상대 탐험대에 딱 맞는 카드는 버리지 마세요!</li>
              <li>더미에 마우스를 올리거나(휴대폰은 장수 배지를 탭) 쌓인 카드를 펼쳐볼 수 있어요.</li>
            </ul>
            <Clip src="/guide/discard.mp4" caption="버림 더미 위에 올리면 쌓인 카드가 스르륵 펼쳐져요" />
          </section>

          <section id="g-score">
            <h3>6. 점수 계산</h3>
            <p>
              시작한 탐험대마다 <b>(숫자 합 − 20) × (투자 카드 수 + 1)</b>. 카드가 <b>8장 이상</b>이면 <b>+20 보너스</b>(배수 적용 안 함).
              시작하지 않은 색은 0점.
            </p>
            <div className="g-examples">
              <Column cards={exGood} note={<ScoreLine cards={exGood} />} />
              <Column cards={exBad} note={<ScoreLine cards={exBad} />} />
              <Column cards={exBig} note={<ScoreLine cards={exBig} />} />
            </div>
            <p className="muted small">게임 중 각 줄 아래의 작은 숫자가 지금 점수예요 (설정에서 끌 수 있음).</p>
          </section>

          <section id="g-end">
            <h3>7. 판의 끝</h3>
            <ul className="g-list">
              <li>
                누군가 <b>덱의 마지막 장</b>을 가져가면 그 즉시 판이 끝나요. 덱이 얼마 안 남으면 경고가 떠요.
              </li>
              <li>버림 더미에서 가져오면 덱이 줄지 않으니, 시간을 끄는 데 쓸 수 있어요.</li>
              <li>여러 판을 하면 점수를 합산해요. 판마다 선은 바뀌어요.</li>
            </ul>
            <Clip src="/guide/results.mp4" caption="마지막 차례와 점수표" />
          </section>

          <section id="g-multi">
            <h3>8. 3~4인 · 팀전</h3>
            <ul className="g-list">
              <li>
                <b>3인</b>: 6색·숫자 2~12로 카드를 늘리는 "3인 권장" 프리셋.
              </li>
              <li>
                <b>4인</b>: 같은 덱 2벌을 섞고 같은 숫자를 허용하는 "4인 권장" 프리셋.
              </li>
              <li>
                <b>2:2 팀전</b>: 좌석 1·3 vs 2·4, 팀원 점수를 합산해요.
              </li>
              <li>로비 아래에 "1인당 약 몇 턴"이 보여요 — 너무 짧으면 경고가 떠요.</li>
            </ul>
          </section>

          <section id="g-custom">
            <h3>9. 규칙 설정 (방장)</h3>
            <div className="g-table">
              <div>
                <b>색 · 숫자 범위</b>
                <span>2~6색, 가장 작은/큰 숫자</span>
              </div>
              <div>
                <b>투자 카드 · 덱 배수</b>
                <span>색당 0~5장, 1~3벌</span>
              </div>
              <div>
                <b>손패</b>
                <span>4~10장</span>
              </div>
              <div>
                <b>탐험대 비용</b>
                <span>숫자 범위에 맞춘 권장값 버튼</span>
              </div>
              <div>
                <b>보너스</b>
                <span>기준 장수·점수·배수 적용</span>
              </div>
              <div>
                <b>판 수 · 턴 시간</b>
                <span>1~5판, 시간 초과 시 자동 진행</span>
              </div>
              <div>
                <b>버림 더미 펼쳐보기</b>
                <span>원작은 맨 위만 보임</span>
              </div>
              <div>
                <b>방금 버린 카드 금지</b>
                <span>원작 규칙 (끌 수 있음)</span>
              </div>
            </div>
            <Clip src="/guide/lobby.mp4" caption="로비: QR로 초대하고 프리셋으로 규칙 고르기" />
          </section>

          <section id="g-ui">
            <h3>10. 화면 사용법</h3>
            <ul className="g-list">
              <li>
                카드를 <b>끌어다</b> 내 탐험대 줄이나 버림 더미에 놓으세요. 또는 카드를 누른 뒤 줄·더미를 누르거나 아래 버튼을 눌러도 돼요.
              </li>
              <li>놓을 수 없는 카드는 흐리게 보이고, 이유가 배너에 떠요.</li>
              <li>덱이나 빛나는 버림 더미를 눌러 가져오기.</li>
              <li>😊 감정 표현은 덱 아래 · 방장은 "게임 중지"로 설정을 바꿔 이어서 할 수 있어요.</li>
              <li>연결이 끊겨도 같은 기기로 다시 열면 그대로 돌아와요. 서버를 업데이트해도 게임은 이어져요.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
