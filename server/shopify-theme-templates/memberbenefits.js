(function () {
  let web3Modal,
    provider,
    selectedAccount,
    unpkgScriptsLoaded = 0;

  // Helper funciton to load scripts from unpkg
  window.load_script = window.load_script || {
    scripts: [],
    index: -1,
    loading: false,
    next: function () {
      if (load_script.loading) return;

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

  window.load_scripts =
    window.load_scripts ||
    function (src) {
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

  function init() {
    // Unpkg imports
    const Web3Modal = window.Web3Modal.default;
    const WalletConnectProvider = window.WalletConnectProvider.default;

    window.locksByMembershipName = __LOCKS_BY_NAME__;
    window.getMembershipDiscountCodeFromCookie =
      window.getMembershipDiscountCodeFromCookie ||
      function () {
        const value = "; " + document.cookie;
        const parts = value.split("; discount_code=");
        if (parts.length == 2) return parts.pop().split(";").shift();
      };

    /**
     * Setup Web3modal
     */

    function initWeb3Modal() {
      web3Modal = new Web3Modal({
        cacheProvider: true,
        providerOptions: {
          walletconnect: {
            package: WalletConnectProvider,
            options: {
              infuraId: "6dd11545940046c0979b5087cafd816e",
            },
          },
        },
        disableInjectedProvider: false, // optional. For MetaMask / Brave / Opera.
      });
    }

    async function onConnect() {
      try {
        provider = await web3Modal.connect();
      } catch (e) {
        console.log("Could not get a wallet connection", e);
        return;
      }

      provider.on("accountsChanged", (accounts) => {
        onDisconnect();
        fetchAccountData();
      });
      /*
      provider.on("networkChanged", (networkId) => {
        fetchAccountData();
      });
      */

      await refreshAccountData();
    }

    async function onDisconnect() {
      // Remove stored discount code
      document.cookie = "discount_code=;max-age=0";
      delete window.activeDiscountCode;

      if (provider && provider.close) {
        await provider.close();
      }

      await web3Modal.clearCachedProvider();
      provider = null;
      selectedAccount = null;

      // Set the UI back to the initial state
      document.querySelector("#prepare").style.display = "block";
      document.querySelector("#connected").style.display = "none";
      document.querySelectorAll(".membership .status").forEach((el) => {
        el.textContent = "Not available";
      });
      updateUnlockUIElements("locked");
    }

    async function refreshAccountData() {
      document.querySelector("#connected").style.display = "none";
      document.querySelector("#prepare").style.display = "block";
      document
        .querySelector("#btn-connect")
        .setAttribute("disabled", "disabled");
      await fetchAccountData();
      document.querySelector("#btn-connect").removeAttribute("disabled");
    }

    async function fetchAccountData() {
      // Get a Web3 instance for the wallet
      const web3 = new Web3(provider);

      // Web3 instances for all productive networks (potentially having locks):
      const web3Mainnet = new Web3(
        new Web3.providers.HttpProvider(
          "https://mainnet.infura.io/v3/6dd11545940046c0979b5087cafd816e"
        )
      );
      const web3Polygon = new Web3(
        new Web3.providers.HttpProvider(
          "https://polygon-mainnet.infura.io/v3/ac9e710e20ce4afea766da1a18ef0ba1"
        )
      );
      const web3Xdai = new Web3(
        new Web3.providers.HttpProvider(
          "https://apis.ankr.com/79e6b002c297431f9e7ec8d74567d743/8a8d4081c8172f13f658a2d3bb64e499/xdai/fast/main"
        )
      );

      const lockAbi = [
        {
          constant: true,
          inputs: [
            {
              name: "_owner",
              type: "address",
            },
          ],
          name: "getHasValidKey",
          outputs: [
            {
              name: "",
              type: "bool",
            },
          ],
          payable: false,
          stateMutability: "view",
          type: "function",
        },
      ];

      // Get selected account from wallet
      const accounts = await web3.eth.getAccounts();
      selectedAccount = accounts[0];
      document.querySelector("#selected-account").textContent = selectedAccount;

      // Check for Unlock keys and update status, if connected!
      document.querySelectorAll(".status").forEach((el) => {
        const locksClasses = el.dataset.locks.replace(",", " ");
        const membershipDiscountCode = el.dataset.discount;
        el.innerHTML = `
          <jelly-switch
            class="benefitSwitch ${locksClasses}"
            name="switch"
            onToggle="return window.captureMembershipChangeEvent(this, '${membershipDiscountCode}')"
            disabled
          >
            <p slot="content-right" class="rightContent">checking…</p>
          </jelly-switch>
        `;
      });

      document.querySelectorAll(".membership").forEach((membership) => {
        const locks = membership
          .querySelector(".status")
          .dataset.locks.split(",");

        locks.map((lockAddress) => {
          // Check if lock address is deployed on a productive network, and if the key is valid
          const mainnetLock = new web3Mainnet.eth.Contract(
            lockAbi,
            lockAddress
          );
          mainnetLock.methods
            .getHasValidKey(selectedAccount)
            .call()
            .then((result) => {
              // console.log('Found lock on mainnet', result);

              if (result === true) {
                window.dispatchEvent(
                  new CustomEvent("memberBenefits.status", {
                    detail: {
                      state: "unlocked",
                      lock: lockAddress,
                    },
                  })
                );
              }
            })
            .catch((error) => {
              // console.log('Error trying to find lock on mainnet', error);
            });

          const xdaiLock = new web3Xdai.eth.Contract(lockAbi, lockAddress);
          xdaiLock.methods
            .getHasValidKey(selectedAccount)
            .call()
            .then((result) => {
              // console.log('Found lock on xdai', result);

              if (result === true) {
                window.dispatchEvent(
                  new CustomEvent("memberBenefits.status", {
                    detail: {
                      state: "unlocked",
                      lock: lockAddress,
                    },
                  })
                );
              }
            })
            .catch((error) => {
              // console.log('Error trying to find lock on xdai', error);
            });

          const polygonLock = new web3Polygon.eth.Contract(
            lockAbi,
            lockAddress
          );
          polygonLock.methods
            .getHasValidKey(selectedAccount)
            .call()
            .then((result) => {
              // console.log('Found lock on polygon', result);

              if (result === true) {
                window.dispatchEvent(
                  new CustomEvent("memberBenefits.status", {
                    detail: {
                      state: "unlocked",
                      lock: lockAddress,
                    },
                  })
                );
              }
            })
            .catch((error) => {
              // console.log('Error trying to find lock on polygon', error);
            });
        });
      });

      document.querySelector("#prepare").style.display = "none";
      document.querySelector("#connected").style.display = "block";
    }

    const discountCodesByLockAddresses = __DISCOUNT_CODE_BY_LOCK_ADDRESS__;

    window.showMemberBenefitsModal = async (options) => {
      // Show memberships and current status
      const template = document.getElementById("template-memberships");
      const membershipsContainer = document.getElementById("memberships");
      membershipsContainer.innerHTML = "";

      // Add rows for all memberships and check status
      await Promise.all(
        options.map(async ({ name, locks }) => {
          const clone = template.content.cloneNode(true);
          clone.querySelector(".membership-name").textContent = name;
          clone.querySelector(".membership-validity").classList.add(...locks);
          clone.querySelector(".status").dataset.locks = locks.join(",");
          clone.querySelector(".status").dataset.discount =
            discountCodesByLockAddresses[locks[0]];
          membershipsContainer.appendChild(clone);
        })
      );

      initWeb3Modal();
      document
        .querySelector("#btn-connect")
        .addEventListener("click", onConnect);
      document
        .querySelector("#btn-disconnect")
        .addEventListener("click", onDisconnect);

      if (web3Modal.cachedProvider) {
        await web3Modal.connect();
        onConnect();
      }
    };

    function updateUnlockUIElements(unlockState) {
      // Hide all .unlock-content elements
      const unlockContentElements = document.querySelectorAll(
        ".unlock-content"
      );
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
        document
          .querySelectorAll(".hidden-after-unlocked")
          .forEach((element) => {
            element.style.display = "none";
          });
      } else if (unlockState === "locked") {
        // Show sections with the according setting after disconnecting the wallet
        document
          .querySelectorAll(".hidden-after-unlocked")
          .forEach((element) => {
            element.style.display = "block";
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

      document.getElementsByClassName(
        "membership-validity " + lockAddress
      )[0].textContent = "🔓 unlocked";
      document.getElementsByClassName(
        "membership-validity " + lockAddress
      )[0].style.backgroundColor = "green";

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

        </div>
      </div>
      <div id="overlay"></div>
      `
      );
    }

    window.openModalButtons =
      window.openModalButtons ||
      document.querySelectorAll("[data-modal-target]");
    window.closeModalButtons =
      window.closeModalButtons ||
      document.querySelectorAll("[data-close-button]");
    window.overlay = window.overlay || document.getElementById("overlay");

    if (window.openModalButtons) {
      window.openModalButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const modal = document.querySelector(button.dataset.modalTarget);
          openModal(modal);
        });
      });
    }

    if (window.overlay) {
      window.overlay.addEventListener("click", () => {
        const modals = document.querySelectorAll(".mb-modal.active");
        modals.forEach((modal) => {
          closeModal(modal);
        });
      });
    }

    if (window.closeModalButtons) {
      window.closeModalButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const modal = button.closest(".mb-modal");
          closeModal(modal);
        });
      });
    }

    window.openModal =
      window.openModal ||
      function openModal(modal) {
        if (modal == null) return;

        document.getElementById("mb-modal").style.display = "block";

        modal.classList.add("active");
        overlay.classList.add("active");
      };

    window.closeModal =
      window.closeModal ||
      function closeModal(modal) {
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
        }
      };

    window.activeDiscountCode =
      window.activeDiscountCode || window.getMembershipDiscountCodeFromCookie();

    if (window.activeDiscountCode) {
      initWeb3Modal();
      if (web3Modal && web3Modal.cachedProvider) {
        web3Modal.connect().then(() => {
          onConnect();
          updateUnlockUIElements("unlocked");
        });
      }
    }
  } // end init()

  [
    "https://unpkg.com/web3@1.2.11/dist/web3.min.js",
    "https://unpkg.com/web3modal@1.9.0/dist/index.js",
    "https://unpkg.com/@walletconnect/web3-provider@1.2.1/dist/umd/index.min.js",
    "https://unpkg.com/jelly-switch",
  ].forEach(async (item, index, array) => {
    await window.load_scripts(item);
    unpkgScriptsLoaded++;

    if (unpkgScriptsLoaded === array.length) {
      init();
    }
  });
})();
