import * as fs from "fs";
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
import _ from "lodash";
import { parse } from "url";

import RedisStore from "./redis-store";

dotenv.config();
// Configure Redis session storage, so that active shops are persisted
// Heroku RedisToGo sets REDISTOGO_URL env var (https://devcenter.heroku.com/articles/redistogo#using-with-node-js)
let sessionStorage;
if (process.env.REDISTOGO_URL) {
  const rtg = parse(process.env.REDISTOGO_URL);
  sessionStorage = new RedisStore(rtg.hostname, rtg.port);
  sessionStorage.client.auth(rtg.auth.split(":")[1]);
} else {
  sessionStorage = new RedisStore(
    process.env.REDIS_HOST || "127.0.0.1",
    parseInt(process.env.REDIS_PORT) || 6379
  );
}

// These theme assets (in "assets") get deleted on reset (as opposed to theme sections, e.g. membership hero)
const ASSET_KEY_PREFIX = "unlock-member-benefits";
const LOCK_METAFIELD_PREFIX = "lock";
const LOCKDETAILS_METAFIELD_PREFIX = "info";
const METAFIELD_NAMESPACE = "umb";
const {
  NODE_ENV,
  SHOPIFY_API_SECRET,
  SHOPIFY_API_KEY,
  SCOPES,
  HOST,
  PORT,
  SHOP,
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
  SESSION_STORAGE: new Shopify.Session.CustomSessionStorage(
    sessionStorage.storeCallback,
    sessionStorage.loadCallback,
    sessionStorage.deleteCallback
  ),
});

const loadActiveShopsFromStorage = async () => {
  const activeShopsFromStorage = await sessionStorage.getAsync(
    "ACTIVE_SHOPIFY_SHOPS"
  );
  const activeShops = JSON.parse(activeShopsFromStorage);

  return activeShops || {};
};

const getAssetKey = (metafieldId) =>
  `assets/${ASSET_KEY_PREFIX}-${metafieldId}.js`;

// Get content of theme section liquid file
const getHeroSectionCode = (sectionName, address, networkId, name) => {
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/mb-hero.liquid`,
    { encoding: "utf8", flag: "r" }
  );
  const liquidString = fileContent
    .replace(
      /__MEMBERSHIP_NAME__/g,
      `${address.substr(0, 5)}...${address.substr(-3, 3)}`
    )
    .replace(
      /__MEMBERSHIP_CONFIG__/g,
      JSON.stringify({
        locks: {
          [address]: {
            network: parseInt(networkId),
            name,
          },
        },
        icon:
          "https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg",
        callToAction: {
          default: "Unlock",
        },
      })
    );
  // console.log("getHeroSectionCode", liquidString);

  return liquidString;
};

const getTopbarSectionCode = (
  sectionTemplateName,
  address,
  network,
  name,
  otherLocks
) => {
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/${sectionTemplateName}`,
    { encoding: "utf8", flag: "r" }
  );
  const locksByAddr = {
    [address]: {
      name,
      network,
    },
  };
  const lockOptions = [
    {
      value: address,
      label: name,
    },
  ];
  otherLocks.map((lock) => {
    locksByAddr[lock.address] = {
      name: lock.name,
      network: lock.networkId,
    };
    lockOptions.push({
      value: lock.address,
      label: lock.name,
    });
  });

  const liquidString = fileContent
    .replace(/__LOCKS_BY_ADDR__/g, JSON.stringify(locksByAddr))
    .replace(/__LOCK_OPTIONS__/g, JSON.stringify(lockOptions))
    .replace(
      /__LOCK_VALUES__/g,
      JSON.stringify(lockOptions.map(({ value }) => value)[0]) // TODO: pre-select multiple locks?
    );
  // console.log("getTopbarSectionCode", liquidString);

  return liquidString;
};

// Get content for the public JS asset for this member benefit
const getUnlockJavaScript = (discountCode) => {
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/unlock-paywall-modals.js`,
    { encoding: "utf8", flag: "r" }
  );
  const uploadContent = fileContent
    .replace(/__SHOP__/g, SHOP)
    .replace(/__DISCOUNT_CODE__/g, discountCode);
  // console.log("getUnlockJavaScript uploadContent", uploadContent);

  return uploadContent;
};

const deleteAsset = async (client, key) => {
  try {
    await client.delete({
      path: `assets`,
      query: { "asset[key]": key },
    });
  } catch (err) {
    console.log("Error trying to delete assets", err);
  }
};

const WEBHOOK_PATH_APP_UNINSTALLED = "/webhooks";
// Mandatory GDPR webhooks:
const WEBHOOK_PATH_CUSTOMERS_REQUEST = "/webhooks/customers-data_request";
const WEBHOOK_PATH_CUSTOMERS_REDACT = "/webhooks/customers-redact";
const WEBHOOK_PATH_SHOP_REDACT = "/webhooks/customers-redact";

const ACTIVE_SHOPIFY_SHOPS = loadActiveShopsFromStorage();

const registerWebhookAppUninstalled = async (shop, accessToken) => {
  const response = await Shopify.Webhooks.Registry.register({
    shop,
    accessToken,
    path: WEBHOOK_PATH_APP_UNINSTALLED,
    topic: "APP_UNINSTALLED",
    webhookHandler: async (topic, shop, body) => {
      delete ACTIVE_SHOPIFY_SHOPS[shop];
      sessionStorage.setAsync(
        "ACTIVE_SHOPIFY_SHOPS",
        JSON.stringify(ACTIVE_SHOPIFY_SHOPS)
      );
    },
  });

  if (!response.success) {
    console.log(
      `Failed to register APP_UNINSTALLED webhook: ${response.result}`
    );
  }
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
        sessionStorage.setAsync(
          "ACTIVE_SHOPIFY_SHOPS",
          JSON.stringify(ACTIVE_SHOPIFY_SHOPS)
        );
        registerWebhookAppUninstalled(shop, accessToken);

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

  router.post(WEBHOOK_PATH_APP_UNINSTALLED, async (ctx) => {
    try {
      await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
      console.log(`Webhook processed, returned status code 200`);
    } catch (error) {
      console.log(`Failed to process webhook: ${error}`);
    }
  });

  router.post(WEBHOOK_PATH_CUSTOMERS_REQUEST, async (ctx) => {
    try {
      console.log(`Processing WEBHOOK_PATH_CUSTOMERS_REQUEST`);
      // We don't store any customer data
      ctx.body = {};
      ctx.res.statusCode = 200;
    } catch (error) {
      console.log(
        `Failed to process ${WEBHOOK_PATH_CUSTOMERS_REQUEST}: ${error}`
      );
    }
  });

  router.post(WEBHOOK_PATH_CUSTOMERS_REDACT, async (ctx) => {
    try {
      console.log(`Processing WEBHOOK_PATH_CUSTOMERS_REDACT`);
      // We don't store any customer data
      ctx.res.statusCode = 200;
    } catch (error) {
      console.log(
        `Failed to process ${WEBHOOK_PATH_CUSTOMERS_REDACT}: ${error}`
      );
    }
  });

  router.post(WEBHOOK_PATH_SHOP_REDACT, async (ctx) => {
    try {
      console.log(`Processing WEBHOOK_PATH_SHOP_REDACT`);
      // We don't store any shop data
      ctx.res.statusCode = 200;
    } catch (error) {
      console.log(`Failed to process ${WEBHOOK_PATH_SHOP_REDACT}: ${error}`);
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
        const locks = metafieldsRes.body.metafields
          .filter((i) => i.key.indexOf(LOCK_METAFIELD_PREFIX) === 0)
          .map(({ id, value }) => {
            // Add details to locks if available
            const detailsMetafield = metafieldsRes.body.metafields.find(
              (i) => i.key === LOCKDETAILS_METAFIELD_PREFIX + id
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

        const codes = priceRules
          .filter(({ value_type, once_per_customer }) => {
            if (["fixed_amount", "percentage"].indexOf(value_type) === -1)
              return false;

            // Only general discount codes are supported at the moment.
            if (once_per_customer) return false;

            return true;
          })
          .map(({ title }) => title);
        discounts.push(...codes);

        console.log("api/locks discounts", discounts);
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

        const lockMetafieldKey = `${LOCK_METAFIELD_PREFIX}${uid(
          30 - LOCK_METAFIELD_PREFIX.length
        )}`;

        const metafieldRes = await client.post({
          path: "metafields",
          data: {
            metafield: {
              namespace: METAFIELD_NAMESPACE,
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
        const lockDetailsKey = `${LOCKDETAILS_METAFIELD_PREFIX}${metafieldId}`;
        const detailsMetafieldRes = await client.get({
          path: "metafields",
          query: { key: lockDetailsKey },
        });

        console.log("About to delete lock address", metafieldId);

        // Delete lock metafield
        try {
          await client.delete({
            path: `metafields/${metafieldId}`,
          });
        } catch (err) {
          console.log("Error trying to delete lock metafield", err);
        }

        if (detailsMetafieldRes.body.metafields.length > 0) {
          const { id, value } = detailsMetafieldRes.body.metafields[0];
          console.log("About to delete details metafield and script tag", id);

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
          if (scriptTagId) {
            try {
              await client.delete({
                path: `script_tags/${scriptTagId}`,
              });
            } catch (err) {
              console.log("Error trying to delete scriptTag", err);
            }
          }
        }

        // Delete script asset
        await client.delete({
          path: "assets",
          query: { "asset[key]": getAssetKey(metafieldId) },
        });

        // Delete hero theme section template
        await client.delete({
          path: "assets",
          query: { "asset[key]": `sections/mb-hero-${metafieldId}.liquid` },
        });

        // TODO: Update lock blocks of multi-lock theme sections (e.g. topbar)

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
  // The content of this metafield is later exposed to the public via liquid variables in the scriptTag, theme section, or custom code snippets.
  router.post(
    "/api/saveLock",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      let lockDetails, scriptTagId, lockDetailsMetafieldId, scriptTagSrc;
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
        isEnabled,
        networkId,
        discountId,
        otherLocks,
      } = payload;

      const lockDetailsKey = `${LOCKDETAILS_METAFIELD_PREFIX}${metafieldId}`;
      console.log("lockDetailsKey", lockDetailsKey);

      // Lock must create theme section assets:
      // 1) Hero
      try {
        const sectionName = `mb-hero-${metafieldId}.liquid`;
        const assetsRes = await client.put({
          path: "assets",
          data: {
            asset: {
              key: `sections/${sectionName}`,
              value: getHeroSectionCode(sectionName, address, networkId, name),
            },
          },
          type: "application/json",
        });
        if (!assetsRes.body.asset) {
          console.log("Invalid put assetsRes", sectionName, assetsRes);
          throw "Missing asset.public_url";
        }
        // console.log(
        //   "New assetsRes.body.asset",
        //   sectionName,
        //   assetsRes.body.asset
        // );
      } catch (err) {
        console.log("Error trying to save here theme section in addLock", err);
        ctx.body = {
          status: "error",
          errors: "Could not create hero theme section for lock.",
        };

        return;
      }

      // 2) Topbar
      try {
        const sectionName = "mb-topbar.liquid";
        const topBarSectionCode = getTopbarSectionCode(
          sectionName,
          address,
          networkId,
          name,
          otherLocks
        );
        const assetsRes = await client.put({
          path: "assets",
          data: {
            asset: {
              key: `sections/${sectionName}`,
              value: topBarSectionCode,
            },
          },
          type: "application/json",
        });
        if (!assetsRes.body.asset) {
          console.log("Invalid put assetsRes", sectionName, assetsRes);
          throw "Missing asset.public_url";
        }
      } catch (err) {
        console.log(
          "Error trying to save topbar theme section in addLock",
          err
        );
        ctx.body = {
          status: "error",
          errors: "Could not create topbar theme section for lock.",
        };

        return;
      }

      // Lock must create the JS assets for the scriptTag src
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

        const { metafields } = detailsMetafieldRes.body;
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

      // Update or create lock details metafield
      await client.post({
        path: "metafields",
        data: {
          metafield: {
            namespace: METAFIELD_NAMESPACE,
            key: lockDetailsKey,
            value: JSON.stringify({
              address,
              name,
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
        metafields.map(async ({ id }) => {
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
        const appAssets = assetsRes.body.assets.filter(
          ({ key }) =>
            key.indexOf(`assets/${ASSET_KEY_PREFIX}`) === 0 ||
            key.indexOf("sections/mb-hero") === 0
        );
        console.log("Deleting assets", appAssets);
        appAssets.map(async ({ key }) => {
          // FIXME: API rate limit of 2 per second
          await deleteAsset(client, key);
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
