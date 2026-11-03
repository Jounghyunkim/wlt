// Korean / English toggle. Default: ?lang= in the URL, then the saved choice, then the browser language.
(function () {
  var root = document.documentElement;
  function pick() {
    var q = new URLSearchParams(location.search).get("lang");
    if (q === "ko" || q === "en") return q;
    try {
      var saved = localStorage.getItem("wlt.lang");
      if (saved === "ko" || saved === "en") return saved;
    } catch (e) {}
    return /^ko\b/i.test(navigator.language || "") ? "ko" : "en";
  }
  function apply(lang) {
    root.setAttribute("data-lang", lang);
    root.lang = lang;
    var title = root.getAttribute("data-title-" + lang);
    if (title) document.title = title;
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.set === lang));
    });
  }
  apply(pick());
  document.addEventListener("DOMContentLoaded", function () {
    apply(root.getAttribute("data-lang"));
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.addEventListener("click", function () {
        apply(b.dataset.set);
        try { localStorage.setItem("wlt.lang", b.dataset.set); } catch (e) {}
      });
    });
  });
})();
