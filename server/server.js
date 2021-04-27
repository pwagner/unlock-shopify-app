import "@babel/polyfill";
import dotenv from "dotenv";
import "isomorphic-fetch";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import Shopify, { ApiVersion } from "@shopify/shopify-api";
import Koa from "koa";
import next from "next";
import Router from "koa-router";
import bodyParser from "koa-body-parser";
import { uid } from "uid";

dotenv.config();
const lockMetafieldKeyPrefix = "lock";
const lockDetailsMetafieldKeyPrefix = "info";
const metafieldNamespace = "umb";
const {
  NODE_ENV,
  SHOPIFY_API_SECRET,
  SHOPIFY_API_KEY,
  SCOPES,
  HOST,
  PORT,
} = process.env;
const port = parseInt(PORT, 10) || 8081;
const dev = NODE_ENV !== "production";
const app = next({
  dev,
});
const handle = app.getRequestHandler();

Shopify.Context.initialize({
  API_KEY: SHOPIFY_API_KEY,
  API_SECRET_KEY: SHOPIFY_API_SECRET,
  SCOPES: SCOPES.split(","),
  HOST_NAME: HOST.replace(/https:\/\//, ""),
  API_VERSION: ApiVersion.April21,
  IS_EMBEDDED_APP: true,
  // This should be replaced with your preferred storage strategy
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {};

const getAssetKey = (metafieldId) =>
  `assets/unlock-member-benefits-${metafieldId}.js`;

// TODO: If discount_code cookie is present, hide elements with class .hide-after-unlocked
// FIXME: make sure window.unlockProtocol.loadCheckoutModal() is called, so that it doesn't require another click on the button
const getUnlockJavaScript = (discountCode) => {
  return `if(!window.showUnlockPaywall) {
  window.showUnlockPaywall = function(config) {
    if(!window.unlockProtocol){(function(d, s) {
      var js = d.createElement(s),
      sc = d.getElementsByTagName(s)[0];
      js.src = "https://paywall.unlock-protocol.com/static/unlock.latest.min.js";
      sc.parentNode.insertBefore(js, sc);
    }(document, "script"));}
    window.unlockProtocolConfig = config;
    window.unlockProtocol && window.unlockProtocol.loadCheckoutModal();
  }
}

window.addEventListener('unlockProtocol.status', function(event) {
  var unlockState = event.detail.state.toString();
  console.log('unlockProtocol.status', event, unlockState);

  // We hide all .unlock-content elements
  document.querySelector('.unlock-content').style.display = "none"
  // We show only the relevant element (CSS class: locked|unlocked)
  document.querySelectorAll('.unlock-content.' + unlockState).forEach((element) => {
    element.style.display = "block";
  })

  // If a discount has already been applied, don't redirect
  var getCookie = function(name) {
    var value = "; " + document.cookie;
    var parts = value.split('; '+name+'=');
    if (parts.length == 2) return parts.pop().split(";").shift();
  };
  codeCookieValue = getCookie('discount_code');
  if(codeCookieValue){
    console.log("Currently active discount", codeCookieValue);
    if(codeCookieValue === '${discountCode}'){
      console.log("Discount already applied.");

      return;
    } else {
      console.log("Other discount already applied.");
      // TODO: overrides?

      return;
    }
  } else if(unlockState === 'unlocked') {
    var redirectUrl = 'https://unlock-protocol-example.myshopify.com/discount/${discountCode}?redirect=' + window.location.pathname;
    console.log('Welcome! Unlocked member benefit ${discountCode} - redirecting to ', redirectUrl);
    window.location.replace(redirectUrl);
  }
})

window.addEventListener('unlockProtocol.authenticated', function(event) {
  // event.detail.addresss includes the address of the current user, when known
  console.log('unlockProtocol.authenticated', event);
})

window.addEventListener('unlockProtocol.transactionSent', function(event) {
  // event.detail.hash includes the hash of the transaction sent
  console.log('unlockProtocol.transactionSent', event);
})`;
};

app.prepare().then(async () => {
  const server = new Koa();
  server.use(bodyParser());
  const router = new Router();
  server.keys = [Shopify.Context.API_SECRET_KEY];
  server.use(
    createShopifyAuth({
      async afterAuth(ctx) {
        const { shop, accessToken, scope } = ctx.state.shopify;
        ACTIVE_SHOPIFY_SHOPS[shop] = scope;

        const response = await Shopify.Webhooks.Registry.register({
          shop,
          accessToken,
          path: "/webhooks",
          topic: "APP_UNINSTALLED",
          webhookHandler: async (topic, shop, body) =>
            delete ACTIVE_SHOPIFY_SHOPS[shop],
        });

        if (!response.success) {
          console.log(
            `Failed to register APP_UNINSTALLED webhook: ${response.result}`
          );
        }

        // Redirect to app with shop parameter upon auth
        ctx.redirect(`/?shop=${shop}`);
      },
    })
  );

  const handleRequest = async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  };

  router.get("/", async (ctx) => {
    const shop = ctx.query.shop;

    // This shop hasn't been seen yet, go through OAuth to create a session
    if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined) {
      ctx.redirect(`/auth?shop=${shop}`);
    } else {
      await handleRequest(ctx);
    }
  });

  router.post("/webhooks", async (ctx) => {
    try {
      await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
      console.log(`Webhook processed, returned status code 200`);
    } catch (error) {
      console.log(`Failed to process webhook: ${error}`);
    }
  });

  router.post(
    "/graphql",
    verifyRequest({ returnHeader: true }),
    async (ctx, next) => {
      await Shopify.Utils.graphqlProxy(ctx.req, ctx.res);
    }
  );

  router.get(
    "/api/locks",
    verifyRequest({ returnHeader: true }),
    async (ctx, next) => {
      const discounts = [];
      try {
        const session = await Shopify.Utils.loadCurrentSession(
          ctx.req,
          ctx.res
        );
        const client = new Shopify.Clients.Rest(
          session.shop,
          session.accessToken
        );

        const metafieldsRes = await client.get({
          path: "metafields",
        });
        console.log(
          "get locks: metafieldsRes.body.metafields",
          metafieldsRes.body.metafields
        );
        const locks = metafieldsRes.body.metafields
          .filter((i) => i.key.indexOf(lockMetafieldKeyPrefix) === 0)
          .map(({ id, value }) => {
            // Add details to locks if available
            const detailsMetafield = metafieldsRes.body.metafields.find(
              (i) => i.key === lockDetailsMetafieldKeyPrefix + id
            );
            if (detailsMetafield) {
              const details = JSON.parse(detailsMetafield.value);

              return {
                metafieldId: id,
                ...details,
              };
            }

            return {
              metafieldId: id,
              address: value,
            };
          });

        // Also return all discounts
        // First get price-rules (needed to retrieve discount_codes)
        const priceRulesRes = await client.get({
          path: "price_rules",
        });
        const priceRules = priceRulesRes.body.price_rules;
        // console.log('priceRules', priceRules);

        // Get discount_codes for each price_rule
        await Promise.all(
          priceRules.map(async ({ id }) => {
            const discountsRes = await client.get({
              path: `price_rules/${id}/discount_codes`,
            });
            console.log(
              "discountsRes.body.discount_codes",
              discountsRes.body.discount_codes
            );
            discountsRes.body.discount_codes.map(({ code }) => {
              discounts.push(code);
            });

            return {
              id,
            };
          })
        );

        console.log("discounts", discounts);
        ctx.body = {
          status: "success",
          data: {
            locks,
            discounts,
          },
        };
      } catch (err) {
        console.log("api/locks error", err);
        ctx.body = {
          status: "error",
          errors: "Unknown error occurred",
        };
      }
    }
  );

  // When adding a new lock, we first save it's address in a Shopify shop metafield.
  // The details of the lock are stored in a separate JSON metafield.
  router.post(
    "/api/addLock",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      try {
        const session = await Shopify.Utils.loadCurrentSession(
          ctx.req,
          ctx.res
        );
        const client = new Shopify.Clients.Rest(
          session.shop,
          session.accessToken
        );
        const payload = JSON.parse(ctx.request.body);
        if (!payload || !payload.lockAddr) {
          throw "lockAddr missing in request body";
        }
        const { lockAddr } = payload;
        console.log("addLock got lockAddr", lockAddr);

        const lockMetafieldKey = `${lockMetafieldKeyPrefix}${uid(
          30 - lockMetafieldKeyPrefix.length
        )}`;

        const metafieldRes = await client.post({
          path: "metafields",
          data: {
            metafield: {
              namespace: metafieldNamespace,
              key: lockMetafieldKey,
              value: lockAddr,
              value_type: "string",
            },
          },
          type: "application/json",
        });
        const { metafield } = metafieldRes.body;

        ctx.body = {
          status: "success",
          data: {
            metafieldId: metafield.id,
          },
        };
      } catch (err) {
        console.log("Error in addLock", err);
        ctx.body = {
          status: "error",
          errors: "Unknown error occurred",
        };
      }
    }
  );

  // Removing lock deletes the address- and JSON-metafield, as well as the script-tag and asset.
  router.post(
    "/api/removeLock",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      try {
        const session = await Shopify.Utils.loadCurrentSession(
          ctx.req,
          ctx.res
        );
        const client = new Shopify.Clients.Rest(
          session.shop,
          session.accessToken
        );
        const payload = JSON.parse(ctx.request.body);
        if (!payload || !payload.metafieldId) {
          throw "metafieldId missing in request body";
        }
        const { metafieldId } = payload;
        console.log("removeLock got metafieldId", metafieldId);
        const lockDetailsKey = `${lockDetailsMetafieldKeyPrefix}${metafieldId}`;
        const detailsMetafieldRes = await client.get({
          path: "metafields",
          query: { key: lockDetailsKey },
        });
        const { id, value } = detailsMetafieldRes.body.metafields[0];
        console.log(
          "About to be delete lock address and details metafields",
          metafieldId,
          id
        );

        // Delete lock metafield
        try {
          await client.delete({
            path: `metafields/${metafieldId}`,
          });
        } catch (err) {
          console.log("Error trying to delete lock metafield", err);
        }

        // Delete details metafield
        try {
          await client.delete({
            path: `metafields/${id}`,
          });
        } catch (err) {
          console.log("Error trying to delete details metafield", err);
        }

        // Delete script tag
        const lockDetails = JSON.parse(value);
        const { scriptTagId } = lockDetails;
        try {
          await client.delete({
            path: `script_tags/${scriptTagId}`,
          });
        } catch (err) {
          console.log("Error trying to delete scriptTag", err);
        }

        // Delete script asset
        const deleteAssetRes = await client.delete({
          path: "assets",
          query: { "asset[key]": getAssetKey(metafieldId) },
        });

        ctx.body = {
          status: "success",
        };
      } catch (err) {
        console.log("Error in removeLock", err);
        ctx.body = {
          status: "error",
          errors: "Could not remove lock.",
        };
      }
    }
  );

  // Save the details of a lock in another metafield, which has keys of pattern: 'info' + lockMetafieldId
  // The content of this metafield is later exposed to the public via liquid variables in the scriptTag
  router.post(
    "/api/saveLock",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      let lockDetails,
        scriptTagId,
        assetId,
        oldAssetId,
        lockDetailsMetafieldId,
        scriptTagSrc;
      const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res);
      const client = new Shopify.Clients.Rest(
        session.shop,
        session.accessToken
      );
      const payload = JSON.parse(ctx.request.body);
      console.log("saveLock payload", payload);
      if (!payload || !payload.address) {
        throw "address missing in request body";
      }
      const {
        metafieldId,
        address,
        name,
        cta,
        isEnabled,
        networkId,
        discountId,
      } = payload;

      const lockDetailsKey = `${lockDetailsMetafieldKeyPrefix}${metafieldId}`;
      console.log("lockDetailsKey", lockDetailsKey);

      // Each lock must create the JS asset for the scriptTag src
      const assetKey = getAssetKey(metafieldId);
      try {
        const assetsRes = await client.get({
          path: "assets",
          query: { "asset[key]": assetKey },
        });
        // Throws invalid JSON error if it doesn't exist yet
        if (!assetsRes.body.asset || !assetsRes.body.asset.public_url) {
          console.log("Invalid get assetsRes", assetsRes);
          throw "Missing asset.public_url";
        }
        console.log(
          "Found existing assetsRes.body.asset",
          assetsRes.body.asset
        );
      } catch (err) {
        console.log("Error trying to get theme asset for scriptTag", err);
        console.log(
          "Presumably missing asset (ambiguous invalid json response), creating asset now"
        );
      }

      try {
        const assetsRes = await client.put({
          path: "assets",
          data: {
            asset: {
              key: assetKey,
              value: getUnlockJavaScript(discountId),
            },
          },
          type: "application/json",
        });
        if (!assetsRes.body.asset || !assetsRes.body.asset.public_url) {
          console.log("Invalid put assetsRes", assetsRes);
          throw "Missing asset.public_url";
        }
        console.log("New assetsRes.body.asset", assetsRes.body.asset);
        scriptTagSrc = assetsRes.body.asset.public_url;

        const detailsMetafieldRes = await client.get({
          path: "metafields",
          query: { key: lockDetailsKey },
        });
        console.log(
          "detailsMetafieldRes.body.metafields",
          detailsMetafieldRes.body.metafields
        );

        const metafields = detailsMetafieldRes.body;
        if (metafields.length > 0) {
          lockDetails = JSON.parse(metafields[0].value);
          lockDetailsMetafieldId = metafields[0].id;
          console.log("Lock details", lockDetails);

          // Delete existing scriptTag
          if (lockDetails.scriptTagId) {
            await client.delete({
              path: `script_tags/${lockDetails.scriptTagId}`,
            });
          }
        }
      } catch (err) {
        console.log("Error in addLock", err);
        ctx.body = {
          status: "error",
          errors: "Could not add lock.",
        };

        return;
      }

      // If the lock is enabled, add a scriptTag that loads the Unlock Paywall JS code.
      if (isEnabled) {
        // Create new script tag
        const scriptTagRes = await client.post({
          path: "script_tags",
          data: {
            script_tag: {
              event: "onload",
              src: scriptTagSrc,
              display_scope: "online_store",
            },
          },
          type: "application/json",
        });
        scriptTagId = scriptTagRes.body.script_tag.id;
      }

      if (lockDetails) {
        // Update existing lock
        await client.put({
          path: `metafields/${lockDetailsMetafieldId}`,
          data: {
            metafield: {
              namespace: metafieldNamespace,
              key: lockDetailsKey,
              value: JSON.stringify({
                address,
                name,
                cta,
                isEnabled,
                networkId,
                discountId,
                scriptTagId,
              }),
              value_type: "json_string",
            },
          },
          type: "application/json",
        });
      } else {
        // Create new lock
        await client.post({
          path: "metafields",
          data: {
            metafield: {
              namespace: metafieldNamespace,
              key: lockDetailsKey,
              value: JSON.stringify({
                address,
                name,
                cta,
                isEnabled,
                networkId,
                discountId,
                scriptTagId,
              }),
              value_type: "json_string",
            },
          },
          type: "application/json",
        });
      }

      ctx.body = {
        status: "success",
        data: { scriptTagId },
      };
    }
  );

  router.get(
    "/api/reset",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      try {
        const session = await Shopify.Utils.loadCurrentSession(
          ctx.req,
          ctx.res
        );
        const client = new Shopify.Clients.Rest(
          session.shop,
          session.accessToken
        );
        const scriptTagsRes = await client.get({
          path: "script_tags",
        });
        const scriptTags = scriptTagsRes.body.script_tags;
        console.log("Deleting scriptTags", scriptTags);
        scriptTags.map(async ({ id }) => {
          try {
            await client.delete({
              path: `script_tags/${id}`,
            });
          } catch (err) {
            console.log("Error trying to delete scriptTag", err);
          }
        });

        const metafieldsRes = await client.get({
          path: "metafields",
        });
        const { metafields } = metafieldsRes.body;
        console.log("Deleting metafields", metafields);
        metafields.map(async ({ id, value }) => {
          try {
            await client.delete({
              path: `metafields/${id}`,
            });
          } catch (err) {
            console.log("Error trying to delete metafield", err);
          }
        });

        const assetsRes = await client.get({
          path: "assets",
        });
        const { assets } = assetsRes.body;
        console.log("Deleting assets", assets);
        assets.map(async ({ id }) => {
          try {
            await client.delete({
              path: `assets/${id}`,
            });
          } catch (err) {
            console.log("Error trying to delete assets", err);
          }
        });

        ctx.body = {
          status: "success",
        };
      } catch (err) {
        console.log("api/reset error", err);
        ctx.body = {
          status: "error",
          errors: "Could not reset",
        };
      }
    }
  );

  router.get("(/_next/static/.*)", handleRequest); // Static content is clear
  router.get("/_next/webpack-hmr", handleRequest); // Webpack content is clear
  router.get("(.*)", verifyRequest(), handleRequest); // Everything else must have sessions

  server.use(router.allowedMethods());
  server.use(router.routes());
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});