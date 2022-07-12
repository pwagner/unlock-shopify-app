import * as fs from "fs";
import "@babel/polyfill";
import dotenv from "dotenv";
import "isomorphic-fetch";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import Shopify from "@shopify/shopify-api";
import Koa from "koa";
import next from "next";
import Router from "koa-router";
import bodyParser from "koa-body-parser";
import { uid } from "uid";
import _ from "lodash";
import { parse } from "url";
import { ethers } from "ethers";
import Web3 from "web3";

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
const SCRIPT_ASSET_KEY = "memberbenefits.js";
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
  WEB3_PROVIDER_MAINNET, // Infura
  WEB3_PROVIDER_POLYGON, // Infura
  WEB3_PROVIDER_OPTIMISM, // Infura
  WEB3_PROVIDER_XDAI, // Ankr
  WEB3_PROVIDER_BSC, // Ankr
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
  API_VERSION: "2021-10", // Shopify.ApiVersion.October21
  IS_EMBEDDED_APP: true,
  SESSION_STORAGE: new Shopify.Session.CustomSessionStorage(
    sessionStorage.storeCallback,
    sessionStorage.loadCallback,
    sessionStorage.deleteCallback
  ),
});

// Web3 instances for productive networks (potentially having locks)
const web3ByNetwork = {};

if (WEB3_PROVIDER_MAINNET) {
  web3ByNetwork.ethereum = new Web3(
    new Web3.providers.HttpProvider(WEB3_PROVIDER_MAINNET)
  );
} else {
  console.log("Missing WEB3_PROVIDER_MAINNET");
}

if (WEB3_PROVIDER_POLYGON) {
  web3ByNetwork.polygon = new Web3(
    new Web3.providers.HttpProvider(WEB3_PROVIDER_POLYGON)
  );
} else {
  console.log("Missing WEB3_PROVIDER_BSC");
}

if (WEB3_PROVIDER_OPTIMISM) {
  web3ByNetwork.optimism = new Web3(
    new Web3.providers.HttpProvider(WEB3_PROVIDER_OPTIMISM)
  );
} else {
  console.log("Missing WEB3_PROVIDER_OPTIMISM");
}

if (WEB3_PROVIDER_XDAI) {
  web3ByNetwork.xdai = new Web3(
    new Web3.providers.HttpProvider(WEB3_PROVIDER_XDAI)
  );
} else {
  console.log("Missing WEB3_PROVIDER_XDAI");
}

if (WEB3_PROVIDER_BSC) {
  web3ByNetwork.bsc = new Web3(
    new Web3.providers.HttpProvider(WEB3_PROVIDER_BSC)
  );
} else {
  console.log("Missing WEB3_PROVIDER_BSC");
}

const loadActiveShopsFromStorage = async () => {
  const activeShopsFromStorage = await sessionStorage.getAsync(
    "ACTIVE_SHOPIFY_SHOPS"
  );
  const activeShops = JSON.parse(activeShopsFromStorage);

  return activeShops || {};
};

const getMembershipSettingOptions = (memberships) =>
  memberships.map(({ lockName }) => ({
    value: lockName,
    label: lockName,
  }));

const getLocksByMembershipName = (memberships) => {
  const locksByName = {};
  memberships.map(({ lockName, lockAddresses }) => {
    if (!locksByName[lockName]) {
      locksByName[lockName] = lockAddresses;
    }
  });

  return locksByName;
};

// Get content of theme section liquid file
const getHeroSectionCode = (lockAddresses, name, otherMemberships) => {
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/mb-hero.liquid`,
    { encoding: "utf8", flag: "r" }
  );

  const membershipSettingOptions = getMembershipSettingOptions([
    { lockName: name },
    ...otherMemberships,
  ]);
  const locksByMembershipName = getLocksByMembershipName([
    { lockName: name, lockAddresses },
    ...otherMemberships,
  ]);

  const liquidString = fileContent
    .replace(
      /__MEMBERSHIP_SECTION_SETTING_OPTIONS__/g,
      JSON.stringify(membershipSettingOptions)
    )
    .replace(/__LOCKS_BY_NAME__/g, JSON.stringify(locksByMembershipName));

  return liquidString;
};

const getTopbarSectionCode = (
  sectionTemplateName,
  lockAddresses,
  name,
  otherMemberships
) => {
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/${sectionTemplateName}`,
    { encoding: "utf8", flag: "r" }
  );

  const membershipSettingOptions = getMembershipSettingOptions([
    { lockName: name },
    ...otherMemberships,
  ]);
  const locksByMembershipName = getLocksByMembershipName([
    { lockName: name, lockAddresses },
    ...otherMemberships,
  ]);

  const liquidString = fileContent
    .replace(
      /__MEMBERSHIP_SECTION_SETTING_OPTIONS__/g,
      JSON.stringify(membershipSettingOptions)
    )
    .replace(/__LOCKS_BY_NAME__/g, JSON.stringify(locksByMembershipName))
    .replace(
      /__LOCK_VALUES__/g,
      JSON.stringify(membershipSettingOptions.map(({ value }) => value)[0]) // TODO: pre-select multiple locks?
    );

  return liquidString;
};

// Get content for the public JS asset for this member benefit
const getMemberBenefitsJS = (
  discountCode,
  lockAddresses,
  membershipName,
  otherMemberships
) => {
  const locksByMembershipName = getLocksByMembershipName([
    { lockName: membershipName, lockAddresses },
    ...otherMemberships,
  ]);
  const discountCodesByLockAddresses = {};
  lockAddresses.map((addr) => {
    discountCodesByLockAddresses[addr] = discountCode;
  });
  otherMemberships.map(({ discountId, lockAddresses }) => {
    lockAddresses.map((addr) => {
      discountCodesByLockAddresses[addr] = discountId;
    });
  });
  const fileContent = fs.readFileSync(
    `${__dirname}/shopify-theme-templates/memberbenefits.js`,
    { encoding: "utf8", flag: "r" }
  );
  const uploadContent = fileContent
    .replace(
      /__DISCOUNT_CODE_BY_LOCK_ADDRESS__/g,
      JSON.stringify(discountCodesByLockAddresses)
    )
    .replace(/__LOCKS_BY_NAME__/g, JSON.stringify(locksByMembershipName))
    .replace(/__UNLOCK_APP_URL__/g, `${HOST}${UNLOCK_PATH}`)
    .replace(/__UNLOCK_STATE_URL__/g, `${HOST}${UNLOCK_STATE_PATH}`);
  // console.log("memberbenefits.js uploadContent", uploadContent);

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

const UNLOCK_PATH = "/unlock"; // Unlock Protocol redirect here after verifying the user's address.
const UNLOCK_STATE_PATH = "/api/getUnlockState"; // Unlock Protocol redirect here after verifying the user's address.
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

  router.get(UNLOCK_STATE_PATH, async (ctx) => {
    try {
      // Generate state as hash of IP and current timestamp
      const state = ethers.utils.id(ctx.request.ip + Date.now());

      // Store redirectUri in redis using state as key.
      const redirectUri = (ctx.query && ctx.query.url) || "";
      const locks = (ctx.query && ctx.query.locks) || "";
      const membershipNames = (ctx.query && ctx.query.membershipNames) || "";

      sessionStorage.setAsync(
        state,
        JSON.stringify({
          redirectUri,
          locks: locks.split(","),
          memberships: membershipNames.split(","),
        }),
        "EX",
        60 * 5 // Expire in 5 min.
      );

      ctx.set("Access-Control-Allow-Origin", "*");
      ctx.body = { state };
      ctx.res.statusCode = 200;
    } catch (error) {
      console.log(`Failed to get unlock state: ${error}`);
    }
  });

  function checkKeyValidity(web3, lockAddress, selectedAccount) {
    const lock = new web3.eth.Contract(
      [
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
      ],
      lockAddress
    );

    return lock.methods
      .getHasValidKey(selectedAccount)
      .call()
      .then((result) => {
        if (result === true) {
          console.log("Found valid key", lockAddress);

          return true;
        }

        return false;
      })
      .catch(async (err) => {
        const networkId = await web3.eth.net.getId();
        console.log(
          "Could not validate key (or find lock) on network:",
          networkId
        );

        if (
          err
            .toString()
            .indexOf(
              `Returned values aren't valid, did it run Out of Gas? You might also see this error if you are not using the correct ABI for the contract you are retrieving data from, requesting data from a block number that does not exist, or querying a node which is not fully synced.`
            ) !== -1
        ) {
          // console.log("Lock probably not on network");
        }

        if (
          err
            .toString()
            .indexOf(`Invalid JSON RPC response: "Server Internal Error`) !== -1
        ) {
          console.log("Web3 provider ERROR");
        }

        return false;
      });
  }

  router.get(UNLOCK_PATH, async (ctx) => {
    console.log("UNLOCK_PATH", UNLOCK_PATH);
    try {
      // Extract user's address from signed message.
      const { state, code } = ctx.query;
      const decoded = ethers.utils.base64.decode(code);
      const message = JSON.parse(ethers.utils.toUtf8String(decoded));
      const address = ethers.utils.verifyMessage(message.d, message.s);
      console.log("Looking up keys of", address);

      // Use state to load URL for redirect back to shop.
      const storedString = await sessionStorage.getAsync(state);
      const data = JSON.parse(storedString);
      const { redirectUri, locks, memberships } = data;
      console.log("Checked for memberships", memberships);
      const finalUrl = new URL(redirectUri);

      // Validate memberships for recovered address.
      const validMemberships = [];
      for (let lockAddress of locks) {
        // Check if lock address is deployed on a productive network, and if the key is valid
        for (let networkName in web3ByNetwork) {
          if (
            await checkKeyValidity(
              web3ByNetwork[networkName],
              lockAddress,
              address
            )
          ) {
            validMemberships.push(lockAddress);
            console.log(`Found membership on ${networkName}!`);
          }
        }
      }

      console.log("validMemberships", validMemberships);

      finalUrl.searchParams.set("_mb_address", address);
      finalUrl.searchParams.set("_mb_locks", validMemberships);
      finalUrl.searchParams.set("_mb_memberships", memberships);

      // Redirect back to shop
      ctx.redirect(finalUrl.toString());
      ctx.res.statusCode = 303;
    } catch (error) {
      console.log(UNLOCK_PATH, `Failed to unlock! ${error}`);

      // TODO: redirect customer back to shop?
      // ctx.redirect(finalUrl.toString());
      ctx.res.statusCode = 401;
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
    "/api/memberships",
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

        const memberships = metafieldsRes.body.metafields
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
              lockName: value,
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

        console.log("api/memberships discounts", discounts);
        ctx.body = {
          status: "success",
          data: {
            memberships,
            discounts,
          },
        };
      } catch (err) {
        console.log("api/memberships error", err);
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
    "/api/addMembership",
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
        if (!payload || !payload.lockName) {
          throw "lockName missing in request body";
        }
        const { lockName } = payload;
        console.log("addMembership got lockName", lockName);

        const lockMetafieldKey = `${LOCK_METAFIELD_PREFIX}${uid(
          30 - LOCK_METAFIELD_PREFIX.length
        )}`;

        const metafieldRes = await client.post({
          path: "metafields",
          data: {
            metafield: {
              namespace: METAFIELD_NAMESPACE,
              key: lockMetafieldKey,
              value: lockName,
              type: "single_line_text_field",
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
        console.log("Error in addMembership", err);
        ctx.body = {
          status: "error",
          errors: "Unknown error occurred",
        };
      }
    }
  );

  // Removing lock deletes the address- and JSON-metafield, as well as the script-tag and asset.
  router.post(
    "/api/removeMembership",
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
        // TODO: Only if this is the last membership to be deleted
        /*
        await client.delete({
          path: "assets",
          query: { "asset[key]": `assets/${SCRIPT_ASSET_KEY}` },
        });
        */

        // TODO: Update locks in theme sections (e.g. hero, blocks in topbar)

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
    "/api/saveMembership",
    verifyRequest({ returnHeader: true }),
    async (ctx) => {
      let lockDetails, scriptTagId, lockDetailsMetafieldId, scriptTagSrc;
      const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res);
      const client = new Shopify.Clients.Rest(
        session.shop,
        session.accessToken
      );
      const payload = JSON.parse(ctx.request.body);
      console.log("saveMembership payload", payload);
      if (!payload || !payload.lockAddresses) {
        throw "lockAddresses missing in request body";
      }
      if (!payload || !payload.lockName) {
        throw "lockName missing in request body";
      }
      const {
        metafieldId,
        lockAddresses,
        lockName,
        isEnabled,
        discountId,
        otherMemberships,
      } = payload;

      const lockDetailsKey = `${LOCKDETAILS_METAFIELD_PREFIX}${metafieldId}`;
      console.log("lockDetailsKey", lockDetailsKey);
      console.log("otherMemberships", otherMemberships);

      // Lock must create theme section assets:

      // 1) Hero
      console.log("Creating Hero asset");
      try {
        const sectionName = `mb-hero.liquid`;
        const assetsRes = await client.put({
          path: "assets",
          data: {
            asset: {
              key: `sections/${sectionName}`,
              value: getHeroSectionCode(
                lockAddresses,
                lockName,
                otherMemberships
              ),
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
          "Error trying to save Hero theme section in saveMembership, err json:",
          JSON.stringify(err)
        );
        ctx.body = {
          status: "error",
          errors: "Could not create hero theme section for membership.",
        };

        return;
      }

      // 2) Topbar
      console.log("Creating Topbar asset");
      try {
        const sectionName = "mb-topbar.liquid";
        const topBarSectionCode = getTopbarSectionCode(
          sectionName,
          lockAddresses,
          lockName,
          otherMemberships
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
          "Error trying to save topbar theme section in saveMembership",
          err
        );
        ctx.body = {
          status: "error",
          errors: "Could not create topbar theme section for lock.",
        };

        return;
      }

      // TODO: there only needs to be one scriptTag for all memberships
      // If the membership is enabled, add its info to script
      if (isEnabled) {
        console.log("Creating JS asset (for scriptTag)");
        try {
          const assetsRes = await client.get({
            path: "assets",
            query: { "asset[key]": `assets/${SCRIPT_ASSET_KEY}` },
          });
          // Throws invalid JSON error if it doesn't exist yet
          if (!assetsRes.body.asset || !assetsRes.body.asset.public_url) {
            console.log("Invalid get assetsRes", assetsRes);
            throw "Missing asset.public_url";
          }
          console.log("Found existing assetsRes.body.asset");
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
                key: `assets/${SCRIPT_ASSET_KEY}`,
                value: getMemberBenefitsJS(
                  discountId,
                  lockAddresses,
                  lockName,
                  otherMemberships
                ),
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
          console.log("Error in saveMembership", err);
          ctx.body = {
            status: "error",
            errors: "Could not save membership.",
          };

          return;
        }

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
              lockAddresses,
              lockName,
              isEnabled,
              discountId,
              scriptTagId,
            }),
            type: "json",
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
            key.indexOf(`assets/${SCRIPT_ASSET_KEY}`) === 0 ||
            key.indexOf("sections/mb-hero") === 0 ||
            key.indexOf("sections/mb-topbar") === 0
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
  router.get("(.*)", async (ctx) => {
    const shop = ctx.query.shop;

    if (Shopify.Context.IS_EMBEDDED_APP && shop) {
      ctx.res.setHeader(
        "Content-Security-Policy",
        `frame-ancestors https://${shop} https://admin.shopify.com;`
      );
    } else {
      ctx.res.setHeader("Content-Security-Policy", `frame-ancestors 'none';`);
    }

    // This shop hasn't been seen yet, go through OAuth to create a session
    if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined) {
      ctx.redirect(`/auth?shop=${shop}`);
    } else {
      await handleRequest(ctx);
    }
  });

  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
