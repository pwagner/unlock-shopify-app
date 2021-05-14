import React, { useState, useCallback } from "react";
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
  Select,
  Checkbox,
  TextStyle,
  Heading,
} from "@shopify/polaris";
import { TitleBar, Context } from "@shopify/app-bridge-react";
import { authenticatedFetch } from "@shopify/app-bridge-utils";

class Index extends React.Component {
  static contextType = Context;
  static fetchWithAuth; // for authenticated requests to Shopify Admin API via app backend

  constructor(props) {
    super(props);
    this.state = {
      locks: [],
      newLockAddr: "",
      newLockAddrError: false,
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
            title="Setup Memperships"
            description="Add memberships to your shop, and reward members with discounts."
          >
            <Card title="Add Membership" sectioned>
              <Form onSubmit={this.handleContinue}>
                <FormLayout>
                  {this.state.newLockAddrError && (
                    <InlineError
                      message="Pattern not recognized as valid Ethereum address, please check!"
                      fieldID="lockAddr"
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

            {this.state.locks.map((value, index) => {
              return (
                <Card key={`card-${index}`} sectioned>
                  <div style={{ float: "left" }}>
                    <h2 className="Polaris-Heading">Membership #{index + 1}</h2>
                  </div>
                  <Stack distribution="trailing">
                    <Button
                      small
                      onClick={() =>
                        this.deleteLock(value.address, value.metafieldId)
                      }
                    >
                      X
                    </Button>
                  </Stack>
                  <br />
                  <Form onSubmit={this.handleSaveLock}>
                    <FormLayout>
                      <input
                        type="hidden"
                        name="membershipNumber"
                        value={index + 1}
                      />
                      <input
                        type="hidden"
                        name="metafieldId"
                        value={value.metafieldId}
                      />
                      <TextField
                        name="lockAddress"
                        value={value.address}
                        disabled
                      />
                      <LockNetworkSelect
                        name="networkId"
                        defaultValue={value.networkId || 100}
                      />
                      <LockBenefitSelect
                        name="discountId"
                        discounts={this.state.discounts}
                        defaultValue={value.discountId || ""}
                      />
                      <LockTextField
                        label="Lock name"
                        name="name"
                        helpText="Explain the benefit your customers receive here"
                        onChange={this.handleTextInput}
                        defaultValue={value.name || ""}
                      />
                      <LockTextField
                        label="Call to action"
                        name="cta"
                        helpText="Enter an engaging label for the join-button here"
                        onChange={this.handleTextInput}
                        defaultValue={value.cta || ""}
                      />
                      <IsEnabledCheckbox
                        name="enabled"
                        checked={value.isEnabled || false}
                      />

                      <p>
                        <b>Note:</b> You can add the following attribute to any
                        HTML tag in your theme's code to turn it into an unlock
                        button for this lock. It uses the Unlock Paywall and
                        contains the paywall configuration for this lock.
                      </p>
                      <input
                        disabled
                        value={`onclick='window.showUnlockPaywall(${JSON.stringify(
                          {
                            network: parseInt(value.networkId),
                            locks: {
                              [value.address]: {
                                name: value.name,
                              },
                            },
                            icon:
                              "https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg",
                            callToAction: {
                              default: value.cta,
                            },
                          }
                        )})'`}
                      />

                      <Stack distribution="trailing">
                        <Button primary submit>
                          Save
                        </Button>
                      </Stack>
                    </FormLayout>
                  </Form>
                </Card>
              );
            })}
          </Layout.AnnotatedSection>

          {this.state.locks.length > 0 && (
            <Layout.AnnotatedSection
              title="Publish Member Benefits"
              description="Show your customers what benefits await them, if they get a membership."
            >
              <Card title="Add Theme Section (recommended)" sectioned>
                <p>
                  You can use the <b>theme sections</b> starting with{" "}
                  <em>MB</em> followed by the lock number (e.g. "MB #1" for the
                  first membership) in the{" "}
                  <a href="/admin/themes">Theme Editor</a>. <br />
                  You can add sections to your theme under Online Store > Themes
                  > Customize. <br />
                  You'll find the "MB -" sections in the <b>Promotional</b>{" "}
                  category.
                </p>
              </Card>
              <Card title="Custom Unlock Button" sectioned>
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
    You don't seem to have a memberhsip 🔒<br/>
    Get a key to become a member instantly 🔑
  </p>

  <p class="unlock-content unlocked">
    Welcome, dear member! 🎉<br/>
    You've unlocked <b>your benefit</b> 🎁
  </p>

  <div class="hide-after-unlocked">
    <hr/>
` +
                    this.state.locks
                      .map(
                        (lock, key) => `
<h2>${this.state.locks[key].name}</h2>
<button class="button" onclick='window.showUnlockPaywall({"network":${this.state.locks[key].networkId},"locks":{"${this.state.locks[key].address}":{"name":"${this.state.locks[key].name}"}},"icon":"https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg","callToAction":{"default":"${this.state.locks[key].cta}"}})'>
  ${this.state.locks[key].cta}
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
                <pre>class="hide-after-unlocked"</pre>
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

  handleTextInput = (e) => {
    this.setState({ [e.target.name]: [e.target.value] });
  };

  handleSaveLock = async (e) => {
    try {
      const membershipNumber = e.target.elements.membershipNumber.value;
      const metafieldId = e.target.elements.metafieldId.value;
      const address = e.target.elements.lockAddress.value;
      const name = e.target.elements.name.value;
      const cta = e.target.elements.cta.value;
      const isEnabled = e.target.elements.enabled.checked;
      const networkId = parseInt(e.target.elements.networkId.value);
      const discountId = e.target.elements.discountId.value;
      const saveRes = await this.fetchWithAuth("/api/saveLock", {
        method: "POST",
        body: JSON.stringify({
          membershipNumber,
          address,
          name,
          cta,
          isEnabled,
          networkId,
          discountId,
          metafieldId,
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

  validateAddr = (val) => {
    // TODO: check if lock was already added!
    this.setState({ newLockAddr: val });
    if (!/^0x[a-fA-F0-9]{40}$/.test(val)) {
      console.log("true");
      this.setState({ newLockAddrError: true });
    } else {
      console.log("false");
      this.setState({ newLockAddrError: false });
    }
  };
}

const LockNetworkSelect = ({ name, defaultValue }) => {
  const [selected, setSelected] = useState(defaultValue);
  const handleSelectChange = useCallback((value) => setSelected(value), []);
  const options = [
    { label: "xDai", value: "100" },
    { label: "Ethereum", value: "1" },
    { label: "Rinkeby", value: "4" },
  ];

  return (
    <Select
      label="Network:"
      labelInline
      options={options}
      onChange={handleSelectChange}
      value={selected}
      name={name}
    />
  );
};

const LockBenefitSelect = ({ name, discounts, defaultValue }) => {
  const [selected, setSelected] = useState(defaultValue);
  const handleSelectChange = useCallback((value) => setSelected(value), []);
  const options = [{ label: "-- Select Discount --", value: "" }];
  discounts.map((code) => {
    options.push({ label: code, value: code });
  });

  return (
    <Select
      label="Benefit:"
      labelInline
      options={options}
      onChange={handleSelectChange}
      value={selected}
      name={name}
    />
  );
};

const LockTextField = (props) => {
  const [value, setValue] = useState(props.defaultValue);
  const handleChange = useCallback((newValue) => setValue(newValue), []);

  return <TextField {...props} value={value} onChange={handleChange} />;
};

const IsEnabledCheckbox = (props) => {
  const [checked, setChecked] = useState(props.checked);
  const handleChange = useCallback((newChecked) => setChecked(newChecked), []);
  const helpText = checked ? "Lock is enabled" : "Lock is disabled";

  return (
    <Checkbox
      label="Active"
      name="enabled"
      helpText={helpText}
      checked={checked}
      onChange={handleChange}
    />
  );
};

export default Index;
