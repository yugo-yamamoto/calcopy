const fs = require('fs');
const { JSDOM } = require('jsdom');

// 実際の Google カレンダー DOM から採取したマークアップを再現した fixture
const DETAIL = (when, locHtml) => `
<div class="jefcFd" data-eventid="RUlE">
 <div data-actions-expanded="false">
  <div class="hMdQi">
   <div class="nBzcnc">
    <div class="JEx5le bgOWSb" id="xDetDlgWhen">
     <div class="UfeRlc" data-tooltip-only-if-necessary="true"><span role="heading" aria-level="1">サンプル定例MTG</span></div>
     ${when}
    </div>
   </div>
   ${locHtml}
  </div>
 </div>
</div>`;

const WHEN_TIMED  = `<div class="AzuXid">9月 16日 (水曜日)<span class="grQv0">⋅</span><span>09:00～09:45</span></div>`;
const WHEN_ALLDAY = `<div class="AzuXid">9月 14日 (月曜日)</div>`;
const WHEN_YEAR   = `<div class="AzuXid">2027年 3月 16日 (火曜日)<span class="grQv0">⋅</span><span>10:00～11:00</span></div>`;
// 場所欄に Zoom の URL が入っているパターン（URL・氏名はダミー）
const LOC_ZOOM = `<div class="nBzcnc"><div class="toUqff" id="xDetDlgLoc"><span jsslot=""><span class="XuJrye">場所:</span><div class="bgOWSb"><div class="UfeRlc"><a href="https://us02web.zoom.us/j/1234567890?pwd=abcdEFGH1234">https://us02web.zoom.us/j/1234567890?pwd=abcdEFGH1234</a></div></div></span></div></div>`;
// Google Meet の参加ボタン
const LOC_MEET = `<div class="nBzcnc"><div class="toUqff"><a href="https://meet.google.com/abc-defg-hij?hs=224" jslog="99999">Google Meet に参加する</a><div>meet.google.com/abc-defg-hij</div></div></div>`;
// 説明欄に Teams の URL がプレーンテキストで書かれているパターン
const DESC_TEAMS = `<div class="nBzcnc"><div class="toUqff" id="xDetDlgDesc"><span class="XuJrye">説明:</span><div>Microsoft Teams 会議<br>会議に参加するにはここをクリック<br>https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmE0/0?context=%7b%22Tid%22%3a%22xxx%22%7d<br>会議 ID: 123 456 789</div></div></div>`;
// 会議 URL ではない物理的な場所（3行目は出ない想定）
const LOC_ROOM = `<div class="nBzcnc"><div class="toUqff" id="xDetDlgLoc"><span jsslot=""><span class="XuJrye">場所:</span><div class="bgOWSb"><div class="UfeRlc">本社 3F 会議室 A</div></div></span></div></div>`;

// 検索結果一覧の fixture
const SEARCH = `
<div role="rowgroup" data-datekey="28975">
 <div role="row"><h2><button aria-label="9月 15日 (火曜日)"></button></h2>
  <div role="presentation" data-eventchip="" data-eventid="A">
   <div role="gridcell" class="FVj2te">18:00～19:00</div>
   <div role="gridcell"><div role="button" tabindex="0" aria-label="18:00～19:00、「打ち合わせ（仮）」、山田太郎、場所の指定なし、2026年 9月 15日">打ち合わせ（仮）</div></div>
  </div>
  <div role="presentation" data-eventchip="" data-eventid="B">
   <div role="gridcell" class="FVj2te">15:00～16:00</div>
   <div role="gridcell"><div role="button" tabindex="0" aria-label="15:00～16:00、「打ち合わせ（仮）」、山田太郎、場所の指定なし、2026年 9月 17日">打ち合わせ（仮）</div></div>
  </div>
 </div>
</div>`;

const bm = fs.readFileSync('/root/work/calcopy/calcopy.bookmarklet.txt', 'utf8');
const code = decodeURIComponent(bm.replace(/^javascript:/, ''));

function run(bodyHtml, label) {
  const dom = new JSDOM(`<body>${bodyHtml}</body>`, { url: 'https://calendar.google.com/calendar/u/0/r/week/2026/9/15', runScripts: 'outside-only' });
  const w = dom.window;
  let copied = null;
  Object.defineProperty(w.navigator, 'clipboard', {
    value: { writeText: t => { copied = t; return Promise.resolve(); } }, configurable: true });
  w.eval(code);
  return new Promise(r => setTimeout(() => {
    const toast = w.document.getElementById('__calcopy_toast');
    r({ label, copied, headline: toast ? toast.firstChild.textContent : '(no toast)' });
  }, 60));
}

(async () => {
  const cases = [
    [DETAIL(WHEN_TIMED, LOC_ZOOM),   '詳細: Zoom (場所欄のリンク)'],
    [DETAIL(WHEN_TIMED, LOC_MEET),   '詳細: Google Meet (参加ボタン)'],
    [DETAIL(WHEN_TIMED, DESC_TEAMS), '詳細: Teams (説明欄のプレーンテキスト)'],
    [DETAIL(WHEN_TIMED, LOC_ROOM),   '詳細: 物理的な場所のみ → URL 行なし'],
    [DETAIL(WHEN_TIMED, ''),         '詳細: 場所なし'],
    [DETAIL(WHEN_ALLDAY, ''),        '詳細: 終日'],
    [DETAIL(WHEN_YEAR, ''),          '詳細: 画面に年が出ている場合'],
    [SEARCH,                  '一覧: 検索結果（タイトルなし / スペースつなぎ）'],
    ['<div>まったく関係ない画面</div>', 'その他の画面'],
  ];
  for (const [html, label] of cases) {
    const r = await run(html, label);
    console.log('─'.repeat(60));
    console.log('■', r.label, '/', r.headline);
    console.log(r.copied === null ? '  (コピーなし)' : JSON.stringify(r.copied, null, 0));
    if (r.copied) { console.log('  --- 実際の見た目 ---'); console.log(r.copied.split('\n').map(l => '  | ' + l).join('\n')); }
  }
})();
