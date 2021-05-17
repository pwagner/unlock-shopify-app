var getMembershipDiscountCodeFromCookie =
  getMembershipDiscountCodeFromCookie ||
  function () {
    var value = "; " + document.cookie;
    var parts = value.split("; discount_code=");
    if (parts.length == 2) return parts.pop().split(";").shift();
  };
var activeDiscountCode =
  activeDiscountCode || getMembershipDiscountCodeFromCookie();
var hasActiveMembership = activeDiscountCode === "__DISCOUNT_CODE__";
if (hasActiveMembership) {
  document.querySelectorAll(".hidden-after-unlocked").forEach((element) => {
    element.style.display = "none";
  });
  document.querySelectorAll(".unlock-content.locked").forEach((element) => {
    element.style.display = "none";
  });
  document.querySelectorAll(".unlock-content.unlocked").forEach((element) => {
    element.style.display = "block";
  });
} else {
  document.querySelectorAll(".unlock-content.locked").forEach((element) => {
    element.style.display = "block";
  });
}

if (!window.showUnlockPaywall) {
  window.showUnlockPaywall = function (config) {
    window.unlockProtocolConfig = config;
    if (!window.unlockProtocol) {
      (function (d, s) {
        var js = d.createElement(s),
          sc = d.getElementsByTagName(s)[0];
        js.src =
          "https://paywall.unlock-protocol.com/static/unlock.latest.min.js";
        sc.parentNode.insertBefore(js, sc);
      })(document, "script");
    }
    setTimeout(
      () =>
        window.unlockProtocol &&
        window.unlockProtocol.loadCheckoutModal(config),
      500
    );
  };
}

window.addEventListener("unlockProtocol.status", function (event) {
  var unlockState = event.detail.state.toString();
  console.log("unlockProtocol.status event.detail", event.detail);

  // We hide all .unlock-content elements
  var unlockContentElements = document.querySelectorAll(".unlock-content");
  unlockContentElements.forEach((element) => {
    element.style.display = "none";
  });
  if (unlockContentElements.length > 0) {
    // We show only the relevant element (CSS class: locked|unlocked)
    document
      .querySelectorAll(".unlock-content." + unlockState)
      .forEach((element) => {
        element.style.display = "block";
      });
  }

  // If a discount has already been applied, don't redirect
  if (activeDiscountCode) {
    console.log("Currently active discount", activeDiscountCode);
    if (hasActiveMembership) {
      console.log("Discount already applied.");
      document.querySelectorAll(".hidden-after-unlocked").forEach((element) => {
        element.style.display = "none";
      });

      return;
    } else {
      console.log("Other discount already applied.");

      return;
    }
  } else if (unlockState === "unlocked") {
    var redirectUrl =
      "https://__SHOP__/discount/__DISCOUNT_CODE__?redirect=" +
      window.location.pathname;
    console.log("Welcome member! Unlocked benefit __DISCOUNT_CODE__");
    console.log("Redirecting to", redirectUrl);
    window.location.replace(redirectUrl);
  }
});

window.addEventListener("unlockProtocol.authenticated", function (event) {
  // event.detail.addresss includes the address of the current user, when known
  console.log("unlockProtocol.authenticated", event.detail);
});

window.addEventListener("unlockProtocol.transactionSent", function (event) {
  // event.detail.hash includes the hash of the transaction sent
  console.log("unlockProtocol.transactionSent", event.detail);
});
