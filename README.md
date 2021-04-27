# Unlock Shopify App

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE.md)

This app for Shopify stores allows merchants to offer special memberships to their customers via [Unlock Protocol](https://github.com/unlock-protocol).

Merchants can [create Unlock Protocol locks](https://app.unlock-protocol.com/dashboard) in the Creator Dashboard.

Customers may then acquire keys for such locks, turning them into members, automatically unlocking the benefits to them (key ownership is proof of membership).

Boilerplate based on [Shopify-App-CLI](https://github.com/Shopify/shopify-app-cli): an embedded Shopify app made with Node, [Next.js](https://nextjs.org/), [Shopify-koa-auth](https://github.com/Shopify/quilt/tree/master/packages/koa-shopify-auth), [Polaris](https://github.com/Shopify/polaris-react), and [App Bridge React](https://shopify.dev/tools/app-bridge/react-components).

## Installation

run:

```sh
~/ $ shopify create project APP_NAME
```

**Note:** Shopify merchants may find it easier to use the _free app_ from the Shopify App Store (coming soon).

## Requirements

- If you don’t have one, [create a Shopify partner account](https://partners.shopify.com/signup).
- If you don’t have one, [create a Development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) where you can install and test your app.
- In the Shopify Partner dashboard, [create a new app](https://help.shopify.com/en/api/tools/partner-dashboard/your-apps#create-a-new-app). You’ll need this app’s API credentials during the setup process.

## Features

- A Shopify merchant adds one **Lock** (or more, once supported) to their online store, and assigns a benefit to each.
- Customers can see the possible benefits associated with locks/memberships – for example 10% discount, or free shipping. An example code snippet can be copy-pasted into a template file of the Shopify theme.
- Customers with a fitting **Key** get their benefit applied. At the moment, the only supported benefits of the type _discount code_ are supported.

## License

This respository is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).
