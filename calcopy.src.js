/*!
 * calcopy - Google カレンダーの予定をクリップボードにコピーするブックマークレット
 *
 * 実行場所によって動作が変わります:
 *   1. 検索結果一覧 (/r/search)      -> 一覧のすべての予定を1行ずつコピー
 *   2. 予定の詳細ポップアップ          -> その予定1件をコピー（最優先）
 *
 * 出力形式:
 *   一覧 (日付と時刻をスペースでつなぐ):
 *     2026/09/15(火) 18:00～19:00
 *   詳細 (各項目を改行でつなぐ):
 *     サンプル定例MTG
 *     09/16(水) 09:00～09:45
 *     https://us02web.zoom.us/j/...   <- Meet / Zoom / Teams の URL があるときだけ
 *
 * 詳細ポップアップには年が表示されないため、日付は「月/日(曜)」になります。
 * （別の年の予定など、画面に年が出ている場合だけ「2027/03/16(火)」形式）
 */
(function () {
  'use strict';

  var WDAY = ['日', '月', '火', '水', '木', '金', '土'];

  /* ------------------------------------------------------------------ *
   * 小道具
   * ------------------------------------------------------------------ */
  function xpathOne(xpath, ctx) {
    return document.evaluate(xpath, ctx || document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  }

  function txt(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function pad2(n) {
    return ('0' + n).slice(-2);
  }

  /* 2026, 9, 16 -> "2026/09/16(水)" */
  function formatDate(y, m, d) {
    if (!y || !m || !d) return '';
    var w = WDAY[new Date(y, m - 1, d).getDay()];
    return y + '/' + pad2(m) + '/' + pad2(d) + '(' + w + ')';
  }

  /* "…、2026年 9月 16日" -> {y,m,d} */
  function dateFromText(s) {
    var m = (s || '').match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  /* Google の data-datekey: ((year-1970)<<9) | (month<<5) | day */
  function dateFromDatekey(key) {
    var k = parseInt(key, 10);
    if (!k) return null;
    var y = 1970 + (k >> 9), mo = (k >> 5) & 15, d = k & 31;
    return (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) ? { y: y, m: mo, d: d } : null;
  }

  /* "18:00～19:00" を取り出す */
  function timeFromText(s) {
    var m = (s || '').match(/(\d{1,2}:\d{2})\s*～\s*(\d{1,2}:\d{2})/);
    return m ? m[1] + '～' + m[2] : '';
  }

  /* 時間帯 → 開始時刻のみ → 終日 の順に採用する */
  function timeOrAllDay(s) {
    var range = timeFromText(s);
    if (range) return range;
    var one = (s || '').match(/(\d{1,2}:\d{2})/);
    return one ? one[1] : '終日';
  }

  /* 予定チップの読み上げ用ラベル（検索は aria-label、週/月は .XuJrye） */
  function chipLabel(chip) {
    var a = chip.getAttribute && chip.getAttribute('aria-label');
    if (a) return a;
    var inner = chip.querySelector('[aria-label]');
    if (inner) return inner.getAttribute('aria-label');
    var hidden = xpathOne(".//*[contains(@class,'XuJrye')]", chip);
    return hidden ? txt(hidden) : txt(chip);
  }

  /* 空の項目を捨ててから sep でつなぐ */
  function line(cols, sep) {
    return cols.filter(function (c) { return c; }).join(sep);
  }

  /* Meet / Zoom / Teams の会議 URL。
     URL に使える ASCII 文字だけを拾う（直後に日本語が続いても巻き込まないため）。 */
  var CONF_URL = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'*+;=%]*/i;

  /* 末尾に紛れ込んだ句読点を落とす */
  function trimUrl(url) {
    return url.replace(/[.,;:!?'"]+$/, '');
  }

  /* 説明欄のリンクは https://www.google.com/url?q=<本来のURL>&sa=... に包まれている */
  function unwrapGoogleRedirect(href) {
    var m = /^https?:\/\/(?:www\.)?google\.com\/url\?(?:[^&]*&)*?q=([^&]*)/i.exec(href || '');
    if (!m) return href || '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  function cleanConferenceUrl(url) {
    url = trimUrl(url);
    /* Meet はパスだけで会議が特定できる。authuser や hs は追跡用なので落とす。
       Zoom の ?pwd= や Teams の ?context= は必須なので残す。 */
    if (/^https?:\/\/meet\.google\.com\//i.test(url)) url = url.split('?')[0];
    return url;
  }

  /* ダイアログ内から会議 URL を1つ探す（リンク優先、無ければ本文テキストから） */
  function findConferenceUrl(dialog) {
    var links = dialog.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var hit = unwrapGoogleRedirect(links[i].getAttribute('href')).match(CONF_URL);
      if (hit) return cleanConferenceUrl(hit[0]);
    }
    var m = (dialog.innerText || dialog.textContent || '').match(CONF_URL);
    return m ? cleanConferenceUrl(m[0]) : '';
  }

  /* ------------------------------------------------------------------ *
   * 1. 詳細ポップアップ
   * ------------------------------------------------------------------ */
  function readDetail(dialog) {
    /* --- タイトル --- */
    var titleEl = dialog.querySelector('#xDetDlgWhen span[role="heading"]')
      || (dialog.querySelector('div[data-tooltip-only-if-necessary="true"]') || {}).firstElementChild
      || dialog.querySelector('div[data-tooltip-only-if-necessary="true"] span');
    var title = txt(titleEl);

    /* --- 日時 --- 「9月 16日 (水曜日)⋅09:00～09:45」 --- */
    var whenBox = dialog.querySelector('#xDetDlgWhen') || dialog;
    var whenEl = xpathOne(".//div[span[contains(text(), '～')]]", whenBox);
    if (!whenEl && titleEl) {
      var holder = titleEl.closest('[data-tooltip-only-if-necessary]') || titleEl.parentElement;
      whenEl = holder && holder.nextElementSibling;
    }
    var whenText = txt(whenEl).replace(/⋅/g, ' ').replace(/\s+/g, ' ').trim();

    /* --- 日付 --- 画面に出ている表記だけを使い、年の補完はしない --- */
    var ymd = dateFromText(whenText);
    var date = '';
    if (ymd) {
      /* 別の年の予定は「2027年 3月 16日 (火曜日)」のように年つきで表示される */
      date = formatDate(ymd.y, ymd.m, ymd.d);
    } else {
      var md = whenText.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (md) {
        var wd = (whenText.match(/[（(]([日月火水木金土])曜?日?[)）]/) || [])[1];
        date = pad2(+md[1]) + '/' + pad2(+md[2]) + (wd ? '(' + wd + ')' : '');
      }
    }
    var time = timeFromText(whenText);
    /* 複数日にまたがる予定などは日付以降の表記をそのまま使い、何も残らなければ終日扱い */
    if (!time) {
      time = whenText.replace(/^\d{1,2}\s*月\s*\d{1,2}\s*日\s*(\([^)]*\))?\s*/, '').trim() || '終日';
    }
    if (!date && whenText) date = whenText;

    return {
      mode: '詳細',
      count: 1,
      text: line([
        title,
        line([date, time], ' '),
        findConferenceUrl(dialog)
      ], '\n')
    };
  }

  /* ------------------------------------------------------------------ *
   * 2. 検索結果一覧
   * ------------------------------------------------------------------ */
  function readSearchList(rowgroups) {
    var lines = [];
    Array.prototype.forEach.call(rowgroups, function (row) {
      var fallback = dateFromDatekey(row.getAttribute('data-datekey'));
      Array.prototype.forEach.call(row.querySelectorAll('[data-eventchip]'), function (chip) {
        var btn = chip.querySelector('[role="button"][aria-label]') || chip;
        var label = chipLabel(btn);
        if (!label) return;
        var ymd = dateFromText(label) || fallback;
        var time = timeFromText(label)
          || timeFromText(txt(xpathOne(".//*[contains(text(),'～')]", chip)))
          || timeOrAllDay(label);
        lines.push(line([ymd ? formatDate(ymd.y, ymd.m, ymd.d) : '', time], ' '));
      });
    });
    return { mode: '検索結果一覧', count: lines.length, text: lines.join('\n') };
  }

  /* ------------------------------------------------------------------ *
   * クリップボード + トースト
   * ------------------------------------------------------------------ */
  function execCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copy(text) {
    try { window.focus(); } catch (e) { /* noop */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      /* 非同期 API が拒否された場合 (未フォーカス等) は execCommand に退避する */
      return navigator.clipboard.writeText(text).catch(function (err) {
        if (execCopy(text)) return;
        throw err;
      });
    }
    return execCopy(text)
      ? Promise.resolve()
      : Promise.reject(new Error('このブラウザではコピーできませんでした'));
  }

  function toast(headline, body, isError) {
    var old = document.getElementById('__calcopy_toast');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = '__calcopy_toast';
    box.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:min(560px,calc(100vw - 32px))', 'max-height:50vh', 'overflow:auto',
      'padding:12px 14px', 'border-radius:10px',
      'background:' + (isError ? '#b3261e' : '#202124'), 'color:#fff',
      'font-family:"游ゴシック",YuGothic,"Yu Gothic",Meiryo,"BIZ UDGothic",sans-serif',
      'font-size:12px', 'line-height:1.6', 'white-space:pre-wrap',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)', 'cursor:pointer'
    ].join(';');
    var h = document.createElement('div');
    h.style.cssText = 'font-weight:700;margin-bottom:6px;font-size:13px';
    h.textContent = headline;
    var b = document.createElement('div');
    b.style.cssText = 'opacity:.85;font-family:ui-monospace,Consolas,"BIZ UDGothic",monospace';
    b.textContent = body;
    box.appendChild(h);
    box.appendChild(b);
    box.addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.remove(); }, 6000);
  }

  /* ------------------------------------------------------------------ *
   * 実行
   * ------------------------------------------------------------------ */
  var dialog = document.querySelector('div[data-actions-expanded]');
  var rowgroups = document.querySelectorAll('div[role="rowgroup"][data-datekey]');
  var result;

  if (dialog) {
    result = readDetail(dialog);
  } else if (rowgroups.length) {
    result = readSearchList(rowgroups);
  } else {
    toast('コピーできませんでした', 'Google カレンダーの検索結果、または予定の詳細を開いた状態で実行してください。', true);
    return;
  }

  if (!result.text) {
    toast('コピーできませんでした', '[' + result.mode + '] 対象の予定が見つかりませんでした。', true);
    return;
  }

  copy(result.text).then(function () {
    toast('コピーしました [' + result.mode + '] ' + result.count + '件', result.text);
  }).catch(function (e) {
    toast('コピーに失敗しました', String(e && e.message || e) + '\n\n' + result.text, true);
  });
})();
