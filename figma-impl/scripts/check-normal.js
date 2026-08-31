// ブラウザのコンソールに貼って使う簡易チェック。
// letter-spacing / line-height が normal のまま残っている要素を洗い出す。
// normal が残っている = 変換規則の適用漏れ。ここが空になるまでは
// 「Figma と一致しない」の原因究明を始めない。
[...document.querySelectorAll('*')].filter((el) => {
  const s = getComputedStyle(el);
  return s.letterSpacing === 'normal' || s.lineHeight === 'normal';
});
