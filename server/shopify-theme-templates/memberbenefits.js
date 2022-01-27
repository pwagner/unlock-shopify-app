(function () {
  let selectedAccount,
    unpkgScriptsLoaded = 0;

  window.locksByMembershipName = __LOCKS_BY_NAME__;
  const discountCodesByLockAddresses = __DISCOUNT_CODE_BY_LOCK_ADDRESS__;

  // Helper funciton to load scripts from unpkg
  window.load_script = window.load_script || {
    scripts: [],
    index: -1,
    loading: false,
    next: function () {
      if (window.load_script.loading) return;

      // Load the next queue item
      window.load_script.loading = true;
      var item = window.load_script.scripts[++window.load_script.index];
      var head = document.getElementsByTagName("head")[0];
      var script = document.createElement("script");
      script.type = "text/javascript";
      script.src = item.src;
      // When complete, start next item in queue and resolve this item's promise
      script.onload = () => {
        window.load_script.loading = false;
        if (window.load_script.index < window.load_script.scripts.length - 1)
          window.load_script.next();
        item.resolve();
      };
      head.appendChild(script);
    },
  };

  loadScripts = function (src) {
    if (src) {
      // Check if already added
      for (var i = 0; i < window.load_script.scripts.length; i++) {
        if (window.load_script.scripts[i].src == src)
          return window.load_script.scripts[i].promise;
      }
      // Add to the queue
      var item = { src: src };
      item.promise = new Promise((resolve) => {
        item.resolve = resolve;
      });
      window.load_script.scripts.push(item);
      window.load_script.next();
    }

    // Return the promise of the last queue item
    return window.load_script.scripts[window.load_script.scripts.length - 1]
      .promise;
  };

  function simulateToggle(elem) {
    var evt = new MouseEvent("toggle", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    elem.dispatchEvent(evt);
  }

  function simulateClick(elem) {
    var evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    elem.dispatchEvent(evt);
  }

  function getMembershipDiscountCodeFromCookie() {
    const value = "; " + document.cookie;
    const parts = value.split("; discount_code=");
    if (parts.length == 2) return parts.pop().split(";").shift();
  }

  async function onConnect(displayedMemberships) {
    const currentUrl = window.location.href;
    const unlockAppUrl = `__UNLOCK_APP_URL__`;

    // Store currentUrl for redirect after request to unlockAppUrl
    try {
      const state = await requestUnlockStateAndStoreUrl(
        currentUrl,
        displayedMemberships
      );
      if (!state) throw "State missing!";

      // state is used to identify the user and redirect him to the right URL.
      const domain = new URL(unlockAppUrl).host;
      const unlockCheckoutUrl = `https://app.unlock-protocol.com/checkout?client_id=${domain}&redirect_uri=${unlockAppUrl}&state=${state}`;
      window.location.href = unlockCheckoutUrl;
    } catch (err) {
      console.log("Error trying to get state and store redirect URL.", err);
    }
  }

  function requestUnlockStateAndStoreUrl(redirectUri, membershipNames) {
    const unlockStateUrl = new URL(`__UNLOCK_STATE_URL__`);
    const allLocks = [];
    for (name in window.locksByMembershipName) {
      allLocks.push(...window.locksByMembershipName[name]);
    }
    unlockStateUrl.search = new URLSearchParams({
      url: window.location.href,
      locks: allLocks,
      membershipNames,
    });

    return fetch(unlockStateUrl.toString())
      .then((response) => response.json())
      .then((data) => data.state);
  }

  async function onDisconnect() {
    // Remove stored discount code
    document.cookie = "discount_code=;max-age=0";
    delete window.activeDiscountCode;
    delete window.memberBenefitsAddress;
    selectedAccount = null;

    // Set the UI back to the initial state
    document.querySelector("#prepare").style.display = "block";
    document.querySelector("#connected").style.display = "none";
    document.querySelectorAll(".membership .status").forEach((el) => {
      el.textContent = "Not available";
    });
    updateUnlockUIElements("locked");
  }

  async function fetchAccountData(selectedAccount, unlockedLocks) {
    console.log("fetchAccountData start", selectedAccount, unlockedLocks);
    document.querySelector("#selected-account").textContent = selectedAccount;

    // Check for Unlock keys and update status, if connected.
    document.querySelectorAll(".status").forEach((el) => {
      console.log("status", el);
      const locksClasses = el.dataset.locks.replace(",", " ");
      const membershipDiscountCode = el.dataset.discount;
      el.innerHTML = `
        <jelly-switch
          class="benefitSwitch ${locksClasses}"
          name="switch"
          onToggle="return window.captureMembershipChangeEvent(this, '${membershipDiscountCode}')"
          disabled
        >
          <p slot="content-right" class="rightContent"> Inactive</p>
        </jelly-switch>
      `;
    });

    // TODO: Show key-purchase URL if no valid keys were found?
    /*
    setTimeout(() => {
      const validMembershipCells = document.getElementsByClassName("membership-validity valid");
      if(validMembershipCells.length > 0) return;
      document.getElementById("key-purchase-container").style.display = "block";
    }, 2000);
    */

    document.querySelectorAll(".membership").forEach((membership) => {
      console.log("membership", membership);
      const knownLocks = membership
        .querySelector(".status")
        .dataset.locks.split(",");

      knownLocks.map((lockAddress) => {
        if (unlockedLocks.indexOf(lockAddress) === -1) return;

        // Found unlocked lock
        window.dispatchEvent(
          new CustomEvent("memberBenefits.status", {
            detail: {
              state: "unlocked",
              lock: lockAddress,
            },
          })
        );

        // Apply discount, if there is only one possible option
        // Delay a second to emphasize activation
        setTimeout(() => {
          const validMembershipCells = document.getElementsByClassName(
            "membership-validity valid"
          );
          if (validMembershipCells.length === 1) {
            const jellySwitch = document.querySelector(".benefitSwitch");
            jellySwitch.checked = true;
            simulateToggle(jellySwitch);
          }
        }, 1000);
      });
    });

    console.log("prepare and connected");

    document.querySelector("#prepare").style.display = "none";
    document.querySelector("#connected").style.display = "block";
  }

  // First redirect to unlock, verify address (checking key validity server-side)
  // After that actually display modal.
  window.showMemberBenefitsModal = async (options) => {
    const membershipNames = options.map(({ name }) => name);

    if (!window.memberBenefitsAddress) {
      // Immediately redirect to Unlock Protocol before showing modal
      onConnect(membershipNames);

      return;
    } else {
      const modal = document.querySelector("#mb-modal");
      openModal(modal);
    }

    // Show memberships and current status
    const template = document.getElementById("template-memberships");
    const membershipsContainer = document.getElementById("memberships");
    membershipsContainer.innerHTML = "";

    // Add rows for all memberships and check status
    await Promise.all(
      options.map(async ({ name, locks }) => {
        console.log("modal options locks", locks);
        const clone = template.content.cloneNode(true);
        clone.querySelector(".membership-name").textContent = name;
        clone.querySelector(".membership-validity").classList.add(...locks);
        clone.querySelector(".status").dataset.locks = locks.join(",");
        clone.querySelector(".status").dataset.discount =
          discountCodesByLockAddresses[locks[0]];
        membershipsContainer.appendChild(clone);
      })
    );

    document
      .querySelector("#btn-connect")
      .addEventListener("click", function () {
        onConnect(membershipNames);
      });
    document
      .querySelector("#btn-disconnect")
      .addEventListener("click", onDisconnect);

    await fetchAccountData(
      window.memberBenefitsAddress,
      window.memberBenefitsUnlocked
    );
  };

  function updateUnlockUIElements(unlockState) {
    // Hide all .unlock-content elements
    const unlockContentElements = document.querySelectorAll(".unlock-content");
    unlockContentElements.forEach((element) => {
      element.style.display = "none";
    });
    if (unlockContentElements.length > 0) {
      // Se show only the relevant element (CSS class: locked|unlocked)
      document
        .querySelectorAll(".unlock-content." + unlockState)
        .forEach((element) => {
          element.style.display = "block";
        });
    }

    if (unlockState === "unlocked" && window.activeDiscountCode) {
      // Hide sections with the according setting after unlocking (and benefit was applied)
      document.querySelectorAll(".hidden-after-unlocked").forEach((element) => {
        element.style.display = "none";
      });
      document
        .querySelectorAll(".displayed-after-unlocked")
        .forEach((element) => {
          element.style.display = "block";
        });
    } else if (unlockState === "locked") {
      // Show sections with the according setting after disconnecting the wallet
      document.querySelectorAll(".hidden-after-unlocked").forEach((element) => {
        element.style.display = "block";
      });
      document
        .querySelectorAll(".displayed-after-unlocked")
        .forEach((element) => {
          element.style.display = "none";
        });
    }
  }

  window.addEventListener("memberBenefits.status", function (event) {
    const lockAddress = event.detail.lock.toString();

    // Find membership row in modal via lock address class
    const benefitSwitch = document.getElementsByClassName(
      "benefitSwitch " + lockAddress
    )[0];
    if (benefitSwitch) {
      benefitSwitch.disabled = false;
    }

    const membershipValidityCell = document.getElementsByClassName(
      "membership-validity " + lockAddress
    )[0];
    membershipValidityCell.textContent = "🔓 unlocked";
    membershipValidityCell.style.backgroundColor = "green";
    membershipValidityCell.classList.add("valid");

    console.log(
      "event memberBenefits.status discountCodesByLockAddresses",
      discountCodesByLockAddresses,
      lockAddress
    );
    if (
      window.activeDiscountCode === discountCodesByLockAddresses[lockAddress]
    ) {
      console.log("Setting checked");
      benefitSwitch.checked = true;
      benefitSwitch.querySelector(".rightContent").textContent = " Active";
    } else {
      benefitSwitch.querySelector(".rightContent").textContent = " Inactive";
    }

    updateUnlockUIElements(event.detail.state.toString());
  });

  async function init() {
    /*
     *  Member Benefits Modal (Vanilla JS):
     */

    // Add modal to DOM if necessary
    if (!document.getElementById("mb-modal")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="mb-modal" id="mb-modal" style="display: none">
        <div class="mb-modal-header">
          <div class="title">
            <img src="https://cdn.shopify.com/s/files/1/0569/7483/5896/t/1/assets/mb-icon-64.png?v=1627515289" alt="Member Benefits" style="width: 22px;top: 3px;position: relative;"/>
            Member Benefits
          </div>
          <button data-close-button class="close-button">&times;</button>
        </div>
        <div class="mb-modal-body">

          <div class="alert alert-danger" id="alert-error-https" style="display: none">
            You can run this example only over HTTPS connection.
          </div>

          <div id="prepare">
            <div>
              <p>Connect your wallet to show membership status.</p>

              <button class="btn" id="btn-connect">
                Connect wallet
              </button>
            </div>
          </div>

          <div id="connected" style="display: none">

            <div id="network">
              <p>
                <strong>Selected account:</strong> <span id="selected-account"></span>
              </p>
            </div>

            <button class="btn" id="btn-disconnect">
              Disconnect wallet
            </button>

          </div>

          <table class="table-memberships">
            <thead>
              <th>Membership</th>
              <th>Benefit Status</th>
            </thead>

            <tbody id="memberships">
            </tbody>
          </table>


          <div id="templates" style="display: none">
            <template id="template-memberships">
              <tr class="membership">
                <td>
                  <span class="membership-name"></span>
                  <br/>
                  <span class="membership-validity">🔒 locked</span>
                </td>
                <td class="status">
                  <em>Not available</em>
                </td>
              </tr>
            </template>
          </div>

          <div id="key-purchase-container" style="display:none;">
            <p style="text-align:center;">Would you like to <a target="_blank" class="purchase-link">become a member</a>?</p>
          </div>

        </div>
      </div>
      <div id="overlay"></div>
      `
      );
    }

    // openModalButtons = document.querySelectorAll("[data-modal-target]");
    closeModalButtons = document.querySelectorAll("[data-close-button]");
    overlay = document.getElementById("overlay");

    /*
    if (openModalButtons) {
      openModalButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const modal = document.querySelector(button.dataset.modalTarget);
          openModal(modal);
        });
      });
    }*/

    if (overlay) {
      overlay.addEventListener("click", () => {
        const modals = document.querySelectorAll(".mb-modal.active");
        modals.forEach((modal) => {
          closeModal(modal);
        });
      });
    }

    if (closeModalButtons) {
      closeModalButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const modal = button.closest(".mb-modal");
          closeModal(modal);
        });
      });
    }

    openModal = function openModal(modal) {
      if (modal == null) return;
      document.getElementById("mb-modal").style.display = "block";
      modal.classList.add("active");
      overlay.classList.add("active");
    };

    closeModal = function closeModal(modal) {
      if (modal == null) return;
      modal.classList.remove("active");
      overlay.classList.remove("active");
    };

    // On/Off jelly-switch

    window.captureMembershipChangeEvent =
      window.captureMembershipChangeEvent ||
      function captureMembershipChangeEvent(self, discountCode) {
        if (self.checked) {
          self.querySelector(".rightContent").style.color = "green";
          self.querySelector(".rightContent").textContent = " Active";

          // Activate discount code by loading iframe
          const iframe = document.createElement("iframe");
          iframe.src = `${window.location.origin}/discount/${discountCode}`;
          iframe.width = 1;
          iframe.height = 1;
          iframe.style.width = "1px";
          iframe.style.height = "1px";
          document.body
            .appendChild(iframe)
            .classList.add("hidden-after-unlocked");
          window.activeDiscountCode = discountCode;

          // Hide sections with the according setting after unlocking (and benefit was applied)
          document
            .querySelectorAll(".hidden-after-unlocked")
            .forEach((element) => {
              element.style.display = "none";
            });
          document
            .querySelectorAll(".displayed-after-unlocked")
            .forEach((element) => {
              element.style.display = "block";
            });
        } else {
          self.querySelector(".rightContent").style.color = "red";
          self.querySelector(".rightContent").textContent = " Inactive";
          document.cookie = "discount_code=;max-age=0";
          delete window.activeDiscountCode;

          // Show sections with the according setting after disconnecting the wallet
          document
            .querySelectorAll(".hidden-after-unlocked")
            .forEach((element) => {
              element.style.display = "block";
            });
          document
            .querySelectorAll(".displayed-after-unlocked")
            .forEach((element) => {
              element.style.display = "none";
            });
        }
      };

    // Check if the user was redirected back from Unlock (after signing message).
    const params = new URLSearchParams(window.location.search);
    const address = params.get("_mb_address");
    const locks = params.get("_mb_locks")
      ? params.get("_mb_locks").split(",")
      : [];
    const memberships = params.get("_mb_memberships")
      ? params.get("_mb_memberships").split(",")
      : [];
    console.log("Got address, locks, memberships", address, locks, memberships);

    if (address) {
      window.memberBenefitsAddress = address;
      window.memberBenefitsUnlocked = locks;
      let clickElement;
      if (locks.length === 0) {
        // User connected wallet but no valid membership was detected
        // TODO: Maybe show link to membership purchase URL

        // Use any available modal
        clickElement = document.querySelector(
          '[onclick*="showMemberBenefitsModal"]'
        );
      } else {
        // TODO: add signature and verify that locks haven't been changed

        // Show first modal that contains the first lock
        let selectorString = '[onclick*="showMemberBenefitsModal"]';
        for (name of memberships) {
          selectorString += `[onclick*="${name}"]`;
        }
        clickElement = document.querySelector(selectorString);
      }

      console.log("clickElement", clickElement);
      simulateClick(clickElement);
    }

    window.activeDiscountCode =
      window.activeDiscountCode || getMembershipDiscountCodeFromCookie();

    if (window.activeDiscountCode) {
      updateUnlockUIElements("unlocked");
    }
  } // end init()

  ["https://unpkg.com/jelly-switch"].forEach(async (item, index, array) => {
    await loadScripts(item);
    unpkgScriptsLoaded++;

    if (unpkgScriptsLoaded === array.length) {
      init();
    }
  });
})();
