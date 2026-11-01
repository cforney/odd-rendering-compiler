/*
 * readings.js — the small script, the default enhancer: a click, Enter or Space on
 * an alternate (.tei-alternate) swaps its readings (.tei-alternate-default and
 * .tei-alternate-alt). It reads nothing else of the page, so it works on what any
 * renderer writes, even later (CETEIcean): clicks are caught on the document, and
 * alternates are watched for. Without JavaScript the first reading stays.
 */
(function () {
  var ALTERNATE = ".tei-alternate";

  function swap(alt) {
    var first = alt.querySelector(":scope > .tei-alternate-default");
    var second = alt.querySelector(":scope > .tei-alternate-alt");
    if (!first || !second) return;
    first.hidden = !first.hidden;
    second.hidden = !second.hidden;
    alt.setAttribute("aria-checked", String(first.hidden));
  }

  function upgrade() {
    document.querySelectorAll(ALTERNATE + ":not([role])").forEach(function (alt) {
      alt.setAttribute("role", "switch");
      alt.setAttribute("aria-checked", "false");
      alt.title = "Swap the readings";
      alt.tabIndex = 0;
    });
  }
  upgrade();
  new MutationObserver(upgrade).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", function (e) {
    var alt = e.target.closest && e.target.closest(ALTERNATE);
    if (alt) swap(alt);
  });
  document.addEventListener("keydown", function (e) {
    var alt = (e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest(ALTERNATE);
    if (alt) { e.preventDefault(); swap(alt); }
  });
})();
