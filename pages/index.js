import React from "react";
import {
  Page,
  Layout,
  TextField,
  Form,
  FormLayout,
  Stack,
  Button,
  InlineError,
  Card,
  TextStyle,
  Heading,
} from "@shopify/polaris";
import { TitleBar, Context } from "@shopify/app-bridge-react";
import { authenticatedFetch } from "@shopify/app-bridge-utils";
import MembershipForm from "../components/MembershipForm";

class Index extends React.Component {
  static contextType = Context;
  static fetchWithAuth; // for authenticated requests to Shopify Admin API via app backend

  constructor(props) {
    super(props);
    this.state = {
      locks: [],
      discounts: [],
      newLockAddr: "",
      newLockAddrError: false,
      isLoading: false,
    };
  }

  componentDidMount() {
    const app = this.context;
    this.fetchWithAuth = authenticatedFetch(app);
    this.loadLocks();
  }

  render() {
    return (
      <Page>
        <TitleBar title="Settings" />
        <Layout>
          <Layout.AnnotatedSection
            title="Step 1: Setup Memperships"
            description="Add memberships to your shop, and reward members with discounts."
          >
            <Card title="Add Membership" sectioned>
              <Form onSubmit={this.handleContinue}>
                <FormLayout>
                  {this.state.newLockAddrError && (
                    <InlineError
                      message={this.state.newLockAddrError}
                      id="lockAddrError"
                    />
                  )}
                  <TextField
                    id="lockAddr"
                    label="Lock smart contract address"
                    value={this.state.newLockAddr}
                    onChange={(val) => this.validateAddr(val)}
                    aria-describedby="lockAddrError"
                    helpText="Example: 0x0b74E0ff5B61a16e94a5A29938d4Ea149CcD1619"
                  />
                  <Stack distribution="trailing">
                    <Button
                      primary
                      submit
                      disabled={
                        this.state.newLockAddrError ||
                        this.state.newLockAddr.length < 1
                      }
                    >
                      Continue
                    </Button>
                  </Stack>
                </FormLayout>
              </Form>

              <TextStyle variation="subdued">
                <Heading>No Lock?</Heading>
                <p>
                  You can create your own locks in the{" "}
                  <a
                    href="https://app.unlock-protocol.com/dashboard"
                    target="_blank"
                  >
                    Unlock Protocol Dashboard
                  </a>
                  .
                </p>
              </TextStyle>
            </Card>

            {this.state.locks.map((value, index) => (
              <MembershipForm
                value={value}
                discounts={this.state.discounts}
                index={index + 1}
                key={value.metafieldId}
                onSave={this.handleSaveLock}
                onDelete={this.deleteLock}
                isLoading={this.state.isLoading}
              />
            ))}
          </Layout.AnnotatedSection>

          {this.state.locks.length > 0 && (
            <Layout.AnnotatedSection
              title="Step 2: Publish Member Benefits"
              description="Show your customers what benefits await them, if they get a membership."
            >
              <Card title="Add Theme Section (recommended)" sectioned>
                <p>
                  Add sections to your theme in your Online Store settings under
                  Themes: Customize. <br />
                  You'll find the "MB -" sections in the <b>Promotional</b>{" "}
                  category.
                </p>
              </Card>
              <Card title="Custom Unlock Buttons" sectioned>
                <p>
                  Optionally, you can edit your theme's code and integrate
                  custom unlock buttons. Find the appropriate theme file under
                  Online Store > Themes > Actions > Edit code. Here's an example
                  that you could for example use in your theme's{" "}
                  <b>index.liquid</b>:
                </p>
                <TextField
                  multiline={2}
                  value={
                    `<style>
.unlock-demo {
  text-align: center;
}

.unlock-content {
  display: none;
}

.unlock-content .locked {
  display: none;  
}

.unlock-content .unlocked {
  display: none;
}
</style>

<div class="unlock-demo">
  <h1>Member Benefits</h1>

  <p class="unlock-content locked">
    You don't seem to have a membership 🔒<br/>
    Get a key to become a member instantly 🔑
  </p>

  <p class="unlock-content unlocked">
    Welcome, dear member! 🎉<br/>
    You've unlocked <b>your benefit</b> 🎁
  </p>

  <div class="hidden-after-unlocked">
    <hr/>
` +
                    this.state.locks
                      .map(
                        (lock, key) => `
<h2>${this.state.locks[key].name}</h2>
<button class="btn" onclick='window.showUnlockPaywall({"network":${this.state.locks[key].networkId},"locks":{"${this.state.locks[key].address}":{"name":"${this.state.locks[key].name}"}},"icon":"https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg","callToAction":{"default":"${this.state.locks[key].cta}"}})'>
  Unlock Member Benefit
</button>
`
                      )
                      .join("<hr/>") +
                    `
    <hr/>
  </div>

</div>
                    `
                  }
                />
              </Card>
              <Card title="CSS Classes" sectioned>
                <p>
                  Use the following CSS class to{" "}
                  <b>display elements to members only after unlocking</b>:
                </p>
                <pre>class="unlocked-content unlocked"</pre>
                <p>
                  Use the following CSS class to{" "}
                  <b>display elements to non-members after unlock attempt</b>:
                </p>
                <pre>class="unlocked-content locked"</pre>
                <p>
                  Use the following CSS class to{" "}
                  <b>display elements only before the unlock attempt</b>:
                </p>
                <pre>class="hidden-after-unlocked"</pre>
              </Card>
            </Layout.AnnotatedSection>
          )}
        </Layout>

        <Button onClick={this.handleReset}>Reset App</Button>
      </Page>
    );
  }

  handleReset = async () => {
    try {
      console.log("Reset initiated");
      const resetRes = await this.fetchWithAuth(`/api/reset`, {
        method: "GET",
      });
      const response = await resetRes.json();
      console.log("Deleted app resources", response);
      await this.loadLocks();
    } catch (err) {
      console.log("Error in reset", err);
    }
  };

  loadLocks = async () => {
    try {
      const lockRes = await this.fetchWithAuth(`/api/locks`, { method: "GET" });
      const response = await lockRes.json();
      console.log("locks response", response);

      if (response.errors || !response.data) {
        throw `Error in metafield response: ${JSON.stringify(response)}`;
      }

      this.setState({
        locks: response.data.locks,
        discounts: response.data.discounts,
      });
    } catch (err) {
      console.log("Error in loadLocks", err);
    }
  };

  handleContinue = async () => {
    try {
      const saveRes = await this.fetchWithAuth("/api/addLock", {
        method: "POST",
        body: JSON.stringify({
          lockAddr: this.state.newLockAddr,
        }),
      });
      const result = await saveRes.json();

      if (result.status !== "success" || !result.data) {
        throw result.errors;
      }

      const { metafieldId } = result.data;
      this.setState({
        locks: [
          ...this.state.locks,
          {
            metafieldId,
            address: this.state.newLockAddr,
          },
        ],
      });
      this.setState({ newLockAddr: "" });
    } catch (err) {
      console.log("Error in handleContinue:", err);
    }
  };

  handleSaveLock = async (e) => {
    this.setState({ isLoading: true });
    try {
      const otherLocks = this.state.locks
        .filter(
          ({ metafieldId }) =>
            metafieldId != e.target.elements.metafieldId.value
        )
        .map(({ networkId, name, address }) => ({ networkId, name, address }));
      const metafieldId = e.target.elements.metafieldId.value;
      const address = e.target.elements.lockAddress.value;
      const name = e.target.elements.name.value;
      const isEnabled = e.target.elements.enabled.checked;
      const networkId = parseInt(e.target.elements.networkId.value);
      const discountId = e.target.elements.discountId.value;
      const saveRes = await this.fetchWithAuth("/api/saveLock", {
        method: "POST",
        body: JSON.stringify({
          address,
          name,
          isEnabled,
          networkId,
          discountId,
          metafieldId,
          otherLocks,
        }),
      });
      const result = await saveRes.json();
      if (result.status !== "success" || !result.data) {
        throw result.errors;
      }
      console.log("Saved lock");
      const { scriptTagId } = result.data;
      if (scriptTagId) {
        console.log("Active scriptTag ID:", scriptTagId);
      }
      await this.loadLocks();
    } catch (err) {
      console.log("Error in handleSaveLock:", err);
    }
    this.setState({ isLoading: false });
  };

  deleteLock = async (lockAddress, metafieldId) => {
    try {
      const saveRes = await this.fetchWithAuth("/api/removeLock", {
        method: "POST",
        body: JSON.stringify({
          metafieldId,
        }),
      });
      const result = await saveRes.json();
      if (!result || result.status !== "success") {
        throw result.errors;
      }
      this.setState({
        locks: this.state.locks.filter(
          ({ address }) => address !== lockAddress
        ),
      });
    } catch (err) {
      console.log("Error in deleteLock:", err);
    }
  };

  validateAddr = (addr) => {
    this.setState({ newLockAddr: addr });
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      this.setState({
        newLockAddrError: "Pattern not recognized as valid Ethereum address.",
      });
      return;
    }

    const hasLock = this.state.locks.find(({ address }) => address === addr);
    if (hasLock) {
      this.setState({ newLockAddrError: "This lock address already exists." });
      return;
    }

    console.log("false");
    this.setState({ newLockAddrError: false });
  };
}

export default Index;
